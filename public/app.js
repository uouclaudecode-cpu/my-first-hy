// Supabase 공개(publishable) 키는 브라우저에 노출돼도 되는 키입니다.
// 테이블은 RLS로 '읽기만' 허용되어 있습니다. (supabase/schema.sql 참고)
const SUPABASE_URL = 'https://yggicyfxcyutfmcsnhxw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_QSU6nO1Kil6FBi-wtTWLRw_tRD02S6M';

const CATEGORY_LABEL = { activity: '대외활동', intern: '인턴', uou_news: '울산대 소식' };
const NEWS_MAX_AGE_DAYS = 120; // 마감일 없는 소식은 이 기간까지만 기본 표시

const $ = (s) => document.querySelector(s);
const state = { rows: [], cat: 'all', sort: 'deadline', q: '', closed: false };

const today = (() => {
  const kst = new Date(Date.now() + 9 * 3600e3);
  return kst.toISOString().slice(0, 10);
})();

async function api(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function load() {
  setStatus('불러오는 중…');
  try {
    const cols = 'id,source,category,title,organization,url,summary,deadline,posted_at,tags,collected_at';
    const [rows, runs] = await Promise.all([
      api(`postings?select=${cols}&order=collected_at.desc&limit=2000`),
      api('collector_runs?select=finished_at&order=finished_at.desc&limit=1').catch(() => []),
    ]);
    state.rows = rows;
    if (runs[0]) $('#updated').textContent = `마지막 수집 ${formatDateTime(runs[0].finished_at)}`;
    render();
  } catch (err) {
    console.error(err);
    setStatus('공고를 불러오지 못했어요. 잠시 후 새로고침해 주세요.');
  }
}

function isClosed(r) {
  if (r.deadline) return r.deadline < today;
  // 마감일이 없는 글(뉴스·공지)은 오래되면 지난 글로 취급
  const posted = r.posted_at || r.collected_at;
  return posted && daysBetween(posted.slice(0, 10), today) > NEWS_MAX_AGE_DAYS;
}

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  return state.rows.filter((r) => {
    if (!state.closed && isClosed(r)) return false;
    if (q && !`${r.title} ${r.organization ?? ''} ${r.summary ?? ''}`.toLowerCase().includes(q))
      return false;
    return true;
  });
}

function sortRows(rows) {
  const recent = (a, b) =>
    (b.posted_at || b.collected_at).localeCompare(a.posted_at || a.collected_at);
  const byDeadline = (dir) => (a, b) => {
    // 마감일 없는 글은 항상 뒤로, 그 안에서는 최신순
    if (a.deadline && b.deadline) return dir * a.deadline.localeCompare(b.deadline) || recent(a, b);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return recent(a, b);
  };
  const cmp =
    state.sort === 'recent' ? recent : byDeadline(state.sort === 'deadline_desc' ? -1 : 1);
  return [...rows].sort(cmp);
}

function render() {
  const base = visibleRows();
  for (const btn of document.querySelectorAll('.tabs button')) {
    const cat = btn.dataset.cat;
    const n = cat === 'all' ? base.length : base.filter((r) => r.category === cat).length;
    btn.querySelector('.count').textContent = n;
    btn.setAttribute('aria-selected', String(cat === state.cat));
  }

  const rows = sortRows(state.cat === 'all' ? base : base.filter((r) => r.category === state.cat));
  const list = $('#list');
  list.replaceChildren(...rows.map(card));
  setStatus(rows.length ? '' : '조건에 맞는 공고가 없어요.');
}

function card(r) {
  const el = $('#card').content.firstElementChild.cloneNode(true);
  el.dataset.cat = r.category;

  el.querySelector('.chip').textContent = CATEGORY_LABEL[r.category] ?? r.category;

  const dday = el.querySelector('.dday');
  const guessed = (r.tags || []).includes('마감일 추정');
  if (r.deadline) {
    const d = daysBetween(today, r.deadline);
    dday.textContent = d < 0 ? '마감' : d === 0 ? 'D-DAY' : `D-${d}`;
    if (guessed && d >= 0) dday.textContent += ' (추정)';
    dday.dataset.level = d < 0 ? 'closed' : d <= 3 ? 'urgent' : d <= 7 ? 'soon' : 'normal';
  } else if (r.category !== 'uou_news') {
    dday.textContent = '상시·미정';
    dday.dataset.level = 'none';
  } else {
    dday.remove();
  }

  const a = el.querySelector('h2 a');
  a.textContent = r.title;
  if (/^https?:\/\//.test(r.url)) a.href = r.url;

  el.querySelector('.org').textContent = r.organization ?? '';
  const summary = el.querySelector('.summary');
  if (r.summary) summary.textContent = r.summary;
  else summary.remove();

  el.querySelector('.tags').textContent = (r.tags || [])
    .filter((t) => t !== '마감일 추정')
    .map((t) => `#${t}`)
    .join(' ');

  const date = el.querySelector('.date');
  if (r.deadline) date.textContent = `마감 ${formatDate(r.deadline)}`;
  else if (r.posted_at) date.textContent = `${formatDate(r.posted_at.slice(0, 10))} 게시`;
  return el;
}

// ---------------------------------------------------------------- helpers
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
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function setStatus(msg) {
  $('#status').textContent = msg;
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

document.querySelector('.tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-cat]');
  if (btn) update({ cat: btn.dataset.cat });
});
$('#sort').addEventListener('change', (e) => update({ sort: e.target.value }));
$('#closed').addEventListener('change', (e) => update({ closed: e.target.checked }));
$('#q').addEventListener('input', (e) => update({ q: e.target.value }));

readUrl();
load();
