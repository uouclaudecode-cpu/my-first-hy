import { draftView } from './drafts-ui.js';

const SUPABASE_URL = 'https://yggicyfxcyutfmcsnhxw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_QSU6nO1Kil6FBi-wtTWLRw_tRD02S6M';
const KIND_LABEL = { weekly: '🗓️ 주간 자동', bundle: '📦 모음', single: '📌 단일' };

const $ = (s) => document.querySelector(s);

async function load() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/drafts?select=id,kind,title,blog,instagram,created_by,created_at&order=created_at.desc&limit=60`,
    { headers: { apikey: SUPABASE_KEY } },
  );
  if (!res.ok) {
    $('#status').textContent = '글을 불러오지 못했어요. 잠시 후 새로고침해 주세요.';
    return;
  }
  const drafts = await res.json();
  $('#status').textContent = drafts.length ? '' : '아직 쓴 글이 없어요. 공고 보드에서 ✍️ 글 쓰기를 눌러 보세요.';
  const admin = await adminClient();
  $('#posts').replaceChildren(...drafts.map((d, i) => postEl(d, i === 0, admin)));
}

function postEl(d, open, admin) {
  const li = document.createElement('li');
  li.className = 'post';

  const meta = document.createElement('div');
  meta.className = 'post-meta';
  const kind = Object.assign(document.createElement('span'), {
    className: `kind ${d.kind}`,
    textContent: KIND_LABEL[d.kind] ?? d.kind,
  });
  const when = new Date(d.created_at).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  meta.append(kind, document.createTextNode(when));
  if (admin) {
    const del = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost del', textContent: '삭제' });
    del.addEventListener('click', async () => {
      if (!confirm('이 글을 보관함에서 지울까요?')) return;
      const { error } = await admin.from('drafts').delete().eq('id', d.id);
      if (error) return toast(`지우지 못했어요: ${error.message}`);
      li.remove();
      toast('지웠어요.');
    });
    meta.append(del);
  }

  const details = document.createElement('details');
  details.open = open;
  const summary = Object.assign(document.createElement('summary'), { className: 'post-title', textContent: d.title });
  details.append(summary, draftView(d, (ok, what) => toast(ok ? `${what} 글을 복사했어요.` : '복사하지 못했어요.')));

  li.append(meta, details);
  return li;
}

/** 로그인한 관리자면 삭제용 Supabase 클라이언트를, 아니면 null */
async function adminClient() {
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data } = await sb.auth.getSession();
    if (!data.session) return null;
    const { data: isAdmin } = await sb.rpc('is_admin');
    return isAdmin ? sb : null;
  } catch {
    return null;
  }
}

let timer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), 3000);
}

load();
