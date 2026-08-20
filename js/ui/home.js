/* ===== 홈 피드 =====
   오늘 무엇을 할지, 지금 어디쯤인지, 최근에 무엇을 남겼는지. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';
  const U = PA.util;
  const { el, icon, clear, toast, coverEl, emptyEl, fmtDur } = U;

  let coachCache = {};   // songId -> {date, text}

  function render(root) {
    clear(root);
    const song = PA.store.activeSong();
    if (!song) {
      root.appendChild(emptyEl('music', '아직 곡이 없습니다', '아래 + 버튼으로 첫 곡을 추가하세요.'));
      root.appendChild(el('button', {
        class: 'btn primary block', style: { marginTop: '14px' },
        html: icon('plus', 17) + '<span>곡 추가</span>',
        onclick: () => PA.views.home.editSong(null),
      }));
      return;
    }

    const m = PA.metrics.summary(song);

    root.appendChild(hero(song, m));
    root.appendChild(coachCard(song, m));
    if (m.stagnation.length) root.appendChild(stagnationCard(song, m));
    root.appendChild(scoreCard(song, m));
    root.appendChild(recentRecordings(song));
    root.appendChild(songShelf());
  }

  /* ---------------- 곡 히어로 ---------------- */
  function hero(song, m) {
    const todaySec = (song.practiceLog || []).filter((l) => l.date === U.todayKey()).reduce((a, b) => a + b.seconds, 0);
    const goal = (PA.store.get().settings.practiceGoalMin || 60) * 60;

    return el('div', { class: 'card', style: { marginTop: '4px' } }, [
      el('div', { class: 'row', style: { alignItems: 'flex-start' } }, [
        coverEl(song.title + song.composer, 'l', song.glyph),
        el('div', { style: { minWidth: 0, flex: '1', alignSelf: 'stretch', display: 'flex', flexDirection: 'column' } }, [
          el('div', { class: 'tiny muted', text: song.composer || '작곡가 미상' }),
          el('div', { style: { fontFamily: 'var(--serif)', fontSize: '21px', lineHeight: '1.25', marginTop: '2px' }, text: song.title }),
          song.work ? el('div', { class: 'tiny faint truncate', text: song.work }) : null,
          el('div', { class: 'spacer' }),
          el('div', { class: 'row', style: { gap: '6px', marginTop: '8px' } }, [
            el('button', {
              class: 'btn sm', html: icon('swap', 15) + '<span>곡 전환</span>',
              onclick: openSongSwitcher,
            }),
            el('button', {
              class: 'btn sm ghost', html: icon('edit', 15), 'aria-label': '곡 수정',
              onclick: () => editSong(song),
            }),
          ]),
        ]),
      ]),
      el('div', { style: { marginTop: '14px' } }, [
        el('div', { class: 'row', style: { marginBottom: '5px' } }, [
          el('span', { class: 'tiny muted', text: '오늘 연습' }),
          el('span', { class: 'spacer' }),
          el('span', { class: 'tiny mono', text: `${U.fmtMinutes(todaySec)} / ${U.fmtMinutes(goal)}` }),
        ]),
        U.barEl((todaySec / goal) * 100, { tone: todaySec >= goal ? 'ok' : '' }),
      ]),
    ]);
  }

  /* ---------------- 오늘의 처방 ---------------- */
  function coachCard(song, m) {
    const card = el('div', { class: 'card accent', style: { marginTop: '10px' } });
    const head = el('div', { class: 'row' }, [
      el('span', { html: icon('sparkles', 16), style: { color: 'var(--accent)' } }),
      el('span', { style: { fontWeight: 700 }, text: '오늘의 처방' }),
      el('span', { class: 'spacer' }),
    ]);
    card.appendChild(head);

    const bodyBox = el('div', { style: { marginTop: '8px' } });
    card.appendChild(bodyBox);

    const cached = coachCache[song.id];
    if (cached && cached.date === U.todayKey()) {
      renderCoach(bodyBox, cached.text, cached.engine);
    } else {
      renderCoach(bodyBox, PA.analysis.coachTodayRules(song, m), 'rules');
    }

    const btn = el('button', {
      class: 'btn sm ghost', html: icon('refresh', 15) + '<span>' + (PA.ai.available() ? 'AI로 다시' : 'AI 켜기') + '</span>',
    });
    btn.addEventListener('click', async () => {
      if (!PA.ai.available()) { PA.views.app.openSettings(); return; }
      btn.disabled = true;
      clear(bodyBox).appendChild(el('span', { class: 'thinking', html: '<i></i><i></i><i></i>' }));
      try {
        const text = await PA.analysis.coachToday(song, m);
        coachCache[song.id] = { date: U.todayKey(), text, engine: 'claude' };
        renderCoach(bodyBox, text, 'claude');
      } catch (e) {
        renderCoach(bodyBox, PA.analysis.coachTodayRules(song, m), 'rules');
        toast(e.message, 'warn');
      }
      btn.disabled = false;
    });
    head.appendChild(btn);
    return card;
  }

  function renderCoach(box, text, engine) {
    clear(box);
    String(text || '').split('\n').forEach((line) => {
      if (!line.trim()) { box.appendChild(el('div', { style: { height: '6px' } })); return; }
      const bold = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      box.appendChild(el('p', { class: 'small', style: { lineHeight: '1.65' }, html: bold }));
    });
    box.appendChild(el('div', { class: 'tiny faint', style: { marginTop: '8px' }, text: engine === 'claude' ? 'Claude 코치' : '규칙 기반 — API 키를 넣으면 AI가 짜 줍니다' }));
  }

  /* ---------------- 정체 경고 ---------------- */
  function stagnationCard(song, m) {
    // 흑백에서 경고는 붉은 배경이 아니라 굵은 검정 왼쪽 띠로 표시한다
    const card = el('div', {
      class: 'card',
      style: { marginTop: '10px', borderLeft: '4px solid var(--ebony)', background: 'var(--surface)' },
    }, [
      el('div', { class: 'row' }, [
        el('span', { html: icon('alert', 16) }),
        el('span', { style: { fontWeight: 700 }, text: '정체 신호' }),
      ]),
    ]);
    m.stagnation.slice(0, 3).forEach((s) => {
      card.appendChild(el('div', { style: { marginTop: '9px' } }, [
        el('p', { class: 'small', style: { fontWeight: 600 }, text: s.text }),
        el('p', { class: 'tiny muted', text: s.hint }),
      ]));
    });
    return card;
  }

  /* ---------------- 완성도 ---------------- */
  function scoreCard(song, m) {
    const trendTxt = m.improvement === 0 ? '변화 없음' : `${m.improvement > 0 ? '+' : ''}${m.improvement}점 (7일)`;
    return el('div', { class: 'card', style: { marginTop: '10px' } }, [
      el('div', { class: 'row', style: { gap: '16px' } }, [
        PA.charts.donut(m.completeness, { size: 104 }),
        el('div', { style: { flex: '1', minWidth: 0 } }, [
          PA.charts.stackedScore(m),
          el('div', { class: 'row', style: { marginTop: '10px', gap: '6px' } }, [
            el('span', {
              class: 'badge ' + (m.improvement > 0 ? 'done' : m.improvement < 0 ? 'stale' : ''),
              text: trendTxt,
            }),
            el('span', { class: 'badge', text: `지적 ${m.totalIssues - m.openIssues}/${m.totalIssues} 해소` }),
          ]),
        ]),
      ]),
      el('button', {
        class: 'btn ghost block sm', style: { marginTop: '10px' },
        html: '<span>추이 자세히 보기</span>' + icon('chevronRight', 15),
        onclick: () => PA.views.app.go('trends'),
      }),
    ]);
  }

  /* ---------------- 최근 녹음 ---------------- */
  function recentRecordings(song) {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'section-title' }, [
      el('span', { text: '최근 녹음' }), el('span', { class: 'rule' }),
      el('button', { class: 'btn sm ghost', html: icon('mic', 15) + '<span>녹음</span>', onclick: () => PA.views.practice.openRecorder(song, null, () => PA.views.app.refresh()) }),
    ]));

    const recs = (song.recordings || []).slice(0, 4);
    if (!recs.length) {
      wrap.appendChild(emptyEl('mic', '녹음이 없습니다', '어쿠스틱 그랜드에는 MIDI가 없습니다. 녹음이 유일한 기록입니다.'));
      return wrap;
    }

    const list = el('div', { class: 'stack' });
    recs.forEach((rec) => {
      const sec = (song.sections || []).find((s) => s.id === rec.sectionId);
      const canvas = el('canvas', { class: 'wave', style: { height: '46px', border: 'none', background: 'transparent' } });
      setTimeout(() => PA.charts.drawEnvelope(canvas, { primary: rec.envelope }), 0);

      const card = el('div', { class: 'card tap' }, [
        el('div', { class: 'row' }, [
          el('button', {
            class: 'btn icon primary', html: icon('play', 17), 'aria-label': '재생',
            onclick: (e) => { e.stopPropagation(); PA.player.play(rec, song); },
          }),
          el('div', { style: { minWidth: 0, flex: '1' } }, [
            el('div', { class: 'truncate', style: { fontWeight: 650, fontSize: '14px' }, text: rec.label || (sec ? sec.name : '녹음') }),
            el('div', { class: 'tiny muted' }, [
              el('span', { text: `${U.relDays(rec.createdAt)} · ${fmtDur(rec.duration)}` }),
              rec.tempo ? el('span', { text: ` · ♩=${rec.tempo}` }) : null,
              rec.kind === 'video' ? el('span', { text: ' · 영상' }) : null,
            ]),
          ]),
        ]),
        el('div', { style: { marginTop: '8px' } }, [canvas]),
      ]);
      card.addEventListener('click', () => PA.views.practice.openRecordingDetail(song, rec, () => PA.views.app.refresh()));
      list.appendChild(card);
    });
    wrap.appendChild(list);
    return wrap;
  }

  /* ---------------- 곡 선반 ---------------- */
  function songShelf() {
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'section-title' }, [
      el('span', { text: '내 곡' }), el('span', { class: 'rule' }),
      el('button', { class: 'btn sm ghost', html: icon('plus', 15), 'aria-label': '곡 추가', onclick: () => editSong(null) }),
    ]));

    const rows = PA.metrics.compareSongs(14);
    const maxSec = Math.max(1, Math.max.apply(null, rows.map((r) => r.seconds)));
    const box = el('div', { class: 'card flush' });

    rows.forEach((r) => {
      const active = r.id === PA.store.get().activeSongId;
      // 현재 곡을 회색으로 칠하면 그 위의 작은 글씨 대비가 떨어진다.
      // 배경 대신 검은 왼쪽 띠로 표시한다.
      const item = el('div', {
        class: 'item',
        style: active ? { boxShadow: 'inset 3px 0 0 var(--ebony)', paddingLeft: '11px' } : null,
      }, [
        coverEl(r.title + r.composer, 's', r.glyph),
        el('div', { class: 'body' }, [
          el('div', { class: 't', text: r.title }),
          el('div', { class: 's', text: `${r.composer || ''} · 완성도 ${r.completeness}` }),
          el('div', { style: { marginTop: '5px' } }, [U.barEl((r.seconds / maxSec) * 100, { thin: true, tone: 'ebony' })]),
        ]),
        el('div', { class: 'center', style: { flex: '0 0 auto' } }, [
          el('div', { class: 'tiny mono', text: U.fmtMinutes(r.seconds) }),
          el('div', { class: 'tiny faint', text: '14일' }),
        ]),
      ]);
      item.addEventListener('click', () => { PA.store.setActiveSong(r.id); toast(`${r.title}(으)로 전환`); });
      box.appendChild(item);
    });
    wrap.appendChild(box);
    return wrap;
  }

  /* ---------------- 곡 전환 시트 ---------------- */
  function openSongSwitcher() {
    const body = el('div', { class: 'stack', style: { gap: '8px' } });
    PA.store.songs().forEach((s) => {
      const c = PA.metrics.completeness(s);
      const active = s.id === PA.store.get().activeSongId;
      const card = el('div', { class: 'card tap', style: active ? { borderColor: 'var(--accent)', borderWidth: '1.5px' } : null }, [
        el('div', { class: 'row' }, [
          coverEl(s.title + s.composer, 'm', s.glyph),
          el('div', { style: { minWidth: 0, flex: '1' } }, [
            el('div', { style: { fontWeight: 650 }, text: s.title }),
            el('div', { class: 'small muted truncate', text: [s.composer, s.keySig].filter(Boolean).join(' · ') }),
            el('div', { class: 'row', style: { gap: '5px', marginTop: '6px' } }, [
              el('span', { class: 'badge', text: `완성도 ${c.completeness}` }),
              el('span', { class: 'badge', text: `♩=${s.tempoCurrent}/${s.tempoTarget}` }),
              el('span', { class: 'badge', text: `구간 ${s.sections.length}` }),
            ]),
          ]),
          active ? el('span', { class: 'badge done', text: '현재' }) : null,
        ]),
      ]);
      card.addEventListener('click', () => { PA.store.setActiveSong(s.id); sheet.close(); });
      body.appendChild(card);
    });

    const sheet = PA.sheets.open({
      title: '곡 전환',
      body,
      actions: [{ label: '곡 추가', kind: 'primary', block: true, icon: 'plus', onClick: (a) => { a.close(); editSong(null); } }],
    });
    return sheet;
  }

  /* ---------------- 곡 편집 ---------------- */
  function editSong(song) {
    const isNew = !song;
    const title = el('input', { class: 'input', value: song ? song.title : '', placeholder: '예: 단테 소나타' });
    const composer = el('input', { class: 'input', value: song ? song.composer : '', placeholder: '예: F. Liszt' });
    const work = el('input', { class: 'input', value: song ? song.work : '', placeholder: '예: S.161/7' });
    const keySig = el('input', { class: 'input', value: song ? song.keySig : '', placeholder: '예: d단조' });
    const glyph = el('input', { class: 'input', value: song ? song.glyph : '♪', maxlength: 2, style: { width: '84px' } });
    const target = el('input', { class: 'input', type: 'number', value: song ? song.tempoTarget : 120 });
    const current = el('input', { class: 'input', type: 'number', value: song ? song.tempoCurrent : 60 });

    const preview = el('div', { class: 'center' });
    const drawPreview = () => {
      clear(preview).appendChild(coverEl((title.value || 'x') + (composer.value || ''), 'l', glyph.value || '♪'));
    };
    drawPreview();
    [title, composer, glyph].forEach((i) => i.addEventListener('input', drawPreview));

    const body = el('div', { class: 'stack', style: { gap: '12px' } }, [
      preview,
      el('div', { class: 'field' }, [el('label', { text: '곡 제목' }), title]),
      el('div', { class: 'field' }, [el('label', { text: '작곡가' }), composer]),
      el('div', { class: 'grid-2' }, [
        el('div', { class: 'field' }, [el('label', { text: '작품번호' }), work]),
        el('div', { class: 'field' }, [el('label', { text: '조성' }), keySig]),
      ]),
      el('div', { class: 'grid-2' }, [
        el('div', { class: 'field' }, [el('label', { text: '목표 템포 ♩' }), target]),
        el('div', { class: 'field' }, [el('label', { text: '현재 템포 ♩' }), current]),
      ]),
      el('div', { class: 'field' }, [el('label', { text: '커버 글리프 (한 글자)' }), glyph]),
    ]);

    const actions = [
      {
        label: '저장', kind: 'primary', block: true,
        onClick: (a) => {
          const data = {
            title: title.value.trim() || '이름 없는 곡',
            composer: composer.value.trim(),
            work: work.value.trim(),
            keySig: keySig.value.trim(),
            glyph: (glyph.value || '♪').slice(0, 2),
            tempoTarget: U.clamp(parseInt(target.value, 10) || 120, 20, 300),
            tempoCurrent: U.clamp(parseInt(current.value, 10) || 60, 20, 300),
          };
          if (isNew) PA.store.addSong(data);
          else PA.store.updateSong(song.id, data);
          a.close();
        },
      },
    ];
    if (!isNew && PA.store.songs().length > 1) {
      actions.unshift({
        label: '삭제', kind: 'danger',
        onClick: async (a) => {
          const ok = await PA.sheets.confirm({
            title: '곡 삭제',
            message: `"${song.title}"의 구간·녹음·레슨·연습기록이 모두 지워집니다. 되돌릴 수 없습니다.`,
            danger: true, confirmLabel: '삭제',
          });
          if (!ok) return;
          await PA.store.removeSong(song.id);
          a.close();
        },
      });
    }

    return PA.sheets.open({ title: isNew ? '곡 추가' : '곡 수정', body, actions });
  }

  PA.views = PA.views || {};
  PA.views.home = { render, editSong, openSongSwitcher };
})(window.PA);
