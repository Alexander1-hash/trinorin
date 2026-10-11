-- User-initiated, organization-scoped evidence records for digital footprint discovery.
create table if not exists public.privacy_footprint_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  search_term text not null check (char_length(search_term) between 1 and 100),
  source_url text not null check (source_url ~ '^https?://'),
  page_title text not null default '',
  description text not null default '',
  provider text not null default 'Brave Search',
  page_age text,
  review_status text not null default 'needs_review'
    check (review_status in ('needs_review', 'confirmed_relevant', 'not_relevant', 'removal_requested', 'removed_verified', 'removal_rejected')),
  review_note text,
  discovered_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists privacy_footprint_findings_org_discovered_idx
  on public.privacy_footprint_findings (organization_id, discovered_at desc);
create index if not exists privacy_footprint_findings_org_status_idx
  on public.privacy_footprint_findings (organization_id, review_status);

alter table public.privacy_footprint_findings enable row level security;

drop policy if exists "Organization members can read footprint findings" on public.privacy_footprint_findings;
create policy "Organization members can read footprint findings"
  on public.privacy_footprint_findings for select to authenticated
  using (organization_id = (select p.organization_id from public.profiles p where p.id = auth.uid()));

drop policy if exists "Organization members can add footprint findings" on public.privacy_footprint_findings;
create policy "Organization members can add footprint findings"
  on public.privacy_footprint_findings for insert to authenticated
  with check (
    created_by = auth.uid()
    and organization_id = (select p.organization_id from public.profiles p where p.id = auth.uid())
  );

drop policy if exists "Organization members can review footprint findings" on public.privacy_footprint_findings;
create policy "Organization members can review footprint findings"
  on public.privacy_footprint_findings for update to authenticated
  using (organization_id = (select p.organization_id from public.profiles p where p.id = auth.uid()))
  with check (organization_id = (select p.organization_id from public.profiles p where p.id = auth.uid()));
