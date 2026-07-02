import Stripe from 'stripe'
import { supabaseAdmin } from '../_lib/supabaseAdmin.js'
import { patchTreasurerSub } from '../_lib/treasurerSubs.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Signature verification needs the raw request body, not Vercel's parsed JSON.
export const config = { api: { bodyParser: false } }

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// The ONLY writer of payment_status/paid state anywhere in the app. Registered
// in the Stripe Dashboard with "Listen to events on Connected accounts" enabled,
// so this one endpoint receives both platform events and connected-account
// events (direct-charge Checkout completions fire on the connected account's
// event stream, not the platform's, unless Connect forwarding is turned on).
// Checkout Sessions are still v1 API, so classic webhook registration/signature
// verification is correct here. Does NOT handle account status changes — v2
// Connect accounts report those via a separate "Event Destinations" system
// (deferred); connect-status.js's polling is the only status-refresh path today.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const sig = req.headers['stripe-signature']
  let event
  try {
    const rawBody = await readRawBody(req)
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` })
  }

  const admin = supabaseAdmin()

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object
      const { flow, refId } = session.metadata || {}
      if (flow && refId && session.payment_status === 'paid') {
        const paidAt = new Date().toISOString()

        if (flow === 'event_registration') {
          await admin
            .from('registrations')
            .update({
              payment_status: 'paid',
              payment_provider: 'stripe',
              payment_reference: session.id,
              payment_amount_cents: session.amount_total,
            })
            .eq('id', refId)
        } else if (flow === 'private_event_deposit') {
          await admin
            .from('private_events')
            .update({ payment: { status: 'paid', provider: 'stripe', reference: session.id, paidAt } })
            .eq('id', refId)
        } else if (flow === 'treasurer_sub') {
          await patchTreasurerSub(admin, session.metadata.clubId, refId, {
            paymentStatus: 'paid',
            paymentProvider: 'stripe',
            paymentReference: session.id,
            paid: true,
            paidDate: paidAt.slice(0, 10),
          })
        }
      }
    }

    return res.status(200).json({ received: true })
  } catch (err) {
    // Returning 500 tells Stripe to retry delivery — safe here since every write
    // above is a plain update keyed by id/reference, not an insert (idempotent).
    return res.status(500).json({ error: err.message })
  }
}
