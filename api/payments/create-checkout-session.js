import Stripe from 'stripe'
import { verifyClerkRequest } from '../_lib/clerk.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { patchTreasurerSub } from '../_lib/treasurerSubs.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const FLOW_ROLES = {
  event_registration: ['manager'],       // self-registrant is also allowed, checked separately below
  private_event_deposit: ['manager', 'secretary'],
  treasurer_sub: ['manager', 'treasurer'],
}

// POST { flow, refId, clubId } — creates a Stripe Checkout Session as a direct
// charge on the club's connected account (funds go straight to the club, no
// platform fee for v1). The amount is always looked up server-side from the
// source-of-truth row — never trusted from the client.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { flow, refId, clubId } = req.body || {}
  if (!flow || !refId || !clubId || !FLOW_ROLES[flow]) {
    return res.status(400).json({ error: 'flow, refId and clubId are required' })
  }

  const admin = supabaseAdmin()

  const { data: account, error: acctError } = await admin
    .from('club_payment_accounts')
    .select('provider_account_id, charges_enabled')
    .eq('club_id', clubId)
    .maybeSingle()
  if (acctError) return res.status(500).json({ error: acctError.message })
  if (!account?.charges_enabled) {
    return res.status(400).json({ error: 'This club has not enabled online payments yet' })
  }

  const clerkUserId = await verifyClerkRequest(req)

  try {
    let amountCents, description, successPath

    if (flow === 'event_registration') {
      const { data: reg, error } = await admin
        .from('registrations')
        .select('id, payment_status, events(club_id, entry_fee_cents, name), players(clerk_user_id)')
        .eq('id', refId)
        .single()
      if (error || !reg) return res.status(404).json({ error: 'Registration not found' })
      if (reg.events.club_id !== clubId) return res.status(400).json({ error: 'Registration does not belong to this club' })
      if (reg.payment_status === 'paid') return res.status(400).json({ error: 'Already paid' })
      if (!reg.events.entry_fee_cents) return res.status(400).json({ error: 'Event has no online fee configured' })

      const isSelf = clerkUserId && reg.players?.clerk_user_id === clerkUserId
      const isManager = clerkUserId
        ? (await admin.rpc('has_any_club_role_for', { target_club_id: clubId, target_clerk_user_id: clerkUserId, allowed_roles: FLOW_ROLES.event_registration })).data
        : false
      if (!isSelf && !isManager) return res.status(403).json({ error: 'Not authorized to pay for this registration' })

      amountCents = reg.events.entry_fee_cents
      description = `Entry fee — ${reg.events.name}`
      successPath = `/?paid=event_registration&ref=${refId}`
    } else if (flow === 'private_event_deposit') {
      if (!clerkUserId) return res.status(401).json({ error: 'Unauthorized' })
      const isAuthorized = (await admin.rpc('has_any_club_role_for', { target_club_id: clubId, target_clerk_user_id: clerkUserId, allowed_roles: FLOW_ROLES.private_event_deposit })).data
      if (!isAuthorized) return res.status(403).json({ error: 'Only a secretary or manager can generate a deposit link' })

      const { data: pe, error } = await admin
        .from('private_events')
        .select('id, club_id, label, deposit_amount_cents, payment')
        .eq('id', refId)
        .single()
      if (error || !pe) return res.status(404).json({ error: 'Private event not found' })
      if (pe.club_id !== clubId) return res.status(400).json({ error: 'Private event does not belong to this club' })
      if (pe.payment?.status === 'paid') return res.status(400).json({ error: 'Already paid' })
      if (!pe.deposit_amount_cents) return res.status(400).json({ error: 'No deposit amount set for this booking' })

      amountCents = pe.deposit_amount_cents
      description = `Deposit — ${pe.label || 'Private event booking'}`
      successPath = `/?paid=private_event_deposit&ref=${refId}`
    } else if (flow === 'treasurer_sub') {
      if (!clerkUserId) return res.status(401).json({ error: 'Unauthorized' })
      const isAuthorized = (await admin.rpc('has_any_club_role_for', { target_club_id: clubId, target_clerk_user_id: clerkUserId, allowed_roles: FLOW_ROLES.treasurer_sub })).data
      if (!isAuthorized) return res.status(403).json({ error: 'Only a treasurer or manager can generate a subs payment link' })

      const { data: club, error } = await admin.from('clubs').select('treasurer_subs').eq('id', clubId).single()
      if (error || !club) return res.status(404).json({ error: 'Club not found' })
      const entry = (club.treasurer_subs || []).find((s) => s.id === refId)
      if (!entry) return res.status(404).json({ error: 'Subs record not found' })
      if (entry.paymentStatus === 'paid' || entry.paid) return res.status(400).json({ error: 'Already paid' })
      if (!entry.amount) return res.status(400).json({ error: 'No amount set for this subs record' })

      amountCents = Math.round(Number(entry.amount) * 100)
      description = `Membership subs — ${entry.name || ''} (${entry.season || ''})`
      successPath = `/?paid=treasurer_sub&ref=${refId}`
    }

    const origin = req.headers.origin || `https://${req.headers.host}`
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: 'aud',
              unit_amount: amountCents,
              product_data: { name: description },
            },
            quantity: 1,
          },
        ],
        metadata: { flow, refId, clubId },
        success_url: `${origin}${successPath}`,
        cancel_url: `${origin}/?paid=cancelled`,
      },
      { stripeAccount: account.provider_account_id }
    )

    // Mark pending immediately with the checkout reference/URL — gives the UI
    // something to show right away and gives the webhook an existing row to
    // transition from. The webhook is still the only thing allowed to mark 'paid'.
    if (flow === 'event_registration') {
      await admin
        .from('registrations')
        .update({ payment_status: 'pending', payment_provider: 'stripe', payment_reference: session.id, payment_amount_cents: amountCents })
        .eq('id', refId)
    } else if (flow === 'private_event_deposit') {
      await admin
        .from('private_events')
        .update({ payment: { status: 'pending', provider: 'stripe', reference: session.id, checkoutUrl: session.url } })
        .eq('id', refId)
    } else if (flow === 'treasurer_sub') {
      await patchTreasurerSub(admin, clubId, refId, {
        paymentStatus: 'pending',
        paymentProvider: 'stripe',
        paymentReference: session.id,
        checkoutUrl: session.url,
      })
    }

    return res.status(200).json({ url: session.url })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
