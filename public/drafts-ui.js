// AI가 쓴 글(블로그·인스타)을 보여주고 복사하는 화면 조각. 메인 페이지 팝업과 글 보관함(/posts)이 함께 씁니다.

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

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/**
 * @param {{title:string, blog:string, instagram:string}} draft
 * @param {(ok:boolean, what:string)=>void} onCopied
 */
export function draftView(draft, onCopied = () => {}) {
  const tabs = [
    { key: 'blog', label: '📝 블로그', text: `${draft.title}\n\n${draft.blog}`, copyLabel: '제목+본문 복사' },
    { key: 'instagram', label: '📸 인스타그램', text: draft.instagram, copyLabel: '캡션 복사' },
  ];
  const root = el('div', { className: 'draft' });
  const bar = el('div', { className: 'draft-tabs', role: 'tablist' });
  const panels = tabs.map((t, i) => {
    const btn = el('button', { type: 'button', role: 'tab', textContent: t.label });
    btn.setAttribute('aria-selected', String(i === 0));
    bar.append(btn);

    const copy = el('button', { type: 'button', className: 'btn primary', textContent: t.copyLabel });
    copy.addEventListener('click', async () => onCopied(await copyText(t.text), t.label));
    const head = el('div', { className: 'draft-head' });
    if (t.key === 'blog') head.append(el('h3', { className: 'draft-title', textContent: draft.title }));
    else head.append(el('span', { className: 'draft-count', textContent: `${t.text.length}자` }));
    head.append(copy);
    const panel = el(
      'div',
      { className: 'draft-panel', role: 'tabpanel', hidden: i !== 0 },
      head,
      el('pre', { className: 'draft-text', textContent: t.key === 'blog' ? draft.blog : draft.instagram }),
    );
    btn.addEventListener('click', () => {
      bar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      panels.forEach((p) => (p.hidden = p !== panel));
    });
    return panel;
  });
  root.append(bar, ...panels);
  return root;
}
