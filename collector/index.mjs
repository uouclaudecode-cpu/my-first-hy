// 수집기 진입점: GitHub Actions에서 1시간마다 실행됩니다.
//   node collector/index.mjs            → 수집 후 Supabase에 저장
//   node collector/index.mjs --dry-run  → 저장하지 않고 결과만 출력 (Secret 키 불필요)
//
// 환경 변수 (GitHub Secrets로 주입)
//   SUPABASE_URL          (선택, 기본값: 프로젝트 주소)
//   SUPABASE_SECRET_KEY   Supabase Secret 키 (sb_secret_...)
//   NAVER_CLIENT_ID / NAVER_CLIENT_SECRET   네이버 검색 API
//   WORK24_AUTH_KEY       고용24 채용정보 Open API 인증키
// 키가 없는 출처는 건너뛰고, 한 출처가 실패해도 나머지는 계속 저장합니다.

import { supabase } from './lib.mjs';
import { collectNaverNews } from './sources/naver.mjs';
import { collectWork24 } from './sources/work24.mjs';
import { collectWevity } from './sources/wevity.mjs';
import { collectUouSw } from './sources/uou-sw.mjs';

const env = process.env;
const dryRun = process.argv.includes('--dry-run');
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
  { name: 'wevity', enabled: true, run: () => collectWevity() },
  {
    name: 'uou_sw',
    enabled: true,
    run: async () => {
      const known = db
        ? await db.select('postings', 'source=eq.uou_sw&select=source_id&order=id.desc&limit=200')
        : [];
      return collectUouSw({ knownIds: known.map((r) => r.source_id) });
    },
  },
];

const startedAt = new Date().toISOString();
const results = {};
let upserted = 0;
let failed = 0;

for (const s of sources) {
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
if (failed > 0 && failed === sources.filter((s) => s.enabled).length) process.exit(1);
