import Stripe from 'stripe'
import { verifyClerkRequest } from '../_lib/clerk.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// GET ?clubId=... — re-fetches the connected account's status from Stripe and
// syncs it onto club_payment_accounts. Called when a manager returns from
// onboarding. This is the ONLY status-refresh path for now (v2 Connect accounts
// report status changes via a separate "Event Destinations" webhook system, not
// the classic account.updated webhook — deferred; polling here is a deliberate
// simplification until that's built).
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const clerkUserId = await verifyClerkRequest(req)
  if (!clerkUserId) return res.status(401).json({ error: 'Unauthorized' })

  const { clubId } = req.query || {}
  if (!clubId) return res.status(400).json({ error: 'clubId is required' })

  const admin = supabaseAdmin()

  const { data: isManager, error: managerError } = await admin.rpc('has_any_club_role_for', {
    target_club_id: clubId,
    target_clerk_user_id: clerkUserId,
    allowed_roles: ['manager'],
  })
  if (managerError) return res.status(500).json({ error: managerError.message })
  if (!isManager) return res.status(403).json({ error: 'Only a club manager can view payment account status' })

  const { data: account, error: fetchError } = await admin
    .from('club_payment_accounts')
    .select('*')
    .eq('club_id', clubId)
    .maybeSingle()
  if (fetchError) return res.status(500).json({ error: fetchError.message })
  if (!account?.provider_account_id) return res.status(200).json({ account: account || null })

  try {
    const stripeAccount = await stripe.v2.core.accounts.retrieve(account.provider_account_id, {
      include: ['configuration.merchant'],
    })
    const status = stripeAccount.configuration?.merchant?.capabilities?.card_payments?.status
    // v2 capability status: 'active' | 'pending' | 'restricted' | 'unsupported'.
    // Mapped onto this table's existing boolean/enum shape rather than adding a
    // migration — charges_enabled is the only field the client UI actually gates on.
    const patch = {
      charges_enabled: status === 'active',
      details_submitted: status === 'active' || status === 'restricted',
      onboarding_status: status === 'active' ? 'complete' : status === 'restricted' ? 'restricted' : status === 'pending' ? 'pending' : 'not_started',
    }
    const { data: updated, error: updateError } = await admin
      .from('club_payment_accounts')
      .update(patch)
      .eq('club_id', clubId)
      .select()
      .single()
    if (updateError) return res.status(500).json({ error: updateError.message })

    return res.status(200).json({ account: updated })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
