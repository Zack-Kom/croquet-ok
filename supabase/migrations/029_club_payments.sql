-- Provider-agnostic payment collection: clubs connect their own payment account
-- (Stripe Connect Standard to start; schema leaves room for PayPal/Square later
-- without a rewrite) and can then charge for event registrations, private-event
-- deposits, and treasurer subs. See the Stripe Connect design plan for the full
-- architecture — this migration only lays the schema/RLS foundation.

-- Mirrors user_is_club_manager()/the secretary-role checks' logic but takes the
-- clerk_user_id and an allowed-roles list explicitly, for server-side callers
-- (api/payments/*.js) using the service-role key — auth.jwt() reflects the
-- service role's own token there, not the real caller's, so the existing
-- auth.jwt()-based helpers can't be reused as-is. Keeps club_slug() matching as
-- the single source of truth instead of reimplementing it in JS. is_admin always
-- passes regardless of allowed_roles, matching every other role check in this app.
create or replace function public.has_any_club_role_for(target_club_id uuid, target_clerk_user_id text, allowed_roles text[])
returns boolean language sql stable as $$
  select exists (
    select 1 from public.user_roles ur
    join public.clubs c on c.id = target_club_id
    where ur.clerk_user_id = target_clerk_user_id
      and (ur.is_admin = true or (ur.roles && allowed_roles and public.club_slug(ur.club) = c.slug))
  )
$$;

create table public.club_payment_accounts (
  id                  uuid primary key default gen_random_uuid(),
  club_id             uuid not null references public.clubs(id) unique,
  provider            text not null default 'stripe',       -- 'stripe' | 'paypal' | 'square'
  provider_account_id text,                                  -- e.g. Stripe acct_...
  charges_enabled     boolean not null default false,
  details_submitted   boolean not null default false,
  onboarding_status   text not null default 'not_started',   -- not_started|pending|complete|restricted
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger club_payment_accounts_updated_at
  before update on public.club_payment_accounts
  for each row execute function public.set_updated_at();

alter table public.club_payment_accounts enable row level security;

-- Members can see the club's connect status (to show/hide "Pay" buttons), but
-- linking a payment account is security-sensitive: deliberately NO insert/update/
-- delete policy at all. Default-deny means only the service-role key (used
-- exclusively by api/payments/*.js) can write this table — the onboarding
-- endpoint does its own club-manager check in application code before writing,
-- since RLS can't run for a service-role connection.
create policy "club members can view payment account"
  on public.club_payment_accounts for select
  to authenticated
  using (public.user_is_club_member(club_id));

-- ─── registrations: generic payment fields ────────────────────────────────────
alter table public.registrations
  add column payment_status      text not null default 'none', -- none|pending|paid|refunded|failed
  add column payment_provider    text,
  add column payment_reference   text,   -- e.g. Stripe Checkout Session id
  add column payment_amount_cents int;

-- The existing "self or manager can update registrations" policy (migration 008)
-- lets a player update their own registration row — which would otherwise let
-- them set their own payment_status to 'paid' directly. Only the Stripe webhook
-- (using the service-role key, role = 'service_role') may change payment fields;
-- silently pin them back to their prior value for every other caller so normal
-- self-service edits (note, status) keep working unaffected.
create or replace function public.protect_registration_payment_fields()
returns trigger language plpgsql as $$
begin
  if auth.role() is distinct from 'service_role' then
    new.payment_status       := old.payment_status;
    new.payment_provider     := old.payment_provider;
    new.payment_reference    := old.payment_reference;
    new.payment_amount_cents := old.payment_amount_cents;
  end if;
  return new;
end;
$$;

create trigger registrations_protect_payment_fields
  before update on public.registrations
  for each row execute function public.protect_registration_payment_fields();

-- ─── private_events: deposit amount + payment status ───────────────────────────
-- Split in two: deposit_amount_cents is a normal quote the secretary sets (same
-- trust level as the existing date/time/assisting fields, no protection needed),
-- while `payment` holds the actual paid/pending state and must only ever be
-- written by the webhook — kept separate so protecting one doesn't also lock out
-- the other.
alter table public.private_events
  add column deposit_amount_cents int,
  add column payment jsonb not null default '{}'::jsonb;
  -- payment shape: {status, provider, reference, paidAt, checkoutUrl}

-- Same concern as registrations: "club members can manage private events"
-- (migration 020) is a blanket member-writable policy, so protect `payment`
-- the same way — only the webhook (service_role) may change it.
create or replace function public.protect_private_event_payment_field()
returns trigger language plpgsql as $$
begin
  if auth.role() is distinct from 'service_role' then
    new.payment := old.payment;
  end if;
  return new;
end;
$$;

create trigger private_events_protect_payment_field
  before update on public.private_events
  for each row execute function public.protect_private_event_payment_field();

-- ─── events: optional structured fee ───────────────────────────────────────────
-- Additive alongside the existing free-text entry_fee (kept as display fallback
-- for events not using online payment). Only set when an organizer explicitly
-- turns on "collect payment online" for the event; managers already have write
-- access to events (migration 008), no new RLS needed.
alter table public.events
  add column entry_fee_cents int;
