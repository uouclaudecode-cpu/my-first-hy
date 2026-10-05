// 울산대학교 SW중심대학사업단(sw.ulsan.ac.kr) 공지사항
// - robots.txt: 'User-agent: * / Allow: /' (확인일 2026-10-05)
//   ※ www.ulsan.ac.kr 본 사이트는 robots.txt가 'Disallow: /' 이므로 수집하지 않습니다.
// - 공지 상세 페이지(/site/swulsan/notices/{id})에 들어 있는 Next.js 데이터(__NEXT_DATA__)를 읽고,
//   그 안의 next_id/prev_id를 따라가며 새 글만 가져옵니다. (요청 사이 1.5초 간격)

import { fetchText, stripTags, truncate, sleep } from '../lib.mjs';

const SITE = 'https://sw.ulsan.ac.kr/site/swulsan';
const MAX_FORWARD = 30; // 한 번 실행에 따라갈 최대 새 글 수
const BACKFILL = 30; // 처음 실행할 때 과거 글 수

// 마감일 읽는 규칙을 바꾸면 이 값을 올립니다. 표시가 없는 예전 글은 다시 읽어 고칩니다.
export const PARSER_TAG = 'p2';

const DEEP_BACKFILL = 15; // 실행마다 더 예전 글을 이만큼씩 채움
const KEEP_DAYS = 120; // 이보다 오래된 공지는 더 거슬러 올라가지 않음

export async function collectUouSw({ knownIds = [], refreshIds = [], oldestId = null }) {
  // 1) 홈 화면의 공지 섹션에서 최근 공지 ID를 얻습니다.
  const home = nextData(await fetchText(SITE));
  const homeIds = [];
  for (const page of home?.props?.pageProps?.apiData?.pages ?? []) {
    for (const section of page.sections ?? []) {
      if (section.type !== 'notice') continue;
      for (const it of section.items ?? []) if (it.notice_id) homeIds.push(Number(it.notice_id));
    }
  }

  const known = knownIds.map(Number).filter(Number.isFinite);
  const start = Math.max(...known, ...homeIds);
  if (!Number.isFinite(start)) throw new Error('SW사업단: 시작할 공지 ID를 찾지 못했습니다');

  const rows = [];
  const seen = new Set();
  const visit = async (id) => {
    if (!id || seen.has(id)) return null;
    seen.add(id);
    await sleep(1500);
    const info = nextData(await fetchText(`${SITE}/notices/${id}`))?.props?.pageProps
      ?.initialNoticeInfo;
    if (!info) return null;
    if (!info.is_private) rows.push(toRow(info));
    return info;
  };

  // 2) 가장 최근에 아는 글부터 next_id를 따라 새 글을 수집
  let info = await visit(start);
  const first = info;
  for (let i = 0; info?.next_id && i < MAX_FORWARD; i++) info = await visit(info.next_id);

  // 3) 처음 실행이면 prev_id를 따라 과거 글도 채웁니다.
  if (known.length === 0) {
    info = first;
    for (let i = 0; info?.prev_id && i < BACKFILL; i++) info = await visit(info.prev_id);
  }

  // 4) 홈 화면에만 보이는 글(중요 공지 등)
  for (const id of homeIds) await visit(id);

  // 5) 가장 오래된 글보다 더 예전 글을 조금씩 채웁니다. (게시 후 KEEP_DAYS일 이내까지만)
  if (oldestId) {
    const cutoff = Date.now() - KEEP_DAYS * 86400e3;
    info = await visit(Number(oldestId));
    for (let i = 0; info?.prev_id && i < DEEP_BACKFILL; i++) {
      info = await visit(info.prev_id);
      if (info && Date.parse(info.insert_date) < cutoff) break;
    }
  }

  // 6) 예전 규칙으로 읽은 글을 다시 읽어 마감일을 고칩니다.
  for (const id of refreshIds.map(Number).filter(Number.isFinite)) await visit(id);

  return rows;
}

function nextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]) : null;
}

function toRow(n) {
  const title = stripTags(n.title);
  const isIntern = /인턴/.test(title);
  const deadline = guessDeadline(stripTags(n.contents ?? ''), n.insert_date);
  return {
    source: 'uou_sw',
    source_id: String(n.notice_id),
    category: isIntern ? 'intern' : 'uou_news',
    title,
    organization: '울산대 SW중심대학사업단',
    url: `${SITE}/notices/${n.notice_id}`,
    summary: truncate(stripTags(n.contents ?? n.content ?? ''), 200),
    deadline,
    posted_at: n.insert_date ?? null,
    tags: [
      'SW중심대학사업단',
      PARSER_TAG,
      ...(n.is_important ? ['중요'] : []),
      ...(deadline ? ['마감일 추정'] : []),
    ],
  };
}

/**
 * 본문에서 "신청·모집·접수·지원·제출 기간/마감" 뒤에 나오는 날짜만 마감일로 읽습니다.
 * 예) '모집기간 : 2026.09.04.(금) ~ 09.17.(목)' → 09-17, '접수 마감: 10. 15.' → 10-15
 * 활동기간·행사일처럼 다른 날짜는 무시하고, 못 찾으면 null (사이트는 게시 후 30일까지만 표시).
 */
export function guessDeadline(text, insertDate) {
  if (!text) return null;
  const posted = insertDate ? new Date(insertDate) : new Date();
  const postedYear = Number(new Date(posted.getTime() + 9 * 3600e3).toISOString().slice(0, 4));
  const DATE = String.raw`(?:(20\d{2})\s*[.\-/년]\s*)?(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*[.일]?\s*(?:\([^)]{1,4}\))?`;
  const KEY = String.raw`(?:신청|모집|접수|지원|제출|응모)\s*(?:기간|기한|마감|일정|일시)?\s*[:：]?\s*`;
  const range = new RegExp(KEY + DATE + String.raw`[^~∼]{0,12}[~∼]\s*` + DATE);
  const single = new RegExp(String.raw`(?:신청|모집|접수|지원|제출|응모)\s*(?:마감|기한)\s*[:：]?\s*` + DATE);

  const toYmd = (y, mo, d, baseYear) => {
    const month = Number(mo);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let yy = y ? Number(y) : baseYear;
    // 연도가 없고 게시일보다 두 달 넘게 이전이면 다음 해로 봅니다 (예: 12월 게시, 1월 마감)
    if (!y && new Date(Date.UTC(yy, month - 1, day)) < new Date(posted.getTime() - 60 * 86400e3)) yy += 1;
    return `${yy}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  let m = text.match(range);
  if (m) {
    const startYear = m[1] ? Number(m[1]) : postedYear;
    return toYmd(m[4], m[5], m[6], startYear);
  }
  m = text.match(single);
  if (m) return toYmd(m[1], m[2], m[3], postedYear);
  return null;
}
