// Supabase 공개(publishable) 키는 브라우저에 노출돼도 되는 키입니다.
// 테이블은 RLS로 '읽기만' 허용되어 있습니다. (supabase/schema.sql 참고)
const SUPABASE_URL = 'https://yggicyfxcyutfmcsnhxw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_QSU6nO1Kil6FBi-wtTWLRw_tRD02S6M';

const CATEGORY_LABEL = { activity: '대외활동', intern: '인턴', uou_news: '울산대 소식' };
const SOURCE_LABEL = {
  wevity: '위비티',
  contestkorea: '콘테스트코리아',
  uou_sw: 'SW사업단',
  naver_news: '뉴스',
  work24: '고용24',
  saramin: '사람인',
  manual: '직접 추가',
};
const HIDDEN_TAGS = new Set([...Object.values(SOURCE_LABEL), '마감일 추정', 'SW중심대학사업단']);
const NEWS_MAX_AGE_DAYS = 120; // 마감일 없는 소식은 이 기간까지만 기본 표시
const NEW_HOURS = 48;
const MAX_SELECT = 8;

const $ = (s) => document.querySelector(s);
const state = { rows: [], cat: 'all', sort: 'deadline', q: '', closed: false, selected: new Set() };

const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// ---------------------------------------------------------------- 데이터
async function api(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SUPABASE_KEY } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function load() {
  renderSkeleton();
  try {
    const cols = 'id,source,category,title,organization,url,summary,deadline,posted_at,tags,collected_at';
    const [rows, runs] = await Promise.all([
      api(`postings?select=${cols}&order=collected_at.desc&limit=2000`),
      api('collector_runs?select=finished_at&order=finished_at.desc&limit=1').catch(() => []),
    ]);
    state.rows = rows;
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
const dday = (r) => (r.deadline ? daysBetween(today, r.deadline) : null);
const isGuessed = (r) => (r.tags || []).includes('마감일 추정');
const isNew = (r) => Date.now() - Date.parse(r.collected_at) < NEW_HOURS * 3600e3;

function isClosed(r) {
  if (r.deadline) return r.deadline < today;
  const posted = r.posted_at || r.collected_at;
  return posted && daysBetween(posted.slice(0, 10), today) > NEWS_MAX_AGE_DAYS;
}

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  return state.rows.filter((r) => {
    if (!state.closed && isClosed(r)) return false;
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
  const open = state.rows.filter((r) => !isClosed(r));
  $('#stat-open').textContent = open.length;
  $('#stat-urgent').textContent = open.filter((r) => dday(r) !== null && dday(r) <= 3).length;
  $('#stat-new').textContent = open.filter(isNew).length;
}

function render() {
  const base = visibleRows();
  for (const btn of document.querySelectorAll('.tabs button')) {
    const cat = btn.dataset.cat;
    btn.querySelector('.count').textContent =
      cat === 'all' ? base.length : base.filter((r) => r.category === cat).length;
    btn.setAttribute('aria-selected', String(cat === state.cat));
  }
  const rows = sortRows(state.cat === 'all' ? base : base.filter((r) => r.category === state.cat));
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
  const a = el.querySelector('h2 a');
  a.textContent = r.title;
  const open = el.querySelector('.open');
  if (link) {
    a.href = link;
    open.href = link;
  } else {
    open.remove();
  }

  setText(el.querySelector('.org'), r.organization);
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
  } else if (r.category === 'uou_news') {
    badge.remove();
    date.textContent = r.posted_at ? `${formatDate(r.posted_at.slice(0, 10))} 게시` : '';
  } else {
    badge.textContent = '상시';
    badge.dataset.level = 'none';
    date.textContent = '마감일 미정';
  }
  return el;
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

// ---------------------------------------------------------------- 카드뉴스 요청 문장
// Canva의 인스타그램 게시물 생성은 한 장짜리 디자인이 기본이고, 요청에 적힌 문구를 그대로 싣습니다.
// 그래서 "이미지에 들어갈 문구"를 정확히 정해서 공고 1개 = 카드 1장으로 요청합니다.
// URL·메모는 이미지에 넣지 않고, 인스타그램 캡션 초안에만 넣도록 따로 줍니다.

function ddayLabel(r) {
  const d = dday(r);
  if (d === null) return '상시 모집';
  return d < 0 ? '마감' : d === 0 ? 'D-DAY' : `D-${d}`;
}

/** 카드에 들어갈 제목: 끝의 괄호 설명을 빼고, 그래도 길면 단어 단위로 자릅니다. */
function shortTitle(title, max = 42) {
  let t = title.trim();
  if (t.length > max) t = t.replace(/\s*\([^)]*\)\s*$/, '');
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s·,\-]+$/, '') + '…';
}

/** 이미지에 실을 문구 (글자 그대로 사용) */
function cardLines(r) {
  const lines = [
    `- 상단 작은 라벨: ${CATEGORY_LABEL[r.category] ?? r.category} · ${ddayLabel(r)}`,
    `- 큰 제목: ${shortTitle(r.title)}`,
  ];
  if (r.organization) lines.push(`- 주최: ${r.organization}`);
  if (r.deadline) lines.push(`- 마감: ${formatDate(r.deadline)}`);
  lines.push('- 한 줄 소개: (아래 참고 정보로 25자 이내 한국어 문장을 직접 써서 넣어줘)');
  lines.push('- 맨 아래: 자세한 내용은 프로필 링크에서 | 울산대 SW 서포터즈');
  return lines;
}

/** 이미지에는 넣지 않는 참고 정보 */
function referenceLines(r) {
  return [
    r.summary && `- 참고 내용: ${r.summary}`,
    isGuessed(r) && '- 마감일은 공지 본문에서 추정한 날짜야. 이미지에는 그대로 쓰되, 확인이 필요하다고 나에게 알려줘.',
    `- 원문 링크(캡션용): ${r.url}`,
  ].filter(Boolean);
}

const STYLE =
  '스타일: 남색과 하늘색 위주의 깔끔한 정보형 디자인, 제목을 가장 크게, 마감일은 눈에 띄게 강조, 인물 사진 없이 도형과 아이콘만 사용.';
const RULES = [
  'Canva로 만들 때 지켜줘:',
  '- 형식: Instagram Post (Portrait)',
  '- "이미지 문구"만 글자 그대로 넣고, 다른 문구·영어·링크는 추가하지 마',
  '- 다 만들면 디자인 링크와 함께 인스타그램 캡션 초안(원문 링크, 해시태그 3~5개 포함)을 써줘',
];

function cardNewsPrompt(rows) {
  if (rows.length === 1) {
    const r = rows[0];
    return [
      '울산대 SW 서포터즈 인스타그램 카드뉴스 1장을 Canva로 만들어줘.',
      '',
      ...RULES,
      '',
      '[이미지 문구]',
      ...cardLines(r),
      '',
      STYLE,
      '',
      '[참고 정보 - 이미지에 넣지 마]',
      ...referenceLines(r),
    ].join('\n');
  }
  const blocks = rows.map((r, i) =>
    [`## 카드 ${i + 2}`, '[이미지 문구]', ...cardLines(r), '[참고 정보 - 이미지에 넣지 마]', ...referenceLines(r)].join('\n'),
  );
  return [
    `울산대 SW 서포터즈 "이번 주 SW 공고 모음" 인스타그램 카드뉴스를 Canva로 만들어줘. 카드 ${rows.length + 1}장을 각각 따로 만들면 돼.`,
    '',
    ...RULES,
    '- 모든 카드는 같은 색과 분위기로 통일해줘',
    '',
    STYLE,
    '',
    '## 카드 1 (표지)',
    '[이미지 문구]',
    '- 큰 제목: 이번 주 SW 공고 모음',
    `- 부제: ${formatDate(today)} 기준 · 공고 ${rows.length}개`,
    `- 목록: ${rows.map((r) => `${ddayLabel(r)} ${shortTitle(r.title, 24)}`).join(' / ')}`,
    '- 맨 아래: 울산대 SW 서포터즈',
    '',
    blocks.join('\n\n'),
  ].join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

async function copyPrompt(rows) {
  const ok = await copyText(cardNewsPrompt(rows));
  toast(
    ok
      ? 'Canva가 연결된 Claude 채팅에 붙여넣으면 카드뉴스를 만들어 드려요.'
      : '복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.',
    ok ? { label: 'Claude 열기', href: 'https://claude.ai/new' } : null,
  );
}

// ---------------------------------------------------------------- 도우미
function setText(el, text) {
  if (text) el.textContent = text;
  else el.remove();
}
function daysBetween(fromYmd, toYmd) {
  return Math.round((Date.parse(toYmd) - Date.parse(fromYmd)) / 86400e3);
}
function formatDate(ymd) {
  const [y, m, d] = ymd.split('-');
  return `${y}.${m}.${d}`;
}
function formatDateTime(iso) {
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function setStatus(msg) {
  $('#status').textContent = msg;
}

let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.replaceChildren(document.createTextNode(msg));
  if (action) {
    const a = Object.assign(document.createElement('a'), {
      href: action.href,
      target: '_blank',
      rel: 'noopener',
      textContent: action.label,
    });
    el.append(a);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

// ---------------------------------------------------------------- URL ↔ 상태
function readUrl() {
  const p = new URLSearchParams(location.search);
  if (['all', 'activity', 'intern', 'uou_news'].includes(p.get('cat'))) state.cat = p.get('cat');
  if (['deadline', 'deadline_desc', 'recent'].includes(p.get('sort'))) state.sort = p.get('sort');
  state.closed = p.get('closed') === '1';
  state.q = p.get('q') ?? '';
  $('#sort').value = state.sort;
  $('#closed').checked = state.closed;
  $('#q').value = state.q;
}
function writeUrl() {
  const p = new URLSearchParams();
  if (state.cat !== 'all') p.set('cat', state.cat);
  if (state.sort !== 'deadline') p.set('sort', state.sort);
  if (state.closed) p.set('closed', '1');
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
$('#q').addEventListener('input', (e) => update({ q: e.target.value }));

$('#list').addEventListener('click', (e) => {
  const cardEl = e.target.closest('.card[data-id]');
  if (!cardEl) return;
  const row = state.rows.find((r) => String(r.id) === cardEl.dataset.id);
  if (e.target.closest('.copy')) copyPrompt([row]);
});
$('#list').addEventListener('change', (e) => {
  if (!e.target.matches('.pick input')) return;
  const cardEl = e.target.closest('.card');
  const id = Number(cardEl.dataset.id);
  if (e.target.checked && state.selected.size >= MAX_SELECT) {
    e.target.checked = false;
    toast(`모음 카드뉴스에는 최대 ${MAX_SELECT}개까지 담을 수 있어요.`);
    return;
  }
  if (e.target.checked) state.selected.add(id);
  else state.selected.delete(id);
  cardEl.classList.toggle('picked', e.target.checked);
  renderSelbar();
});
$('#sel-copy').addEventListener('click', () => {
  const rows = state.rows.filter((r) => state.selected.has(r.id));
  copyPrompt(sortRows(rows));
});
$('#sel-clear').addEventListener('click', () => {
  state.selected.clear();
  render();
});

readUrl();
load();
