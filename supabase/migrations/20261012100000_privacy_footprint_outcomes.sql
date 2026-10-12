-- Append-only record of user-reported website responses and removal outcomes.
-- These reports are not independently verified; verification observations remain separate.
create table if not exists public.privacy_footprint_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finding_id uuid not null references public.privacy_footprint_findings(id) on delete cascade,
  reported_by uuid not null references auth.users(id) on delete cascade,
  outcome text not null check (outcome in (
    'no_response', 'needs_more_information', 'request_accepted',
    'request_rejected', 'content_removed_reported', 'content_reappeared_reported'
  )),
  note text not null default '' check (char_length(note) <= 1500),
  reported_at timestamptz not null default now()
);

create index if not exists privacy_footprint_outcomes_finding_reported_idx
  on public.privacy_footprint_outcomes (organization_id, finding_id, reported_at desc);

alter table public.privacy_footprint_outcomes enable row level security;

drop policy if exists "Organization members can read footprint outcomes" on public.privacy_footprint_outcomes;
create policy "Organization members can read footprint outcomes"
  on public.privacy_footprint_outcomes for select to authenticated
  using (organization_id = (select p.organization_id from public.profiles p where p.id = auth.uid()));

drop policy if exists "Organization members can add footprint outcomes" on public.privacy_footprint_outcomes;
create policy "Organization members can add footprint outcomes"
  on public.privacy_footprint_outcomes for insert to authenticated
  with check (
    reported_by = auth.uid()
    and organization_id = (select p.organization_id from public.profiles p where p.id = auth.uid())
  );
