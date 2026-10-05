// 위비티(wevity.com) 공모전·대외활동 목록
// - robots.txt: 'User-agent: * / Allow: /' (확인일 2026-10-05)
// - 이용약관: 크롤링 금지 조항 없음. 저작권 침해 금지 조항이 있으므로
//   본문·포스터 이미지는 저장하지 않고 제목·주최·마감일·링크만 저장합니다.
// - 요청 사이 2초 간격, 목록 페이지만 읽습니다.

import { fetchText, stripTags, todayKst, addDays, SW_KEYWORDS, sleep } from '../lib.mjs';

const BASE = 'https://www.wevity.com/';
// cidx: 21=게임/소프트웨어, 20=웹/모바일/IT, 27=대외활동/서포터즈
const LISTS = [
  { cidx: 21, pages: 2, mustMatch: false },
  { cidx: 20, pages: 2, mustMatch: true },
  { cidx: 27, pages: 2, mustMatch: true },
];

export async function collectWevity() {
  const rows = [];
  const today = todayKst();
  for (const { cidx, pages, mustMatch } of LISTS) {
    for (let gp = 1; gp <= pages; gp++) {
      const html = await fetchText(`${BASE}?c=find&s=1&gub=1&cidx=${cidx}&gp=${gp}`);
      for (const item of parseList(html, today)) {
        if (mustMatch && !SW_KEYWORDS.test(item.title)) continue;
        rows.push(item);
      }
      await sleep(2000);
    }
  }
  return rows;
}

export function parseList(html, today) {
  const list = html.match(/<ul class="list">([\s\S]*?)<\/ul>/);
  if (!list) return [];
  const out = [];
  for (const li of list[1].split(/<li[\s>]/).slice(1)) {
    const a = li.match(/<div class="tit">\s*<a href="([^"]*ix=(\d+)[^"]*)">([\s\S]*?)<\/a>/);
    if (!a) continue;
    const id = a[2];
    const title = stripTags(a[3].replace(/<span class='stat[^>]*>[\s\S]*?<\/span>/g, ''));
    const field = stripTags(li.match(/<div class="sub-tit">([\s\S]*?)<\/div>/)?.[1] ?? '').replace(
      /^분야\s*:\s*/,
      '',
    );
    const organ = stripTags(li.match(/<div class="organ">([\s\S]*?)<\/div>/)?.[1] ?? '') || null;
    const day = stripTags(li.match(/<div class="day">([\s\S]*?)<\/div>/)?.[1] ?? '');
    if (/마감(?!임박)/.test(day)) continue; // 이미 마감된 공고

    // 'D-13 접수중' → 오늘 + 13일, 'D-day' → 오늘
    let deadline = null;
    const d = day.match(/D-(\d+|day)/i);
    if (d) deadline = addDays(today, /day/i.test(d[1]) ? 0 : Number(d[1]));

    out.push({
      source: 'wevity',
      source_id: id,
      category: 'activity',
      title,
      organization: organ,
      url: `${BASE}?c=find&s=1&gbn=view&ix=${id}`,
      summary: field ? `분야: ${field}` : null,
      deadline,
      posted_at: null,
      tags: ['위비티', ...(/서포터즈|대외활동/.test(field + title) ? ['대외활동'] : ['공모전'])],
    });
  }
  return out;
}
