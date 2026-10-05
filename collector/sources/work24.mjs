// 고용24 Open API — 채용정보 목록 (워크넷 채용정보 API 후속)
// 신청: https://www.work24.go.kr > 고객지원 > 오픈API > 채용정보 API 인증키 발급
// 'XXX 인턴' 공고 중 SW 관련 직무만 남깁니다.

import { fetchText, decodeEntities, SW_KEYWORDS, sleep } from '../lib.mjs';

const ENDPOINT = 'https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do';
const PAGES = 3; // 페이지당 100건

export async function collectWork24({ authKey }) {
  const rows = [];
  for (let page = 1; page <= PAGES; page++) {
    const url =
      ENDPOINT +
      '?' +
      new URLSearchParams({
        authKey,
        callTp: 'L',
        returnType: 'XML',
        startPage: String(page),
        display: '100',
        keyword: '인턴',
      });
    const xml = await fetchText(url);
    const error = tag(xml, 'error') || tag(xml, 'messageCd');
    if (error && !xml.includes('<wanted>')) throw new Error(`고용24: ${error}`);

    const items = [...xml.matchAll(/<wanted>([\s\S]*?)<\/wanted>/g)].map((m) => m[1]);
    for (const it of items) {
      const title = tag(it, 'title');
      const company = tag(it, 'company');
      const id = tag(it, 'wantedAuthNo');
      if (!id || !title) continue;
      if (!SW_KEYWORDS.test(`${title} ${tag(it, 'jobsNm') ?? ''}`)) continue;

      const summary = [tag(it, 'region'), tag(it, 'sal'), tag(it, 'career'), tag(it, 'minEdubg')]
        .filter(Boolean)
        .join(' · ');
      rows.push({
        source: 'work24',
        source_id: id,
        category: 'intern',
        title,
        organization: company,
        url:
          tag(it, 'wantedInfoUrl') ||
          `https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=${id}`,
        summary: summary || null,
        deadline: parseShortDate(tag(it, 'closeDt')),
        posted_at: toIso(parseShortDate(tag(it, 'regDt'))),
        tags: ['고용24', tag(it, 'region')?.split(' ')[0]].filter(Boolean),
      });
    }
    if (items.length < 100) break;
    await sleep(500);
  }
  return rows;
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`));
  const v = m && decodeEntities(m[1]).trim();
  return v || null;
}

/** '26-10-31', '채용시까지 26-10-31', '2026-10-31', '20261031' → '2026-10-31' */
function parseShortDate(s) {
  if (!s) return null;
  let m = s.match(/(20\d{2})-?(\d{2})-?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{2})-(\d{2})-(\d{2})/);
  if (m) return `20${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function toIso(ymd) {
  return ymd ? `${ymd}T00:00:00+09:00` : null;
}
