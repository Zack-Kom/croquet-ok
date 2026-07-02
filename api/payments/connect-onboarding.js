import Stripe from 'stripe'
import { verifyClerkRequest } from '../_lib/clerk.js'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// POST { clubId } — creates (or resumes) the club's Stripe connected account
// (v2 Accounts API, Merchant configuration — the v2 equivalent of a v1 Standard
// account: the club is merchant of record via direct charges, and Stripe owns
// fee collection + negative-balance liability per defaults.responsibilities) and
// returns a hosted onboarding link to redirect the manager to.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const clerkUserId = await verifyClerkRequest(req)
  if (!clerkUserId) return res.status(401).json({ error: 'Unauthorized' })

  const { clubId } = req.body || {}
  if (!clubId) return res.status(400).json({ error: 'clubId is required' })

  const admin = supabaseAdmin()

  const { data: isManager, error: managerError } = await admin.rpc('has_any_club_role_for', {
    target_club_id: clubId,
    target_clerk_user_id: clerkUserId,
    allowed_roles: ['manager'],
  })
  if (managerError) return res.status(500).json({ error: managerError.message })
  if (!isManager) return res.status(403).json({ error: 'Only a club manager can connect a payment account' })

  try {
    let { data: account } = await admin
      .from('club_payment_accounts')
      .select('*')
      .eq('club_id', clubId)
      .maybeSingle()

    let acctId = account?.provider_account_id

    if (!acctId) {
      const stripeAccount = await stripe.v2.core.accounts.create({
        dashboard: 'full',
        configuration: {
          merchant: {
            capabilities: { card_payments: { requested: true } },
          },
        },
        defaults: {
          responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
        },
      })
      acctId = stripeAccount.id
      // Persist immediately — before creating the account link — so a retry
      // after a network failure reuses this account instead of creating a duplicate.
      const { error: upsertError } = await admin
        .from('club_payment_accounts')
        .upsert(
          { club_id: clubId, provider: 'stripe', provider_account_id: acctId, onboarding_status: 'pending' },
          { onConflict: 'club_id' }
        )
      if (upsertError) return res.status(500).json({ error: upsertError.message })
    }

    const origin = req.headers.origin || `https://${req.headers.host}`
    const accountLink = await stripe.v2.core.accountLinks.create({
      account: acctId,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['merchant'],
          refresh_url: `${origin}/?onboarding=refresh&clubId=${clubId}`,
          return_url: `${origin}/?onboarding=return&clubId=${clubId}`,
        },
      },
    })

    return res.status(200).json({ url: accountLink.url })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
