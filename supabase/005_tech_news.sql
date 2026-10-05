-- 'AI·SW 뉴스'(tech_news) 분류 추가
-- Supabase SQL Editor에서 한 번 실행하세요. (여러 번 실행해도 안전)
-- 실행 전에는 수집기의 tech_news 출처만 저장에 실패하고, 나머지는 정상 동작합니다.

alter table public.postings drop constraint if exists postings_category_check;
alter table public.postings
  add constraint postings_category_check
  check (category in ('activity', 'intern', 'uou_news', 'tech_news'));
