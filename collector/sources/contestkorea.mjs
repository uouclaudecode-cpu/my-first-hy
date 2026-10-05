// 콘테스트코리아(contestkorea.com) 공모전·대외활동 목록
// - robots.txt: 'User-agent: * / Allow: /' (확인일 2026-10-05)
// - 이용약관: 크롤링·자동 수집 금지 조항 없음. 콘텐츠 저작권은 저자·제공기관에 있다고 안내하므로
//   본문·포스터는 저장하지 않고 제목·주최·마감일·링크만 저장합니다.
// - 요청 사이 2초 간격, 목록 페이지만 읽습니다.

import { fetchText, stripTags, todayKst, addDays, SW_KEYWORDS, sleep } from '../lib.mjs';

const BASE = 'https://www.contestkorea.com/sub/';
const LISTS = [
  // 학문•과학•IT 분야 공모전
  { query: 'int_gbn=1&Txt_bcode=030310001', pages: 2, kind: '공모전' },
  // 전체 대외활동 (SW 관련만 남김)
  { query: 'int_gbn=2', pages: 3, kind: '대외활동' },
];

export async function collectContestKorea() {
  const rows = [];
  const today = todayKst();
  for (const { query, pages, kind } of LISTS) {
    for (let page = 1; page <= pages; page++) {
      const html = await fetchText(`${BASE}list.php?${query}&page=${page}`);
      for (const item of parseList(html, today, kind)) {
        if (SW_KEYWORDS.test(item.title)) rows.push(item);
      }
      await sleep(2000);
    }
  }
  return rows;
}

export function parseList(html, today, kind) {
  const list = html.match(/<div class="list_style_2">([\s\S]*?)<div class="(?:paging|page)/);
  const body = list ? list[1] : html.split('<div class="list_style_2">')[1] ?? '';
  const out = [];
  // 항목마다 <div class="title">로 시작하므로 그 기준으로 나눕니다.
  for (const li of body.split('<div class="title">').slice(1)) {
    const a = li.match(/<a href="view\.php\?([^"]*str_no=(\d+)[^"]*)">/);
    const title = li.match(/<span class="txt">([\s\S]*?)<\/span>/);
    if (!a || !title) continue;
    const id = a[2];
    const gbn = a[1].match(/int_gbn=(\d)/)?.[1] ?? '1';
    const host = stripTags(li.match(/<strong>주최<\/strong>\s*\.?([\s\S]*?)<\/li>/)?.[1] ?? '') || null;
    const dday = stripTags(li.match(/<span class="day"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '');
    const condition = stripTags(
      li.match(/<span class="condition"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '',
    );
    if (/마감/.test(condition) && !/임박/.test(condition)) continue;

    let deadline = null;
    const d = dday.match(/D-(\d+|day)/i);
    if (d) deadline = addDays(today, /day/i.test(d[1]) ? 0 : Number(d[1]));

    out.push({
      source: 'contestkorea',
      source_id: id,
      category: 'activity',
      title: stripTags(title[1]),
      organization: host,
      url: `${BASE}view.php?int_gbn=${gbn}&str_no=${id}`,
      summary: null,
      deadline,
      posted_at: null,
      tags: ['콘테스트코리아', kind],
    });
  }
  return out;
}
