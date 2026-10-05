// 매주 월요일 아침: 이번 주에 챙길 공고를 골라 "이번 주 SW 공고 모음" 글을 써서 보관함(drafts)에 저장합니다.
//   node scripts/weekly-posts.mjs            → 저장
//   node scripts/weekly-posts.mjs --dry-run  → 고른 공고만 출력 (AI 호출·저장 안 함)
// 환경 변수: ANTHROPIC_API_KEY, SUPABASE_SECRET_KEY

import Anthropic from '@anthropic-ai/sdk';
import { writePosts, todayKst } from '../lib/writer.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yggicyfxcyutfmcsnhxw.supabase.co';
const dryRun = process.argv.includes('--dry-run');
const key = process.env.SUPABASE_SECRET_KEY || 'sb_publishable_QSU6nO1Kil6FBi-wtTWLRw_tRD02S6M';

async function db(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const addDays = (ymd, n) => new Date(Date.parse(ymd) + n * 86400e3).toISOString().slice(0, 10);

/** 이번 주 글에 넣을 공고: 앞으로 3주 안에 마감하는 대외활동·인턴 최대 7개 + 최근 1주 울산대 소식 최대 2개 */
async function pickPostings() {
  const today = todayKst();
  const cols = 'id,category,title,organization,url,summary,deadline,tags';
  const upcoming = await db(
    `postings?select=${cols}&hidden=eq.false&category=in.(activity,intern)` +
      `&deadline=gte.${today}&deadline=lte.${addDays(today, 21)}&order=deadline.asc&limit=7`,
  );
  const news = await db(
    `postings?select=${cols}&hidden=eq.false&category=eq.uou_news` +
      `&posted_at=gte.${addDays(today, -7)}&order=posted_at.desc&limit=2`,
  );
  return [...upcoming, ...news];
}

const postings = await pickPostings();
console.log(`고른 공고 ${postings.length}개`);
for (const p of postings) console.log(`  - ${p.deadline ?? '----------'} [${p.category}] ${p.title}`);
if (dryRun) process.exit(0);
if (postings.length === 0) {
  console.log('이번 주에 소개할 공고가 없어 건너뜁니다.');
  process.exit(0);
}
if (!process.env.SUPABASE_SECRET_KEY) {
  console.error('SUPABASE_SECRET_KEY가 없습니다.');
  process.exit(1);
}

try {
  const post = await writePosts(postings, 'weekly');
  await db('drafts', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ kind: 'weekly', posting_ids: postings.map((p) => p.id), ...post, created_by: 'weekly' }),
  });
  console.log(`저장 완료: ${post.title}`);
} catch (err) {
  if (err instanceof Anthropic.AuthenticationError) console.error('ANTHROPIC_API_KEY가 올바르지 않습니다.');
  else if (err instanceof Anthropic.APIError) console.error(`Claude API 오류 ${err.status}: ${err.message}`);
  else console.error(err.message);
  process.exit(1);
}
