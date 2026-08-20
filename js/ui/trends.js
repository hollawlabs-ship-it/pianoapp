/* ===== 추이 탭 =====
   누적 · 14일 그래프 · 구간별 향상 곡선 · 곡 간 연습량 비교 · 정체 감지 */
window.PA = window.PA || {};

(function (PA) {
  'use strict';
  const U = PA.util;
  const { el, icon, clear, emptyEl } = U;
  const DIMS = PA.store.DIMENSIONS;

  function render(root) {
    clear(root);
    const song = PA.store.activeSong();
    if (!song) { root.appendChild(emptyEl('trend', '곡이 없습니다', '')); return; }

    const m = PA.metrics.summary(song);

    root.appendChild(overview(song, m));
    root.appendChild(practiceChart(song));
    root.appendChild(completenessChart(song));
    root.appendChild(sectionCurves(song));
    root.appendChild(dimensionBreakdown(song));
    if (m.stagnation.length) root.appendChild(stagnationList(song, m));
    root.appendChild(songComparison());
  }

  /* ---------------- 누적 개요 ---------------- */
  function overview(song, m) {
    const total = PA.store.totalPractice(song);
    const days = new Set((song.practiceLog || []).map((l) => l.date)).size;
    const streak = currentStreak(song);

    return el('div', { class: 'card', style: { marginTop: '4px' } }, [
      el('div', { class: 'row', style: { gap: '16px' } }, [
        PA.charts.donut(m.completeness, { size: 96 }),
        el('div', { style: { flex: '1' } }, [PA.charts.stackedScore(m)]),
      ]),
      el('div', { class: 'tiles', style: { marginTop: '14px' } }, [
        tile('누적 연습', U.fmtMinutes(total), `${days}일`),
        tile('7일 향상도', (m.improvement >= 0 ? '+' : '') + m.improvement, '점', m.improvement > 0 ? 'up' : m.improvement < 0 ? 'down' : ''),
        tile('연속', String(streak), '일'),
        tile('녹음 검증', `${m.sectionsVerified}/${song.sections.length}`, '구간'),
      ]),
    ]);
  }

  function tile(k, v, d, tone) {
    const cls = ['v', tone || '', String(v).length > 5 ? 'long' : ''].filter(Boolean).join(' ');
    return el('div', { class: 'tile' }, [
      el('div', { class: 'k', text: k }),
      el('div', { class: cls, text: v }),
      d ? el('div', { class: 'd muted', text: d }) : null,
    ]);
  }

  function currentStreak(song) {
    const dates = new Set((song.practiceLog || []).map((l) => l.date));
    let n = 0, k = U.todayKey();
    if (!dates.has(k)) k = U.addDays(k, -1);        // 오늘 아직 안 했어도 어제부터 센다
    while (dates.has(k)) { n++; k = U.addDays(k, -1); }
    return n;
  }

  /* ---------------- 14일 연습량 ---------------- */
  function practiceChart(song) {
    const data = PA.store.practiceByDay(song, 14);
    const goal = (PA.store.get().settings.practiceGoalMin || 60) * 60;
    const points = data.map((d, i) => ({
      label: i % 3 === 0 || i === data.length - 1 ? String(new Date(d.date + 'T00:00:00').getDate()) : '',
      value: Math.round(d.seconds / 60),
      highlight: d.date === U.todayKey(),
    }));
    const total = data.reduce((a, b) => a + b.seconds, 0);

    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'section-title' }, [el('span', { text: '14일 연습량' }), el('span', { class: 'rule' })]));
    wrap.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'row', style: { marginBottom: '10px' } }, [
        el('span', { class: 'small muted', text: `합계 ${U.fmtMinutes(total)}` }),
        el('span', { class: 'spacer' }),
        // 범례 견본은 실제 목표선과 같은 파선이어야 한다
        el('span', { class: 'tiny faint', html: '<i style="display:inline-block;width:14px;height:2px;vertical-align:middle;margin-right:4px;background:repeating-linear-gradient(90deg,var(--ink) 0 4px,transparent 4px 7px)"></i>일일 목표 ' + Math.round(goal / 60) + '분' }),
      ]),
      PA.charts.barChart({ points, goal: Math.round(goal / 60), height: 96 }),
    ]));
    return wrap;
  }

  /* ---------------- 완성도 추이 ---------------- */
  function completenessChart(song) {
    const points = [];
    for (let i = 13; i >= 0; i--) {
      const k = U.addDays(U.todayKey(), -i);
      const v = i === 0 ? PA.metrics.completeness(song).completeness : PA.metrics.completenessAt(song, k);
      points.push({
        label: i % 4 === 0 || i === 0 ? String(new Date(k + 'T00:00:00').getDate()) : '',
        value: v,
      });
    }
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'section-title' }, [el('span', { text: '완성도 지수 추이' }), el('span', { class: 'rule' })]));
    wrap.appendChild(el('div', { class: 'card' }, [
      PA.charts.lineChart({ points, height: 132, min: 0, max: 100, goal: 80 }),
      el('p', { class: 'tiny faint', style: { marginTop: '6px' }, text: '템포 30 + 표현 30 + 녹음검증 20 + 지적해소 20. 파선은 80점 기준선.' }),
    ]));
    return wrap;
  }

  /* ---------------- 구간별 향상 곡선 ---------------- */
  function sectionCurves(song) {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'section-title' }, [el('span', { text: '구간별 향상 곡선' }), el('span', { class: 'rule' })]));
    if (!song.sections.length) { wrap.appendChild(emptyEl('layers', '구간이 없습니다', '')); return wrap; }

    const box = el('div', { class: 'stack' });
    song.sections.forEach((sec) => {
      const curve = PA.metrics.sectionCurve(song, sec.id, 14);
      const vals = curve.map((c) => c.value).filter((v) => v != null);
      const first = vals.length ? vals[0] : 0;
      const last = vals.length ? vals[vals.length - 1] : 0;
      const delta = U.round1(last - first);
      const points = curve.map((c, i) => ({
        label: i === 0 ? '14일 전' : i === curve.length - 1 ? '오늘' : '',
        value: c.value,
      }));

      box.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'row' }, [
          el('span', { style: { fontWeight: 650, fontSize: '14px' }, text: sec.name }),
          el('span', { class: 'spacer' }),
          el('span', {
            class: 'badge ' + (delta > 0 ? 'done' : delta < 0 ? 'stale' : ''),
            text: `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`,
          }),
          el('span', { class: 'tiny mono muted', text: `${U.round1(last).toFixed(1)}/5` }),
        ]),
        PA.charts.lineChart({
          points, height: 78, min: 0, max: 5, area: true,
          tone: delta >= 0 ? 'var(--ink)' : 'var(--muted)',
          dashed: delta < 0,          // 하락은 파선 — 흑백에서 색 대신 쓰는 신호
        }),
      ]));
    });
    wrap.appendChild(box);
    return wrap;
  }

  /* ---------------- 차원별 분포 ---------------- */
  function dimensionBreakdown(song) {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'section-title' }, [el('span', { text: '표현 차원별 평균' }), el('span', { class: 'rule' })]));

    const means = {};
    DIMS.forEach((d) => {
      const vals = song.sections.map((sec) => {
        const r = song.ratings[sec.id];
        return r ? (r[d.id] || 0) : 0;
      });
      means[d.id] = U.avg(vals);
    });

    const box = el('div', { class: 'card' }, [
      el('div', { class: 'row', style: { gap: '18px', alignItems: 'center' } }, [
        PA.charts.radar(means, { size: 160 }),
        el('div', { class: 'stack', style: { flex: '1', gap: '8px' } },
          DIMS.slice().sort((a, b) => means[a.id] - means[b.id]).map((d) =>
            el('div', {}, [
              el('div', { class: 'row', style: { marginBottom: '3px' } }, [
                el('span', { class: 'dim-dot', style: { background: d.color } }),
                el('span', { class: 'tiny', style: { fontWeight: 600 }, text: d.label }),
                el('span', { class: 'spacer' }),
                el('span', { class: 'tiny mono muted', text: U.round1(means[d.id]).toFixed(1) }),
              ]),
              (() => {
                const b = el('div', { class: 'bar thin' });
                b.appendChild(el('i', { style: { width: (means[d.id] / 5) * 100 + '%', background: d.color } }));
                return b;
              })(),
            ])
          )
        ),
      ]),
    ]);
    const weakest = DIMS.slice().sort((a, b) => means[a.id] - means[b.id])[0];
    box.appendChild(el('p', { class: 'small muted', style: { marginTop: '10px' }, text: `가장 낮은 차원은 ${weakest.label}입니다. ${weakest.hint}` }));
    wrap.appendChild(box);
    return wrap;
  }

  /* ---------------- 정체 목록 ---------------- */
  function stagnationList(song, m) {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'section-title' }, [el('span', { text: '정체 감지' }), el('span', { class: 'rule' })]));
    const box = el('div', { class: 'stack' });
    m.stagnation.forEach((s) => {
      box.appendChild(el('div', {
        class: 'card',
        style: { borderLeft: '3px solid ' + (s.severity === 'high' ? 'var(--warn)' : 'var(--accent)') },
      }, [
        el('div', { class: 'row', style: { gap: '7px' } }, [
          el('span', { html: icon(s.kind === 'issue' ? 'flag' : s.kind === 'section' ? 'layers' : 'alert', 15), style: { color: s.severity === 'high' ? 'var(--warn)' : 'var(--accent)' } }),
          el('span', { class: 'small', style: { fontWeight: 650 }, text: s.text }),
        ]),
        el('p', { class: 'tiny muted', style: { marginTop: '5px' }, text: s.hint }),
      ]));
    });
    wrap.appendChild(box);
    return wrap;
  }

  /* ---------------- 곡 간 비교 ---------------- */
  function songComparison() {
    const rows = PA.metrics.compareSongs(14);
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'section-title' }, [el('span', { text: '곡 간 연습량 (14일)' }), el('span', { class: 'rule' })]));
    if (rows.length < 2) {
      wrap.appendChild(el('p', { class: 'small muted', text: '곡이 하나뿐입니다. 곡을 더 추가하면 배분을 비교할 수 있습니다.' }));
      return wrap;
    }
    const total = rows.reduce((a, b) => a + b.seconds, 0) || 1;
    const box = el('div', { class: 'card' });
    rows.forEach((r) => {
      const pct = (r.seconds / total) * 100;
      box.appendChild(el('div', { style: { padding: '7px 0' } }, [
        el('div', { class: 'row', style: { marginBottom: '4px' } }, [
          el('span', { class: 'small', style: { fontWeight: 600 }, text: `${r.glyph} ${r.title}` }),
          el('span', { class: 'spacer' }),
          el('span', { class: 'tiny mono muted', text: `${U.fmtMinutes(r.seconds)} · ${Math.round(pct)}%` }),
        ]),
        (() => {
          const b = el('div', { class: 'bar' });
          b.appendChild(el('i', { style: { width: pct + '%', background: r.id === PA.store.get().activeSongId ? 'var(--accent)' : 'var(--ebony)' } }));
          return b;
        })(),
        el('div', { class: 'row', style: { marginTop: '4px', gap: '5px' } }, [
          el('span', { class: 'tiny faint', text: `완성도 ${r.completeness}` }),
          el('span', { class: 'tiny ' + (r.improvement > 0 ? 'up' : r.improvement < 0 ? 'down' : 'faint'), text: `${r.improvement >= 0 ? '+' : ''}${r.improvement} (7일)` }),
        ]),
      ]));
    });
    wrap.appendChild(box);

    const neglected = rows[rows.length - 1];
    if (neglected && neglected.seconds < total * 0.15) {
      wrap.appendChild(el('div', { class: 'card', style: { marginTop: '10px', background: 'var(--surface-2)' } }, [
        el('p', { class: 'small muted', text: `${neglected.title}에 14일간 ${U.fmtMinutes(neglected.seconds)}만 썼습니다. 의도한 배분인지 확인해 보세요.` }),
      ]));
    }
    return wrap;
  }

  PA.views = PA.views || {};
  PA.views.trends = { render };
})(window.PA);
