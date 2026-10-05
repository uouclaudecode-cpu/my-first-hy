// 언론사가 직접 공개한 RSS 피드 수집 (제목·링크·요약·게시 시각만 저장, 본문은 저장하지 않음)
// robots.txt 확인일 2026-10-06
//  - AI타임스(aitimes.com)        : Disallow /admin/ 만 → RSS 허용
//  - 전자신문(etnews.com)          : Allow /
//  - 경상일보·울산신문·울산매일    : Disallow /admin/ 등 관리 경로만 → RSS 허용
//  ※ Google 뉴스 RSS는 robots.txt가 /rss 경로를 막고 있어 쓰지 않습니다.

import { fetchText, decodeEntities, stripTags, truncate, sleep, SW_KEYWORDS } from '../lib.mjs';

/** AI·SW 뉴스 탭 */
export const TECH_FEEDS = [
  { source: 'aitimes', name: 'AI타임스', url: 'https://www.aitimes.com/rss/allArticle.xml' },
  { source: 'etnews', name: '전자신문', url: 'https://rss.etnews.com/04.xml' }, // AI·SW 분야
];

/** 울산 지역 신문: '울산대'가 들어간 기사만 울산대 소식으로 */
export const ULSAN_FEEDS = [
  { source: 'ksilbo', name: '경상일보', url: 'https://www.ksilbo.co.kr/rss/allArticle.xml' },
  { source: 'ulsanpress', name: '울산신문', url: 'https://www.ulsanpress.net/rss/allArticle.xml' },
  { source: 'iusm', name: '울산매일', url: 'https://www.iusm.co.kr/rss/allArticle.xml' },
];

export async function collectTechNews() {
  const rows = [];
  for (const feed of TECH_FEEDS) {
    for (const item of await readFeed(feed.url)) {
      rows.push(toRow(feed, item, 'tech_news', SW_KEYWORDS.test(item.title) ? ['SW·IT'] : []));
    }
    await sleep(1000);
  }
  return rows;
}

export async function collectUlsanPress() {
  const rows = [];
  for (const feed of ULSAN_FEEDS) {
    for (const item of await readFeed(feed.url)) {
      // 제목이나 요약 첫 부분에 '울산대'가 나오는 기사만 (울산대학교·울산대병원 포함)
      if (!/울산대/.test(`${item.title} ${item.description.slice(0, 200)}`)) continue;
      rows.push(toRow(feed, item, 'uou_news', ['지역신문']));
    }
    await sleep(1000);
  }
  return rows;
}

function toRow(feed, item, category, tags) {
  return {
    source: feed.source,
    source_id: item.link,
    category,
    title: item.title,
    organization: feed.name,
    url: item.link,
    summary: truncate(item.description, 140),
    deadline: null,
    posted_at: item.pubDate,
    tags: [feed.name, ...tags],
  };
}

async function readFeed(url) {
  const xml = await fetchText(url);
  const items = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const title = stripTags(field(m[1], 'title'));
    const link = field(m[1], 'link').trim();
    if (!title || !/^https?:\/\//.test(link)) continue;
    items.push({
      title,
      link,
      description: stripTags(field(m[1], 'description')),
      pubDate: parseDate(field(m[1], 'pubDate')),
    });
  }
  return items;
}

function field(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  if (!m) return '';
  const v = m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
  return decodeEntities(v);
}

/** '2026-10-05 21:01:19'(한국 시간) 또는 RFC 822 형식 → ISO */
function parseDate(s) {
  if (!s) return null;
  const local = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    const [, y, mo, d, h, mi, se = '00'] = local;
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}+09:00`).toISOString();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
