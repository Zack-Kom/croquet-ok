import { verifyToken } from '@clerk/backend'

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY

// Verifies the Clerk session token sent as `Authorization: Bearer <token>` by the
// client (the default getToken() token — NOT the "supabase" JWT template token,
// which is shaped for Postgres RLS rather than general verification). Returns the
// Clerk user id (`sub`), or null if the header is missing or the token is invalid.
export async function verifyClerkRequest(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return null
  try {
    const { sub } = await verifyToken(token, { secretKey: CLERK_SECRET_KEY })
    return sub || null
  } catch {
    return null
  }
}
