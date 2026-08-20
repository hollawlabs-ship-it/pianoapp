/* ===== 그래프 =====
   외부 라이브러리 없이 SVG/Canvas로 직접 그린다.
   축·눈금은 최소로 두고, 데이터가 없을 때는 선을 그리지 않는다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';
  const { el, clamp } = PA.util;

  const NS = 'http://www.w3.org/2000/svg';

  /* 캔버스는 CSS 변수를 못 읽으므로 한 번 읽어 캐시한다.
     테마는 런타임에 바뀌지 않으므로 캐시로 충분하다. */
  const tokenCache = {};
  function token(name, fallback) {
    if (tokenCache[name] === undefined) {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      tokenCache[name] = v || fallback;
    }
    return tokenCache[name];
  }
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  };

  /* ---------- 음량 곡선 (canvas) ---------- */
  /**
   * 하나 또는 두 개의 곡선을 겹쳐 그린다.
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts { primary:[], secondary:[], labels:{a,b}, playhead:0..1 }
   */
  function drawEnvelope(canvas, opts) {
    opts = opts || {};
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = Math.max(120, Math.round(rect.width));
    const H = Math.max(40, Math.round(rect.height));
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const pad = 4;
    const base = H - pad;
    const usable = H - pad * 2;

    // 중앙선
    g.strokeStyle = 'rgba(0,0,0,.12)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, base - usable * 0.5);
    g.lineTo(W, base - usable * 0.5);
    g.stroke();

    const drawCurve = (data, color, fill, width, dash) => {
      if (!data || data.length < 2) return;
      const n = data.length;
      const x = (i) => (i / (n - 1)) * W;
      const y = (v) => base - clamp(v, 0, 1) * usable;

      g.beginPath();
      g.moveTo(x(0), y(data[0]));
      for (let i = 1; i < n; i++) {
        const cx = (x(i - 1) + x(i)) / 2;
        g.bezierCurveTo(cx, y(data[i - 1]), cx, y(data[i]), x(i), y(data[i]));
      }
      if (fill) {
        const grad = g.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, fill);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.save();
        g.lineTo(W, base); g.lineTo(0, base); g.closePath();
        g.fillStyle = grad; g.fill();
        g.restore();
        g.beginPath();
        g.moveTo(x(0), y(data[0]));
        for (let i = 1; i < n; i++) {
          const cx = (x(i - 1) + x(i)) / 2;
          g.bezierCurveTo(cx, y(data[i - 1]), cx, y(data[i]), x(i), y(data[i]));
        }
      }
      g.strokeStyle = color;
      g.lineWidth = width || 1.8;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.setLineDash(dash || []);
      g.stroke();
      g.setLineDash([]);
    };

    // 흑백에서는 두 곡선을 색으로 못 나눈다. 이전 = 옅은 회색 파선, 이번 = 검정 실선.
    if (opts.secondary) {
      drawCurve(opts.secondary, token('--curve-prev', '#A6A6A6'), 'rgba(0,0,0,.05)', 1.6, [4, 3]);
    }
    drawCurve(opts.primary, token('--curve-now', '#0D0D0D'), 'rgba(0,0,0,.13)', 2);

    if (opts.playhead != null && opts.playhead >= 0) {
      // 곡선도 검정이므로 흰 테두리를 깔아 재생 위치가 묻히지 않게 한다
      const px = clamp(opts.playhead, 0, 1) * W;
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H);
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 4; g.stroke();
      g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H);
      g.strokeStyle = token('--ink', '#0D0D0D'); g.lineWidth = 1.5; g.stroke();
    }
  }

  /* ---------- 실시간 레벨 미터 ---------- */
  function drawLive(canvas, samples, color) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = Math.max(120, Math.round(rect.width)), H = Math.max(30, Math.round(rect.height));
    canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const barW = 3, gap = 1.5;
    const count = Math.floor(W / (barW + gap));
    const slice = samples.slice(-count);
    const peak = Math.max(0.02, Math.max.apply(null, slice.length ? slice : [0.02]));
    g.fillStyle = color || token('--ink-2', '#3A3A3A');
    slice.forEach((v, i) => {
      const h = Math.max(2, (v / peak) * (H - 6));
      const x = i * (barW + gap);
      g.globalAlpha = 0.35 + 0.65 * (i / Math.max(1, slice.length - 1));
      g.fillRect(x, (H - h) / 2, barW, h);
    });
    g.globalAlpha = 1;
  }

  /* ---------- 선 그래프 (SVG) ---------- */
  /**
   * @param {object} opts
   *   points: [{label, value}] — value가 null이면 선이 끊긴다
   *   height, max, min, goal, tone
   */
  function lineChart(opts) {
    const pts = opts.points || [];
    const H = opts.height || 130;
    const W = 320;                       // viewBox 기준 폭, CSS로 늘어난다
    const padL = 26, padR = 8, padT = 10, padB = 20;
    const iw = W - padL - padR, ih = H - padT - padB;

    const vals = pts.map((p) => p.value).filter((v) => v != null);
    const max = opts.max != null ? opts.max : (vals.length ? Math.max.apply(null, vals) : 1);
    const min = opts.min != null ? opts.min : 0;
    const span = Math.max(1e-6, max - min);

    const x = (i) => padL + (pts.length > 1 ? (i / (pts.length - 1)) * iw : iw / 2);
    const y = (v) => padT + ih - ((v - min) / span) * ih;

    const svg = svgEl('svg', {
      class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none',
      style: `height:${H}px`,
    });

    // 가로 눈금 3개
    [0, 0.5, 1].forEach((f) => {
      const yy = padT + ih * (1 - f);
      svg.appendChild(svgEl('line', {
        x1: padL, y1: yy, x2: W - padR, y2: yy,
        stroke: 'var(--line)', 'stroke-width': 0.8,
        'stroke-dasharray': f === 0 ? '' : '2 3',
      }));
      svg.appendChild(svgEl('text', {
        x: padL - 5, y: yy + 3, 'text-anchor': 'end',
        'font-size': 8.5, fill: 'var(--faint)',
      })).textContent = String(Math.round(min + span * f));
    });

    if (opts.goal != null) {
      const gy = y(opts.goal);
      svg.appendChild(svgEl('line', {
        x1: padL, y1: gy, x2: W - padR, y2: gy,
        stroke: 'var(--warn)', 'stroke-width': 1, 'stroke-dasharray': '4 3', opacity: 0.6,
      }));
    }

    // 선 (null 구간에서 끊는다)
    let d = '', started = false;
    pts.forEach((p, i) => {
      if (p.value == null) { started = false; return; }
      d += (started ? ' L' : ' M') + x(i).toFixed(1) + ' ' + y(p.value).toFixed(1);
      started = true;
    });
    if (d) {
      // 면
      const firstIdx = pts.findIndex((p) => p.value != null);
      const lastIdx = pts.length - 1 - pts.slice().reverse().findIndex((p) => p.value != null);
      if (firstIdx >= 0 && opts.area !== false) {
        const areaD = d + ` L${x(lastIdx).toFixed(1)} ${(padT + ih).toFixed(1)} L${x(firstIdx).toFixed(1)} ${(padT + ih).toFixed(1)} Z`;
        svg.appendChild(svgEl('path', { d: areaD, fill: opts.tone || 'var(--accent)', opacity: 0.10 }));
      }
      svg.appendChild(svgEl('path', {
        d, fill: 'none', stroke: opts.tone || 'var(--accent)',
        'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'vector-effect': 'non-scaling-stroke',
        // 흑백에서 상승/하락을 색으로 못 나누므로 하락선은 파선으로 그린다
        'stroke-dasharray': opts.dashed ? '5 4' : null,
      }));
      // 마지막 점
      if (lastIdx >= 0) {
        svg.appendChild(svgEl('circle', {
          cx: x(lastIdx), cy: y(pts[lastIdx].value), r: 3,
          fill: opts.tone || 'var(--accent)', stroke: 'var(--surface)', 'stroke-width': 1.5,
        }));
      }
    }

    // x 라벨: 처음/중간/끝
    const labelIdx = pts.length > 2 ? [0, Math.floor(pts.length / 2), pts.length - 1] : pts.map((_, i) => i);
    labelIdx.forEach((i) => {
      if (!pts[i]) return;
      const t = svgEl('text', {
        x: x(i), y: H - 6,
        'text-anchor': i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle',
        'font-size': 8.5, fill: 'var(--faint)',
      });
      t.textContent = pts[i].label || '';
      svg.appendChild(t);
    });

    return svg;
  }

  /* ---------- 막대 그래프 (일별 연습량) ---------- */
  function barChart(opts) {
    const pts = opts.points || [];
    const H = opts.height || 92;
    const W = 320;
    const padT = 8, padB = 16;
    const ih = H - padT - padB;
    const max = Math.max(1, Math.max.apply(null, pts.map((p) => p.value).concat([opts.goal || 0])));
    const gap = 2;
    const bw = Math.max(2, (W - gap * (pts.length - 1)) / Math.max(1, pts.length));

    const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', style: `height:${H}px` });

    if (opts.goal) {
      const gy = padT + ih - (opts.goal / max) * ih;
      svg.appendChild(svgEl('line', {
        x1: 0, y1: gy, x2: W, y2: gy, stroke: 'var(--warn)',
        'stroke-width': 1, 'stroke-dasharray': '4 3', opacity: 0.55,
      }));
    }

    pts.forEach((p, i) => {
      const h = p.value > 0 ? Math.max(2, (p.value / max) * ih) : 0;
      const x = i * (bw + gap);
      if (h > 0) {
        svg.appendChild(svgEl('rect', {
          x, y: padT + ih - h, width: bw, height: h, rx: Math.min(2, bw / 2),
          // 강조(오늘)와 나머지가 둘 다 검정이면 구분이 사라진다. 명도로 벌린다.
          fill: p.highlight ? 'var(--ink)' : 'var(--muted)',
          opacity: 1,
        }));
      } else {
        svg.appendChild(svgEl('rect', {
          x, y: padT + ih - 2, width: bw, height: 2, rx: 1, fill: 'var(--line-2)',
        }));
      }
      if (p.label) {
        const t = svgEl('text', {
          x: x + bw / 2, y: H - 4, 'text-anchor': 'middle',
          'font-size': 7.5, fill: 'var(--faint)',
        });
        t.textContent = p.label;
        svg.appendChild(t);
      }
    });
    return svg;
  }

  /* ---------- 표현 5차원 레이더 ---------- */
  function radar(values, opts) {
    opts = opts || {};
    const dims = PA.store.DIMENSIONS;
    const S = opts.size || 150;
    const cx = S / 2, cy = S / 2, R = S / 2 - 22;
    const svg = svgEl('svg', { viewBox: `0 0 ${S} ${S}`, width: S, height: S, style: 'overflow:visible' });

    const pt = (i, r) => {
      const a = (Math.PI * 2 * i) / dims.length - Math.PI / 2;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };

    [1, 2, 3, 4, 5].forEach((lv) => {
      const r = (R * lv) / 5;
      const d = dims.map((_, i) => pt(i, r).map((v) => v.toFixed(1)).join(',')).join(' ');
      svg.appendChild(svgEl('polygon', {
        points: d, fill: 'none', stroke: 'var(--line)',
        'stroke-width': lv === 5 ? 1 : 0.6, opacity: lv === 5 ? 1 : 0.7,
      }));
    });
    dims.forEach((_, i) => {
      const [x, y] = pt(i, R);
      svg.appendChild(svgEl('line', { x1: cx, y1: cy, x2: x, y2: y, stroke: 'var(--line)', 'stroke-width': 0.6 }));
    });

    const poly = dims.map((d, i) => pt(i, (R * (values[d.id] || 0)) / 5).map((v) => v.toFixed(1)).join(',')).join(' ');
    svg.appendChild(svgEl('polygon', {
      points: poly, fill: 'var(--accent)', 'fill-opacity': 0.20,
      stroke: 'var(--accent)', 'stroke-width': 1.8, 'stroke-linejoin': 'round',
    }));
    dims.forEach((d, i) => {
      const [x, y] = pt(i, (R * (values[d.id] || 0)) / 5);
      svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 2.4, fill: d.color }));
      const [lx, ly] = pt(i, R + 13);
      const t = svgEl('text', {
        x: lx, y: ly + 3, 'text-anchor': Math.abs(lx - cx) < 6 ? 'middle' : lx > cx ? 'start' : 'end',
        'font-size': 9, fill: 'var(--muted)', 'font-weight': 600,
      });
      t.textContent = d.label;
      svg.appendChild(t);
    });
    return svg;
  }

  /* ---------- 완성도 도넛 ---------- */
  function donut(value, opts) {
    opts = opts || {};
    const S = opts.size || 108;
    const stroke = opts.stroke || 9;
    const r = (S - stroke) / 2;
    const c = 2 * Math.PI * r;
    const svg = svgEl('svg', { viewBox: `0 0 ${S} ${S}`, width: S, height: S });
    svg.appendChild(svgEl('circle', {
      cx: S / 2, cy: S / 2, r, fill: 'none', stroke: 'var(--paper-2)', 'stroke-width': stroke,
    }));
    const arc = svgEl('circle', {
      cx: S / 2, cy: S / 2, r, fill: 'none',
      stroke: opts.color || 'var(--accent)', 'stroke-width': stroke, 'stroke-linecap': 'round',
      'stroke-dasharray': `${(c * clamp(value, 0, 100)) / 100} ${c}`,
      transform: `rotate(-90 ${S / 2} ${S / 2})`,
    });
    svg.appendChild(arc);
    const v = svgEl('text', {
      x: S / 2, y: S / 2 + 2, 'text-anchor': 'middle',
      'font-size': S * 0.28, 'font-family': 'var(--serif)', fill: 'var(--ink)',
    });
    v.textContent = Math.round(value);
    svg.appendChild(v);
    const l = svgEl('text', {
      x: S / 2, y: S / 2 + S * 0.20, 'text-anchor': 'middle',
      'font-size': 8.5, fill: 'var(--muted)', 'letter-spacing': '.08em',
    });
    l.textContent = opts.label || '완성도';
    svg.appendChild(l);
    return svg;
  }

  /* ---------- 적층 막대: 완성도 구성 ---------- */
  function stackedScore(c) {
    const na = c.issueApplicable === false;
    const parts = [
      // 네 항목을 같은 검정으로 두면 서로 구분이 안 되므로 명도 사다리를 쓴다
      { k: '템포', v: c.tempoScore, max: 30, color: '#0D0D0D' },
      { k: '표현', v: c.expressionScore, max: 30, color: '#3A3A3A' },
      { k: '녹음검증', v: c.recordScore, max: 20, color: '#6B6B6B' },
      { k: '지적해소', v: c.issueScore, max: 20, color: '#9B9B9B', na },
    ];
    const wrap = el('div', { class: 'stack', style: { gap: '7px' } });
    parts.forEach((p) => {
      wrap.appendChild(el('div', { class: 'row', style: { gap: '9px' } }, [
        el('span', { class: 'tiny muted', style: { width: '52px', flex: '0 0 52px' }, text: p.k }),
        (() => {
          const b = el('div', { class: 'bar', style: { flex: '1', opacity: p.na ? '.45' : '1' } });
          b.appendChild(el('i', { style: { width: (p.na ? 0 : (p.v / p.max) * 100) + '%', background: p.color } }));
          return b;
        })(),
        el('span', {
          class: 'tiny mono muted', style: { width: '48px', textAlign: 'right' },
          text: p.na ? '해당없음' : `${p.v}/${p.max}`,
        }),
      ]));
    });
    if (na) {
      wrap.appendChild(el('p', {
        class: 'tiny faint',
        text: '레슨 분석 기록이 없어 지적해소는 빼고 나머지 80점을 100점으로 환산했습니다.',
      }));
    }
    return wrap;
  }

  PA.charts = { drawEnvelope, drawLive, lineChart, barChart, radar, donut, stackedScore, svgEl };
})(window.PA);
