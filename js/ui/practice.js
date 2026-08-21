/* ===== 연습 탭 =====
   구간 카드 · 표현 5차원 별점 · 녹음/업로드 · 음량 곡선 A/B · 메트로놈 · 타이머 */
window.PA = window.PA || {};

(function (PA) {
  'use strict';
  const U = PA.util;
  const { el, icon, clear, toast, fmtDur, starsEl, barEl, emptyEl, coverEl } = U;
  const DIMS = PA.store.DIMENSIONS;

  let metro = null, timer = null;
  let timerSectionId = null;

  /* ---------------- 진입점 ---------------- */
  function render(root) {
    clear(root);
    const song = PA.store.activeSong();
    if (!song) { root.appendChild(emptyEl('music', '곡이 없습니다', '홈에서 곡을 추가하세요.')); return; }

    root.appendChild(header(song));
    root.appendChild(tools(song));
    root.appendChild(todayFocus(song));

    const ro = PA.store.isReadOnly();
    root.appendChild(el('div', { class: 'section-title' }, [
      el('span', { text: '구간' }), el('span', { class: 'rule' }),
      ro ? null : el('button', {
        class: 'btn ghost sm', html: icon('plus', 15) + '<span>구간</span>',
        onclick: () => editSection(song, null),
      }),
    ]));

    const list = el('div', { class: 'stack' });
    if (!song.sections.length) {
      list.appendChild(emptyEl('layers', '구간이 없습니다', '곡을 몇 덩어리로 나눠 놓으면 한 번에 한 곳만 다룰 수 있습니다.'));
    }
    song.sections.forEach((sec) => list.appendChild(sectionCard(song, sec)));
    root.appendChild(list);
  }

  /* ---------------- 헤더 ---------------- */
  function header(song) {
    const pct = U.clamp((song.tempoCurrent / (song.tempoTarget || 1)) * 100, 0, 100);
    const c = PA.metrics.completeness(song);

    const wrap = el('div', { class: 'card', style: { marginTop: '4px' } }, [
      el('div', { class: 'row' }, [
        coverEl(song.title + song.composer, 'm', song.glyph),
        el('div', { style: { minWidth: 0, flex: '1' } }, [
          el('div', { class: 'truncate', style: { fontFamily: 'var(--serif)', fontSize: '19px' }, text: song.title }),
          el('div', { class: 'small muted truncate', text: [song.composer, song.keySig].filter(Boolean).join(' · ') }),
          el('div', { class: 'row', style: { marginTop: '6px', gap: '6px' } }, [
            el('span', { class: 'badge', text: `완성도 ${c.completeness}` }),
            el('span', { class: 'badge', text: `구간 ${song.sections.length}` }),
          ]),
        ]),
      ]),
      el('div', { style: { marginTop: '14px' } }, [
        el('div', { class: 'row', style: { marginBottom: '5px' } }, [
          el('span', { class: 'tiny muted', text: '템포 진행' }),
          el('span', { class: 'spacer' }),
          el('span', { class: 'tiny mono', text: `♩=${song.tempoCurrent} → ${song.tempoTarget}` }),
        ]),
        barEl(pct, { goal: 100 }),
        PA.store.isReadOnly() ? null : el('div', { class: 'row', style: { marginTop: '8px', gap: '6px' } }, [
          el('button', { class: 'btn sm', text: '−4', onclick: () => bumpTempo(song, -4) }),
          el('button', { class: 'btn sm', text: '+4', onclick: () => bumpTempo(song, 4) }),
          el('span', { class: 'spacer' }),
          el('button', {
            class: 'btn sm ghost', html: icon('edit', 15) + '<span>목표 수정</span>',
            onclick: async () => {
              const v = await PA.sheets.prompt({ title: '목표 템포', label: '♩ = ', value: String(song.tempoTarget), type: 'number' });
              if (v) PA.store.updateSong(song.id, { tempoTarget: U.clamp(parseInt(v, 10) || song.tempoTarget, 20, 260) });
            },
          }),
        ]),
      ]),
    ]);
    return wrap;
  }

  function bumpTempo(song, d) {
    const v = U.clamp((song.tempoCurrent || 40) + d, 20, 300);
    PA.store.updateSong(song.id, { tempoCurrent: v });
    if (metro) metro.bpm = v;
  }

  /* ---------------- 오늘의 집중 ---------------- */
  function todayFocus(song) {
    // 레슨 스케줄에 오늘 몫이 있으면 그것을, 없으면 가장 약한 차원을 제시한다.
    const lesson = (song.lessons || [])[0];
    let focusDim = null, source = '';
    let tasks = [];
    if (lesson && lesson.analysis && lesson.analysis.schedule && lesson.analysis.schedule.length) {
      const offset = U.daysBetween(lesson.date, U.todayKey());
      const day = lesson.analysis.schedule[U.clamp(offset, 0, lesson.analysis.schedule.length - 1)];
      if (day) {
        focusDim = day.focus;
        source = `${U.fmtDate(lesson.date)} 레슨 · ${day.day}일차`;
        tasks = day.tasks || [];
      }
    }
    if (!focusDim) {
      const w = PA.analysis.weakestDimension(song);
      focusDim = w.dim;
      source = '가장 낮은 별점 기준';
    }
    const dim = PA.store.DIM_MAP[focusDim] || DIMS[0];

    const card = el('div', { class: 'card accent', style: { marginTop: '10px' } }, [
      el('div', { class: 'row' }, [
        el('span', { class: 'dim-dot', style: { background: dim.color, width: '10px', height: '10px' } }),
        el('span', { style: { fontWeight: 700 }, text: `오늘의 한 차원 — ${dim.label}` }),
        el('span', { class: 'spacer' }),
        el('span', { class: 'badge focus', text: source }),
      ]),
      el('p', { class: 'small muted', style: { marginTop: '6px' }, text: dim.hint }),
    ]);

    if (tasks.length) {
      const ul = el('div', { class: 'stack', style: { marginTop: '10px', gap: '6px' } });
      tasks.forEach((t, ti) => {
        const chk = el('button', { class: 'check' + (t.done ? ' on' : ''), html: icon('check', 13) });
        chk.addEventListener('click', () => {
          const idx = lesson.analysis.schedule.findIndex((d) => (d.tasks || []).includes(t));
          PA.store.toggleTask(song.id, lesson.id, idx, ti);
        });
        ul.appendChild(el('div', { class: 'row', style: { alignItems: 'flex-start', gap: '9px' } }, [
          chk,
          el('span', { class: 'small', style: { textDecoration: t.done ? 'line-through' : '', opacity: t.done ? .5 : 1 }, text: t.text }),
        ]));
      });
      card.appendChild(ul);
    }
    return card;
  }

  /* ---------------- 도구: 메트로놈 · 타이머 ---------------- */
  function tools(song) {
    if (!metro) { metro = PA.metronome.create(); metro.bpm = song.tempoCurrent || 60; }
    if (!timer) timer = PA.metronome.createTimer();

    const bpmLabel = el('span', { class: 'mono', style: { fontSize: '22px', fontFamily: 'var(--serif)' }, text: String(metro.bpm) });
    const beatDots = el('div', { class: 'row', style: { gap: '5px' } });
    const renderDots = () => {
      clear(beatDots);
      for (let i = 0; i < metro.beatsPerBar; i++) {
        beatDots.appendChild(el('span', {
          class: 'beat-dot',
          style: {
            width: '7px', height: '7px', borderRadius: '50%',
            background: i === 0 ? 'var(--accent)' : 'var(--line-2)', transition: 'transform .1s',
          },
        }));
      }
    };
    renderDots();
    metro.onBeat((b) => {
      const dots = beatDots.children;
      for (let i = 0; i < dots.length; i++) {
        dots[i].style.transform = i === b ? 'scale(1.9)' : 'scale(1)';
        dots[i].style.background = i === b ? 'var(--ebony)' : i === 0 ? 'var(--accent)' : 'var(--line-2)';
      }
    });

    const toggleBtn = el('button', { class: 'btn icon primary', html: icon('play', 18), 'aria-label': '메트로놈' });
    toggleBtn.addEventListener('click', () => {
      const on = metro.toggle();
      toggleBtn.innerHTML = icon(on ? 'square' : 'play', 18);
      toggleBtn.classList.toggle('accent', on);
    });

    const setBpm = (v) => {
      metro.bpm = v;
      bpmLabel.textContent = String(metro.bpm);
    };

    const metroCard = el('div', { class: 'card' }, [
      el('div', { class: 'row' }, [
        el('span', { class: 'tiny muted', html: icon('metronome', 14) }),
        el('span', { class: 'tiny muted', text: '메트로놈' }),
        el('span', { class: 'spacer' }),
        beatDots,
      ]),
      el('div', { class: 'row wrap', style: { marginTop: '8px', gap: '6px' } }, [
        toggleBtn,
        el('button', { class: 'btn icon sm', text: '−', onclick: () => setBpm(metro.bpm - 1) }),
        bpmLabel,
        el('button', { class: 'btn icon sm', text: '+', onclick: () => setBpm(metro.bpm + 1) }),
        el('span', { class: 'spacer' }),
        el('button', {
          class: 'btn sm ghost', text: `${metro.beatsPerBar}/4`,
          onclick: (e) => {
            metro.beatsPerBar = metro.beatsPerBar === 4 ? 3 : metro.beatsPerBar === 3 ? 6 : 4;
            e.currentTarget.textContent = `${metro.beatsPerBar}/4`;
            renderDots();
          },
        }),
        el('button', { class: 'btn sm ghost', text: '곡 템포', onclick: () => setBpm(song.tempoCurrent) }),
      ]),
    ]);

    /* --- 타이머 --- */
    const timeLabel = el('div', { class: 'mono', style: { fontSize: '26px', fontFamily: 'var(--serif)' }, text: '0:00' });
    timer.onTick((s) => { timeLabel.textContent = fmtDur(s); });
    const startBtn = el('button', { class: 'btn icon primary', html: icon(timer.running ? 'pause' : 'play', 18) });
    startBtn.addEventListener('click', () => {
      if (timer.running) { timer.pause(); } else { timer.start(); }
      startBtn.innerHTML = icon(timer.running ? 'pause' : 'play', 18);
    });
    const saveBtn = el('button', {
      class: 'btn sm', html: icon('check', 15) + '<span>기록</span>',
      onclick: () => {
        const secs = Math.round(timer.elapsed);
        if (secs < 30) { toast('30초 이상 연습해야 기록됩니다.'); return; }
        PA.store.logPractice(song.id, { seconds: secs, sectionId: timerSectionId, tempo: song.tempoCurrent });
        timer.pause(); timer.reset();
        startBtn.innerHTML = icon('play', 18);
        toast(`${U.fmtMinutes(secs)} 기록 — ${song.title}`);
      },
    });

    const todaySec = (song.practiceLog || []).filter((l) => l.date === U.todayKey()).reduce((a, b) => a + b.seconds, 0);
    const timerCard = el('div', { class: 'card' }, [
      el('div', { class: 'row' }, [
        el('span', { class: 'tiny muted', html: icon('clock', 14) }),
        el('span', { class: 'tiny muted', text: '연습 타이머' }),
        el('span', { class: 'spacer' }),
        el('span', { class: 'tiny faint', text: `오늘 ${U.fmtMinutes(todaySec)}` }),
      ]),
      el('div', { class: 'row wrap', style: { marginTop: '8px', gap: '6px' } }, [
        startBtn, timeLabel, el('span', { class: 'spacer' }), PA.store.isReadOnly() ? null : saveBtn,
      ]),
      el('p', { class: 'tiny faint', style: { marginTop: '6px' }, text: '기록한 시간은 이 곡에 귀속됩니다.' }),
    ]);

    return el('div', { class: 'grid-2', style: { marginTop: '10px' } }, [metroCard, timerCard]);
  }

  /* ---------------- 구간 카드 ---------------- */
  function sectionCard(song, sec) {
    const r = PA.store.rating(song.id, sec.id);
    const mean = U.avg(DIMS.map((d) => r[d.id] || 0));
    const recs = (song.recordings || []).filter((x) => x.sectionId === sec.id);
    const verified = recs.some((x) => x.createdAt >= U.addDays(U.todayKey(), -PA.metrics.RECENT_DAYS));
    const openIssues = PA.store.allIssues(song).filter((i) => i.sectionId === sec.id && !i.resolved);
    const focusDim = PA.store.DIM_MAP[sec.focus] || DIMS[0];

    const strip = el('div', { class: 'row', style: { gap: '4px', marginTop: '9px' } });
    DIMS.forEach((d) => {
      const v = r[d.id] || 0;
      strip.appendChild(el('div', { style: { flex: '1' }, title: `${d.label} ${v}/5` }, [
        el('div', { class: 'bar thin' }, [el('i', { style: { width: (v / 5) * 100 + '%', background: d.color } })]),
      ]));
    });

    const card = el('div', { class: 'card tap' }, [
      el('div', { class: 'row', style: { alignItems: 'flex-start' } }, [
        el('div', { style: { minWidth: 0, flex: '1' } }, [
          el('div', { class: 'row', style: { gap: '6px' } }, [
            el('span', { style: { fontWeight: 650, fontSize: '15px' }, text: sec.name }),
            openIssues.length ? el('span', { class: 'badge stale', text: `지적 ${openIssues.length}` }) : null,
          ]),
          el('div', { class: 'small muted truncate', text: [sec.bars, sec.character].filter(Boolean).join(' · ') || '—' }),
        ]),
        el('div', { class: 'center', style: { flex: '0 0 auto' } }, [
          el('div', { class: 'mono', style: { fontFamily: 'var(--serif)', fontSize: '19px' }, text: U.round1(mean).toFixed(1) }),
          el('div', { class: 'tiny faint', text: '/5' }),
        ]),
      ]),
      strip,
      el('div', { class: 'row', style: { marginTop: '9px', gap: '6px' } }, [
        el('span', { class: 'badge focus', text: focusDim.label }),
        verified
          ? el('span', { class: 'badge done', text: `녹음 ${recs.length}` })
          : el('span', { class: 'badge', text: recs.length ? `녹음 ${recs.length} (오래됨)` : '녹음 없음' }),
        el('span', { class: 'spacer' }),
        el('span', { class: 'tiny faint', html: icon('chevronRight', 15) }),
      ]),
    ]);
    card.addEventListener('click', () => openSection(song, sec));
    return card;
  }

  /* ---------------- 구간 상세 시트 ---------------- */
  function openSection(song, sec) {
    const sheet = PA.sheets.open({ title: sec.name, body: () => sectionBody(song, sec, () => sheet.setBody(sectionBody(song, sec, refresh))) });
    function refresh() { sheet.setBody(sectionBody(song, sec, refresh)); }
    return sheet;
  }

  function sectionBody(song, sec, refresh) {
    const r = PA.store.rating(song.id, sec.id);
    const ro = PA.store.isReadOnly();
    const wrap = el('div', { class: 'stack', style: { gap: '16px' } });

    /* 정보 */
    wrap.appendChild(el('div', { class: 'row wrap', style: { gap: '6px' } }, [
      sec.bars ? el('span', { class: 'chip outline', text: sec.bars }) : null,
      el('span', { class: 'chip accent', text: (PA.store.DIM_MAP[sec.focus] || DIMS[0]).label + ' 집중' }),
      el('span', { class: 'spacer' }),
      ro ? null : el('button', { class: 'btn sm ghost', html: icon('edit', 15), 'aria-label': '구간 수정', onclick: () => editSection(song, sec, refresh) }),
    ]));
    if (sec.character) wrap.appendChild(el('p', { class: 'small muted', text: sec.character }));
    if (sec.note) wrap.appendChild(el('div', { class: 'card', style: { background: 'var(--surface-2)' } }, [
      el('p', { class: 'small', text: sec.note }),
    ]));

    /* 5차원 별점 */
    wrap.appendChild(el('div', { class: 'section-title' }, [el('span', { text: '표현 5차원' }), el('span', { class: 'rule' })]));
    const dimBox = el('div', { class: 'card' });
    DIMS.forEach((d) => {
      const row = el('div', { class: 'dim-row' }, [
        el('div', { class: 'dim-label' }, [
          el('span', { class: 'dim-dot', style: { background: d.color } }),
          el('span', { text: d.label }),
        ]),
        starsEl(r[d.id] || 0, ro ? null : (v) => { PA.store.setRating(song.id, sec.id, d.id, v); refresh(); }),
        el('span', { class: 'spacer' }),
        el('button', {
          class: 'btn ghost sm', html: icon('sparkles', 14), 'aria-label': d.label + ' 설명',
          onclick: () => toast(d.hint),
        }),
      ]);
      dimBox.appendChild(row);
    });
    wrap.appendChild(dimBox);
    wrap.appendChild(el('div', { class: 'center' }, [PA.charts.radar(r, { size: 168 })]));

    /* 메모 */
    wrap.appendChild(el('div', { class: 'section-title' }, [el('span', { text: '메모' }), el('span', { class: 'rule' })]));
    const memo = el('textarea', {
      class: 'textarea', placeholder: ro ? '' : '오늘 알아낸 것, 다음에 시도할 것…',
      style: { minHeight: '84px' },
      readonly: ro,
    });
    memo.value = r.memo || '';
    if (!ro) memo.addEventListener('input', U.debounce(() => PA.store.setMemo(song.id, sec.id, memo.value), 500));
    wrap.appendChild(memo);

    /* 녹음 */
    wrap.appendChild(el('div', { class: 'section-title' }, [
      el('span', { text: '녹음' }), el('span', { class: 'rule' }),
      ro ? null : el('button', { class: 'btn sm accent', html: icon('mic', 15) + '<span>녹음</span>', onclick: () => openRecorder(song, sec, refresh) }),
      ro ? null : el('button', { class: 'btn sm ghost', html: icon('upload', 15), 'aria-label': '파일 업로드', onclick: () => openUpload(song, sec, refresh) }),
    ]));
    wrap.appendChild(recordingList(song, sec, refresh));

    return wrap;
  }

  /* ---------------- 녹음 목록 + A/B ---------------- */
  function recordingList(song, sec, refresh) {
    const recs = (song.recordings || []).filter((x) => !sec || x.sectionId === sec.id);
    if (!recs.length) {
      return emptyEl('mic', '녹음이 없습니다', 'MIDI가 없으니 녹음이 유일한 증거입니다. 짧게라도 남겨 두세요.');
    }
    const box = el('div', { class: 'card flush' });
    const selected = new Set();

    const compareBar = el('div', {
      class: 'row', style: { padding: '10px 14px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)' },
    }, [
      el('span', { class: 'tiny muted', text: '2개를 고르면 곡선을 겹쳐 봅니다' }),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn sm primary', html: icon('layers', 15) + '<span>A/B 비교</span>', disabled: true,
        onclick: () => {
          const [a, b] = Array.from(selected).map((id) => recs.find((r) => r.id === id));
          openCompare(song, a, b);
        },
      }),
    ]);
    const cmpBtn = compareBar.querySelector('button');

    recs.forEach((rec) => {
      const chk = el('button', { class: 'check', html: icon('check', 13) });
      chk.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selected.has(rec.id)) selected.delete(rec.id);
        else {
          if (selected.size >= 2) { toast('두 개까지만 고를 수 있습니다.'); return; }
          selected.add(rec.id);
        }
        chk.classList.toggle('on', selected.has(rec.id));
        cmpBtn.disabled = selected.size !== 2;
      });

      const canvas = el('canvas', { class: 'wave', style: { height: '34px', width: '110px', flex: '0 0 110px', border: 'none', background: 'transparent' } });
      setTimeout(() => PA.charts.drawEnvelope(canvas, { primary: rec.envelope }), 0);

      const item = el('div', { class: 'item' }, [
        chk,
        canvas,
        el('div', { class: 'body' }, [
          el('div', { class: 't' }, [
            el('span', { text: rec.label || U.fmtDate(rec.createdAt) }),
            rec.isReference ? el('span', { class: 'badge focus', style: { marginLeft: '6px' }, text: '기준' }) : null,
            rec.kind === 'video' ? el('span', { class: 'badge', style: { marginLeft: '6px' }, text: '영상' }) : null,
          ]),
          el('div', { class: 's' }, [
            el('span', { text: `${U.relDays(rec.createdAt)} · ${fmtDur(rec.duration)}` }),
            rec.tempo ? el('span', { text: ` · ♩=${rec.tempo}` }) : null,
          ]),
        ]),
        el('button', {
          class: 'btn icon sm ghost', html: icon('play', 16), 'aria-label': '재생',
          onclick: (e) => { e.stopPropagation(); PA.player.play(rec, song); },
        }),
      ]);
      item.addEventListener('click', () => openRecordingDetail(song, rec, refresh));
      box.appendChild(item);
    });
    box.appendChild(compareBar);
    return box;
  }

  /* ---------------- 녹음 상세 ---------------- */
  function openRecordingDetail(song, rec, onChange) {
    const m = PA.envelope.metrics(rec.envelope);
    const sec = (song.sections || []).find((s) => s.id === rec.sectionId);
    const body = el('div', { class: 'stack', style: { gap: '14px' } });

    const canvas = el('canvas', { class: 'wave tall' });
    setTimeout(() => PA.charts.drawEnvelope(canvas, { primary: rec.envelope }), 30);
    const unsub = PA.player.subscribe((st) => {
      if (st.recordingId === rec.id) PA.charts.drawEnvelope(canvas, { primary: rec.envelope, playhead: st.progress });
    });

    body.appendChild(el('div', { class: 'row' }, [
      el('button', { class: 'btn primary', html: icon('play', 17) + '<span>재생</span>', onclick: () => PA.player.play(rec, song) }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'tiny muted', text: `${U.fmtDate(rec.createdAt)} · ${fmtDur(rec.duration)}` }),
    ]));
    body.appendChild(canvas);

    body.appendChild(el('div', { class: 'tiles' }, [
      tile('다이내믹 폭', m.range.toFixed(2), m.range < 0.28 ? '좁음' : m.range > 0.6 ? '넓음' : '보통'),
      tile('곡선 일관성', m.shape.toFixed(2), m.shape < 0.45 ? '흩어짐' : '또렷'),
      tile('정점 위치', Math.round(m.peakAt * 100) + '%', ''),
      tile('방향 전환', String(m.steps), '회'),
    ]));

    const reads = PA.envelope.readMetrics(m);
    body.appendChild(el('div', { class: 'card', style: { background: 'var(--surface-2)' } }, [
      el('div', { class: 'tiny muted', style: { marginBottom: '5px' }, text: '곡선이 말하는 것' }),
      ...reads.map((t) => el('p', { class: 'small', text: '· ' + t })),
    ]));

    /* AI 코멘트 */
    const aiBox = el('div');
    body.appendChild(aiBox);
    body.appendChild(el('button', {
      class: 'btn block', html: icon('sparkles', 16) + '<span>AI 코치에게 물어보기</span>',
      onclick: async (e) => {
        if (!PA.ai.available()) { toast('설정에서 API 키를 넣어야 씁니다.', 'warn'); return; }
        const btn = e.currentTarget;
        btn.disabled = true;
        clear(aiBox).appendChild(el('div', { class: 'card' }, [el('span', { class: 'thinking', html: '<i></i><i></i><i></i>' })]));
        try {
          const prev = (song.recordings || []).filter((x) => x.sectionId === rec.sectionId && x.at < rec.at)[0];
          const cmp = prev ? PA.envelope.compare(prev.envelope, rec.envelope) : null;
          const text = await PA.analysis.commentOnRecording(song, sec, m, cmp);
          clear(aiBox).appendChild(el('div', { class: 'card accent' }, [
            el('p', { class: 'small', style: { whiteSpace: 'pre-wrap' }, text }),
          ]));
        } catch (err) {
          clear(aiBox);
          toast(err.message, 'warn');
        }
        btn.disabled = false;
      },
    }));

    /* 라벨·기준 지정·삭제 */
    body.appendChild(el('div', { class: 'row wrap', style: { gap: '6px' } }, [
      el('button', {
        class: 'btn sm', html: icon('edit', 15) + '<span>이름</span>',
        onclick: async () => {
          const v = await PA.sheets.prompt({ title: '녹음 이름', value: rec.label || '' });
          if (v != null) { PA.store.updateRecording(song.id, rec.id, { label: v }); onChange && onChange(); }
        },
      }),
      el('button', {
        class: 'btn sm' + (rec.isReference ? ' accent' : ''),
        html: icon('flag', 15) + `<span>${rec.isReference ? '기준 해제' : '기준으로'}</span>`,
        onclick: () => { PA.store.updateRecording(song.id, rec.id, { isReference: !rec.isReference }); onChange && onChange(); toast(rec.isReference ? '기준 해제' : '기준 녹음으로 지정'); },
      }),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn sm danger', html: icon('trash', 15),
        'aria-label': '삭제',
        onclick: async () => {
          const ok = await PA.sheets.confirm({ title: '녹음 삭제', message: '되돌릴 수 없습니다.', danger: true, confirmLabel: '삭제' });
          if (!ok) return;
          if (PA.player.currentId() === rec.id) PA.player.stop();
          await PA.store.removeRecording(song.id, rec.id);
          sheet.close();
          onChange && onChange();
        },
      }),
    ]));

    const sheet = PA.sheets.open({
      title: rec.label || (sec ? sec.name : '녹음'),
      body,
      onClose: unsub,
    });
    return sheet;
  }

  function tile(k, v, d) {
    return el('div', { class: 'tile' }, [
      el('div', { class: 'k', text: k }),
      el('div', { class: 'v' + (String(v).length > 5 ? ' long' : ''), text: v }),
      d ? el('div', { class: 'd muted', text: d }) : null,
    ]);
  }

  /* ---------------- A/B 비교 ---------------- */
  function openCompare(song, a, b) {
    if (!a || !b) return;
    const older = a.at <= b.at ? a : b;
    const newer = a.at <= b.at ? b : a;
    const cmp = PA.envelope.compare(older.envelope, newer.envelope);

    const canvas = el('canvas', { class: 'wave tall' });
    setTimeout(() => PA.charts.drawEnvelope(canvas, { primary: cmp.b, secondary: cmp.a }), 30);

    const body = el('div', { class: 'stack', style: { gap: '14px' } }, [
      el('div', { class: 'wave-legend' }, [
        // 범례도 곡선과 같은 표기여야 한다 — 이전은 회색 파선, 이번은 검정 실선
        el('span', { html: '<i style="background:repeating-linear-gradient(90deg,var(--curve-prev) 0 4px,transparent 4px 7px)"></i>' + U.esc(older.label || U.fmtDate(older.createdAt)) + ' (이전)' }),
        el('span', { html: '<i style="background:var(--curve-now)"></i>' + U.esc(newer.label || U.fmtDate(newer.createdAt)) + ' (이후)' }),
      ]),
      canvas,
      el('div', { class: 'tiles' }, [
        tile('곡선 상관', cmp.correlation.toFixed(2), cmp.correlation > 0.8 ? '거의 같음' : cmp.correlation > 0.5 ? '비슷' : '달라짐'),
        tile('다이내믹 폭', (cmp.rangeDelta >= 0 ? '+' : '') + cmp.rangeDelta.toFixed(2), cmp.rangeDelta > 0.03 ? '넓어짐' : cmp.rangeDelta < -0.03 ? '좁아짐' : '유지'),
        tile('일관성', (cmp.shapeDelta >= 0 ? '+' : '') + cmp.shapeDelta.toFixed(2), cmp.shapeDelta > 0.03 ? '또렷해짐' : cmp.shapeDelta < -0.03 ? '흩어짐' : '유지'),
        tile('평균 차이', cmp.meanDiff.toFixed(2), ''),
      ]),
      el('div', { class: 'card', style: { background: 'var(--surface-2)' } }, [
        el('p', { class: 'small', text: verdict(cmp) }),
      ]),
      el('div', { class: 'row', style: { gap: '8px' } }, [
        el('button', { class: 'btn sm', html: icon('play', 15) + '<span>이전</span>', onclick: () => PA.player.play(older, song) }),
        el('button', { class: 'btn sm primary', html: icon('play', 15) + '<span>이후</span>', onclick: () => PA.player.play(newer, song) }),
      ]),
    ]);
    PA.sheets.open({ title: 'A/B 비교', body });
  }

  /**
   * A/B 판정.
   *
   * 순서가 중요하다. 평평하던 연주에 굴곡을 넣으면 '방향 전환'이 늘어나므로
   * 일관성 지표는 반드시 떨어진다. 그걸 먼저 읽으면 개선을 후퇴로 오독하게 된다.
   * 그래서 다이내믹 폭의 변화를 먼저 보고, 일관성은 그 안에서 해석한다.
   * 또 이전 연주가 애초에 평평했다면 그쪽의 '형태'는 비교 대상이 아니다.
   */
  function verdict(cmp) {
    const wasFlat = cmp.metricsA.range < 0.15;
    const shapeComparable = !wasFlat && cmp.metricsB.range >= 0.15;

    if (cmp.correlation > 0.9 && Math.abs(cmp.rangeDelta) < 0.03) {
      return '두 연주의 음량 곡선이 거의 같습니다. 머리로는 바꿨다고 생각해도 소리로는 아직 달라지지 않았다는 뜻입니다. 변화를 더 과장해 보세요.';
    }
    if (cmp.rangeDelta > 0.05) {
      if (wasFlat) {
        return '평평하던 연주에 셈여림이 생겼습니다. 폭이 넓어지면 곡선의 방향 전환도 함께 늘어나므로 일관성 수치가 내려간 것은 정상입니다. 다음은 부풀리는 지점이 의도한 자리인지만 확인하세요.';
      }
      if (!shapeComparable || cmp.shapeDelta >= -0.05) {
        return '다이내믹 폭이 넓어졌고 곡선의 형태도 유지됐습니다. 의도한 방향으로 가고 있습니다.';
      }
      return '폭은 넓어졌지만 오르내림이 함께 늘었습니다. 부풀림이 의도한 것이라면 괜찮습니다. 아니라면 정점을 하나로 줄여 보세요.';
    }
    if (shapeComparable && cmp.shapeDelta < -0.06) {
      return '곡선이 이전보다 자주 오르내립니다. 셈여림을 넣으려다 정점이 흩어졌을 수 있습니다. 부풀리는 지점을 하나로 줄여 보세요.';
    }
    if (cmp.rangeDelta < -0.05) {
      return '다이내믹 폭이 좁아졌습니다. 다른 것에 집중하느라 셈여림이 평평해졌을 가능성이 큽니다.';
    }
    return '변화가 있지만 방향이 뚜렷하지 않습니다. 다음 녹음에서는 한 가지만 바꿔서 비교해 보세요.';
  }

  /* ---------------- 마이크 녹음 시트 ---------------- */
  function openRecorder(song, sec, onDone) {
    const rec = PA.recorder.create();
    const timeEl = el('div', { class: 'mono center', style: { fontSize: '38px', fontFamily: 'var(--serif)' }, text: '0:00' });
    const live = el('canvas', { class: 'wave', style: { height: '76px' } });
    const hint = el('p', { class: 'tiny faint center', text: '자동 음량 보정을 끈 상태로 녹음합니다. 피아노에서 1~2m 떨어진 곳에 기기를 두세요.' });

    let started = false, busy = false;
    const mainBtn = el('button', { class: 'btn accent block', html: icon('mic', 18) + '<span>녹음 시작</span>' });

    // 입력이 0dBFS에 붙으면 큰 소리가 잘려 다이내믹 폭이 가짜로 좁아진다.
    // 흑백에서는 빨간색으로 알릴 수 없으므로 말로 알린다.
    const clipWarn = el('p', {
      class: 'tiny center', style: { fontWeight: 700, minHeight: '15px', visibility: 'hidden' },
      text: '입력이 너무 큽니다 — 소리가 잘려 분석이 부정확해집니다. 기기를 더 멀리 두세요.',
    });
    let clipped = false;

    rec.onTick((s) => { timeEl.textContent = fmtDur(s); });
    rec.onLevel((rms, peak, samples) => {
      PA.charts.drawLive(live, samples);
      if (peak > 0.97 && !clipped) { clipped = true; clipWarn.style.visibility = 'visible'; }
    });

    mainBtn.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      if (!started) {
        try {
          await rec.start();
          started = true;
          // 폰은 화면이 꺼지면 브라우저가 멈춰 녹음이 끊긴다
          PA.storage.keepAwake().catch(() => {});
          mainBtn.className = 'btn primary block';
          mainBtn.innerHTML = icon('square', 18) + '<span>중지하고 저장</span>';
          hint.textContent = '녹음 중… 끝나면 중지를 누르세요. 화면을 끄거나 다른 앱으로 넘어가면 녹음이 멈춥니다.';
        } catch (e) {
          toast(e.name === 'NotAllowedError' ? '마이크 사용이 거부되었습니다. 브라우저 설정에서 허용해 주세요.' : e.message, 'warn');
        }
        busy = false;
        return;
      }

      mainBtn.disabled = true;
      mainBtn.innerHTML = '<span class="thinking"><i></i><i></i><i></i></span><span>분석 중</span>';
      PA.storage.releaseAwake().catch(function(){});
      const out = await rec.stop();
      if (!out || !out.blob || out.duration < 1) {
        toast('녹음이 너무 짧습니다.', 'warn');
        sheet.close();
        return;
      }
      let envelope = out.liveEnvelope, duration = out.duration;
      try {
        const analyzed = await PA.envelope.analyzeBlob(out.blob);
        if (analyzed.envelope && analyzed.envelope.some((v) => v > 0.02)) {
          envelope = analyzed.envelope;
          if (analyzed.duration) duration = analyzed.duration;
        }
      } catch (e) { /* 실시간 곡선으로 대체 */ }

      await PA.store.addRecording(song.id, {
        sectionId: sec ? sec.id : null,
        label: '',
        duration,
        envelope,
        kind: 'audio',
        source: 'mic',
        tempo: song.tempoCurrent,
      }, out.blob);

      // 녹음한 시간만큼 연습 기록에도 반영
      PA.store.logPractice(song.id, { seconds: Math.round(duration), sectionId: sec ? sec.id : null, tempo: song.tempoCurrent, note: '녹음' });

      toast('녹음을 저장했습니다.');
      sheet.close();
      onDone && onDone();
    });

    const sheet = PA.sheets.open({
      title: sec ? `녹음 — ${sec.name}` : '녹음',
      dismissible: false,
      body: el('div', { class: 'stack', style: { gap: '14px' } }, [timeEl, live, clipWarn, mainBtn, hint,
        el('button', {
          class: 'btn ghost block', text: '취소',
          onclick: () => { rec.cancel(); PA.storage.releaseAwake().catch(function(){}); sheet.close(); },
        }),
      ]),
      onClose: () => { try { rec.cancel(); } catch (e) {} PA.storage.releaseAwake().catch(function(){}); },
    });
    return sheet;
  }

  /* ---------------- 파일 업로드(오디오/영상) ---------------- */
  function openUpload(song, sec, onDone) {
    const input = el('input', { type: 'file', accept: 'audio/*,video/*', class: 'input', style: { padding: '10px' } });
    const status = el('div', { class: 'small muted' });
    const progressBar = barEl(0);
    progressBar.style.display = 'none';

    const body = el('div', { class: 'stack', style: { gap: '12px' } }, [
      el('p', { class: 'small muted', text: '레슨 영상이나 연주 영상을 올리면 오디오 트랙만 뽑아 음량 곡선을 만듭니다. 영상은 실시간으로 훑기 때문에 길이만큼 시간이 걸립니다.' }),
      input, progressBar, status,
    ]);

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      input.disabled = true;
      progressBar.style.display = '';
      const isVideo = (file.type || '').startsWith('video');
      status.textContent = isVideo ? '영상에서 오디오 트랙을 훑는 중…' : '오디오를 분석하는 중…';
      try {
        const res = await PA.recorder.analyzeFile(file, (p) => {
          progressBar.firstChild.style.width = Math.round(p * 100) + '%';
        });
        progressBar.firstChild.style.width = '100%';
        await PA.store.addRecording(song.id, {
          sectionId: sec ? sec.id : null,
          label: file.name.replace(/\.[^.]+$/, ''),
          duration: res.duration,
          envelope: res.envelope,
          kind: res.kind,
          source: 'file',
          mime: res.mime,
          tempo: song.tempoCurrent,
        }, res.blob);
        toast('업로드와 분석을 마쳤습니다.');
        sheet.close();
        onDone && onDone();
      } catch (e) {
        status.textContent = '';
        toast('분석 실패: ' + e.message, 'warn');
        input.disabled = false;
        progressBar.style.display = 'none';
      }
    });

    const sheet = PA.sheets.open({ title: '영상·음성 업로드', body });
    return sheet;
  }

  /* ---------------- 구간 편집 ---------------- */
  function editSection(song, sec, onDone) {
    const isNew = !sec;
    const name = el('input', { class: 'input', value: sec ? sec.name : '', placeholder: '예: 제2주제 — F# 장조' });
    const bars = el('input', { class: 'input', value: sec ? sec.bars : '', placeholder: '예: mm. 124–180' });
    const character = el('input', { class: 'input', value: sec ? sec.character : '', placeholder: '예: Andante, 프란체스카의 노래' });
    const note = el('textarea', { class: 'textarea', style: { minHeight: '76px' }, placeholder: '이 구간에서 늘 신경 쓸 것' });
    note.value = sec ? (sec.note || '') : '';

    const focusRow = el('div', { class: 'pill-group' });
    let focus = sec ? sec.focus : 'dynamics';
    DIMS.forEach((d) => {
      const chip = el('button', { class: 'chip' + (focus === d.id ? ' on' : ''), text: d.label });
      chip.addEventListener('click', () => {
        focus = d.id;
        Array.from(focusRow.children).forEach((c) => c.classList.remove('on'));
        chip.classList.add('on');
      });
      focusRow.appendChild(chip);
    });

    const body = el('div', { class: 'stack', style: { gap: '12px' } }, [
      el('div', { class: 'field' }, [el('label', { text: '구간 이름' }), name]),
      el('div', { class: 'field' }, [el('label', { text: '마디' }), bars]),
      el('div', { class: 'field' }, [el('label', { text: '성격' }), character]),
      el('div', { class: 'field' }, [el('label', { text: '집중 차원' }), focusRow]),
      el('div', { class: 'field' }, [el('label', { text: '메모' }), note]),
    ]);

    const actions = [
      { label: '저장', kind: 'primary', block: true, onClick: (a) => {
        const data = { name: name.value.trim() || '이름 없는 구간', bars: bars.value.trim(), character: character.value.trim(), focus, note: note.value };
        if (isNew) PA.store.addSection(song.id, data);
        else PA.store.updateSection(song.id, sec.id, data);
        a.close();
        onDone && onDone();
      } },
    ];
    if (!isNew) {
      actions.unshift({ label: '삭제', kind: 'danger', onClick: async (a) => {
        const ok = await PA.sheets.confirm({ title: '구간 삭제', message: '이 구간의 별점과 메모도 함께 지워집니다. 녹음은 남습니다.', danger: true, confirmLabel: '삭제' });
        if (!ok) return;
        PA.store.removeSection(song.id, sec.id);
        a.close();
        onDone && onDone();
      } });
    }

    return PA.sheets.open({ title: isNew ? '구간 추가' : '구간 수정', body, actions });
  }

  PA.views = PA.views || {};
  PA.views.practice = { render, openRecorder, openUpload, openCompare, recordingList, openRecordingDetail };
})(window.PA);
