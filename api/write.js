// POST /api/write  { posting_ids: number[] }  (Authorization: Bearer <Supabase 로그인 토큰>)
// 로그인한 관리자만 호출할 수 있고, Claude가 쓴 글을 drafts 표에 저장한 뒤 돌려줍니다.
// Vercel 환경 변수: ANTHROPIC_API_KEY

import Anthropic from '@anthropic-ai/sdk';
import { writePosts } from '../lib/writer.mjs';

const SUPABASE_URL = 'https://yggicyfxcyutfmcsnhxw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_QSU6nO1Kil6FBi-wtTWLRw_tRD02S6M';
const MAX_POSTINGS = 8;

const json = (body, status = 200) => Response.json(body, { status });

async function supabase(path, token, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: 'Vercel에 ANTHROPIC_API_KEY가 등록되지 않았어요.' }, 500);
  }

  // 1) 로그인·관리자 확인
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: '로그인이 필요해요.' }, 401);
  const user = await supabase('/auth/v1/user', token);
  if (!user.ok) return json({ error: '로그인이 만료됐어요. 다시 로그인해 주세요.' }, 401);
  const admin = await supabase('/rest/v1/rpc/is_admin', token, { method: 'POST', body: '{}' });
  if (admin.data !== true) return json({ error: '글 쓰기 권한이 없는 계정이에요.' }, 403);

  // 2) 공고 불러오기
  let ids;
  try {
    ids = (await request.json()).posting_ids;
  } catch {
    return json({ error: '요청 형식이 올바르지 않아요.' }, 400);
  }
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_POSTINGS || !ids.every(Number.isInteger)) {
    return json({ error: `공고를 1~${MAX_POSTINGS}개 골라 주세요.` }, 400);
  }
  const cols = 'id,category,title,organization,url,summary,deadline,tags';
  const rows = await supabase(`/rest/v1/postings?id=in.(${ids.join(',')})&select=${cols}`, token);
  if (!rows.ok || !rows.data?.length) return json({ error: '공고를 찾지 못했어요.' }, 404);
  const postings = rows.data.sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
  const kind = postings.length === 1 ? 'single' : 'bundle';

  // 3) Claude로 글 쓰기
  let post;
  try {
    post = await writePosts(postings, kind);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return json({ error: 'Anthropic API 키가 올바르지 않아요.' }, 500);
    if (err instanceof Anthropic.RateLimitError) return json({ error: '요청이 많아요. 1분 뒤 다시 시도해 주세요.' }, 429);
    if (err instanceof Anthropic.APIError) return json({ error: `AI 호출 오류 (${err.status}). 잠시 후 다시 시도해 주세요.` }, 502);
    return json({ error: err.message }, 500);
  }

  // 4) 보관함에 저장 (관리자 권한으로)
  const saved = await supabase('/rest/v1/drafts', token, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      kind,
      posting_ids: postings.map((p) => p.id),
      ...post,
      created_by: user.data.email,
    }),
  });
  // 저장에 실패해도 쓴 글은 돌려줍니다.
  return json({ draft: saved.ok ? saved.data[0] : { kind, ...post }, saved: saved.ok });
}
