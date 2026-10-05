-- 울산대 SW 서포터즈 공고 모음: Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 한 번 실행하세요. (여러 번 실행해도 안전)

-- 1) 공고 테이블 ------------------------------------------------------------
create table if not exists public.postings (
  id            bigint generated always as identity primary key,
  source        text        not null,             -- naver_news | work24 | wevity | uou_sw
  source_id     text        not null,             -- 출처 안에서의 고유 ID
  category      text        not null
                check (category in ('activity', 'intern', 'uou_news')),
  title         text        not null,
  organization  text,                             -- 주최/회사/언론사
  url           text        not null,
  summary       text,
  deadline      date,                             -- 마감일 (없으면 null)
  posted_at     timestamptz,                      -- 원문 게시 시각
  tags          text[]      not null default '{}',
  collected_at  timestamptz not null default now(), -- 처음 수집한 시각
  updated_at    timestamptz not null default now(), -- 마지막으로 갱신한 시각
  unique (source, source_id)
);

create index if not exists postings_category_deadline_idx
  on public.postings (category, deadline);
create index if not exists postings_posted_at_idx
  on public.postings (posted_at desc);

-- 2) 수집 실행 기록 (사이트에 "마지막 수집 시각" 표시용) -------------------
create table if not exists public.collector_runs (
  id           bigint generated always as identity primary key,
  started_at   timestamptz not null,
  finished_at  timestamptz not null default now(),
  upserted     integer     not null default 0,
  results      jsonb       not null default '{}'   -- 출처별 개수/오류 메시지
);

-- 3) 권한: 공개 키(anon)는 읽기만, 쓰기는 Secret 키(service_role)만 ----------
alter table public.postings       enable row level security;
alter table public.collector_runs enable row level security;

drop policy if exists "postings are public" on public.postings;
create policy "postings are public"
  on public.postings for select
  to anon, authenticated
  using (true);

drop policy if exists "runs are public" on public.collector_runs;
create policy "runs are public"
  on public.collector_runs for select
  to anon, authenticated
  using (true);

-- 새 테이블이 Data API에 자동 노출되지 않는 프로젝트도 있어서 명시적으로 부여합니다.
grant select on public.postings, public.collector_runs to anon, authenticated;
grant all    on public.postings, public.collector_runs to service_role;
grant usage, select on all sequences in schema public to service_role;
