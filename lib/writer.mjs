// 공고 정보로 블로그 글과 인스타그램 캡션을 쓰는 공통 모듈.
// 사이트의 "글 쓰기" 버튼(api/write.js)과 매주 자동 작성(scripts/weekly-posts.mjs)이 함께 씁니다.

import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5-5';
export const SITE_URL = 'https://my-first-hy.vercel.app';

const CATEGORY_LABEL = { activity: '대외활동·공모전', intern: '인턴', uou_news: '울산대 소식' };

const SYSTEM = `너는 울산대학교 SW 서포터즈의 홍보 글 담당이야. 서포터즈는 SW 관련 대외활동·인턴 공고와 울산대 SW 소식을 학생들에게 알리는 활동을 해.
주어진 공고 정보로 네이버 블로그 글과 인스타그램 캡션을 써.

[사실 규칙 - 가장 중요]
- 주어진 정보(제목, 주최, 마감일, 소개, 링크)에 있는 사실만 써. 상금, 혜택, 지원 자격, 일정처럼 주어지지 않은 내용을 지어내지 마.
- 정보가 부족하면 "자세한 내용은 원문에서 확인해 주세요"처럼 원문으로 안내해.
- 제목, 주최, 마감일, 링크는 주어진 그대로 써. 마감일 옆 D-day도 주어진 값을 써.
- "(추정)"이 붙은 마감일은 "공지 기준 ○월 ○일까지로 보여요, 원문에서 꼭 확인해 주세요"처럼 확인을 권해.

[말투]
- 친근한 해요체, 대학생 눈높이. 과장 광고 문구("역대급", "무조건")는 피해.
- 이모지는 문단 앞이나 항목 앞에 자연스럽게 써. 한 줄에 이모지를 여러 개 몰아 쓰지 마.

[블로그 글]
- 마크다운 기호(#, **, -) 없이 네이버 블로그 편집기에 그대로 붙여넣을 수 있는 일반 텍스트로 써. 빈 줄로 문단을 나눠.
- 구성: 인사와 도입 2~3문장 → 공고별 소개 → 마무리(서포터즈 사이트 ${SITE_URL} 안내, 응원 한마디).
- 공고별 소개는 이 형식을 지켜:
  📌 [제목]
  🏢 주최: ...
  ⏰ 마감: YYYY.MM.DD (D-n)
  ✨ 이런 분께 추천해요: 1~2문장
  🔗 원문: 링크
- 맨 끝 줄에 해시태그 8~12개.

[인스타그램 캡션]
- 첫 줄은 시선을 끄는 한 문장(이모지 포함).
- 공고마다 2~3줄로 짧게: 이모지 + 제목, 마감일(D-day), 한 줄 소개.
- 인스타 캡션은 링크가 눌리지 않으니 URL을 쓰지 말고 "🔗 링크는 프로필에서 확인하세요"로 안내해.
- 맨 끝에 해시태그 10~15개.

[해시태그]
- #울산대 #울산대학교 #SW서포터즈 를 기본으로 넣고, 분야·공고 성격에 맞는 태그를 더해.`;

/** 공고 하나를 프롬프트용 텍스트로 */
function describe(p, i, today) {
  const dday = p.deadline ? daysBetween(today, p.deadline) : null;
  const guessed = (p.tags || []).includes('마감일 추정');
  const due = p.deadline
    ? `${p.deadline.replaceAll('-', '.')} (${dday === 0 ? 'D-DAY' : `D-${dday}`})${guessed ? ' (추정)' : ''}`
    : '상시 모집 또는 미정';
  return [
    `[공고 ${i + 1}]`,
    `분류: ${CATEGORY_LABEL[p.category] ?? p.category}`,
    `제목: ${p.title}`,
    p.organization && `주최: ${p.organization}`,
    `마감: ${due}`,
    p.summary && `소개: ${p.summary}`,
    `링크: ${p.url}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '블로그 글 제목 (40자 이내, 이모지 1개 포함 가능)' },
    blog: { type: 'string', description: '네이버 블로그 본문 (일반 텍스트, 해시태그 줄 포함)' },
    instagram: { type: 'string', description: '인스타그램 캡션 (해시태그 포함)' },
    hashtags: { type: 'array', items: { type: 'string' }, description: '사용한 해시태그 목록 (# 포함)' },
  },
  required: ['title', 'blog', 'instagram', 'hashtags'],
  additionalProperties: false,
};

/**
 * @param {object[]} postings  postings 표의 행 (title, organization, url, deadline, summary, category, tags)
 * @param {'single'|'bundle'|'weekly'} kind
 * @returns {Promise<{title:string, blog:string, instagram:string, hashtags:string[]}>}
 */
export async function writePosts(postings, kind, { apiKey } = {}) {
  if (!postings.length) throw new Error('글로 쓸 공고가 없어요.');
  const today = todayKst();
  const intro =
    kind === 'weekly'
      ? `오늘은 ${today}(월)이야. "이번 주 SW 공고 모음" 주간 글을 써줘. 마감이 가까운 순서로 소개해.`
      : kind === 'bundle'
        ? `오늘은 ${today}이야. 아래 공고 ${postings.length}개를 함께 소개하는 모음 글을 써줘.`
        : `오늘은 ${today}이야. 아래 공고 하나를 소개하는 글을 써줘.`;

  const client = new Anthropic(apiKey ? { apiKey } : {});
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // 안전 분류기가 거절하면 서버가 다른 모델로 다시 시도합니다.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content: `${intro}\n\n${postings.map((p, i) => describe(p, i, today)).join('\n\n')}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') throw new Error('AI가 이 요청을 처리하지 않았어요. 공고 내용을 확인해 주세요.');
  if (response.stop_reason === 'max_tokens') throw new Error('글이 너무 길어서 중간에 끊겼어요. 공고 수를 줄여 다시 시도해 주세요.');
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('AI 응답에 글이 없어요.');
  const out = JSON.parse(text);
  return {
    title: out.title.trim(),
    blog: out.blog.trim(),
    instagram: out.instagram.trim(),
    hashtags: out.hashtags.map((h) => h.trim()).filter(Boolean),
  };
}

export function todayKst() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}

function daysBetween(fromYmd, toYmd) {
  return Math.round((Date.parse(toYmd) - Date.parse(fromYmd)) / 86400e3);
}
