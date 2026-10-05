-- 홍보 현황: 어떤 공고를 어느 채널(블로그·인스타·에타)에 올렸는지 기록
-- Supabase SQL Editor에서 한 번 실행하세요. (여러 번 실행해도 안전)

create table if not exists public.promotions (
  posting_id  bigint      not null references public.postings (id) on delete cascade,
  channel     text        not null check (channel in ('blog', 'insta', 'everytime')),
  done_at     timestamptz not null default now(),
  primary key (posting_id, channel)
);
create index if not exists promotions_done_at_idx on public.promotions (done_at desc);

alter table public.promotions enable row level security;

-- 로그인 없이 팀원 누구나 표시·취소할 수 있게 엽니다. (사이트 주소를 아는 사람은 바꿀 수 있어요)
drop policy if exists "promotions are public" on public.promotions;
create policy "promotions are public"
  on public.promotions for select
  to anon, authenticated
  using (true);

drop policy if exists "anyone can mark promotions" on public.promotions;
create policy "anyone can mark promotions"
  on public.promotions for insert
  to anon, authenticated
  with check (true);

drop policy if exists "anyone can unmark promotions" on public.promotions;
create policy "anyone can unmark promotions"
  on public.promotions for delete
  to anon, authenticated
  using (true);

grant select, insert, delete on public.promotions to anon, authenticated;
grant all on public.promotions to service_role;
