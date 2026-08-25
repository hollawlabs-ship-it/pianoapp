/* ===== 레슨 탭 =====
   주 4회 레슨 → 클로바노트 전사 붙여넣기 → 분석 →
   지적사항(구간 자동 연결) · 연습 지시 · 하루별 스케줄 */
window.PA = window.PA || {};

(function (PA) {
  'use strict';
  const U = PA.util;
  const { el, icon, clear, toast, emptyEl } = U;
  const DIMS = PA.store.DIMENSIONS;

  function render(root) {
    clear(root);
    const song = PA.store.activeSong();
    if (!song) { root.appendChild(emptyEl('notebook', '곡이 없습니다', '')); return; }

    root.appendChild(head(song));
    root.appendChild(issueBoard(song));

    root.appendChild(el('div', { class: 'section-title' }, [
      el('span', { text: '레슨 기록' }), el('span', { class: 'rule' }),
      PA.store.isReadOnly() ? null
        /* 레슨장에서 제일 급한 건 녹음이다. 전사는 끝나고 붙여넣으면 된다. */
        : el('button', {
            class: 'btn sm', html: icon('mic', 15) + '<span>녹음</span>',
            onclick: () => openLessonRecorder(song, null, () => render(root)),
          }),
      PA.store.isReadOnly() ? null
        /* 다른 앱으로 찍어 둔 레슨을 들여온다. 지난 녹음을 몰아 넣을 때도 쓴다. */
        : el('button', {
            class: 'btn sm', html: icon('upload', 15) + '<span>가져오기</span>',
            onclick: () => openLessonImport(song, () => render(root)),
          }),
      PA.store.isReadOnly() ? null
        : el('button', { class: 'btn sm accent', html: icon('plus', 15) + '<span>레슨</span>', onclick: () => openLessonEditor(song, null) }),
    ]));

    if (!song.lessons.length) {
      root.appendChild(emptyEl('notebook', '레슨 기록이 없습니다',
        PA.store.isReadOnly()
          ? '주 기기에서 레슨을 기록하면 여기에 나타납니다.'
          : '레슨장에서 「녹음」을 눌러 담고, 클로바노트로 전사한 뒤 텍스트를 붙여넣으면 지적사항과 하루별 스케줄이 만들어집니다.'));
      return;
    }
    const list = el('div', { class: 'stack' });
    song.lessons.forEach((l) => list.appendChild(lessonCard(song, l)));
    root.appendChild(list);
  }

  /* ---------------- 상단 요약 ---------------- */
  function head(song) {
    const issues = PA.store.allIssues(song);
    const open = issues.filter((i) => !i.resolved);
    const last = song.lessons[0];
    const nextIn = last ? 7 - (U.daysBetween(last.date, U.todayKey()) % 7) : null;

    return el('div', { class: 'card', style: { marginTop: '4px' } }, [
      el('div', { class: 'row' }, [
        el('div', { style: { flex: '1' } }, [
          el('div', { class: 'tiny muted', text: '지적 해소' }),
          el('div', { style: { fontFamily: 'var(--serif)', fontSize: '26px' }, text: `${issues.length - open.length} / ${issues.length}` }),
        ]),
        el('div', { style: { flex: '1' } }, [
          el('div', { class: 'tiny muted', text: '마지막 레슨' }),
          el('div', { style: { fontFamily: 'var(--serif)', fontSize: '18px', marginTop: '4px' }, text: last ? U.relDays(last.date) : '—' }),
        ]),
      ]),
      el('div', { style: { marginTop: '10px' } }, [
        U.barEl(issues.length ? ((issues.length - open.length) / issues.length) * 100 : 100, { tone: 'ok' }),
      ]),
    ]);
  }

  /* ---------------- 지적사항 보드 ---------------- */
  function issueBoard(song) {
    const all = PA.store.allIssues(song);
    const open = all.filter((i) => !i.resolved);
    const wrap = el('div');
    wrap.appendChild(el('div', { class: 'section-title' }, [
      el('span', { text: `미해소 지적 ${open.length}` }), el('span', { class: 'rule' }),
    ]));

    if (!open.length) {
      wrap.appendChild(el('div', { class: 'card', style: { background: 'var(--ok-wash)', borderColor: 'var(--ok-wash)' } }, [
        el('div', { class: 'row' }, [
          el('span', { html: icon('check', 16), style: { color: 'var(--ok)' } }),
          el('span', { class: 'small', style: { fontWeight: 650 }, text: all.length ? '모든 지적을 해소했습니다.' : '아직 기록된 지적이 없습니다.' }),
        ]),
      ]));
      return wrap;
    }

    const box = el('div', { class: 'card flush' });
    open.forEach((it) => box.appendChild(issueRow(song, it)));
    wrap.appendChild(box);
    return wrap;
  }

  function issueRow(song, it) {
    const sec = (song.sections || []).find((s) => s.id === it.sectionId);
    const dim = PA.store.DIM_MAP[it.dimension] || DIMS[0];
    const age = U.daysBetween(it.lessonDate, U.todayKey());

    // 보기 전용에서는 체크가 아니라 '상태 표시'로만 쓴다
    const ro = PA.store.isReadOnly();
    const chk = el(ro ? 'span' : 'button', {
      class: 'check' + (it.resolved ? ' on' : ''),
      html: icon('check', 13),
      style: ro ? { pointerEvents: 'none' } : null,
    });
    if (!ro) chk.addEventListener('click', (e) => {
      e.stopPropagation();
      PA.store.toggleIssue(song.id, it.lessonId, it.index);
      toast(it.resolved ? '미해소로 되돌림' : '해소로 표시');
    });

    return el('div', { class: 'item' }, [
      chk,
      el('div', { class: 'body' }, [
        el('div', { class: 'small', style: { fontWeight: 600, lineHeight: '1.45', whiteSpace: 'normal' }, text: it.text }),
        el('div', { class: 'row', style: { gap: '5px', marginTop: '5px', flexWrap: 'wrap' } }, [
          // 차원의 회색을 글자에 쓰면 옅은 단계가 작은 글씨 대비(4.5:1)에 못 미친다.
          // 글자는 진하게 두고, 색은 점으로만 쓴다.
          el('span', { class: 'badge', style: { background: 'transparent', border: '1px solid var(--line-2)', color: 'var(--ink-2)' } }, [
            el('span', { class: 'dim-dot', style: { background: dim.color, width: '6px', height: '6px' } }),
            el('span', { text: dim.label }),
          ]),
          sec ? el('span', { class: 'badge', text: sec.name }) : null,
          it.severity === 'high' ? el('span', { class: 'badge stale', text: '중요' }) : null,
          el('span', { class: 'tiny faint', text: `${age}일 전` }),
        ]),
      ]),
    ]);
  }

  /* ---------------- 레슨 카드 ---------------- */
  function lessonCard(song, lesson) {
    const a = lesson.analysis;
    const issues = (a && a.issues) || [];
    const doneCount = issues.filter((i) => i.resolved).length;

    const card = el('div', { class: 'card tap' }, [
      el('div', { class: 'row' }, [
        el('div', { class: 'center', style: { flex: '0 0 52px' } }, [
          el('div', { style: { fontFamily: 'var(--serif)', fontSize: '20px', lineHeight: 1 }, text: String(new Date(lesson.date + 'T00:00:00').getDate()) }),
          el('div', { class: 'tiny faint', text: `${new Date(lesson.date + 'T00:00:00').getMonth() + 1}월 ${U.weekday(lesson.date)}` }),
        ]),
        el('div', { style: { minWidth: 0, flex: '1' } }, [
          el('div', { class: 'row', style: { gap: '5px' } }, [
            el('span', { style: { fontWeight: 650, fontSize: '14px' }, text: a ? `지적 ${issues.length}건` : '분석 전' }),
            lesson.sample ? el('span', { class: 'badge', text: '예시' }) : null,
            a && a.engine === 'claude' ? el('span', { class: 'badge focus', text: 'AI' }) : null,
            a && a.engine === 'rules' ? el('span', { class: 'badge', text: '규칙' }) : null,
            a && a.engine === 'sample' ? el('span', { class: 'badge', text: '손으로 쓴 예시' }) : null,
          ]),
          el('div', { class: 'small muted', style: { marginTop: '2px' }, text: a ? (a.summary || '').slice(0, 88) : (lesson.transcript || '').slice(0, 88) || '전사 없음' }),
        ]),
        el('span', { class: 'tiny faint', html: icon('chevronRight', 16) }),
      ]),
      issues.length ? el('div', { style: { marginTop: '10px' } }, [
        U.barEl((doneCount / issues.length) * 100, { thin: true, tone: 'ok' }),
      ]) : null,
    ]);
    card.addEventListener('click', () => openLessonDetail(song, lesson));
    return card;
  }

  /* ---------------- 레슨 상세 ---------------- */
  function openLessonDetail(song, lesson) {
    const sheet = PA.sheets.open({
      title: `${U.fmtDate(lesson.date)} 레슨`,
      body: () => detailBody(song, lesson, refresh),
    });
    function refresh() { sheet.setBody(detailBody(song, lesson, refresh)); }
    return sheet;
  }

  function detailBody(song, lesson, refresh) {
    const a = lesson.analysis;
    const ro = PA.store.isReadOnly();
    const wrap = el('div', { class: 'stack', style: { gap: '16px' } });

    wrap.appendChild(el('div', { class: 'row wrap', style: { gap: '6px' } }, [
      el('span', { class: 'chip outline', text: U.fmtDate(lesson.date) + ' ' + U.weekday(lesson.date) }),
      lesson.teacher ? el('span', { class: 'chip outline', text: lesson.teacher }) : null,
      el('span', { class: 'spacer' }),
      ro ? null : el('button', { class: 'btn sm ghost', html: icon('edit', 15), 'aria-label': '수정', onclick: () => { openLessonEditor(song, lesson, refresh); } }),
    ]));

    if (!a) {
      /* 녹음 직후가 바로 이 상태다. 원본 오디오를 맨 위에 둔다 —
         지금 필요한 건 분석이 아니라 전사로 넘기는 일이다. */
      wrap.appendChild(lessonAudioBlock(song, lesson, refresh));
      wrap.appendChild(emptyEl('sparkles', '아직 분석하지 않았습니다',
        lesson.audioKey && !lesson.transcript
          ? '위 녹음을 클로바노트로 보내 전사한 뒤, 그 텍스트를 붙여넣으세요.'
          : '전사를 넣고 분석을 실행하세요.'));
      if (!ro) wrap.appendChild(analyzeButton(song, lesson, refresh));
      wrap.appendChild(transcriptBlock(lesson));
      return wrap;
    }

    /* 요약 */
    const engineLabel = a.engine === 'claude' ? 'Claude 분석'
      : a.engine === 'sample' ? '앱에 미리 넣어 둔 예시 — 실제 전사로 다시 분석하세요'
      : '규칙 기반 분석';
    wrap.appendChild(el('div', { class: 'card accent' }, [
      el('div', { class: 'tiny muted', style: { marginBottom: '5px' }, text: engineLabel }),
      el('p', { class: 'small', style: { lineHeight: '1.65' }, text: a.summary }),
    ]));

    /* 지적사항 */
    if (a.issues && a.issues.length) {
      wrap.appendChild(el('div', { class: 'section-title' }, [el('span', { text: '지적사항' }), el('span', { class: 'rule' })]));
      const box = el('div', { class: 'card flush' });
      a.issues.forEach((it, idx) => {
        const sec = (song.sections || []).find((s) => s.id === it.sectionId);
        const dim = PA.store.DIM_MAP[it.dimension] || DIMS[0];
        const chk = el(ro ? 'span' : 'button', {
          class: 'check' + (it.resolved ? ' on' : ''), html: icon('check', 13),
          style: ro ? { pointerEvents: 'none' } : null,
        });
        if (!ro) chk.addEventListener('click', () => { PA.store.toggleIssue(song.id, lesson.id, idx); refresh(); });
        box.appendChild(el('div', { class: 'item' }, [
          chk,
          el('div', { class: 'body' }, [
            el('div', { class: 'small', style: { whiteSpace: 'normal', lineHeight: '1.45', opacity: it.resolved ? .5 : 1, textDecoration: it.resolved ? 'line-through' : '' }, text: it.text }),
            el('div', { class: 'row', style: { gap: '5px', marginTop: '4px', flexWrap: 'wrap' } }, [
              el('span', { class: 'badge' }, [
                el('span', { class: 'dim-dot', style: { background: dim.color, width: '6px', height: '6px' } }),
                el('span', { text: dim.label }),
              ]),
              sec ? el('span', { class: 'badge', text: sec.name }) : el('span', { class: 'badge', text: '구간 미지정' }),
              it.severity === 'high' ? el('span', { class: 'badge stale', text: '중요' }) : null,
            ]),
          ]),
          sec ? el('button', {
            class: 'btn icon sm ghost', html: icon('chevronRight', 15), 'aria-label': '구간으로',
            onclick: () => { PA.views.app.go('practice'); },
          }) : null,
        ]));
      });
      wrap.appendChild(box);
    }

    /* 연습 지시 */
    if (a.directives && a.directives.length) {
      wrap.appendChild(el('div', { class: 'section-title' }, [el('span', { text: '연습 지시' }), el('span', { class: 'rule' })]));
      const box = el('div', { class: 'card' });
      a.directives.forEach((d, i) => {
        box.appendChild(el('div', { class: 'row', style: { alignItems: 'flex-start', gap: '9px', padding: '6px 0' } }, [
          el('span', { class: 'mono tiny', style: { color: 'var(--accent)', paddingTop: '2px' }, text: String(i + 1).padStart(2, '0') }),
          el('span', { class: 'small', style: { lineHeight: '1.55' }, text: d }),
        ]));
      });
      wrap.appendChild(box);
    }

    /* 하루별 스케줄 */
    if (a.schedule && a.schedule.length) {
      wrap.appendChild(el('div', { class: 'section-title' }, [el('span', { text: '하루별 스케줄' }), el('span', { class: 'rule' })]));
      a.schedule.forEach((day, di) => {
        const dim = PA.store.DIM_MAP[day.focus] || DIMS[0];
        const dayDate = U.addDays(lesson.date, day.day - 1);
        const isToday = dayDate === U.todayKey();
        const card = el('div', { class: 'card', style: isToday ? { borderColor: 'var(--accent)', borderWidth: '1.5px' } : null }, [
          el('div', { class: 'row' }, [
            el('span', { class: 'dim-dot', style: { background: dim.color } }),
            el('span', { style: { fontWeight: 700, fontSize: '14px' }, text: `${day.day}일차 — ${dim.label}` }),
            el('span', { class: 'spacer' }),
            el('span', { class: isToday ? 'badge focus' : 'badge', text: isToday ? '오늘' : U.fmtDate(dayDate) }),
          ]),
        ]);
        (day.tasks || []).forEach((t, ti) => {
          const chk = el(ro ? 'span' : 'button', {
            class: 'check' + (t.done ? ' on' : ''), html: icon('check', 13),
            style: ro ? { pointerEvents: 'none' } : null,
          });
          if (!ro) chk.addEventListener('click', () => { PA.store.toggleTask(song.id, lesson.id, di, ti); refresh(); });
          card.appendChild(el('div', { class: 'row', style: { alignItems: 'flex-start', gap: '9px', marginTop: '9px' } }, [
            chk,
            el('span', { class: 'small', style: { lineHeight: '1.5', textDecoration: t.done ? 'line-through' : '', opacity: t.done ? .5 : 1 }, text: t.text }),
          ]));
        });
        wrap.appendChild(card);
      });
    }

    if (a.positives && a.positives.length) {
      wrap.appendChild(el('div', { class: 'section-title' }, [el('span', { text: '좋아진 점' }), el('span', { class: 'rule' })]));
      const box = el('div', { class: 'card', style: { background: 'var(--ok-wash)', borderColor: 'var(--ok-wash)' } });
      a.positives.forEach((p) => box.appendChild(el('p', { class: 'small', style: { padding: '3px 0' }, text: '· ' + p })));
      wrap.appendChild(box);
    }

    if (!ro) wrap.appendChild(analyzeButton(song, lesson, refresh, true));
    wrap.appendChild(lessonAudioBlock(song, lesson, refresh));
    wrap.appendChild(transcriptBlock(lesson));
    return wrap;
  }

  function transcriptBlock(lesson) {
    if (!lesson.transcript) return el('div');
    const pre = el('pre', {
      class: 'small muted',
      style: { whiteSpace: 'pre-wrap', fontFamily: 'var(--sans)', lineHeight: '1.7', margin: 0, maxHeight: '220px', overflow: 'auto' },
      text: lesson.transcript,
    });
    const box = el('details', { style: { marginTop: '4px' } }, [
      el('summary', { class: 'small muted', style: { cursor: 'pointer', padding: '8px 0' }, text: '원본 전사 보기' }),
      el('div', { class: 'card', style: { background: 'var(--surface-2)' } }, [pre]),
    ]);
    return box;
  }

  function analyzeButton(song, lesson, refresh, again) {
    const btn = el('button', {
      class: 'btn ' + (again ? '' : 'accent') + ' block',
      html: icon('sparkles', 17) + `<span>${again ? '다시 분석' : '분석하기'}</span>`,
    });
    btn.addEventListener('click', async () => {
      if (!lesson.transcript || lesson.transcript.trim().length < 30) {
        toast('전사 내용이 너무 짧습니다.', 'warn');
        return;
      }
      btn.disabled = true;
      btn.innerHTML = '<span class="thinking"><i></i><i></i><i></i></span><span>' + (PA.ai.available() ? 'Claude가 읽는 중' : '분석 중') + '</span>';
      try {
        const analysis = await PA.analysis.analyzeLesson(lesson.transcript, song);
        PA.store.updateLesson(song.id, lesson.id, {
          analysis, analyzedAt: U.todayKey(), analyzedBy: analysis.engine, sample: false,
        });
        toast(`지적 ${analysis.issues.length}건, ${analysis.schedule.length}일 스케줄을 만들었습니다.`);
        refresh && refresh();
      } catch (e) {
        toast(e.message, 'warn');
        btn.disabled = false;
        btn.innerHTML = icon('sparkles', 17) + `<span>${again ? '다시 분석' : '분석하기'}</span>`;
      }
    });
    return btn;
  }


  /* ---------------- 레슨 원본 오디오 ---------------- */
  /* 흐름: 앱에서 녹음하거나 파일을 붙임 → 클로바노트로 넘겨 전사 →
     전사 텍스트를 붙여넣어 분석. Claude API는 오디오를 받지 않으므로
     음성→텍스트 단계는 반드시 바깥을 거친다. */

  const fmtDur = (sec) => {
    const s = Math.max(0, Math.round(sec || 0));
    const m = Math.floor(s / 60);
    return m >= 60
      ? `${Math.floor(m / 60)}시간 ${m % 60}분`
      : m > 0 ? `${m}분 ${String(s % 60).padStart(2, '0')}초` : `${s}초`;
  };

  function lessonAudioBlock(song, lesson, refresh) {
    const ro = PA.store.isReadOnly();
    if (!lesson.audioKey) return ro ? el('div') : audioAddRow(song, lesson, refresh);

    const wrap = el('div', { class: 'card', style: { background: 'var(--surface-2)', marginTop: '4px' } });
    wrap.appendChild(el('div', { class: 'row', style: { gap: '8px' } }, [
      el('span', { class: 'small', text: '레슨 원본' }),
      el('span', { class: 'spacer' }),
      el('span', { class: 'tiny faint', text: fmtDur(lesson.audioDuration) + (lesson.audioSource === 'file' ? ' · 첨부' : ' · 앱 녹음') }),
    ]));

    const audio = el('audio', { controls: true, style: { width: '100%', marginTop: '8px' } });
    PA.store.getBlob(lesson.audioKey).then((b) => {
      if (!b) { audio.replaceWith(el('p', { class: 'tiny warn', text: '오디오 파일을 찾을 수 없습니다.' })); return; }
      audio.src = URL.createObjectURL(b);
      audio.addEventListener('loadedmetadata', () => {
        /* 조각을 이어붙인 파일은 컨테이너에 길이가 비어 있을 수 있다.
           그럴 때는 녹음하며 재어 둔 시간을 그대로 쓴다. */
        if (isFinite(audio.duration) && audio.duration > 0 && !lesson.audioDuration) {
          PA.store.updateLesson(song.id, lesson.id, { audioDuration: audio.duration });
        }
      });
    });
    wrap.appendChild(audio);

    if (!ro) {
      const toClova = el('button', {
        class: 'btn sm accent', html: icon('upload', 15) + '<span>클로바노트로 보내기</span>',
        onclick: async () => {
          const blob = await PA.store.getBlob(lesson.audioKey);
          if (!blob) { toast('오디오 파일을 찾을 수 없습니다.', 'warn'); return; }
          const name = `레슨 ${lesson.date}${lesson.teacher ? ' ' + lesson.teacher : ''}`;
          const r = await PA.lessonrec.shareForTranscript(blob, name);
          if (r === 'unsupported') {
            /* 공유 시트가 없는 환경(데스크톱 등)에서는 파일로 내려준다. */
            PA.lessonrec.download(blob, name);
            toast('파일을 내려받았습니다. 클로바노트에 올려 전사하세요.');
          } else if (r === 'shared') {
            toast('전사가 끝나면 텍스트를 복사해 붙여넣으세요.');
          }
        },
      });
      const del = el('button', {
        class: 'btn sm ghost', html: icon('trash', 15),
        onclick: async () => {
          const ok = await PA.sheets.confirm({
            title: '원본 오디오 삭제',
            message: lesson.transcript
              ? '전사와 분석은 그대로 남고 오디오만 지웁니다. 용량을 돌려받습니다.'
              : '아직 전사를 붙여넣지 않았습니다. 지우면 이 레슨은 되돌릴 수 없습니다.',
            danger: true, confirmLabel: '삭제',
          });
          if (!ok) return;
          await PA.store.removeLessonAudio(song.id, lesson.id);
          refresh();
        },
      });
      del.setAttribute('aria-label', '원본 오디오 삭제');
      wrap.appendChild(el('div', { class: 'row', style: { gap: '8px', marginTop: '10px' } }, [toClova, el('span', { class: 'spacer' }), del]));
      if (!lesson.transcript) {
        wrap.appendChild(el('p', { class: 'tiny faint', style: { marginTop: '8px' },
          text: '클로바노트에서 전사한 뒤 텍스트를 이 레슨에 붙여넣으면 분석이 돌아갑니다.' }));
      }
    }
    return wrap;
  }

  function audioAddRow(song, lesson, refresh) {
    const recBtn = el('button', {
      class: 'btn sm', html: icon('mic', 15) + '<span>레슨 녹음</span>',
      onclick: () => openLessonRecorder(song, lesson, refresh),
    });
    const file = el('input', { type: 'file', accept: 'audio/*', style: { display: 'none' } });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      toast('저장 중…');
      await PA.store.setLessonAudio(song.id, lesson.id, f, { source: 'file', mime: f.type });
      refresh();
    });
    const upBtn = el('button', {
      class: 'btn sm ghost', html: icon('upload', 15) + '<span>파일 첨부</span>',
      onclick: () => file.click(),
    });
    return el('div', { class: 'row', style: { gap: '8px', marginTop: '4px' } }, [recBtn, upBtn, file]);
  }

  /* ---------------- 녹음 파일 가져오기 ---------------- */
  /* 다른 앱으로 녹음해 둔 레슨을 통째로 들여온다.
     앱 내 녹음과 도착지는 같다 — 레슨 하나에 원본 오디오가 붙은 상태. */
  function openLessonImport(song, onDone) {
    let picked = null;

    const file = el('input', { class: 'input', type: 'file', accept: 'audio/*,video/*', style: { padding: '10px' } });
    const summary = el('div', { class: 'tiny faint', text: '아이폰의 음성 메모, 클로바노트에서 내려받은 파일, 녹음기 앱 파일 모두 됩니다.' });
    const date = el('input', { class: 'input', type: 'date', value: U.todayKey() });
    const teacher = el('input', { class: 'input', placeholder: '선생님 (선택)' });

    file.addEventListener('change', () => {
      picked = file.files && file.files[0];
      if (!picked) { summary.textContent = ''; return; }
      summary.textContent = `${picked.name} · ${PA.storage.fmtBytes(picked.size)} · 길이 읽는 중…`;

      /* 길이는 메타데이터를 읽어야 안다. 실패해도 가져오기는 막지 않는다 —
         컨테이너에 길이가 없는 파일도 재생은 된다. */
      const probe = el('audio');
      const url = URL.createObjectURL(picked);
      probe.addEventListener('loadedmetadata', () => {
        const d = isFinite(probe.duration) ? probe.duration : 0;
        picked._duration = d;
        summary.textContent = `${picked.name} · ${PA.storage.fmtBytes(picked.size)}` + (d ? ` · ${fmtDur(d)}` : '');
        URL.revokeObjectURL(url);
      });
      probe.addEventListener('error', () => {
        summary.textContent = `${picked.name} · ${PA.storage.fmtBytes(picked.size)}`;
        URL.revokeObjectURL(url);
      });
      probe.src = url;

      /* 파일명에 날짜가 들어 있으면 (20260822 / 2026-08-22 / 2026_08_22)
         그걸 기본값으로 쓴다. 지난 레슨을 몰아서 넣을 때 매번 고치지 않아도 된다. */
      const m = picked.name.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
      if (m) {
        const cand = `${m[1]}-${m[2]}-${m[3]}`;
        if (!isNaN(new Date(cand + 'T00:00:00').getTime())) date.value = cand;
      }
    });

    const body = el('div', { class: 'stack', style: { gap: '12px' } }, [
      el('div', { class: 'field' }, [el('label', { text: '녹음 파일' }), file, summary]),
      el('div', { class: 'grid-2' }, [
        el('div', { class: 'field' }, [el('label', { text: '레슨 날짜' }), date]),
        el('div', { class: 'field' }, [el('label', { text: '선생님' }), teacher]),
      ]),
      el('p', { class: 'tiny faint', style: { lineHeight: '1.6' },
        text: '가져온 뒤 「클로바노트로 보내기」로 전사하고, 그 텍스트를 붙여넣으면 분석이 돕니다.' }),
    ]);

    return PA.sheets.open({
      title: '녹음 파일 가져오기',
      body,
      actions: [{
        label: '가져오기', kind: 'primary', block: true,
        onClick: async (a) => {
          if (!picked) { toast('파일을 고르세요.', 'warn'); return; }
          a.close();
          toast('저장 중…');
          const lesson = PA.store.addLesson(song.id, {
            date: date.value || U.todayKey(),
            teacher: teacher.value.trim(),
            transcript: '',
          });
          if (!lesson) return;
          await PA.store.setLessonAudio(song.id, lesson.id, picked, {
            source: 'file', duration: picked._duration || 0, mime: picked.type,
          });
          toast('가져왔습니다.');
          onDone && onDone();
          openLessonDetail(song, lesson);
        },
      }],
    });
  }

  /* ---------------- 레슨 녹음 ---------------- */
  function openLessonRecorder(song, lesson, onDone) {
    const rec = PA.lessonrec.create();
    let running = false;

    const time = el('div', {
      style: { fontSize: '34px', fontWeight: '600', fontVariantNumeric: 'tabular-nums', letterSpacing: '-.02em' },
      text: '0:00',
    });
    const meterFill = el('div', { style: { height: '100%', width: '0%', background: 'var(--ink)', transition: 'width .1s linear' } });
    const meter = el('div', { style: { height: '4px', width: '100%', background: 'var(--paper-2)', borderRadius: '2px', overflow: 'hidden' } }, [meterFill]);
    const note = el('p', { class: 'tiny faint', style: { lineHeight: '1.6' },
      text: '화면을 끄거나 다른 앱으로 넘어가면 iOS가 녹음을 멈춥니다. 그때까지 녹음된 부분은 5초 단위로 저장돼 남습니다.' });

    rec.onTick((sec) => {
      const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
      time.textContent = `${m}:${String(s).padStart(2, '0')}`;
    });
    rec.onLevel((rms) => { meterFill.style.width = Math.min(100, rms * 320) + '%'; });
    rec.onInterrupt(() => {
      note.textContent = '화면이 꺼져 녹음이 멈췄을 수 있습니다. 앱으로 돌아와 정지를 누르면 그때까지 녹음된 부분이 저장됩니다.';
      note.className = 'tiny warn';
    });

    /* 시작·정지 버튼은 시트의 actions가 아니라 body 안에 둔다.
       actions로 만든 버튼은 라벨을 바꿀 수 없어 한 버튼으로 토글할 수 없다. */
    const mainBtn = el('button', { class: 'btn accent block', html: icon('mic', 17) + '<span>녹음 시작</span>' });
    const body = el('div', { class: 'stack', style: { gap: '14px', alignItems: 'center', textAlign: 'center' } },
      [time, meter, note, mainBtn]);

    const sheet = PA.sheets.open({
      title: '레슨 녹음',
      body,
      actions: [
        {
          label: '닫기', kind: 'ghost',
          onClick: async (a) => {
            if (running) {
              const ok = await PA.sheets.confirm({
                title: '녹음 취소', message: '지금까지 녹음된 내용을 버립니다.',
                danger: true, confirmLabel: '버리기', cancelLabel: '계속 녹음',
              });
              if (!ok) return;
              await rec.cancel();
            }
            a.close();
          },
        },
      ],
    });

    mainBtn.addEventListener('click', async () => {
      if (!running) {
        try {
          await rec.start(song.id, lesson ? lesson.id : null);
          running = true;
          mainBtn.innerHTML = icon('square', 17) + '<span>정지하고 저장</span>';
          mainBtn.className = 'btn block';
          note.textContent = '녹음 중입니다. 이 화면을 켜 둔 채로 두세요.';
          note.className = 'tiny faint';
        } catch (e) {
          toast(e.name === 'NotAllowedError' ? '마이크 권한이 필요합니다.' : e.message, 'warn');
        }
        return;
      }
      mainBtn.disabled = true;
      const res = await rec.stop();
      running = false;
      sheet.close();
      if (!res || !res.blob || !res.blob.size) { toast('녹음된 내용이 없습니다.', 'warn'); return; }
      await saveLessonAudio(song, lesson, res, onDone);
    });

    return sheet;
  }

  /** 녹음 결과를 레슨에 붙인다. 레슨이 없으면 새로 만든다. */
  async function saveLessonAudio(song, lesson, res, onDone) {
    let target = lesson;
    if (!target) {
      target = PA.store.addLesson(song.id, { date: U.todayKey(), transcript: '' });
      if (!target) return;
    }
    await PA.store.setLessonAudio(song.id, target.id, res.blob, {
      source: 'mic', duration: res.duration, mime: res.mime,
    });
    toast(`${fmtDur(res.duration)} 녹음을 저장했습니다.`);
    onDone && onDone();

    /* 레슨 직후가 전사를 잊지 않고 처리할 가능성이 가장 높다. */
    const go = await PA.sheets.confirm({
      title: '지금 전사할까요?',
      message: '클로바노트로 파일을 넘깁니다. 전사가 끝나면 텍스트를 복사해 이 레슨에 붙여넣으세요.',
      confirmLabel: '클로바노트로 보내기', cancelLabel: '나중에',
    });
    if (!go) return;
    const name = `레슨 ${target.date}`;
    const r = await PA.lessonrec.shareForTranscript(res.blob, name);
    if (r === 'unsupported') { PA.lessonrec.download(res.blob, name); toast('파일을 내려받았습니다.'); }
  }

  /** 끊긴 녹음이 남아 있으면 복구를 제안한다. 앱을 열 때 부른다. */
  async function checkPendingRecording() {
    if (PA.store.isReadOnly()) return;
    const p = PA.lessonrec.pending();
    if (!p) return;
    const song = PA.store.songById(p.songId) || PA.store.activeSong();
    if (!song) { await PA.lessonrec.dropPending(); return; }
    const ok = await PA.sheets.confirm({
      title: '중단된 레슨 녹음',
      message: `약 ${fmtDur(p.seconds)} 분량이 저장된 채 남아 있습니다. 녹음이 끊긴 것 같습니다. 복구할까요?`,
      confirmLabel: '복구', cancelLabel: '버리기',
    });
    if (!ok) { await PA.lessonrec.dropPending(); return; }
    const res = await PA.lessonrec.recover();
    if (!res || !res.blob || !res.blob.size) { toast('복구할 내용이 없습니다.', 'warn'); return; }
    const lesson = p.lessonId ? (song.lessons || []).find((x) => x.id === p.lessonId) : null;
    await saveLessonAudio(song, lesson, res, () => {
      if (PA.views.app && PA.views.app.refresh) PA.views.app.refresh();
    });
  }

  /* ---------------- 레슨 입력/수정 ---------------- */
  function openLessonEditor(song, lesson, onDone) {
    const isNew = !lesson;
    const date = el('input', { class: 'input', type: 'date', value: lesson ? lesson.date : U.todayKey() });
    const teacher = el('input', { class: 'input', value: lesson ? lesson.teacher : '', placeholder: '선생님 (선택)' });
    const transcript = el('textarea', {
      class: 'textarea',
      style: { minHeight: '220px' },
      placeholder: '클로바노트에서 복사한 전사를 그대로 붙여넣으세요.\n오탈자나 잡담이 섞여 있어도 괜찮습니다.',
    });
    transcript.value = lesson ? lesson.transcript : '';

    const counter = el('div', { class: 'tiny faint' });
    const updateCount = () => { counter.textContent = `${transcript.value.length}자`; };
    transcript.addEventListener('input', updateCount);
    updateCount();

    const body = el('div', { class: 'stack', style: { gap: '12px' } }, [
      el('div', { class: 'grid-2' }, [
        el('div', { class: 'field' }, [el('label', { text: '레슨 날짜' }), date]),
        el('div', { class: 'field' }, [el('label', { text: '선생님' }), teacher]),
      ]),
      el('div', { class: 'field' }, [
        el('div', { class: 'row' }, [el('label', { class: 'small muted', text: '전사' }), el('span', { class: 'spacer' }), counter]),
        transcript,
      ]),
      el('p', { class: 'tiny faint', text: 'AI 분석이 켜져 있으면 Claude가, 아니면 규칙 엔진이 구간·차원을 연결합니다.' }),
    ]);

    const actions = [
      {
        label: isNew ? '저장하고 분석' : '저장', kind: 'primary', block: true,
        onClick: async (a) => {
          const data = { date: date.value || U.todayKey(), teacher: teacher.value.trim(), transcript: transcript.value };
          let target = lesson;
          if (isNew) target = PA.store.addLesson(song.id, data);
          else PA.store.updateLesson(song.id, lesson.id, data);
          a.close();
          if (isNew && data.transcript.trim().length >= 30) {
            toast('분석을 시작합니다…');
            try {
              const analysis = await PA.analysis.analyzeLesson(data.transcript, song);
              PA.store.updateLesson(song.id, target.id, { analysis, analyzedAt: U.todayKey(), analyzedBy: analysis.engine });
              toast(`지적 ${analysis.issues.length}건을 찾았습니다.`);
            } catch (e) { toast(e.message, 'warn'); }
          }
          onDone && onDone();
        },
      },
    ];
    if (!isNew) {
      actions.unshift({
        label: '삭제', kind: 'danger',
        onClick: async (a) => {
          const ok = await PA.sheets.confirm({ title: '레슨 삭제', message: '지적사항과 스케줄도 함께 지워집니다.', danger: true, confirmLabel: '삭제' });
          if (!ok) return;
          await PA.store.removeLesson(song.id, lesson.id);
          a.close();
          onDone && onDone();
        },
      });
    }

    return PA.sheets.open({ title: isNew ? '레슨 추가' : '레슨 수정', body, actions });
  }

  PA.views = PA.views || {};
  PA.views.lesson = { render, openLessonEditor, openLessonRecorder, openLessonImport, openLessonDetail, checkPendingRecording };
})(window.PA);
