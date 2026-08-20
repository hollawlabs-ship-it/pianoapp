/* ===== 하단 시트(모달) · 확인 대화 ===== */
window.PA = window.PA || {};

(function (PA) {
  'use strict';
  const { el, icon, clear } = PA.util;

  let openCount = 0;

  /**
   * 하단 시트를 연다.
   * @param {object} opts {title, body(Node|fn), actions:[{label,kind,onClick}], onClose}
   * @returns {object} { close, setBody, root }
   */
  function open(opts) {
    opts = opts || {};
    const scrim = el('div', { class: 'sheet-scrim' });
    const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });

    const grip = el('div', { class: 'sheet-grip' });
    const head = el('div', { class: 'sheet-head' }, [
      el('h3', { text: opts.title || '' }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn ghost icon', 'aria-label': '닫기', html: icon('x', 18), onclick: () => close() }),
    ]);
    const body = el('div', { class: 'sheet-body' });

    sheet.appendChild(grip);
    if (opts.title !== null) sheet.appendChild(head);
    sheet.appendChild(body);

    if (opts.actions && opts.actions.length) {
      const bar = el('div', { class: 'row', style: { padding: '0 18px 18px', gap: '8px' } });
      opts.actions.forEach((a) => {
        bar.appendChild(
          el('button', {
            class: 'btn ' + (a.kind || '') + (a.block ? ' block' : ''),
            html: (a.icon ? icon(a.icon, 17) : '') + '<span>' + PA.util.esc(a.label) + '</span>',
            onclick: () => a.onClick && a.onClick(api),
          })
        );
      });
      sheet.appendChild(bar);
    }

    // api는 setBody보다 먼저 만들어 둔다. body를 함수로 넘기면 그 안에서 api를 쓰기 때문이다.
    const api = { close, setBody, root: sheet, body };

    function setBody(content) {
      clear(body);
      const node = typeof content === 'function' ? content(api) : content;
      if (typeof node === 'string') body.innerHTML = node;
      else if (node) body.appendChild(node);
    }
    if (opts.body) setBody(opts.body);

    document.body.appendChild(scrim);
    document.body.appendChild(sheet);
    openCount++;
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(() => { scrim.classList.add('in'); sheet.classList.add('in'); });

    let closed = false;
    function close(result) {
      if (closed) return;
      closed = true;
      scrim.classList.remove('in');
      sheet.classList.remove('in');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => {
        scrim.remove(); sheet.remove();
        openCount = Math.max(0, openCount - 1);
        if (!openCount) document.body.style.overflow = '';
        if (opts.onClose) opts.onClose(result);
      }, 280);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    scrim.addEventListener('click', () => { if (opts.dismissible !== false) close(); });
    document.addEventListener('keydown', onKey);

    return api;
  }

  /** 예/아니오 확인. Promise<boolean> */
  function confirm(opts) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const sheet = open({
        title: opts.title || '확인',
        body: el('div', { class: 'stack' }, [
          el('p', { class: 'small muted', text: opts.message || '' }),
        ]),
        actions: [
          { label: '취소', onClick: (a) => { finish(false); a.close(); } },
          {
            label: opts.confirmLabel || '확인',
            kind: opts.danger ? 'danger' : 'primary',
            onClick: (a) => { finish(true); a.close(); },
          },
        ],
        onClose: () => finish(false),
      });
      return sheet;
    });
  }

  /** 한 줄 입력 프롬프트. Promise<string|null> */
  function prompt(opts) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const input = el('input', {
        class: 'input',
        value: opts.value || '',
        placeholder: opts.placeholder || '',
        type: opts.type || 'text',
      });
      const sheet = open({
        title: opts.title || '입력',
        body: el('div', { class: 'stack' }, [
          opts.label ? el('label', { class: 'small muted', text: opts.label }) : null,
          input,
          opts.hint ? el('p', { class: 'tiny faint', text: opts.hint }) : null,
        ]),
        actions: [
          { label: '취소', onClick: (a) => { finish(null); a.close(); } },
          { label: '저장', kind: 'primary', onClick: (a) => { finish(input.value.trim()); a.close(); } },
        ],
        onClose: () => finish(null),
      });
      setTimeout(() => input.focus(), 320);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { finish(input.value.trim()); sheet.close(); }
      });
      return sheet;
    });
  }

  PA.sheets = { open, confirm, prompt };
})(window.PA);
