// 사람인 채용공고 Open API — IT개발·데이터 직무의 인턴 공고
// 문서: https://oapi.saramin.co.kr/guide/job-search
// 신청: https://oapi.saramin.co.kr → access-key 발급 (하루 호출 한도가 있으니 1시간에 1~2회만 호출)
// 이용 조건에 따라 사이트 하단에 '사람인 제공' 출처를 표시합니다.

import { fetchJson } from '../lib.mjs';

const ENDPOINT = 'https://oapi.saramin.co.kr/job-search';

export async function collectSaramin({ accessKey }) {
  const url =
    ENDPOINT +
    '?' +
    new URLSearchParams({
      'access-key': accessKey,
      job_mid_cd: '2', // IT개발·데이터
      job_type: '4 11', // 4=인턴직, 11=인턴직(정규직 전환가능)
      sort: 'pd', // 게시일 최신순
      count: '110', // 최대값
      fields: 'expiration-date',
    });
  const data = await fetchJson(url, { headers: { Accept: 'application/json' } });
  if (data.code || data.message) throw new Error(`사람인: ${data.message ?? data.code}`);

  return (data.jobs?.job ?? [])
    .filter((j) => String(j.active) !== '0')
    .map((j) => {
      const p = j.position ?? {};
      const summary = [
        stripLoc(p.location?.name),
        p['job-type']?.name,
        p['experience-level']?.name,
        p['required-education-level']?.name,
      ]
        .filter(Boolean)
        .join(' · ');
      return {
        source: 'saramin',
        source_id: String(j.id),
        category: 'intern',
        title: decode(p.title ?? ''),
        organization: decode(j.company?.detail?.name ?? '') || null,
        url: j.url,
        summary: summary || null,
        deadline: kstDate(j['expiration-timestamp']),
        posted_at: j['posting-timestamp']
          ? new Date(Number(j['posting-timestamp']) * 1000).toISOString()
          : null,
        tags: ['사람인', stripLoc(p.location?.name)?.split(' ')[0]].filter(Boolean),
      };
    })
    .filter((r) => r.title && r.url);
}

/** Unix timestamp(초) → 한국 날짜. 상시채용 등 마감일이 없으면 null */
function kstDate(ts) {
  const n = Number(ts);
  if (!n) return null;
  return new Date(n * 1000 + 9 * 3600e3).toISOString().slice(0, 10);
}

function stripLoc(s) {
  return s ? s.replace(/&gt;/g, '>').split(',')[0].trim() : null;
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}
