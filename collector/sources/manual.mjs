// 직접 추가한 공고: data/manual-postings.json
// 서포터즈가 링커리어 등에서 눈으로 보고 가져온 공고를 Claude가 양식에 맞게 정리해 넣는 파일입니다.
// 파일에서 지운 공고는 다음 실행 때 Supabase에서도 지워집니다. (양식은 CLAUDE.md 참고)

import { readFile } from 'node:fs/promises';

const FILE = new URL('../../data/manual-postings.json', import.meta.url);
const CATEGORIES = new Set(['activity', 'intern', 'uou_news']);

export async function collectManual() {
  const list = JSON.parse(await readFile(FILE, 'utf8'));
  if (!Array.isArray(list)) throw new Error('manual-postings.json은 배열이어야 합니다');

  return list.map((p, i) => {
    const where = `manual-postings.json ${i + 1}번째 (${p.id ?? '?'})`;
    if (!p.id || !p.title || !p.url) throw new Error(`${where}: id, title, url은 필수입니다`);
    if (!CATEGORIES.has(p.category)) throw new Error(`${where}: category가 올바르지 않습니다`);
    if (!/^https?:\/\//.test(p.url)) throw new Error(`${where}: url은 http(s)로 시작해야 합니다`);
    if (p.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(p.deadline))
      throw new Error(`${where}: deadline은 YYYY-MM-DD 형식이어야 합니다`);
    return {
      source: 'manual',
      source_id: String(p.id),
      category: p.category,
      title: p.title,
      organization: p.organization ?? null,
      url: p.url,
      summary: p.summary ?? null,
      deadline: p.deadline ?? null,
      posted_at: p.added_at ? `${p.added_at}T00:00:00+09:00` : null,
      tags: ['직접 추가', ...(p.via ? [p.via] : []), ...(p.tags ?? [])],
    };
  });
}
