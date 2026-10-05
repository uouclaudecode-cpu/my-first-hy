-- 방문자 공고 올리기 · 신고 · 관리자 기능
-- schema.sql을 실행한 뒤, Supabase SQL Editor에서 이 파일을 한 번 실행하세요. (여러 번 실행해도 안전)

-- 1) 숨김 표시 ----------------------------------------------------------------
alter table public.postings add column if not exists hidden boolean not null default false;

-- 2) 관리자 목록 -------------------------------------------------------------
create table if not exists public.admins (
  email text primary key
);
alter table public.admins enable row level security; -- 정책 없음 = 공개 키로는 읽을 수 없음
insert into public.admins (email) values ('uouclaudecode@gmail.com') on conflict do nothing;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where email = lower(auth.jwt() ->> 'email'));
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 3) 방문자 공고 입력 검사 ----------------------------------------------------
-- 방문자는 source='community'로만 넣을 수 있고, 아래 트리거가 값을 정리·검사합니다.
create or replace function public.prepare_community_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
begin
  -- 관리자 키(service_role)로 넣는 수집기 데이터는 건드리지 않습니다.
  if new.source is distinct from 'community' then
    return new;
  end if;

  new.title        := btrim(new.title);
  new.organization := nullif(btrim(coalesce(new.organization, '')), '');
  new.summary      := nullif(btrim(coalesce(new.summary, '')), '');
  new.url          := btrim(new.url);
  new.source_id    := gen_random_uuid()::text;
  new.tags         := array['방문자 제보'];
  new.hidden       := false;
  new.posted_at    := now();
  new.collected_at := now();
  new.updated_at   := now();

  if new.category not in ('activity', 'intern') then
    raise exception '분류는 대외활동 또는 인턴만 선택할 수 있어요.';
  end if;
  if char_length(new.title) not between 4 and 120 then
    raise exception '제목은 4~120자로 적어 주세요.';
  end if;
  if new.url !~* '^https?://[^\s/$.?#].[^\s]*$' or char_length(new.url) > 500 then
    raise exception '원문 링크는 http:// 또는 https://로 시작하는 주소여야 해요.';
  end if;
  if char_length(coalesce(new.organization, '')) > 60 then
    raise exception '주최는 60자 이내로 적어 주세요.';
  end if;
  if char_length(coalesce(new.summary, '')) > 200 then
    raise exception '한 줄 소개는 200자 이내로 적어 주세요.';
  end if;
  if new.deadline is not null and (new.deadline < today or new.deadline > today + 400) then
    raise exception '마감일은 오늘부터 1년 이내로 골라 주세요.';
  end if;
  if exists (
    select 1 from public.postings
    where url = new.url and collected_at > now() - interval '60 days'
  ) then
    raise exception '이미 올라와 있는 공고예요.';
  end if;
  if (
    select count(*) from public.postings
    where source = 'community' and collected_at > now() - interval '1 hour'
  ) >= 30 then
    raise exception '지금은 올리는 사람이 많아요. 잠시 후 다시 시도해 주세요.';
  end if;
  return new;
end;
$$;

drop trigger if exists prepare_community_post on public.postings;
create trigger prepare_community_post
  before insert on public.postings
  for each row execute function public.prepare_community_post();

-- 4) 신고 --------------------------------------------------------------------
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  posting_id  bigint not null references public.postings (id) on delete cascade,
  reason      text check (char_length(reason) <= 200),
  created_at  timestamptz not null default now()
);
create index if not exists reports_posting_idx on public.reports (posting_id);
alter table public.reports enable row level security;

-- 신고가 3건 쌓이면 자동으로 숨깁니다.
create or replace function public.hide_reported_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.reports where posting_id = new.posting_id) >= 3 then
    update public.postings set hidden = true where id = new.posting_id;
  end if;
  return new;
end;
$$;

drop trigger if exists hide_reported_post on public.reports;
create trigger hide_reported_post
  after insert on public.reports
  for each row execute function public.hide_reported_post();

-- 5) 권한(RLS) ---------------------------------------------------------------
-- 읽기: 숨긴 글은 관리자만
drop policy if exists "postings are public" on public.postings;
create policy "postings are public"
  on public.postings for select
  to anon, authenticated
  using (not hidden or public.is_admin());

-- 쓰기: 방문자는 community 글만 추가
drop policy if exists "visitors can post" on public.postings;
create policy "visitors can post"
  on public.postings for insert
  to anon, authenticated
  with check (source = 'community');

-- 관리자: 방문자 글 숨기기/보이기/삭제
drop policy if exists "admins manage community posts" on public.postings;
create policy "admins manage community posts"
  on public.postings for update
  to authenticated
  using (source = 'community' and public.is_admin())
  with check (source = 'community');

drop policy if exists "admins delete community posts" on public.postings;
create policy "admins delete community posts"
  on public.postings for delete
  to authenticated
  using (source = 'community' and public.is_admin());

-- 신고: 누구나 방문자 글에만 신고 가능, 신고 내용은 관리자만 보기·삭제
drop policy if exists "anyone can report community posts" on public.reports;
create policy "anyone can report community posts"
  on public.reports for insert
  to anon, authenticated
  with check (exists (select 1 from public.postings p where p.id = posting_id and p.source = 'community'));

drop policy if exists "admins read reports" on public.reports;
create policy "admins read reports"
  on public.reports for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins delete reports" on public.reports;
create policy "admins delete reports"
  on public.reports for delete
  to authenticated
  using (public.is_admin());

grant insert on public.postings to anon, authenticated;
grant update (hidden), delete on public.postings to authenticated;
grant insert on public.reports to anon, authenticated;
grant select, delete on public.reports to authenticated;
grant all on public.reports, public.admins to service_role;
grant usage on all sequences in schema public to anon, authenticated;
