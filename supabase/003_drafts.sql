-- AI가 쓴 블로그·인스타 글 보관함
-- 002_community.sql을 실행한 뒤, Supabase SQL Editor에서 한 번 실행하세요. (여러 번 실행해도 안전)

create table if not exists public.drafts (
  id           bigint generated always as identity primary key,
  kind         text        not null check (kind in ('single', 'bundle', 'weekly')),
  posting_ids  bigint[]    not null default '{}',
  title        text        not null,
  blog         text        not null,
  instagram    text        not null,
  hashtags     text[]      not null default '{}',
  created_by   text,                       -- 쓴 사람 이메일, 자동 작성은 'weekly'
  created_at   timestamptz not null default now()
);
create index if not exists drafts_created_at_idx on public.drafts (created_at desc);

alter table public.drafts enable row level security;

-- 보관함은 누구나 읽기 (사이트에서 복사해 쓰기 위해), 쓰기·삭제는 관리자만
drop policy if exists "drafts are public" on public.drafts;
create policy "drafts are public"
  on public.drafts for select
  to anon, authenticated
  using (true);

drop policy if exists "admins write drafts" on public.drafts;
create policy "admins write drafts"
  on public.drafts for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "admins delete drafts" on public.drafts;
create policy "admins delete drafts"
  on public.drafts for delete
  to authenticated
  using (public.is_admin());

grant select on public.drafts to anon, authenticated;
grant insert, delete on public.drafts to authenticated;
grant all on public.drafts to service_role;
grant usage on all sequences in schema public to authenticated, service_role;
