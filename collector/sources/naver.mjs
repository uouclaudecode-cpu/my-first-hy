// 네이버 검색 API (뉴스) — '울산대 SW' 관련 소식
// 문서: https://developers.naver.com/docs/serviceapi/search/news/news.md

import { fetchJson, stripTags, truncate, sleep, SW_KEYWORDS } from '../lib.mjs';

const QUERIES = ['울산대 SW', '울산대학교 SW중심대학', '울산대 소프트웨어', '울산대 AI 인재'];

export async function collectNaverNews({ clientId, clientSecret }) {
  const rows = [];
  for (const q of QUERIES) {
    const url =
      'https://openapi.naver.com/v1/search/news.json?' +
      new URLSearchParams({ query: q, display: '50', sort: 'date' });
    const data = await fetchJson(url, {
      headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
    });
    for (const item of data.items ?? []) {
      const title = stripTags(item.title);
      const desc = stripTags(item.description);
      const text = `${title} ${desc}`;
      // 검색 결과에는 무관한 기사가 섞이므로 '울산대' + SW 관련 단어가 모두 있는 기사만 남깁니다.
      if (!/울산대/.test(text) || !SW_KEYWORDS.test(text)) continue;
      const link = item.originallink || item.link;
      rows.push({
        source: 'naver_news',
        source_id: link,
        category: 'uou_news',
        title,
        organization: hostOf(link),
        url: link,
        summary: truncate(desc, 200),
        posted_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
        tags: ['뉴스'],
      });
    }
    await sleep(200);
  }
  return rows;
}

function hostOf(link) {
  try {
    return new URL(link).hostname.replace(/^(www|m)\./, '');
  } catch {
    return null;
  }
}
