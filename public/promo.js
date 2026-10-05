import {
  CATEGORY_LABEL,
  isNewsCategory,
  CHANNELS,
  api,
  dday,
  ddayLabel,
  isClosed,
  dedupe,
  formatDateTime,
  loadPromotions,
  setPromotion,
  toast,
  initThemeToggle,
} from './common.js?v=20261006f';

const $ = (s) => document.querySelector(s);
const state = { postings: [], byId: new Map(), promos: new Map(), log: [], filter: 'all' };

async function load() {
  const cols = 'id,category,title,organization,url,deadline,posted_at,collected_at,tags';
  const [rows, promos] = await Promise.all([
    api(`postings?select=${cols}&order=collected_at.desc&limit=2000`),
    loadPromotions().catch(() => null),
  ]);
  state.byId = new Map(rows.map((r) => [r.id, r]));
  state.postings = dedupe(rows)
    .filter((r) => !isClosed(r) && !isNewsCategory(r.category))
    .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));
  if (!promos) {
    $('#setup').hidden = false;
  } else {
    state.promos = promos.map;
    state.log = promos.log;
  }
  render();
}

const doneCount = (r) => state.promos.get(r.id)?.size ?? 0;
const statusOf = (r) => {
  const n = doneCount(r);
  return n === 0 ? 'pending' : n === CHANNELS.length ? 'done' : 'partial';
};

function render() {
  // 통계: 최근 7일 게시 수 (채널별), 진행 중 공고 중 홍보 대기
  const weekAgo = Date.now() - 7 * 86400e3;
  const recent = state.log.filter((p) => Date.parse(p.done_at) >= weekAgo);
  $('#s-week').textContent = recent.length;
  for (const c of CHANNELS) $(`#s-${c.key}`).textContent = recent.filter((p) => p.channel === c.key).length;
  const pending = state.postings.filter((r) => statusOf(r) === 'pending');
  $('#s-pending').textContent = pending.length;

  // 급한 공고
  const urgent = pending.filter((r) => dday(r) !== null && dday(r) <= 7);
  $('#urgent').replaceChildren(...(urgent.length ? urgent.map(row) : [emptyRow('급한 공고가 없어요.')]));
  $('#urgent-panel').classList.toggle('tone-warn', urgent.length > 0);

  // 필터별 개수와 목록
  for (const b of document.querySelectorAll('#filters button')) {
    const f = b.dataset.filter;
    b.querySelector('.count').textContent =
      f === 'all' ? state.postings.length : state.postings.filter((r) => statusOf(r) === f).length;
    b.setAttribute('aria-pressed', String(f === state.filter));
  }
  const list = state.filter === 'all' ? state.postings : state.postings.filter((r) => statusOf(r) === state.filter);
  $('#board').replaceChildren(...(list.length ? list.map(row) : [emptyRow('해당하는 공고가 없어요.')]));

  // 최근 활동
  const log = state.log.slice(0, 15);
  $('#log').replaceChildren(
    ...(log.length
      ? log.map((p) => {
          const c = CHANNELS.find((x) => x.key === p.channel);
          const li = document.createElement('li');
          const time = Object.assign(document.createElement('time'), { textContent: formatDateTime(p.done_at), dateTime: p.done_at });
          const title = state.byId.get(p.posting_id)?.title ?? '(지워진 공고)';
          const who = Object.assign(document.createElement('span'), { className: 'who' });
          who.append(Object.assign(document.createElement('span'), { className: `dot ${p.channel}` }), c?.short ?? p.channel);
          li.append(time, who, Object.assign(document.createElement('b'), { textContent: title }));
          return li;
        })
      : [Object.assign(document.createElement('li'), { className: 'empty', textContent: '아직 기록이 없어요.' })]),
  );
}

function emptyRow(text) {
  return Object.assign(document.createElement('li'), { className: 'empty', textContent: text });
}

function row(r) {
  const li = document.createElement('li');
  li.className = 'board-row';

  const title = document.createElement('div');
  title.className = 'board-title';
  const a = Object.assign(document.createElement('a'), { textContent: r.title, target: '_blank', rel: 'noopener noreferrer' });
  if (/^https?:\/\//.test(r.url)) a.href = r.url;
  const meta = document.createElement('div');
  meta.className = 'board-meta';
  const d = dday(r);
  const badge = Object.assign(document.createElement('span'), { className: 'dday', textContent: ddayLabel(r) });
  badge.dataset.level = d === null ? 'none' : d <= 3 ? 'urgent' : d <= 7 ? 'soon' : 'normal';
  meta.append(badge, CATEGORY_LABEL[r.category] ?? '', r.organization ? ` · ${r.organization}` : '');
  title.append(a, meta);

  const toggles = document.createElement('div');
  toggles.className = 'toggles';
  for (const c of CHANNELS) {
    const at = state.promos.get(r.id)?.get(c.key);
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'ch-toggle' });
    b.innerHTML = `<span class="dot ${c.key}"></span><svg class="i"><use href="#i-check"/></svg>`;
    b.append(c.short);
    b.setAttribute('aria-pressed', String(Boolean(at)));
    b.title = at ? `${formatDateTime(at)} 홍보 완료 · 누르면 해제` : `${c.short}에 올렸으면 눌러 주세요`;
    b.addEventListener('click', () => toggle(r, c, !at, b));
    toggles.append(b);
  }
  li.append(title, toggles);
  return li;
}

async function toggle(r, c, done, btn) {
  btn.disabled = true;
  try {
    await setPromotion(r.id, c.key, done);
    if (!state.promos.has(r.id)) state.promos.set(r.id, new Map());
    if (done) {
      const at = new Date().toISOString();
      state.promos.get(r.id).set(c.key, at);
      state.log.unshift({ posting_id: r.id, channel: c.key, done_at: at });
    } else {
      state.promos.get(r.id).delete(c.key);
      state.log = state.log.filter((p) => !(p.posting_id === r.id && p.channel === c.key));
    }
    render();
    toast(done ? `${c.short} 홍보 완료로 체크했어요.` : `${c.short} 완료 체크를 해제했어요.`, {
      label: '되돌리기',
      onClick: () => toggle(r, c, !done, btn),
    });
  } catch (err) {
    btn.disabled = false;
    toast(err.message);
  }
}

$('#filters').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-filter]');
  if (!b) return;
  state.filter = b.dataset.filter;
  render();
});

load().catch((err) => {
  console.error(err);
  $('#board').replaceChildren(emptyRow('불러오지 못했어요. 잠시 후 새로고침해 주세요.'));
});

initThemeToggle(document.querySelector('#theme-btn'));
