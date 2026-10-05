// 울산대학교 SW중심대학사업단(sw.ulsan.ac.kr) 공지사항
// - robots.txt: 'User-agent: * / Allow: /' (확인일 2026-10-05)
//   ※ www.ulsan.ac.kr 본 사이트는 robots.txt가 'Disallow: /' 이므로 수집하지 않습니다.
// - 공지 상세 페이지(/site/swulsan/notices/{id})에 들어 있는 Next.js 데이터(__NEXT_DATA__)를 읽고,
//   그 안의 next_id/prev_id를 따라가며 새 글만 가져옵니다. (요청 사이 1.5초 간격)

import { fetchText, stripTags, truncate, sleep } from '../lib.mjs';

const SITE = 'https://sw.ulsan.ac.kr/site/swulsan';
const MAX_FORWARD = 30; // 한 번 실행에 따라갈 최대 새 글 수
const BACKFILL = 30; // 처음 실행할 때 과거 글 수

export async function collectUouSw({ knownIds = [] }) {
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
      ...(n.is_important ? ['중요'] : []),
      ...(deadline ? ['마감일 추정'] : []),
    ],
  };
}

/**
 * 본문에서 '마감', '기한', '~' 근처의 날짜를 찾아 마감일로 추정합니다.
 * 예) '신청기간: 9.1.(월) ~ 9.12.(금)', '접수 마감 2026. 10. 15.'
 * 확실하지 않으면 null (사이트에서는 '마감일 미정'으로 표시).
 */
export function guessDeadline(text, insertDate) {
  if (!text) return null;
  const posted = insertDate ? new Date(insertDate) : new Date();
  const year = Number(new Date(posted.getTime() + 9 * 3600e3).toISOString().slice(0, 4));
  const DATE = String.raw`(?:(20\d{2})\s*[.\-/년]\s*)?(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?`;
  const patterns = [
    new RegExp(String.raw`(?:마감|기한|까지)[^0-9]{0,15}` + DATE),
    new RegExp(DATE + String.raw`[^0-9]{0,15}(?:까지|마감)`),
    new RegExp(String.raw`~\s*` + DATE),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const [, y, mo, d] = m;
    const month = Number(mo);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    let yy = y ? Number(y) : year;
    // 연도가 없고 게시일보다 많이 이전이면 다음 해로 봅니다 (예: 12월 게시, 1월 마감)
    const candidate = new Date(Date.UTC(yy, month - 1, day));
    if (!y && candidate < new Date(posted.getTime() - 60 * 86400e3)) yy += 1;
    return `${yy}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}
