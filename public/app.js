import {
  CATEGORY_LABEL,
  isNewsCategory,
  CHANNELS,
  today,
  api,
  apiInsert,
  dday,
  isGuessed,
  isClosed,
  dedupe,
  daysBetween,
  formatDate,
  formatDateTime,
  copyText,
  toast,
  initThemeToggle,
  loadPromotions,
  setPromotion,
} from './common.js?v=20261006f';

const SOURCE_LABEL = {
  wevity: '위비티',
  contestkorea: '콘테스트코리아',
  uou_sw: 'SW사업단',
  naver_news: '뉴스',
  work24: '고용24',
  saramin: '사람인',
  manual: '직접 추가',
  community: '방문자 제보',
  aitimes: 'AI타임스',
  etnews: '전자신문',
  ksilbo: '경상일보',
  ulsanpress: '울산신문',
  iusm: '울산매일',
};
const HIDDEN_TAGS = new Set([...Object.values(SOURCE_LABEL), '마감일 추정', 'SW중심대학사업단', 'p2', 'SW·IT']);
const MAX_SELECT = 8;

// 분야 필터: 제목·소개·태그에 들어간 단어로 판단합니다. 한 공고가 여러 분야에 속할 수 있어요.
const FIELDS = [
  { key: 'sw', label: 'SW·IT', tag: 'SW·IT', re: /소프트웨어|개발자|코딩|프로그래밍|해커톤|(?<![A-Za-z])(SW|IT|ICT|AI)(?![A-Za-z])/ },
  { key: 'ai', label: 'AI·데이터', re: /AI|인공지능|데이터|머신러닝|딥러닝|LLM|에이전트|생성형|GPT/i },
  { key: 'web', label: '웹·앱', re: /웹(?!툰)|앱|모바일|프론트|백엔드|풀스택|서비스 개발|플랫폼/ },
  { key: 'game', label: '게임', re: /게임|e스포츠|이스포츠|로블록스|메이플|Unity|유니티/i },
  { key: 'contest', label: '해커톤·대회', re: /해커톤|아이디어톤|경진대회|경시대회|챌린지|공모전|콘테스트|대회/ },
  { key: 'edu', label: '교육·부트캠프', re: /교육|부트캠프|아카데미|캠프|특강|과정|강의|설명회|TA/ },
  { key: 'startup', label: '창업', re: /창업|스타트업|사업화|오디션/ },
];

const $ = (s) => document.querySelector(s);
const state = {
  rows: [],
  promos: new Map(), // posting_id → Map(channel → done_at)
  cat: 'all',
  field: 'all',
  sort: 'deadline',
  q: '',
  closed: false,
  pending: false, // 홍보 안 한 공고만
  selected: new Set(),
};

// ---------------------------------------------------------------- 데이터
async function load() {
  renderSkeleton();
  try {
    const cols = 'id,source,category,title,organization,url,summary,deadline,posted_at,tags,collected_at';
    const [rows, runs, promos] = await Promise.all([
      api(`postings?select=${cols}&order=collected_at.desc&limit=2000`),
      api('collector_runs?select=finished_at&order=finished_at.desc&limit=1').catch(() => []),
      loadPromotions().catch(() => ({ map: new Map() })), // promotions 표가 아직 없어도 보드는 동작
    ]);
    state.rows = rows;
    state.promos = promos.map;
    $('#stat-updated').textContent = runs[0] ? formatDateTime(runs[0].finished_at) : '–';
    renderStats();
    render();
  } catch (err) {
    console.error(err);
    $('#list').replaceChildren();
    setStatus('공고를 불러오지 못했어요. 잠시 후 새로고침해 주세요.');
  } finally {
    $('#list').setAttribute('aria-busy', 'false');
  }
}

// ---------------------------------------------------------------- 판단
/** 오늘(한국 시간) 처음 수집된 공고 */
const isNew = (r) => kstDate(r.collected_at) === today;
const kstDate = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
// 위비티 분야명 "게임/소프트웨어", "웹/모바일/IT"는 게임·앱 공고라는 뜻이 아니라서 분야 판단에서 뺍니다.
const fieldText = (r) =>
  `${r.title} ${(r.summary ?? '').replace(/게임\/소프트웨어|웹\/모바일\/(IT|플래시)/g, '소프트웨어')} ${(r.tags || []).join(' ')}`;
const inField = (r, key) => {
  if (key === 'all') return true;
  const f = FIELDS.find((x) => x.key === key);
  return Boolean(f && ((f.tag && (r.tags || []).includes(f.tag)) || f.re.test(fieldText(r))));
};

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  return dedupe(state.rows).filter((r) => {
    if (!state.closed && isClosed(r)) return false;
    if (state.pending && state.promos.get(r.id)?.size) return false;
    if (!q) return true;
    const hay = `${r.title} ${r.organization ?? ''} ${r.summary ?? ''} ${(r.tags || []).join(' ')}`;
    return hay.toLowerCase().includes(q);
  });
}

function sortRows(rows) {
  const recent = (a, b) => (b.posted_at || b.collected_at).localeCompare(a.posted_at || a.collected_at);
  const byDeadline = (dir) => (a, b) => {
    if (a.deadline && b.deadline) return dir * a.deadline.localeCompare(b.deadline) || recent(a, b);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return recent(a, b);
  };
  const cmp = state.sort === 'recent' ? recent : byDeadline(state.sort === 'deadline_desc' ? -1 : 1);
  return [...rows].sort(cmp);
}

// ---------------------------------------------------------------- 렌더링
function renderStats() {
  const open = dedupe(state.rows).filter((r) => !isClosed(r) && r.category !== 'tech_news');
  $('#stat-open').textContent = open.filter((r) => !isNewsCategory(r.category)).length;
  $('#stat-urgent').textContent = open.filter((r) => dday(r) !== null && dday(r) <= 3).length;
  $('#stat-new').textContent = open.filter(isNew).length;
  $('#stat-pending').textContent = open.filter((r) => !isNewsCategory(r.category) && !state.promos.get(r.id)?.size).length;
}

/** ISO 시각 → 한국 날짜 '10/6' */
function shortDate(iso) {
  const [, m, d] = new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10).split('-');
  return `${+m}/${+d}`;
}

/** 카드의 홍보 칸: 채널별 완료 상태, 완료 날짜, 진행도(n/3) */
function renderPromo(el, r) {
  const done = state.promos.get(r.id);
  const n = done?.size ?? 0;
  const progress = el.querySelector('.progress');
  progress.textContent = n === CHANNELS.length ? '홍보 완료' : `홍보 ${n}/${CHANNELS.length}`;
  progress.dataset.level = n === 0 ? 'none' : n === CHANNELS.length ? 'all' : 'partial';
  el.classList.toggle('promo-all', n === CHANNELS.length);
  for (const ch of el.querySelectorAll('.channel')) {
    const key = ch.dataset.channel;
    const at = done?.get(key);
    const btn = ch.querySelector('.ch-done');
    ch.classList.toggle('is-done', Boolean(at));
    btn.setAttribute('aria-pressed', String(Boolean(at)));
    btn.querySelector('span').textContent = at ? `완료 ${shortDate(at)}` : '완료 체크';
    btn.title = at ? `${formatDateTime(at)} 홍보 완료 · 누르면 해제` : '이 채널에 올렸으면 눌러 주세요';
  }
}

/** '전체' 탭에는 AI·SW 뉴스를 섞지 않습니다. (뉴스가 많아 공고가 묻혀서) */
function inTab(rows, cat) {
  return cat === 'all' ? rows.filter((r) => r.category !== 'tech_news') : rows.filter((r) => r.category === cat);
}

function render() {
  const all = visibleRows();
  const base = all.filter((r) => inField(r, state.field));
  for (const btn of document.querySelectorAll('.tabs button')) {
    const cat = btn.dataset.cat;
    btn.querySelector('.count').textContent = inTab(base, cat).length;
    btn.setAttribute('aria-selected', String(cat === state.cat));
  }
  renderFields(inTab(all, state.cat));
  const rows = sortRows(inTab(base, state.cat));
  $('#list').replaceChildren(...rows.map(card));
  setStatus(rows.length ? '' : '조건에 맞는 공고가 없어요. 검색어나 필터를 바꿔 보세요.');
  renderSelbar();
}

function card(r) {
  const el = $('#card').content.firstElementChild.cloneNode(true);
  el.dataset.cat = r.category;
  el.dataset.id = r.id;

  el.querySelector('.chip').textContent = CATEGORY_LABEL[r.category] ?? r.category;
  el.querySelector('.src').textContent = SOURCE_LABEL[r.source] ?? r.source;
  el.querySelector('.new').hidden = !isNew(r) || isClosed(r);

  const pick = el.querySelector('.pick input');
  pick.checked = state.selected.has(r.id);
  el.classList.toggle('picked', pick.checked);

  const link = /^https?:\/\//.test(r.url) ? r.url : null;
  const a = el.querySelector('.card-title a');
  a.textContent = r.title;
  el.querySelector('.report').hidden = r.source !== 'community';
  el.querySelector('.cal').hidden = !r.deadline || isClosed(r);
  // AI·SW 뉴스는 읽을거리라서 홍보 칸·모음 담기를 빼고 간단하게 보여줍니다.
  if (r.category === 'tech_news') {
    el.classList.add('is-news');
    el.querySelector('.promo').remove();
    el.querySelector('.progress').remove();
    el.querySelector('.pick').remove();
  } else {
    renderPromo(el, r);
  }
  if (!link) el.querySelector('.share').hidden = true;
  const open = el.querySelector('.open');
  if (link) {
    a.href = link;
    open.href = link;
  } else {
    open.remove();
  }

  // 언론사 이름은 출처 표시와 같으므로 한 번만 보여줍니다.
  setText(el.querySelector('.org'), r.organization === SOURCE_LABEL[r.source] ? null : r.organization);
  setText(el.querySelector('.summary'), r.summary);

  const tags = (r.tags || []).filter((t) => !HIDDEN_TAGS.has(t)).slice(0, 3);
  const tagList = el.querySelector('.tags');
  if (tags.length) tagList.replaceChildren(...tags.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  else tagList.remove();

  const badge = el.querySelector('.dday');
  const date = el.querySelector('.date');
  const d = dday(r);
  if (d !== null) {
    badge.textContent = d < 0 ? '마감' : d === 0 ? 'D-DAY' : `D-${d}`;
    badge.dataset.level = d < 0 ? 'closed' : d <= 3 ? 'urgent' : d <= 7 ? 'soon' : 'normal';
    date.textContent = `${formatDate(r.deadline)} 마감${isGuessed(r) ? ' (추정)' : ''}`;
  } else if (isNewsCategory(r.category)) {
    badge.remove();
    date.textContent = r.posted_at ? `${formatDateTime(r.posted_at)} 게시` : '';
  } else {
    badge.textContent = '상시';
    badge.dataset.level = 'none';
    date.textContent = '마감일 미정';
  }
  return el;
}

/** 분야 칩: 지금 탭에서 해당 분야 공고가 몇 개인지 함께 보여줍니다. */
function renderFields(rows) {
  const chip = (key, label, n) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'field-chip' });
    b.dataset.field = key;
    b.setAttribute('aria-pressed', String(state.field === key));
    b.append(label, Object.assign(document.createElement('span'), { className: 'count', textContent: n }));
    return b;
  };
  $('#fields').replaceChildren(
    chip('all', '전체 분야', rows.length),
    ...FIELDS.map((f) => chip(f.key, f.label, rows.filter((r) => f.re.test(fieldText(r))).length)),
  );
}

// ---------------------------------------------------------------- 캘린더 · 공유
const isApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
const ymdCompact = (ymd) => ymd.replaceAll('-', '');
const nextDay = (ymd) => new Date(Date.parse(ymd) + 86400e3).toISOString().slice(0, 10);

/** 마감일을 하루짜리 일정으로 추가합니다. 아이폰은 .ics 파일, 그 밖에는 구글 캘린더 창을 엽니다. */
function addToCalendar(r) {
  const title = `[마감] ${r.title}`;
  const details = [r.organization && `주최: ${r.organization}`, `원문: ${r.url}`, `SW 공고 보드: ${location.origin}`]
    .filter(Boolean)
    .join('\n');
  if (!isApple) {
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: title,
      dates: `${ymdCompact(r.deadline)}/${ymdCompact(nextDay(r.deadline))}`,
      details,
    });
    window.open(`https://calendar.google.com/calendar/render?${params}`, '_blank', 'noopener');
    return;
  }
  const esc = (s) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UOU SW Board//KO',
    'BEGIN:VEVENT',
    `UID:posting-${r.id}@uou-sw-board`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${ymdCompact(r.deadline)}`,
    `DTEND;VALUE=DATE:${ymdCompact(nextDay(r.deadline))}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(details)}`,
    `URL:${r.url}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT15H', // 마감 전날 오전 9시쯤
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(`내일 마감: ${r.title}`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })),
    download: `마감-${r.deadline}.ics`,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function sharePosting(r) {
  const d = dday(r);
  const due = r.deadline ? ` (마감 ${formatDate(r.deadline)}${d >= 0 ? `, ${d === 0 ? 'D-DAY' : `D-${d}`}` : ''})` : '';
  const data = { title: r.title, text: `${r.title}${due}`, url: r.url };
  if (navigator.share) {
    try {
      await navigator.share(data);
    } catch {} // 사용자가 공유 창을 닫은 경우
    return;
  }
  const ok = await copyText(`${data.text}\n${data.url}`);
  toast(ok ? '공고 제목과 링크를 복사했어요. 원하는 곳에 붙여넣으세요.' : '복사하지 못했어요.');
}

function renderSkeleton() {
  const items = Array.from({ length: 6 }, () => {
    const li = document.createElement('li');
    li.className = 'card skeleton';
    li.innerHTML = '<span></span><span></span><span></span>';
    return li;
  });
  $('#list').replaceChildren(...items);
}

function renderSelbar() {
  const n = state.selected.size;
  $('#selbar').hidden = n === 0;
  $('#sel-count').textContent = n;
  document.body.classList.toggle('has-selbar', n > 0);
}

// ---------------------------------------------------------------- 인스타·블로그 프롬프트
// 공고 정보를 넣은 글쓰기 프롬프트를 복사합니다. ChatGPT·Claude·Gemini 등 어떤 AI 채팅에 붙여넣어도 같은 양식으로 글이 나오도록
// 특정 서비스에 기대지 않는 일반 지시문으로 씁니다.

const SITE_URL = 'https://my-first-hy.vercel.app';

function ddayText(r) {
  const d = dday(r);
  if (d === null) return '';
  return d < 0 ? ' (마감됨)' : d === 0 ? ' (D-DAY)' : ` (D-${d})`;
}

/** 공고 하나를 프롬프트용 정보 블록으로 */
function postingFacts(r, i) {
  const due = r.deadline
    ? `${formatDate(r.deadline)}${ddayText(r)}${isGuessed(r) ? ' ※ 공지 본문에서 추정한 날짜' : ''}`
    : '상시 모집 또는 미정';
  return [
    i == null ? '[공고 정보]' : `[공고 ${i + 1}]`,
    `- 분류: ${CATEGORY_LABEL[r.category] ?? r.category}`,
    `- 제목: ${r.title}`,
    r.organization && `- 주최: ${r.organization}`,
    `- 마감: ${due}`,
    r.summary && `- 참고 내용: ${r.summary}`,
    `- 원문 링크: ${r.url}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const COMMON_RULES = `[꼭 지켜줘]
- 맨 아래 공고 정보에 있는 사실만 써줘. 상금, 혜택, 지원 자격, 일정처럼 정보에 없는 내용은 지어내지 말고 "자세한 내용은 원문에서 확인해 주세요"로 안내해줘.
- 제목·주최·마감일은 주어진 그대로 써줘. "추정한 날짜"라고 적힌 마감일은 "공지 기준"이라고 밝히고 원문 확인을 권해줘.
- 말투는 친근한 해요체, 대학생 눈높이로. "역대급", "무조건" 같은 과장 광고 문구는 쓰지 마.
- 답변은 한국어로, 설명이나 인사 없이 요청한 결과물만 써줘.`;

function instaPrompt(rows) {
  const many = rows.length > 1;
  return `너는 울산대학교 SW 서포터즈의 인스타그램 담당이야. 아래 ${many ? `공고 ${rows.length}개를 묶어 소개하는` : '공고를 소개하는'} 인스타그램 게시물 캡션을 써줘.

${COMMON_RULES}

[캡션 형식]
- 이모지는 줄·항목 앞에 하나씩 자연스럽게. 한 줄에 여러 개 몰아 쓰지 마.
1. 첫 줄: 스크롤을 멈추게 하는 한 문장 + 이모지 1개 (예: 마감 임박, 이런 분께 추천 등 공고 성격에 맞게)
2. 빈 줄 후 ${many ? '공고마다 3줄씩:\n   🔹 제목\n   ⏰ 마감 YYYY.MM.DD (D-n)\n   💡 한 줄 소개 (누구에게 좋은지)\n   공고 사이에는 빈 줄' : '본문 4~6줄:\n   📌 제목\n   🏢 주최\n   ⏰ 마감 YYYY.MM.DD (D-n)\n   💡 이런 분께 추천해요 (1~2줄)'}
3. 마무리: "🔗 링크는 프로필에서 확인하세요" + 저장·공유를 권하는 한 줄
4. 맨 끝: 해시태그 10~15개 (#울산대 #울산대학교 #SW서포터즈 기본 + 분야·성격에 맞는 태그)
- 인스타 캡션은 링크가 눌리지 않으니 URL은 넣지 마.
- 전체 2,200자 이내, 모바일에서 읽기 좋게 줄을 짧게.

[답변 형식]
캡션 본문만 바로 복사할 수 있게 써줘. 그 아래에 "✏️ 대안 첫 줄" 2개를 덧붙여줘.

${rows.map((r, i) => postingFacts(r, many ? i : null)).join('\n\n')}`;
}

function blogPrompt(rows) {
  const many = rows.length > 1;
  return `너는 울산대학교 SW 서포터즈의 블로그 담당이야. 아래 ${many ? `공고 ${rows.length}개를 함께 소개하는 모음` : '공고를 소개하는'} 네이버 블로그 글을 써줘.

${COMMON_RULES}

[블로그 글 형식]
- 이모지는 문단·항목 앞에 하나씩 자연스럽게. 한 줄에 여러 개 몰아 쓰지 마.
- 네이버 블로그 편집기에 그대로 붙여넣을 수 있게 마크다운 기호(#, **, -, >) 없이 일반 텍스트로. 문단은 빈 줄로 나눠줘.
- 제목: 검색에 잘 걸리도록 핵심 키워드(공고명 또는 분야 + "대외활동/공모전/인턴" + 연도)를 앞쪽에 넣어 35자 이내로.
- 도입 (2~3문장): 서포터즈 인사 + 왜 이 ${many ? '공고들을' : '공고를'} 소개하는지.
- 공고 소개 (${many ? '공고마다 아래 형식을 반복' : '아래 형식'}):
  📌 제목
  🏢 주최: ...
  ⏰ 마감: YYYY.MM.DD (D-n)
  👀 이런 분께 추천해요: 2~3문장 (분야·대상 기준, 정보에 있는 내용으로만)
  ✅ 지원 전 체크: 원문에서 꼭 확인할 것 1~2가지 (예: 지원 자격, 제출 서류)
  🔗 원문: 링크 그대로
- 마무리 (2~3문장): 응원 한마디 + "더 많은 SW 공고는 ${SITE_URL} 에서 볼 수 있어요" 안내
- 맨 끝 줄: 해시태그 8~12개 (#울산대 #SW서포터즈 포함)
- 분량: ${many ? '공고당 5~8줄, 전체 1,500~2,500자' : '1,000~1,500자'}

[답변 형식]
첫 줄에 "제목: ..."을 쓰고 빈 줄 다음에 본문을 써줘. 본문 아래에 "✏️ 다른 제목 후보" 2개를 덧붙여줘.

${rows.map((r, i) => postingFacts(r, many ? i : null)).join('\n\n')}`;
}

function everytimePrompt(rows) {
  const many = rows.length > 1;
  return `너는 울산대학교 SW 서포터즈야. 아래 ${many ? `공고 ${rows.length}개를 한 번에 알리는` : '공고를 알리는'} 에브리타임(대학생 익명 커뮤니티) 홍보게시판 글을 써줘.

${COMMON_RULES}

[에브리타임 글 형식]
- 에브리타임은 광고 느낌이 강하면 반응이 나쁘니, 같은 학교 학생이 정보를 공유하듯 담백하고 짧게 써줘. 이모지는 글 전체에 0~3개만.
- 마크다운 기호(#, **, -) 없이 일반 텍스트로. 해시태그는 쓰지 마.
- 제목: 한 줄, 35자 이내. 형식 예: "[${many ? 'SW 공고 모음' : '분류'}] 핵심 내용 (~마감 MM/DD)"
- 본문:
  ${many ? '1) 첫 줄: 어떤 공고들을 모았는지 한 문장\n  2) 공고마다 3~4줄: 제목 / 주최 / 마감 MM/DD (D-n) / 링크\n     공고 사이에는 빈 줄' : '1) 첫 줄: 어떤 공고인지 한 문장\n  2) 주최, 마감 MM/DD (D-n), 누구에게 좋은지 1~2줄\n  3) 링크: 원문 링크 그대로'}
  ${many ? '3)' : '4)'} 마지막 줄: "SW 공고 더 보기: ${SITE_URL}"
- 전체 ${many ? '700' : '400'}자 이내.

[답변 형식]
첫 줄에 "제목: ..."을 쓰고 빈 줄 다음에 본문만 써줘.

${rows.map((r, i) => postingFacts(r, many ? i : null)).join('\n\n')}`;
}

const PROMPTS = {
  blog: { label: '🟢 네이버 블로그', build: (rows) => blogPrompt(rows) },
  insta: { label: '📸 인스타 게시글', build: (rows) => instaPrompt(rows) },
  everytime: { label: '💬 에브리타임 게시글', build: (rows) => everytimePrompt(rows) },
};

async function copyPrompt(rows, kind) {
  const prompt = PROMPTS[kind];
  if (!prompt) return;
  const ok = await copyText(prompt.build(rows));
  if (!ok) return toast('복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.');
  const ch = CHANNELS.find((c) => c.key === kind);
  toast(`${ch.short} 프롬프트를 복사했어요. AI 채팅에 붙여넣어 글을 만들고, 올린 뒤에는 '완료 체크'를 눌러 주세요.`);
}

/** 홍보 완료 체크/해제: 팀원 모두에게 보이도록 promotions 표에 저장합니다. */
async function markPromoted(rows, kind, done) {
  const ch = CHANNELS.find((c) => c.key === kind);
  for (const r of rows) {
    await setPromotion(r.id, kind, done);
    if (!state.promos.has(r.id)) state.promos.set(r.id, new Map());
    if (done) state.promos.get(r.id).set(kind, new Date().toISOString());
    else state.promos.get(r.id).delete(kind);
  }
  return ch;
}

async function toggleDone(row, kind, btn) {
  const done = !state.promos.get(row.id)?.has(kind);
  btn.disabled = true;
  try {
    const ch = await markPromoted([row], kind, done);
    refreshCard(row);
    renderStats();
    toast(done ? `${ch.short} 홍보 완료로 체크했어요.` : `${ch.short} 완료 체크를 해제했어요.`, {
      label: '되돌리기',
      onClick: async () => {
        await markPromoted([row], kind, !done).catch((e) => toast(e.message));
        refreshCard(row);
        renderStats();
      },
    });
  } catch (err) {
    btn.disabled = false;
    toast(err.message);
  }
}

/** 카드 하나만 다시 그립니다. (목록 전체를 다시 그리면 스크롤·포커스가 흔들려서) */
function refreshCard(row) {
  const old = $(`#list .card[data-id="${row.id}"]`);
  if (old) old.replaceWith(card(row));
}

// ---------------------------------------------------------------- 도우미
function setText(el, text) {
  if (text) el.textContent = text;
  else el.remove();
}
function setStatus(msg) {
  $('#status').textContent = msg;
}

// ---------------------------------------------------------------- URL ↔ 상태
function readUrl() {
  const p = new URLSearchParams(location.search);
  if (['all', 'activity', 'intern', 'uou_news', 'tech_news'].includes(p.get('cat'))) state.cat = p.get('cat');
  if (['deadline', 'deadline_desc', 'recent'].includes(p.get('sort'))) state.sort = p.get('sort');
  if (p.get('field') && FIELDS.some((f) => f.key === p.get('field'))) state.field = p.get('field');
  state.closed = p.get('closed') === '1';
  state.pending = p.get('pending') === '1';
  $('#pending').checked = state.pending;
  state.q = p.get('q') ?? '';
  $('#sort').value = state.sort;
  $('#closed').checked = state.closed;
  $('#q').value = state.q;
}
function writeUrl() {
  const p = new URLSearchParams();
  if (state.cat !== 'all') p.set('cat', state.cat);
  if (state.field !== 'all') p.set('field', state.field);
  if (state.sort !== 'deadline') p.set('sort', state.sort);
  if (state.closed) p.set('closed', '1');
  if (state.pending) p.set('pending', '1');
  if (state.q) p.set('q', state.q);
  history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
}
function update(patch) {
  Object.assign(state, patch);
  writeUrl();
  render();
}

// ---------------------------------------------------------------- 이벤트
document.querySelector('.tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-cat]');
  if (btn) update({ cat: btn.dataset.cat });
});
$('#sort').addEventListener('change', (e) => update({ sort: e.target.value }));
$('#closed').addEventListener('change', (e) => update({ closed: e.target.checked }));
$('#pending').addEventListener('change', (e) => update({ pending: e.target.checked }));
$('#q').addEventListener('input', (e) => update({ q: e.target.value }));

$('#list').addEventListener('click', (e) => {
  const cardEl = e.target.closest('.card[data-id]');
  if (!cardEl) return;
  const row = state.rows.find((r) => String(r.id) === cardEl.dataset.id);
  const promptBtn = e.target.closest('[data-prompt]');
  if (promptBtn) copyPrompt([row], promptBtn.dataset.prompt);
  const doneBtn = e.target.closest('[data-done]');
  if (doneBtn) toggleDone(row, doneBtn.dataset.done, doneBtn);
  if (e.target.closest('.report')) reportPost(row, e.target.closest('.report'));
  if (e.target.closest('.cal')) addToCalendar(row);
  if (e.target.closest('.share')) sharePosting(row);
});
$('#fields').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-field]');
  if (b) update({ field: b.dataset.field });
});
$('#list').addEventListener('change', (e) => {
  if (!e.target.matches('.pick input')) return;
  const cardEl = e.target.closest('.card');
  const id = Number(cardEl.dataset.id);
  if (e.target.checked && state.selected.size >= MAX_SELECT) {
    e.target.checked = false;
    toast(`모음 글에는 최대 ${MAX_SELECT}개까지 담을 수 있어요.`);
    return;
  }
  if (e.target.checked) state.selected.add(id);
  else state.selected.delete(id);
  cardEl.classList.toggle('picked', e.target.checked);
  renderSelbar();
});
document.querySelectorAll('#selbar [data-prompt]').forEach((b) =>
  b.addEventListener('click', () => {
    const rows = state.rows.filter((r) => state.selected.has(r.id));
    copyPrompt(sortRows(rows), b.dataset.prompt);
  }),
);
$('#sel-clear').addEventListener('click', () => {
  state.selected.clear();
  render();
});

// ---------------------------------------------------------------- 공고 올리기 · 신고
const dialog = $('#post-dialog');
const form = $('#post-form');

function openPostDialog() {
  form.reset();
  $('#post-error').textContent = '';
  form.elements.deadline.min = today;
  form.elements.deadline.disabled = false;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  form.elements.title.focus();
}
function closePostDialog() {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

document.querySelectorAll('[data-open-post]').forEach((b) => b.addEventListener('click', openPostDialog));
dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closePostDialog));
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) closePostDialog(); // 바깥 클릭
});
form.elements.always.addEventListener('change', () => {
  form.elements.deadline.disabled = form.elements.always.checked;
  if (form.elements.always.checked) form.elements.deadline.value = '';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#post-error');
  err.textContent = '';
  if (form.elements.homepage.value) return closePostDialog(); // 봇
  const data = Object.fromEntries(new FormData(form));
  const title = (data.title ?? '').trim();
  const url = (data.url ?? '').trim();
  if (title.length < 4) return (err.textContent = '제목을 4자 이상 적어 주세요.');
  if (!/^https?:\/\/\S+\.\S+/.test(url)) return (err.textContent = '원문 링크를 https://로 시작하는 주소로 적어 주세요.');
  if (!form.elements.always.checked && !data.deadline)
    return (err.textContent = '마감일을 고르거나 "상시 모집"을 체크해 주세요.');

  const btn = $('#post-submit');
  btn.disabled = true;
  btn.textContent = '올리는 중…';
  try {
    await apiInsert('postings', {
      source: 'community',
      source_id: 'pending', // DB에서 고유 ID로 바꿉니다
      category: data.category,
      title,
      url,
      organization: data.organization?.trim() || null,
      deadline: form.elements.always.checked ? null : data.deadline,
      summary: data.summary?.trim() || null,
    });
    closePostDialog();
    toast('공고를 올렸어요. 고마워요!');
    update({ cat: data.category, q: '', sort: 'recent' });
    $('#q').value = '';
    $('#sort').value = 'recent';
    load();
  } catch (e2) {
    err.textContent = e2.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '올리기';
  }
});

const REPORTED_KEY = 'reported-posts';
function reportedIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(REPORTED_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

async function reportPost(row, btn) {
  const done = reportedIds();
  if (done.has(row.id)) return toast('이미 신고한 공고예요.');
  const reason = prompt('신고 사유를 적어 주세요. (예: 광고, 허위 정보, SW와 무관)\n신고가 3건 쌓이면 자동으로 숨겨져요.');
  if (reason === null) return;
  btn.disabled = true;
  try {
    await apiInsert('reports', { posting_id: row.id, reason: reason.trim().slice(0, 200) || null });
    done.add(row.id);
    try {
      localStorage.setItem(REPORTED_KEY, JSON.stringify([...done]));
    } catch {}
    toast('신고했어요. 관리자가 확인할게요.');
  } catch (e) {
    btn.disabled = false;
    toast(e.message);
  }
}

readUrl();
load();

// 상단 "홍보 대기" 숫자를 누르면 홍보 안 한 공고만 보여줍니다.
$('#stat-pending-link').addEventListener('click', (e) => {
  e.preventDefault();
  $('#pending').checked = true;
  update({ pending: true });
  document.querySelector('.toolbar').scrollIntoView({ behavior: 'smooth' });
});

initThemeToggle(document.querySelector('#theme-btn'));
