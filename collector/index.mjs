// 수집기 진입점: GitHub Actions에서 1시간마다 실행됩니다.
//   node collector/index.mjs            → 수집 후 Supabase에 저장
//   node collector/index.mjs --dry-run  → 저장하지 않고 결과만 출력 (Secret 키 불필요)
//
// 환경 변수 (GitHub Secrets로 주입)
//   SUPABASE_URL          (선택, 기본값: 프로젝트 주소)
//   SUPABASE_SECRET_KEY   Supabase Secret 키 (sb_secret_...)
//   NAVER_CLIENT_ID / NAVER_CLIENT_SECRET   네이버 검색 API
//   WORK24_AUTH_KEY       고용24 채용정보 Open API 인증키
//   SARAMIN_ACCESS_KEY    사람인 채용공고 Open API access-key
// 키가 없는 출처는 건너뛰고, 한 출처가 실패해도 나머지는 계속 저장합니다.

import { supabase } from './lib.mjs';
import { collectNaverNews } from './sources/naver.mjs';
import { collectWork24 } from './sources/work24.mjs';
import { collectSaramin } from './sources/saramin.mjs';
import { collectWevity } from './sources/wevity.mjs';
import { collectContestKorea } from './sources/contestkorea.mjs';
import { collectUouSw, PARSER_TAG } from './sources/uou-sw.mjs';
import { collectManual } from './sources/manual.mjs';
import { collectTechNews, collectUlsanPress } from './sources/rss.mjs';

const env = process.env;
const dryRun = process.argv.includes('--dry-run');
// --only=manual,wevity 처럼 일부 출처만 실행 (직접 추가한 공고를 바로 반영할 때 사용)
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const SUPABASE_URL = env.SUPABASE_URL || 'https://yggicyfxcyutfmcsnhxw.supabase.co';

if (!dryRun && !env.SUPABASE_SECRET_KEY) {
  console.error('SUPABASE_SECRET_KEY가 없습니다. GitHub Secrets를 확인하세요. (테스트는 --dry-run)');
  process.exit(1);
}
const db = dryRun ? null : supabase({ url: SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY });

const sources = [
  {
    name: 'naver_news',
    enabled: env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET,
    run: () =>
      collectNaverNews({ clientId: env.NAVER_CLIENT_ID, clientSecret: env.NAVER_CLIENT_SECRET }),
  },
  {
    name: 'work24',
    enabled: env.WORK24_AUTH_KEY,
    run: () => collectWork24({ authKey: env.WORK24_AUTH_KEY }),
  },
  {
    name: 'saramin',
    enabled: env.SARAMIN_ACCESS_KEY,
    run: () => collectSaramin({ accessKey: env.SARAMIN_ACCESS_KEY }),
  },
  { name: 'wevity', enabled: true, run: () => collectWevity() },
  { name: 'contestkorea', enabled: true, run: () => collectContestKorea() },
  { name: 'ulsan_press', enabled: true, run: () => collectUlsanPress() },
  {
    name: 'tech_news',
    enabled: true,
    run: async () => {
      // AI·SW 뉴스는 30일이 지나면 지웁니다. (사이트에는 최근 14일만 보임)
      if (db) await db.remove('postings', `category=eq.tech_news&posted_at=lt.${new Date(Date.now() - 30 * 86400e3).toISOString()}`);
      return collectTechNews();
    },
  },
  {
    name: 'manual',
    enabled: true,
    run: async () => {
      const rows = await collectManual();
      // 파일에서 지운 공고는 DB에서도 지웁니다.
      if (db) {
        const keep = rows.map((r) => `"${r.source_id.replace(/"/g, '')}"`).join(',');
        await db.remove('postings', `source=eq.manual${keep ? `&source_id=not.in.(${keep})` : ''}`);
      }
      return rows;
    },
  },
  {
    name: 'uou_sw',
    enabled: true,
    run: async () => {
      const known = db
        ? await db.select('postings', 'source=eq.uou_sw&select=source_id&order=id.desc&limit=200')
        : [];
      const stale = db
        ? await db.select('postings', `source=eq.uou_sw&tags=not.cs.{${PARSER_TAG}}&select=source_id&order=posted_at.desc&limit=15`)
        : [];
      const oldest = db
        ? await db.select('postings', 'source=eq.uou_sw&select=source_id,posted_at&order=posted_at.asc&limit=1')
        : [];
      const oldestId = oldest[0] && Date.parse(oldest[0].posted_at) > Date.now() - 120 * 86400e3 ? oldest[0].source_id : null;
      return collectUouSw({
        knownIds: known.map((r) => r.source_id),
        refreshIds: stale.map((r) => r.source_id),
        oldestId,
      });
    },
  },
];

const startedAt = new Date().toISOString();
const results = {};
let upserted = 0;
let failed = 0;

const selected = only ? sources.filter((s) => only.includes(s.name)) : sources;

for (const s of selected) {
  if (!s.enabled) {
    results[s.name] = { skipped: '키 없음' };
    console.log(`- ${s.name}: 건너뜀 (API 키 없음)`);
    continue;
  }
  try {
    const rows = await s.run();
    if (db && rows.length) await db.upsertPostings(rows);
    upserted += rows.length;
    results[s.name] = { count: rows.length };
    console.log(`✓ ${s.name}: ${rows.length}건`);
    if (dryRun) for (const r of rows.slice(0, 5)) console.log(`    [${r.category}] ${r.deadline ?? '----------'} ${r.title}`);
  } catch (err) {
    failed++;
    results[s.name] = { error: String(err.message).slice(0, 300) };
    console.error(`✗ ${s.name}: ${err.message}`);
  }
}

if (db) {
  await db.insert('collector_runs', [{ started_at: startedAt, upserted, results }]);
}
console.log(`완료: ${upserted}건 저장${dryRun ? ' (dry-run, 저장 안 함)' : ''}, 실패한 출처 ${failed}개`);
// 모든 출처가 실패했을 때만 워크플로를 실패로 표시합니다.
if (failed > 0 && failed === selected.filter((s) => s.enabled).length) process.exit(1);
