/* ===== 롤모델 탭 =====
   "음은 MuseScore MIDI, 표현은 명연주 녹음" — 여기는 표현 쪽 레퍼런스를 모으는 곳.
   AI 웹검색으로 명연주를 발굴하고, 해석을 항목별로 적어 내 연주와 비교한다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';
  const U = PA.util;
  const { el, icon, clear, toast, emptyEl } = U;

  const ASPECTS = [
    { id: 'tempo', label: '템포', ph: '예: ♩=76, 서주를 유난히 느리게' },
    { id: 'dynamics', label: '다이내믹', ph: '예: 제1주제를 mp로 시작해 두 번 부풀림' },
    { id: 'pedal', label: '페달링', ph: '예: 화성 단위로 얕게, 코다에서만 길게' },
    { id: 'character', label: '성격', ph: '예: 극적이기보다 서사적' },
  ];

  /* ---------------- 유튜브 ---------------- */
  function videoId(url) {
    if (!url) return null;
    const m = String(url).match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  function thumbUrl(id) { return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`; }

  /* ---------------- 진입점 ---------------- */
  function render(root) {
    clear(root);
    const song = PA.store.activeSong();
    if (!song) { root.appendChild(emptyEl('users', '곡이 없습니다', '')); return; }

    root.appendChild(intro(song));
    root.appendChild(searchCard(song));

    root.appendChild(el('div', { class: 'section-title' }, [
      el('span', { text: `롤모델 ${song.roleModels.length}` }), el('span', { class: 'rule' }),
      PA.store.isReadOnly() ? null
        : el('button', { class: 'btn sm ghost', html: icon('plus', 15) + '<span>직접 추가</span>', onclick: () => editRoleModel(song, null) }),
    ]));

    if (!song.roleModels.length) {
      root.appendChild(emptyEl('users', '아직 롤모델이 없습니다', '해석이 서로 다른 연주를 3~4개 모아 두면 내 해석을 정할 기준이 생깁니다.'));
      return;
    }

    const primary = song.roleModels.filter((r) => r.isPrimary);
    const rest = song.roleModels.filter((r) => !r.isPrimary);
    const list = el('div', { class: 'stack' });
    primary.concat(rest).forEach((rm) => list.appendChild(card(song, rm)));
    root.appendChild(list);
  }

  function intro(song) {
    const primary = song.roleModels.find((r) => r.isPrimary);
    return el('div', { class: 'card', style: { marginTop: '4px' } }, [
      el('div', { class: 'row' }, [
        el('span', { html: icon('users', 16), style: { color: 'var(--accent)' } }),
        el('span', { style: { fontWeight: 700 }, text: '표현 레퍼런스' }),
      ]),
      el('p', { class: 'small muted', style: { marginTop: '6px' }, text: '음정과 리듬은 악보에서, 표현은 명연주에서. 한 연주를 따라 하는 게 아니라 서로 다른 해석을 비교해 내 것을 정하는 자리입니다.' }),
      primary ? el('div', { class: 'row', style: { marginTop: '10px', gap: '6px' } }, [
        el('span', { class: 'badge focus', text: '주 롤모델' }),
        el('span', { class: 'small', style: { fontWeight: 600 }, text: primary.performer }),
      ]) : null,
    ]);
  }

  /* ---------------- AI 발굴 ---------------- */
  function searchCard(song) {
    const results = el('div', { style: { marginTop: '10px' } });
    const btn = el('button', {
      class: 'btn accent block',
      html: icon('sparkles', 17) + '<span>AI로 명연주 찾기</span>',
    });

    btn.addEventListener('click', async () => {
      if (!PA.ai.available()) { toast('설정에서 API 키를 넣어야 씁니다.', 'warn'); PA.views.app.openSettings(); return; }
      btn.disabled = true;
      clear(results).appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'row' }, [
          el('span', { class: 'thinking', html: '<i></i><i></i><i></i>' }),
          el('span', { class: 'small muted', text: '유튜브를 검색해 해석이 다른 연주를 고르는 중…' }),
        ]),
      ]));
      try {
        const found = await PA.analysis.findRoleModels(song);
        renderFound(song, results, found);
      } catch (e) {
        clear(results);
        toast(e.message, 'warn');
      }
      btn.disabled = false;
    });

    return el('div', { class: 'card', style: { marginTop: '10px' } }, [
      el('p', { class: 'small muted', style: { marginBottom: '10px' }, text: 'Claude가 웹을 검색해 이 곡의 명연주를 찾고, 해석이 어떻게 갈리는지 정리해 줍니다.' }),
      btn,
      results,
    ]);
  }

  function renderFound(song, host, found) {
    clear(host);
    if (found.comparison) {
      host.appendChild(el('div', { class: 'card accent', style: { marginBottom: '10px' } }, [
        el('div', { class: 'tiny muted', style: { marginBottom: '4px' }, text: '해석 비교' }),
        el('p', { class: 'small', style: { lineHeight: '1.65', whiteSpace: 'pre-wrap' }, text: found.comparison }),
      ]));
    }
    (found.results || []).forEach((r) => {
      const vid = videoId(r.url);
      const item = el('div', { class: 'card', style: { marginBottom: '8px' } }, [
        el('div', { class: 'row', style: { alignItems: 'flex-start' } }, [
          vid ? el('img', {
            src: thumbUrl(vid), alt: '',
            style: { width: '84px', height: '48px', objectFit: 'cover', borderRadius: '6px', flex: '0 0 84px' },
            onerror: (e) => { e.currentTarget.style.display = 'none'; },
          }) : null,
          el('div', { style: { minWidth: 0, flex: '1' } }, [
            el('div', { style: { fontWeight: 650, fontSize: '14px' }, text: r.performer || '연주자 미상' }),
            el('div', { class: 'tiny muted truncate', text: [r.year, r.title].filter(Boolean).join(' · ') }),
          ]),
        ]),
        el('div', { class: 'stack', style: { gap: '3px', marginTop: '9px' } }, [
          r.tempo ? line('템포', r.tempo) : null,
          r.dynamics ? line('다이내믹', r.dynamics) : null,
          r.pedal ? line('페달', r.pedal) : null,
          r.character ? line('성격', r.character) : null,
          r.forStudent ? el('p', { class: 'tiny', style: { color: 'var(--ok)', marginTop: '4px' }, text: '학생 참고: ' + r.forStudent }) : null,
        ]),
        el('div', { class: 'row', style: { marginTop: '10px', gap: '6px' } }, [
          r.url ? el('a', { class: 'btn sm', href: r.url, target: '_blank', rel: 'noopener noreferrer', html: icon('link', 15) + '<span>열기</span>' }) : null,
          el('span', { class: 'spacer' }),
          el('button', {
            class: 'btn sm primary', html: icon('plus', 15) + '<span>추가</span>',
            onclick: (e) => {
              PA.store.addRoleModel(song.id, {
                performer: r.performer || '', year: r.year || '', url: r.url || '', videoId: vid,
                interpretation: { tempo: r.tempo || '', dynamics: r.dynamics || '', pedal: r.pedal || '', character: r.character || '' },
                note: r.forStudent || '',
              });
              e.currentTarget.disabled = true;
              e.currentTarget.innerHTML = icon('check', 15) + '<span>추가됨</span>';
              toast('롤모델에 추가했습니다.');
            },
          }),
        ]),
      ]);
      host.appendChild(item);
    });
    host.appendChild(el('p', { class: 'tiny faint', style: { marginTop: '8px' }, text: '링크는 AI가 검색으로 찾은 것입니다. 열어서 실제로 맞는 연주인지 확인하세요.' }));
  }

  function line(k, v) {
    return el('div', { class: 'row', style: { alignItems: 'flex-start', gap: '8px' } }, [
      el('span', { class: 'tiny muted', style: { width: '52px', flex: '0 0 52px' }, text: k }),
      el('span', { class: 'tiny', style: { lineHeight: '1.5' }, text: v }),
    ]);
  }

  /* ---------------- 롤모델 카드 ---------------- */
  function card(song, rm) {
    const vid = rm.videoId || videoId(rm.url);
    const filled = ASPECTS.filter((a) => rm.interpretation[a.id]).length;

    const c = el('div', {
      class: 'card tap',
      style: rm.isPrimary ? { borderColor: 'var(--accent)', borderWidth: '1.5px' } : null,
    }, [
      el('div', { class: 'row', style: { alignItems: 'flex-start' } }, [
        vid
          ? el('img', {
              src: thumbUrl(vid), alt: '',
              style: { width: '92px', height: '52px', objectFit: 'cover', borderRadius: '8px', flex: '0 0 92px', background: 'var(--paper-2)' },
              onerror: (e) => { e.currentTarget.style.display = 'none'; },
            })
          : el('div', { class: 'cover s', html: U.coverSVG(rm.performer || 'x') }),
        el('div', { style: { minWidth: 0, flex: '1' } }, [
          el('div', { class: 'row', style: { gap: '5px' } }, [
            el('span', { style: { fontWeight: 650, fontSize: '14.5px' }, text: rm.performer || '연주자 미상' }),
            rm.isPrimary ? el('span', { class: 'badge focus', text: '주' }) : null,
          ]),
          el('div', { class: 'tiny muted', text: [rm.year, `해석 ${filled}/4 기록`].filter(Boolean).join(' · ') }),
          rm.note ? el('div', { class: 'tiny faint truncate', style: { marginTop: '3px' }, text: rm.note }) : null,
        ]),
        el('span', { class: 'tiny faint', html: icon('chevronRight', 16) }),
      ]),
    ]);
    c.addEventListener('click', () => openDetail(song, rm));
    return c;
  }

  /* ---------------- 상세 ---------------- */
  function openDetail(song, rm) {
    const sheet = PA.sheets.open({
      title: rm.performer || '롤모델',
      body: () => detailBody(song, rm, refresh),
    });
    function refresh() { sheet.setBody(detailBody(song, rm, refresh)); }
    return sheet;
  }

  function detailBody(song, rm, refresh) {
    const vid = rm.videoId || videoId(rm.url);
    const wrap = el('div', { class: 'stack', style: { gap: '14px' } });

    if (vid) {
      wrap.appendChild(el('div', {
        style: { position: 'relative', paddingTop: '56.25%', borderRadius: 'var(--r-m)', overflow: 'hidden', background: 'var(--ebony)' },
      }, [
        el('iframe', {
          src: `https://www.youtube-nocookie.com/embed/${vid}`,
          title: rm.performer || '연주 영상',
          allow: 'accelerometer; clipboard-write; encrypted-media; picture-in-picture',
          allowfullscreen: true,
          referrerpolicy: 'strict-origin-when-cross-origin',
          style: { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 },
        }),
      ]));
    } else if (rm.url) {
      wrap.appendChild(el('a', { class: 'btn block', href: rm.url, target: '_blank', rel: 'noopener noreferrer', html: icon('link', 16) + '<span>링크 열기</span>' }));
    }

    wrap.appendChild(el('div', { class: 'row wrap', style: { gap: '6px' } }, [
      el('button', {
        class: 'btn sm' + (rm.isPrimary ? ' accent' : ''),
        html: icon('flag', 15) + `<span>${rm.isPrimary ? '주 롤모델' : '주 롤모델로'}</span>`,
        onclick: () => { PA.store.setPrimaryRoleModel(song.id, rm.id); refresh(); toast('주 롤모델로 지정'); },
      }),
      el('button', { class: 'btn sm ghost', html: icon('edit', 15) + '<span>수정</span>', onclick: () => editRoleModel(song, rm, refresh) }),
    ]));

    /* 해석 노트 */
    wrap.appendChild(el('div', { class: 'section-title' }, [el('span', { text: '해석' }), el('span', { class: 'rule' })]));
    const box = el('div', { class: 'card' });
    ASPECTS.forEach((a, i) => {
      const v = rm.interpretation[a.id];
      box.appendChild(el('div', { style: { padding: '7px 0', borderTop: i ? '1px dashed var(--line)' : 'none' } }, [
        el('div', { class: 'tiny muted', style: { fontWeight: 700, letterSpacing: '.04em' }, text: a.label }),
        el('p', { class: 'small', style: { marginTop: '3px', color: v ? '' : 'var(--faint)', lineHeight: '1.55' }, text: v || '(미입력)' }),
      ]));
    });
    wrap.appendChild(box);

    if (rm.note) {
      wrap.appendChild(el('div', { class: 'card', style: { background: 'var(--surface-2)' } }, [
        el('div', { class: 'tiny muted', style: { marginBottom: '4px' }, text: '메모' }),
        el('p', { class: 'small', style: { whiteSpace: 'pre-wrap' }, text: rm.note }),
      ]));
    }

    /* 내 연주와 비교 */
    wrap.appendChild(el('div', { class: 'section-title' }, [el('span', { text: '내 연주와 비교' }), el('span', { class: 'rule' })]));
    const cmpBox = el('div');
    if (rm.compare) {
      cmpBox.appendChild(el('div', { class: 'card accent' }, [
        el('p', { class: 'small', style: { whiteSpace: 'pre-wrap', lineHeight: '1.65' }, text: rm.compare }),
      ]));
    }
    wrap.appendChild(cmpBox);

    const recs = (song.recordings || []).filter((r) => r.envelope && r.envelope.length);
    const cmpBtn = el('button', {
      class: 'btn block', html: icon('sparkles', 16) + '<span>' + (rm.compare ? '비교 노트 다시 쓰기' : '비교 노트 만들기') + '</span>',
      disabled: !recs.length,
    });
    cmpBtn.addEventListener('click', async () => {
      if (!PA.ai.available()) { toast('설정에서 API 키를 넣어야 씁니다.', 'warn'); return; }
      cmpBtn.disabled = true;
      clear(cmpBox).appendChild(el('div', { class: 'card' }, [el('span', { class: 'thinking', html: '<i></i><i></i><i></i>' })]));
      try {
        const m = PA.envelope.metrics(recs[0].envelope);
        const text = await PA.analysis.compareWithRoleModel(song, rm, m);
        PA.store.updateRoleModel(song.id, rm.id, { compare: text });
        refresh();
      } catch (e) {
        clear(cmpBox);
        toast(e.message, 'warn');
        cmpBtn.disabled = false;
      }
    });
    wrap.appendChild(cmpBtn);
    if (!recs.length) {
      wrap.appendChild(el('p', { class: 'tiny faint', text: '비교하려면 녹음이 최소 한 개 필요합니다.' }));
    }

    wrap.appendChild(el('button', {
      class: 'btn danger block sm', style: { marginTop: '6px' },
      html: icon('trash', 15) + '<span>롤모델 삭제</span>',
      onclick: async () => {
        const ok = await PA.sheets.confirm({ title: '롤모델 삭제', message: '해석 노트도 함께 지워집니다.', danger: true, confirmLabel: '삭제' });
        if (!ok) return;
        PA.store.removeRoleModel(song.id, rm.id);
        PA.views.app.refresh();
        document.querySelectorAll('.sheet').forEach((s) => s.classList.remove('in'));
        setTimeout(() => document.querySelectorAll('.sheet,.sheet-scrim').forEach((s) => s.remove()), 300);
        document.body.style.overflow = '';
      },
    }));

    return wrap;
  }

  /* ---------------- 편집 ---------------- */
  function editRoleModel(song, rm, onDone) {
    const isNew = !rm;
    const performer = el('input', { class: 'input', value: rm ? rm.performer : '', placeholder: '예: Claudio Arrau' });
    const year = el('input', { class: 'input', value: rm ? rm.year : '', placeholder: '예: 1970' });
    const url = el('input', { class: 'input', value: rm ? rm.url : '', placeholder: 'https://www.youtube.com/watch?v=…' });
    const note = el('textarea', { class: 'textarea', style: { minHeight: '72px' }, placeholder: '이 연주에서 배울 점 / 배우지 않을 점' });
    note.value = rm ? (rm.note || '') : '';

    const inputs = {};
    const aspectFields = ASPECTS.map((a) => {
      const inp = el('input', { class: 'input', value: rm ? (rm.interpretation[a.id] || '') : '', placeholder: a.ph });
      inputs[a.id] = inp;
      return el('div', { class: 'field' }, [el('label', { text: a.label }), inp]);
    });

    const body = el('div', { class: 'stack', style: { gap: '12px' } }, [
      el('div', { class: 'grid-2' }, [
        el('div', { class: 'field' }, [el('label', { text: '연주자' }), performer]),
        el('div', { class: 'field' }, [el('label', { text: '연도' }), year]),
      ]),
      el('div', { class: 'field' }, [el('label', { text: '유튜브 링크' }), url]),
      el('div', { class: 'section-title', style: { margin: '6px 0 0' } }, [el('span', { text: '해석 노트' }), el('span', { class: 'rule' })]),
      ...aspectFields,
      el('div', { class: 'field' }, [el('label', { text: '메모' }), note]),
    ]);

    const actions = [{
      label: '저장', kind: 'primary', block: true,
      onClick: (a) => {
        const interpretation = {};
        ASPECTS.forEach((asp) => { interpretation[asp.id] = inputs[asp.id].value.trim(); });
        const data = {
          performer: performer.value.trim() || '연주자 미상',
          year: year.value.trim(),
          url: url.value.trim(),
          videoId: videoId(url.value.trim()),
          note: note.value,
          interpretation,
        };
        if (isNew) PA.store.addRoleModel(song.id, data);
        else PA.store.updateRoleModel(song.id, rm.id, data);
        a.close();
        onDone && onDone();
      },
    }];

    return PA.sheets.open({ title: isNew ? '롤모델 추가' : '롤모델 수정', body, actions });
  }

  PA.views = PA.views || {};
  PA.views.rolemodel = { render, videoId };
})(window.PA);
