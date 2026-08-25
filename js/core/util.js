/* ===== 공용 유틸 · 아이콘 · DOM 헬퍼 ===== */
window.PA = window.PA || {};

(function (PA) {
  'use strict';

  /* 자산을 바꾸면 sw.js의 VERSION도 함께 올려야 캐시가 갱신된다. */
  PA.VERSION = 'v6.8.0';
  PA.CHANNEL = 'beta';

  /* ---------- DOM ---------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    (Array.isArray(children) ? children : children != null ? [children] : []).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  const frag = (nodes) => {
    const f = document.createDocumentFragment();
    nodes.filter(Boolean).forEach((n) => f.appendChild(n));
    return f;
  };

  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- 아이콘 (lucide 스타일 stroke 아이콘, 인라인 SVG) ---------- */
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    piano: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18"/><path d="M8 4v10"/><path d="M13 4v10"/><path d="M18 4v10"/>',
    notebook: '<path d="M5 3h13a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5z"/><path d="M9 3v18"/><path d="M13 8h4"/><path d="M13 12h4"/>',
    trend: '<path d="M3 17l6-6 4 4 7-8"/><path d="M15 7h5v5"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    pause: '<rect x="7" y="4.5" width="3.6" height="15" rx="1"/><rect x="13.4" y="4.5" width="3.6" height="15" rx="1"/>',
    mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>',
    square: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    x: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    chevronRight: '<path d="M9 5l7 7-7 7"/>',
    chevronDown: '<path d="M5 9l7 7 7-7"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3.5 2"/>',
    metronome: '<path d="M10 3h4l4 18H6z"/><path d="M7.6 14h8.8"/><path d="M17 6L9.5 17"/>',
    upload: '<path d="M12 16V4"/><path d="M7.5 8.5L12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    video: '<rect x="2.5" y="6" width="13" height="12" rx="2"/><path d="M15.5 10.5l6-3.5v10l-6-3.5z"/>',
    music: '<circle cx="6.5" cy="17.5" r="2.8"/><circle cx="18" cy="15.5" r="2.8"/><path d="M9.3 17.5V6l11.5-2.5v12"/>',
    users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0"/><path d="M16.5 5.2a3.4 3.4 0 0 1 0 6.6"/><path d="M18 14.4A6.2 6.2 0 0 1 21.2 20"/>',
    sparkles: '<path d="M12 3l1.7 4.6L18.3 9l-4.6 1.7L12 15l-1.7-4.3L5.7 9l4.6-1.4z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    trash: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/>',
    edit: '<path d="M15.5 4.5l4 4L8 20H4v-4z"/>',
    swap: '<path d="M4 8h13"/><path d="M13.5 4.5L17 8l-3.5 3.5"/><path d="M20 16H7"/><path d="M10.5 12.5L7 16l3.5 3.5"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".9" fill="currentColor"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4.5h11l-1.8 3.6L16 12H5z"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/>',
    download: '<path d="M12 4v12"/><path d="M7.5 11.5L12 16l4.5-4.5"/><path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/>',
    alert: '<path d="M12 4.5L21 20H3z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
    key: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9"/><path d="M17.5 12v3.5"/><path d="M20.5 12v2.5"/>',
    link: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.3 1.3"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.3-1.3"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.2"/><path d="M20 5v6h-6"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  };

  function icon(name, size) {
    const d = P[name] || P.music;
    const s = size || 20;
    return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  }
  function iconEl(name, size) {
    const wrap = document.createElement('span');
    wrap.style.display = 'contents';
    wrap.innerHTML = icon(name, size);
    return wrap.firstChild;
  }

  /* ---------- 포맷 ---------- */
  const pad2 = (n) => String(n).padStart(2, '0');

  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  }
  function fmtMinutes(sec) {
    const m = Math.round((sec || 0) / 60);
    if (m < 60) return `${m}분`;
    return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  }
  const todayKey = () => dateKey(new Date());
  function dateKey(d) {
    d = d instanceof Date ? d : new Date(d);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function fmtDate(key) {
    const d = new Date(key + 'T00:00:00');
    if (isNaN(d)) return key;
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  }
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  function weekday(key) {
    const d = new Date(key + 'T00:00:00');
    return isNaN(d) ? '' : WD[d.getDay()];
  }
  function relDays(key) {
    const diff = Math.round((new Date(todayKey() + 'T00:00:00') - new Date(key + 'T00:00:00')) / 86400000);
    if (diff === 0) return '오늘';
    if (diff === 1) return '어제';
    if (diff < 0) return `${-diff}일 뒤`;
    if (diff < 7) return `${diff}일 전`;
    if (diff < 30) return `${Math.floor(diff / 7)}주 전`;
    return `${Math.floor(diff / 30)}개월 전`;
  }
  function addDays(key, n) {
    const d = new Date(key + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return dateKey(d);
  }
  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }

  /* ---------- 수학 ---------- */
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round1 = (v) => Math.round(v * 10) / 10;
  const avg = (arr) => (arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* 문자열 해시 → 커버 아트 시드 */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }

  /* ---------- 토스트 ---------- */
  function toast(msg, kind) {
    let host = $('#toast-host');
    if (!host) { host = el('div', { id: 'toast-host' }); document.body.appendChild(host); }
    const t = el('div', { class: 'toast' + (kind === 'warn' ? ' warn' : ''), text: msg });
    host.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .25s ease, transform .25s ease';
      t.style.opacity = '0'; t.style.transform = 'translateY(8px)';
      setTimeout(() => t.remove(), 260);
    }, kind === 'warn' ? 3400 : 2200);
  }

  /* ---------- 커버 아트: 추상 건반 + 음표 ---------- */
  /* 커버도 무채색. 곡마다 달라 보여야 하므로 색상 대신
     '바탕의 검정 농도 + 건반의 밝기 대비'를 다르게 준다. */
  const COVER_PALETTES = [
    ['#0D0D0D', '#6E6E6E', '#FFFFFF'],
    ['#1C1C1C', '#8A8A8A', '#F2F2F2'],
    ['#2B2B2B', '#B4B4B4', '#FFFFFF'],
    ['#111111', '#4A4A4A', '#D8D8D8'],
    ['#232323', '#9E9E9E', '#FFFFFF'],
    ['#080808', '#5C5C5C', '#EDEDED'],
  ];

  /**
   * 곡 제목·작곡가에서 결정론적으로 커버를 생성한다.
   * 흑건 스트라이프 + 오선 + 음표 글리프의 추상 구성.
   */
  function coverSVG(seed) {
    const h = hash(seed);
    const pal = COVER_PALETTES[h % COVER_PALETTES.length];
    const bg = pal[0], mid = pal[1], hi = pal[2];
    const tilt = (h % 40) - 20;
    const keys = [];
    for (let i = 0; i < 7; i++) {
      const w = 6 + ((h >> (i * 2)) % 5);
      const x = 4 + i * 14 + ((h >> (i * 3)) % 6);
      const y = 10 + ((h >> (i + 5)) % 44);
      const hgt = 30 + ((h >> (i + 2)) % 60);
      const op = 0.10 + ((h >> (i * 4)) % 22) / 100;
      keys.push(`<rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="2" fill="${i % 3 === 0 ? hi : mid}" opacity="${op.toFixed(2)}"/>`);
    }
    const staff = [0, 1, 2, 3, 4]
      .map((i) => `<line x1="-10" y1="${34 + i * 7}" x2="110" y2="${34 + i * 7}" stroke="${hi}" stroke-width=".7" opacity=".22"/>`)
      .join('');
    return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="${bg}"/>
      <g transform="rotate(${tilt} 50 50)">${staff}${keys.join('')}</g>
      <circle cx="${18 + (h % 50)}" cy="${20 + ((h >> 6) % 55)}" r="${8 + (h % 12)}" fill="${mid}" opacity=".20"/>
      <rect width="100" height="100" fill="url(#cg${h % 9})"/>
      <defs><linearGradient id="cg${h % 9}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${hi}" stop-opacity=".10"/>
        <stop offset="1" stop-color="${bg}" stop-opacity=".55"/>
      </linearGradient></defs>
    </svg>`;
  }

  function coverEl(seed, size, glyph) {
    const node = el('div', { class: 'cover ' + (size || 'm') });
    node.innerHTML = coverSVG(seed);
    // U+FE0E(텍스트 표현 선택자)를 붙여 이모지가 아니라 글자로 그려지게 한다.
    // 폰트가 이를 무시하면 CSS의 grayscale이 받아 준다.
    node.appendChild(el('span', { class: 'glyph', text: (glyph || '♪') + '︎' }));
    return node;
  }

  /* ---------- 별점 ---------- */
  function starsEl(value, onChange) {
    const wrap = el('div', { class: 'stars' + (onChange ? '' : ' readonly') });
    for (let i = 1; i <= 5; i++) {
      const b = el('button', {
        type: 'button',
        class: i <= value ? 'on' : '',
        'aria-label': `${i}점`,
        html: icon('star', 18),
      });
      if (onChange) b.addEventListener('click', () => onChange(i === value ? 0 : i));
      wrap.appendChild(b);
    }
    return wrap;
  }

  /* ---------- 진행 바 ---------- */
  function barEl(pct, opts) {
    opts = opts || {};
    const wrap = el('div', { class: 'bar' + (opts.thin ? ' thin' : '') + (opts.tone ? ' ' + opts.tone : '') });
    wrap.appendChild(el('i', { style: { width: clamp(pct, 0, 100) + '%' } }));
    if (opts.goal != null) wrap.appendChild(el('span', { class: 'goal', style: { left: clamp(opts.goal, 0, 100) + '%' } }));
    return wrap;
  }

  /* ---------- 빈 상태 ---------- */
  function emptyEl(iconName, title, sub) {
    return el('div', { class: 'empty' }, [
      el('div', { html: icon(iconName, 32) }),
      el('div', { class: 't', text: title }),
      sub ? el('div', { class: 'small', text: sub }) : null,
    ]);
  }

  /* ---------- 디바운스 ---------- */
  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(self, args), ms || 250);
    };
  }

  /* ---------- 다운로드 ---------- */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  PA.util = {
    $, $$, el, frag, clear, esc, icon, iconEl,
    fmtDur, fmtMinutes, dateKey, todayKey, fmtDate, weekday, relDays, addDays, daysBetween,
    clamp, round1, avg, uid, hash, pad2,
    toast, coverSVG, coverEl, starsEl, barEl, emptyEl, debounce, downloadBlob,
  };
})(window.PA);
