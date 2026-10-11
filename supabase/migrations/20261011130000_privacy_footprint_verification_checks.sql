-- Append-only verification observations for public footprint findings.
create table if not exists public.privacy_footprint_verification_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finding_id uuid not null references public.privacy_footprint_findings(id) on delete cascade,
  checked_by uuid not null references auth.users(id) on delete cascade,
  source_url text not null check (source_url ~ '^https?://'),
  http_status integer,
  verification_status text not null check (verification_status in ('content_still_detected', 'term_not_found', 'source_unavailable', 'verification_inconclusive')),
  page_title text not null default '',
  checked_term text not null,
  detail text not null default '',
  checked_at timestamptz not null default now()
);

create index if not exists privacy_footprint_checks_finding_checked_idx
  on public.privacy_footprint_verification_checks (organization_id, finding_id, checked_at desc);

alter table public.privacy_footprint_verification_checks enable row level security;

drop policy if exists "Organization members can read footprint verification checks" on public.privacy_footprint_verification_checks;
create policy "Organization members can read footprint verification checks"
  on public.privacy_footprint_verification_checks for select to authenticated
  using (organization_id = (select p.organization_id from public.profiles p where p.id = auth.uid()));

drop policy if exists "Organization members can add footprint verification checks" on public.privacy_footprint_verification_checks;
create policy "Organization members can add footprint verification checks"
  on public.privacy_footprint_verification_checks for insert to authenticated
  with check (
    checked_by = auth.uid()
    and organization_id = (select p.organization_id from public.profiles p where p.id = auth.uid())
  );
