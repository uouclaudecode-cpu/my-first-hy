// 수집기 공통 도구: HTTP, 텍스트 정리, 날짜, Supabase REST

export const USER_AGENT =
  'UOU-SW-Supporters-Bot/1.0 (Ulsan Univ. SW supporters notice aggregator; hourly)';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url, { headers = {}, timeoutMs = 20000 } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.split('?')[0]}`);
  return res.text();
}

export async function fetchJson(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·' };

export function decodeEntities(s = '') {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function stripTags(html = '') {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(s, n) {
  if (!s) return null;
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** 한국 시간 기준 오늘 날짜 (YYYY-MM-DD) */
export function todayKst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function addDays(ymd, days) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * SW 관련 공고인지 판단할 때 쓰는 키워드.
 * 영어 약어는 대문자·단어 경계로만 매칭합니다. ('Competition'의 'it' 같은 오탐 방지)
 * '개발'은 '커리어개발', '산업개발'처럼 SW와 무관하게도 쓰여서 SW 맥락이 있을 때만 인정합니다.
 */
const SW_KO =
  /(소프트웨어|개발자|(앱|웹|게임|서비스|프로그램|시스템|플랫폼|솔루션|MVP|SW|AI)\s?개발|프로그래|코딩|해커톤|아이디어톤|전산|데이터|인공지능|머신러닝|딥러닝|빅데이터|웹(?!툰)|앱|모바일|백엔드|프론트엔드|풀스택|서버|클라우드|정보보안|사이버보안|임베디드|정보시스템|게임|로봇|블록체인|메타버스)/;
const SW_EN = /(?<![A-Za-z])(SW|S\/W|IT|ICT|AI|DX|AX|IoT|Python|Java|React|Unity)(?![A-Za-z])/;
export const SW_KEYWORDS = { test: (s) => SW_KO.test(s) || SW_EN.test(s) };

// ---------------------------------------------------------------------------
// Supabase (PostgREST) — Secret 키는 서버(GitHub Actions)에서만 사용합니다.

export function supabase({ url, secretKey }) {
  const base = url.replace(/\/$/, '') + '/rest/v1';
  const headers = { apikey: secretKey, 'Content-Type': 'application/json' };

  async function request(path, init = {}) {
    const res = await fetch(base + path, {
      ...init,
      headers: { ...headers, ...(init.headers || {}) },
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${body.slice(0, 300)}`);
    return body ? JSON.parse(body) : null;
  }

  return {
    select: (table, query) => request(`/${table}?${query}`),
    insert: (table, rows) =>
      request(`/${table}`, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(rows),
      }),
    /** (source, source_id) 기준 upsert. collected_at은 보내지 않아 최초 수집 시각이 유지됩니다. */
    async upsertPostings(rows) {
      const now = new Date().toISOString();
      // PostgREST 일괄 upsert는 모든 행의 키가 같아야 하고, 같은 키가 두 번 나오면 실패합니다.
      const unique = new Map();
      for (const r of rows) {
        unique.set(`${r.source}:${r.source_id}`, {
          source: r.source,
          source_id: String(r.source_id),
          category: r.category,
          title: r.title,
          organization: r.organization ?? null,
          url: r.url,
          summary: r.summary ?? null,
          deadline: r.deadline ?? null,
          posted_at: r.posted_at ?? null,
          tags: r.tags ?? [],
          updated_at: now,
        });
      }
      const all = [...unique.values()];
      for (let i = 0; i < all.length; i += 200) {
        const chunk = all.slice(i, i + 200);
        await request('/postings?on_conflict=source,source_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(chunk),
        });
      }
    },
  };
}
