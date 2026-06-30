# Environments

Two tiers: **dev** and **production**, each with its own Supabase project and Clerk instance.

| Tier | Branch | Vercel env | Supabase project ref | Clerk instance |
|---|---|---|---|---|
| dev | any non-master branch / local | Preview, Development | `cvjazjoqghotsbykxtkk` | test (`pk_test_...`) |
| production | `master` | Production | `ezgjlhhnlxlaimdfscyi` | production (`pk_live_...`), domain `croquetok.com` |

Vercel auto-deploys `master` to Production (served at `croquetok.com`) and every other branch/PR to a Preview URL, each wired to the matching Supabase project + Clerk instance via env vars already set in the Vercel project (`vercel env ls` to inspect).

## Local development

`.env` already points at the dev Supabase project — `npm run dev` as usual.

## Promoting a schema change to production

1. Add a new file under `supabase/migrations/` (e.g. `004_xyz.sql`) and apply it to dev:
   ```
   npm run db:link:dev
   npx supabase db push
   ```
2. Verify against the dev Preview deployment.
3. Promote the same migration to production:
   ```
   npm run db:link:prod
   npx supabase db push
   ```
4. Merge to `master` — Vercel deploys Production pointing at the now-matching prod schema.

Migrations are applied in order and tracked per-project, so `db push` only applies what's new to whichever project is currently linked.

## RLS

`committee_documents` and `greens_reports` are scoped to the requester's own club (matched via `user_roles.club`, normalized through `club_slug()`) or `is_admin`. `broadcast_contributions` allows anonymous inserts (the QR-join contributor flow is sign-in-free by design) but restricts reading the queue and approving/rejecting to the `broadcaster` role or admins. Matching `storage.objects` policies exist for the `committee-docs`, `greens-reports`, and `broadcast-media` buckets. See `supabase/migrations/004_tighten_rls.sql`.
