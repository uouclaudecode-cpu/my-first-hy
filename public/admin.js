// 관리자 페이지: Supabase 이메일 로그인(매직 링크) 후, 방문자가 올린 공고를 숨기기/보이기/삭제합니다.
// 권한은 DB의 admins 표와 RLS 정책이 판단합니다. (supabase/002_community.sql)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://yggicyfxcyutfmcsnhxw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_QSU6nO1Kil6FBi-wtTWLRw_tRD02S6M';
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (s) => document.querySelector(s);
const show = (id) => ['login', 'denied', 'manage'].forEach((x) => ($(`#${x}`).hidden = x !== id));
let rows = [];
let filter = 'all';

async function init() {
  const { data } = await sb.auth.getSession();
  const session = data.session;
  if (!session) return show('login');
  const { data: isAdmin, error } = await sb.rpc('is_admin');
  if (error || !isAdmin) return show('denied');
  $('#who').textContent = `${session.user.email} 로 로그인됨`;
  show('manage');
  load();
}

async function load() {
  $('#status').textContent = '불러오는 중…';
  const { data, error } = await sb
    .from('postings')
    .select('id,category,title,organization,url,summary,deadline,hidden,collected_at,reports(reason,created_at)')
    .eq('source', 'community')
    .order('collected_at', { ascending: false })
    .limit(500);
  if (error) {
    $('#status').textContent = `불러오지 못했어요: ${error.message}`;
    return;
  }
  rows = data;
  render();
}

function render() {
  const list = rows.filter((r) =>
    filter === 'reported' ? r.reports.length > 0 : filter === 'hidden' ? r.hidden : true,
  );
  $('#status').textContent = list.length ? '' : '해당하는 글이 없어요.';
  $('#rows').replaceChildren(...list.map(rowEl));
}

function rowEl(r) {
  const li = document.createElement('li');
  li.className = 'row' + (r.hidden ? ' is-hidden' : '');
  li.dataset.id = r.id;

  const h3 = document.createElement('h3');
  const a = Object.assign(document.createElement('a'), { textContent: r.title, target: '_blank', rel: 'noopener noreferrer' });
  if (/^https?:\/\//.test(r.url)) a.href = r.url;
  h3.append(a);

  const meta = document.createElement('div');
  meta.className = 'meta-line';
  const bits = [
    r.category === 'intern' ? '인턴' : '대외활동',
    r.organization,
    r.deadline ? `마감 ${r.deadline}` : '상시',
    `올린 시각 ${new Date(r.collected_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
  ].filter(Boolean);
  for (const b of bits) meta.append(Object.assign(document.createElement('span'), { textContent: b }));
  if (r.hidden) meta.append(Object.assign(document.createElement('span'), { className: 'badge', textContent: '숨김' }));
  if (r.reports.length)
    meta.append(Object.assign(document.createElement('span'), { className: 'badge warn', textContent: `신고 ${r.reports.length}` }));

  li.append(h3, meta);
  if (r.summary) li.append(Object.assign(document.createElement('div'), { className: 'meta-line', textContent: r.summary }));
  const reasons = r.reports.map((x) => x.reason).filter(Boolean);
  if (reasons.length) {
    const ul = document.createElement('ul');
    ul.className = 'reasons';
    ul.append(...reasons.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
    li.append(ul);
  }

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  actions.innerHTML = r.hidden
    ? '<button class="btn" data-act="unhide">다시 보이기</button>'
    : '<button class="btn" data-act="hide">숨기기</button>';
  actions.innerHTML += '<button class="btn danger" data-act="delete">삭제</button>';
  li.append(actions);
  return li;
}

$('#rows').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = Number(btn.closest('.row').dataset.id);
  const act = btn.dataset.act;
  if (act === 'delete' && !confirm('이 공고를 완전히 삭제할까요? 되돌릴 수 없어요.')) return;
  btn.disabled = true;
  let error;
  if (act === 'delete') ({ error } = await sb.from('postings').delete().eq('id', id));
  if (act === 'hide') ({ error } = await sb.from('postings').update({ hidden: true }).eq('id', id));
  if (act === 'unhide') {
    ({ error } = await sb.from('reports').delete().eq('posting_id', id));
    if (!error) ({ error } = await sb.from('postings').update({ hidden: false }).eq('id', id));
  }
  if (error) {
    btn.disabled = false;
    return toast(`실패했어요: ${error.message}`);
  }
  toast({ delete: '삭제했어요.', hide: '숨겼어요.', unhide: '다시 보이게 했어요.' }[act]);
  load();
});

document.querySelector('.filters').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-filter]');
  if (!b) return;
  filter = b.dataset.filter;
  document.querySelectorAll('.filters button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  render();
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#login-msg');
  const email = $('#email').value.trim();
  msg.style.color = '';
  msg.textContent = '보내는 중…';
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${location.origin}/admin` },
  });
  if (error) {
    msg.textContent = `보내지 못했어요: ${error.message}`;
  } else {
    msg.style.color = 'var(--intern)';
    msg.textContent = `${email}로 로그인 링크를 보냈어요. 메일함(스팸함 포함)을 확인해 주세요.`;
  }
});

document.querySelectorAll('[data-logout]').forEach((b) =>
  b.addEventListener('click', async () => {
    await sb.auth.signOut();
    show('login');
  }),
);

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN') init();
});
init();
