// 공고 보드(index)와 홍보 현황(promo) 페이지가 함께 쓰는 설정·판단·도우미.

// Supabase 공개(publishable) 키는 브라우저에 노출돼도 되는 키입니다. 권한은 RLS가 정합니다. (supabase/*.sql)
export const SUPABASE_URL = 'https://yggicyfxcyutfmcsnhxw.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_QSU6nO1Kil6FBi-wtTWLRw_tRD02S6M';

export const CATEGORY_LABEL = { activity: '대외활동', intern: '인턴', uou_news: '울산대 소식', tech_news: 'AI·SW 뉴스' };
/** 소식·뉴스(모집 공고가 아닌 글) */
export const isNewsCategory = (cat) => cat === 'uou_news' || cat === 'tech_news';

/** 홍보 채널 (promotions 표의 channel 값) */
export const CHANNELS = [
  { key: 'blog', short: '블로그', icon: '🟢', label: '🟢 네이버 블로그' },
  { key: 'insta', short: '인스타', icon: '📸', label: '📸 인스타 게시글' },
  { key: 'everytime', short: '에타', icon: '💬', label: '💬 에브리타임 게시글' },
];

export const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// ---------------------------------------------------------------- 마감 판단
// 마감일 없는 글은 게시 후 이 기간까지만 기본 표시
const MAX_DAYS = { uou_news: 90, tech_news: 14, default: 30 };
// 모집 공고인데 제목만 봐도 끝난 글: (마감), 수상자 발표, 최종 결과 등 (소식·뉴스에는 적용하지 않음)
const ENDED_TITLE = /[(\[]\s*마감\s*[)\]]|접수\s*마감|모집\s*마감|조기\s*마감|마감\s*되었|수상자\s*발표|결과\s*발표|최종\s*결과|선정\s*결과|합격자\s*발표/;

export const dday = (r) => (r.deadline ? daysBetween(today, r.deadline) : null);
export const isGuessed = (r) => (r.tags || []).includes('마감일 추정');

export function isClosed(r) {
  if (!isNewsCategory(r.category) && ENDED_TITLE.test(r.title)) return true;
  if (r.deadline) return r.deadline < today;
  const posted = r.posted_at || r.collected_at;
  return posted && daysBetween(kstDate(posted), today) > (MAX_DAYS[r.category] ?? MAX_DAYS.default);
}

/** ISO 시각 → 한국 날짜 'YYYY-MM-DD' */
export const kstDate = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);

/** 같은 공고가 여러 사이트에 올라온 경우 하나만 남깁니다. (제목에서 기호·공백만 빼고 비교) */
export function dedupe(rows) {
  const key = (t) => t.replace(/[^0-9a-zA-Z가-힣]/g, '').toLowerCase();
  const seen = new Set();
  return rows.filter((r) => {
    const k = key(r.title) || String(r.id);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function ddayLabel(r) {
  const d = dday(r);
  if (d === null) return '상시';
  return d < 0 ? '마감' : d === 0 ? 'D-DAY' : `D-${d}`;
}

// ---------------------------------------------------------------- Supabase
export async function api(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SUPABASE_KEY } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function apiWrite(method, path, body, prefer = 'return=minimal') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: prefer },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = '';
    let code = '';
    try {
      ({ message: msg = '', code = '' } = await res.json());
    } catch {}
    if (code === 'PGRST205' || code === '42P01') {
      throw new Error('저장할 표가 아직 없어요. Supabase SQL Editor에서 supabase/ 폴더의 SQL을 실행해 주세요.');
    }
    // DB 트리거가 보낸 한국어 안내는 그대로 보여주고, 그 밖의 오류는 일반 문구로
    throw new Error(/[가-힣]/.test(msg) ? msg : '저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}

export const apiInsert = (table, row) => apiWrite('POST', table, row);

/** 홍보 기록: Map<posting_id, Map<channel, done_at>> */
export async function loadPromotions() {
  const rows = await api('promotions?select=posting_id,channel,done_at&order=done_at.desc&limit=5000');
  const map = new Map();
  for (const p of rows) {
    if (!map.has(p.posting_id)) map.set(p.posting_id, new Map());
    map.get(p.posting_id).set(p.channel, p.done_at);
  }
  return { map, log: rows };
}

export async function setPromotion(postingId, channel, done) {
  if (done) {
    // 이미 표시돼 있으면 그대로 둡니다 (ON CONFLICT DO NOTHING)
    await apiWrite('POST', 'promotions?on_conflict=posting_id,channel', { posting_id: postingId, channel }, 'resolution=ignore-duplicates,return=minimal');
  } else {
    await apiWrite('DELETE', `promotions?posting_id=eq.${postingId}&channel=eq.${channel}`);
  }
}

// ---------------------------------------------------------------- 도우미
export function daysBetween(fromYmd, toYmd) {
  return Math.round((Date.parse(toYmd) - Date.parse(fromYmd)) / 86400e3);
}
export function formatDate(ymd) {
  const [y, m, d] = ymd.split('-');
  return `${y}.${m}.${d}`;
}
export function formatDateTime(iso) {
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function copyText(text) {
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

let toastTimer;
/**
 * 화면 아래 알림. action은 링크({label, href, newTab}) 또는 버튼({label, onClick}).
 */
export function toast(msg, action) {
  const el = document.querySelector('#toast');
  el.replaceChildren(document.createTextNode(msg));
  if (action?.onClick) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: action.label });
    b.addEventListener('click', () => {
      el.classList.remove('show');
      action.onClick();
    });
    el.append(b);
  } else if (action?.href) {
    const a = Object.assign(document.createElement('a'), { href: action.href, textContent: action.label });
    if (action.newTab !== false) Object.assign(a, { target: '_blank', rel: 'noopener' });
    el.append(a);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action?.onClick ? 8000 : 5000);
}

// ---------------------------------------------------------------- 화면 모드 (시스템 → 라이트 → 다크)
const THEMES = [
  { key: 'system', label: '시스템 설정', icon: 'i-monitor' },
  { key: 'light', label: '라이트 모드', icon: 'i-sun' },
  { key: 'dark', label: '다크 모드', icon: 'i-moon' },
];

export function initThemeToggle(button) {
  if (!button) return;
  let current = 'system';
  try {
    current = localStorage.getItem('theme') || 'system';
  } catch {}
  const apply = (key) => {
    const t = THEMES.find((x) => x.key === key) ?? THEMES[0];
    if (t.key === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t.key;
    button.querySelector('use').setAttribute('href', `#${t.icon}`);
    button.title = `화면 모드: ${t.label} (누르면 바뀜)`;
    button.setAttribute('aria-label', button.title);
    current = t.key;
  };
  apply(current);
  button.addEventListener('click', () => {
    const next = THEMES[(THEMES.findIndex((x) => x.key === current) + 1) % THEMES.length];
    apply(next.key);
    try {
      if (next.key === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', next.key);
    } catch {}
    toast(`${next.label}로 바꿨어요.`);
  });
}
