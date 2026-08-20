/* ===== 앱 셸: 라우팅 · 하단 내비 · 설정 ===== */
window.PA = window.PA || {};

(function (PA) {
  'use strict';
  const U = PA.util;
  const { el, icon, clear, toast, $ } = U;

  const TABS = [
    { id: 'home', label: '홈', icon: 'home', title: '오늘', sub: '무엇을 어떻게 연습할지' },
    { id: 'practice', label: '연습', icon: 'piano', title: '연습', sub: '구간별 표현 · 녹음' },
    { id: 'lesson', label: '레슨', icon: 'notebook', title: '레슨', sub: '전사 · 지적 · 스케줄' },
    { id: 'trends', label: '추이', icon: 'trend', title: '추이', sub: '완성도 · 향상도 · 정체' },
    { id: 'rolemodel', label: '롤모델', icon: 'users', title: '롤모델', sub: '명연주 · 해석 비교' },
  ];

  let currentTab = 'home';
  let screen, topbar, nav;
  let rendering = false;

  /* ---------------- 부트 ---------------- */
  function boot() {
    PA.store.load();

    const app = $('#app');
    clear(app);

    // topbar는 화면 컨테이너 안에 sticky로 두어 좌우 여백을 공유한다
    topbar = el('div', { class: 'topbar' });
    screen = el('div', { style: { padding: 0 } });
    app.appendChild(el('div', { class: 'screen' }, [topbar, screen]));

    nav = buildNav();
    document.body.appendChild(nav);
    PA.player.mount(document.body);

    PA.store.subscribe(U.debounce(() => { refresh(); }, 40));

    // 하루 한 번 스냅샷 — 향상도 계산의 기준선
    const last = localStorage.getItem('pianoapp.lastSnapshot');
    if (last !== U.todayKey()) {
      PA.metrics.snapshotAll();
      localStorage.setItem('pianoapp.lastSnapshot', U.todayKey());
    }

    const hash = (location.hash || '').replace('#', '');
    if (TABS.some((t) => t.id === hash)) currentTab = hash;

    window.addEventListener('hashchange', () => {
      const h = (location.hash || '').replace('#', '');
      if (TABS.some((t) => t.id === h) && h !== currentTab) { currentTab = h; refresh(); }
    });

    refresh();
    setTimeout(maybeWelcome, 400);
  }

  /* ---------------- 내비 ---------------- */
  function buildNav() {
    const n = el('nav', { class: 'nav' });
    TABS.forEach((t) => {
      const b = el('button', {
        class: t.id === currentTab ? 'on' : '',
        dataset: { tab: t.id },
        html: icon(t.icon, 21) + `<span>${t.label}</span>`,
        onclick: () => go(t.id),
      });
      n.appendChild(b);
    });
    return n;
  }

  function go(tab) {
    if (!TABS.some((t) => t.id === tab)) return;
    currentTab = tab;
    if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    refresh();
  }

  /* ---------------- 렌더 ---------------- */
  function refresh() {
    if (rendering) return;
    rendering = true;
    try {
      Array.from(nav.children).forEach((b) => b.classList.toggle('on', b.dataset.tab === currentTab));
      renderTopbar();
      const view = PA.views[currentTab];
      if (view && view.render) view.render(screen);
    } catch (e) {
      console.error(e);
      clear(screen).appendChild(U.emptyEl('alert', '화면을 그리다 문제가 생겼습니다', e.message));
    } finally {
      rendering = false;
    }
  }

  function renderTopbar() {
    clear(topbar);
    const tab = TABS.find((t) => t.id === currentTab);
    const song = PA.store.activeSong();

    topbar.appendChild(el('div', { style: { minWidth: 0 } }, [
      el('h1', { text: tab.title }),
      el('div', { class: 'sub truncate', text: song ? `${song.title} · ${tab.sub}` : tab.sub }),
    ]));
    topbar.appendChild(el('div', { class: 'topbar-actions' }, [
      song ? el('button', {
        class: 'btn icon ghost', 'aria-label': '곡 전환',
        html: icon('swap', 19),
        onclick: () => PA.views.home.openSongSwitcher(),
      }) : null,
      el('button', {
        class: 'btn icon ghost', 'aria-label': '설정',
        html: icon('settings', 19),
        onclick: openSettings,
      }),
    ]));
  }

  /* ---------------- 설정 ---------------- */
  function openSettings() {
    const s = PA.store.get().settings;

    const key = el('input', {
      class: 'input', type: 'password', value: PA.store.getApiKey(),
      placeholder: 'sk-ant-…', autocomplete: 'off', spellcheck: 'false',
    });
    const showKey = el('button', {
      class: 'btn sm ghost', text: '보기',
      onclick: (e) => {
        key.type = key.type === 'password' ? 'text' : 'password';
        e.currentTarget.textContent = key.type === 'password' ? '보기' : '숨기기';
      },
    });
    const keyStatus = el('div', { class: 'tiny', style: { minHeight: '16px' } });

    /* 저장 위치 선택 — 공개 URL에서는 세션 한정이 기본값 */
    const remember = el('input', { type: 'checkbox', id: 'rememberKey', style: { width: '18px', height: '18px', accentColor: '#0D0D0D' } });
    remember.checked = !!s.rememberKey;
    const rememberNote = el('p', { class: 'tiny faint' });
    const syncNote = () => {
      rememberNote.textContent = remember.checked
        ? '이 브라우저에 계속 남습니다. 개인 기기에서만 쓰세요.'
        : '탭을 닫으면 키가 사라집니다. 공용 기기에 안전한 설정입니다.';
    };
    syncNote();
    remember.addEventListener('change', () => {
      PA.store.setRememberKey(remember.checked);
      syncNote();
      toast(remember.checked ? '이 기기에 키를 기억합니다.' : '세션이 끝나면 키를 지웁니다.');
    });

    const testBtn = el('button', {
      class: 'btn sm', html: icon('check', 15) + '<span>연결 확인</span>',
      onclick: async (e) => {
        PA.store.setApiKey(key.value.trim(), remember.checked);
        e.currentTarget.disabled = true;
        keyStatus.textContent = '확인 중…';
        keyStatus.style.color = 'var(--muted)';
        try {
          await PA.ai.ping();
          keyStatus.textContent = '연결됨 — AI 코치를 쓸 수 있습니다.';
          keyStatus.style.color = 'var(--ok)';
        } catch (err) {
          keyStatus.textContent = err.message;
          keyStatus.style.color = 'var(--warn)';
        }
        e.currentTarget.disabled = false;
      },
    });

    const goal = el('input', { class: 'input', type: 'number', value: String(s.practiceGoalMin || 60), min: 10, max: 300 });
    const learner = el('input', {
      class: 'input', value: s.learnerProfile || '',
      placeholder: '예: 예술중학교 1학년 피아노 전공생',
      maxlength: 120,
    });
    learner.addEventListener('change', () => PA.store.setSettings({ learnerProfile: learner.value.trim() }));

    const body = el('div', { class: 'stack', style: { gap: '16px' } }, [
      /* AI */
      el('div', {}, [
        el('div', { class: 'section-title', style: { marginTop: 0 } }, [el('span', { text: 'AI 코치' }), el('span', { class: 'rule' })]),
        el('div', { class: 'field' }, [
          el('label', { text: 'Anthropic API 키' }),
          el('div', { class: 'row', style: { gap: '6px' } }, [key, showKey]),
          keyStatus,
          el('div', { class: 'row', style: { gap: '6px', marginTop: '4px' } }, [
            testBtn,
            el('button', {
              class: 'btn sm ghost', text: '키 지우기',
              onclick: () => {
                key.value = '';
                PA.store.clearApiKey();
                remember.checked = false;
                syncNote();
                keyStatus.textContent = '';
                toast('키를 지웠습니다.');
              },
            }),
          ]),
          el('label', {
            for: 'rememberKey',
            class: 'row',
            style: { gap: '8px', marginTop: '8px', cursor: 'pointer' },
          }, [
            remember,
            el('span', { class: 'small', text: '이 기기에 키 기억하기' }),
          ]),
          rememberNote,
        ]),
        el('div', { class: 'card', style: { borderLeft: '4px solid var(--ebony)', marginTop: '10px' } }, [
          el('div', { class: 'row', style: { gap: '7px' } }, [
            el('span', { html: icon('key', 15) }),
            el('span', { class: 'small', style: { fontWeight: 700 }, text: '키는 브라우저 밖으로 나가지 않습니다' }),
          ]),
          el('p', { class: 'tiny', style: { marginTop: '5px', lineHeight: '1.6' }, text:
            '이 앱에는 서버가 없습니다. 키는 이 브라우저에만 보관되고 Anthropic API로 직접 전송되며, ' +
            '내보내기(JSON) 파일에도 담기지 않습니다. 기본값은 탭을 닫으면 지워지는 세션 저장입니다. ' +
            '키 없이도 규칙 기반 분석은 모두 동작합니다.' }),
        ]),
        el('p', { class: 'tiny faint', style: { marginTop: '8px' }, text: `모델: ${s.model || PA.ai.MODEL}` }),
      ]),

      /* 연습 */
      el('div', {}, [
        el('div', { class: 'section-title', style: { marginTop: 0 } }, [el('span', { text: '연습' }), el('span', { class: 'rule' })]),
        el('div', { class: 'field' }, [
          el('label', { text: '하루 목표 (분)' }),
          goal,
        ]),
        el('div', { class: 'field', style: { marginTop: '12px' } }, [
          el('label', { text: '학습자 소개' }),
          learner,
          el('p', { class: 'tiny faint', text: 'AI 코치가 누구를 가르치는지 알려 주는 한 줄입니다. 이 기기에만 저장되며 말투와 난이도가 여기에 맞춰집니다.' }),
        ]),
      ]),

      /* 데이터 */
      el('div', {}, [
        el('div', { class: 'section-title', style: { marginTop: 0 } }, [el('span', { text: '데이터' }), el('span', { class: 'rule' })]),
        el('div', { class: 'row wrap', style: { gap: '8px' } }, [
          el('button', {
            class: 'btn sm', html: icon('download', 15) + '<span>내보내기</span>',
            onclick: () => {
              const blob = new Blob([PA.store.exportJSON()], { type: 'application/json' });
              U.downloadBlob(blob, `pianoapp-${U.todayKey()}.json`);
              toast('연습 기록을 내려받았습니다. (녹음 파일은 제외)');
            },
          }),
          (() => {
            const fi = el('input', { type: 'file', accept: 'application/json', style: { display: 'none' } });
            fi.addEventListener('change', async () => {
              const f = fi.files && fi.files[0];
              if (!f) return;
              const ok = await PA.sheets.confirm({
                title: '가져오기',
                message: '현재 기록을 모두 덮어씁니다. 계속할까요?',
                danger: true, confirmLabel: '덮어쓰기',
              });
              if (!ok) { fi.value = ''; return; }
              try {
                PA.store.importJSON(await f.text());
                toast('가져왔습니다.');
                sheet.close();
              } catch (e) { toast('가져오기 실패: ' + e.message, 'warn'); }
            });
            const b = el('button', { class: 'btn sm', html: icon('upload', 15) + '<span>가져오기</span>', onclick: () => fi.click() });
            return el('span', { style: { display: 'contents' } }, [b, fi]);
          })(),
        ]),
        el('p', { class: 'tiny faint', style: { marginTop: '8px' }, text: '녹음 오디오는 이 브라우저(IndexedDB)에만 있습니다. JSON에는 별점·메모·레슨·연습기록·음량 곡선이 담깁니다.' }),
        el('button', {
          class: 'btn danger block sm', style: { marginTop: '12px' },
          html: icon('trash', 15) + '<span>모든 데이터 지우기</span>',
          onclick: async () => {
            const ok = await PA.sheets.confirm({
              title: '전체 초기화',
              message: '곡·녹음·레슨·연습기록이 모두 사라집니다. 되돌릴 수 없습니다.',
              danger: true, confirmLabel: '전부 지우기',
            });
            if (!ok) return;
            localStorage.removeItem('pianoapp.v6.state');
            localStorage.removeItem('pianoapp.lastSnapshot');
            indexedDB.deleteDatabase('pianoapp-media');
            location.reload();
          },
        }),
      ]),

      /* 정보 */
      el('div', {}, [
        el('div', { class: 'section-title', style: { marginTop: 0 } }, [el('span', { text: '정보' }), el('span', { class: 'rule' })]),
        el('div', { class: 'row', style: { gap: '6px', marginBottom: '8px' } }, [
          el('span', { class: 'badge stale', text: '베타' }),
          el('span', { class: 'tiny mono muted', text: PA.VERSION }),
          el('span', { class: 'spacer' }),
          el('span', { class: 'tiny faint', text: navigator.onLine ? '온라인' : '오프라인' }),
        ]),
        el('p', { class: 'tiny muted', style: { lineHeight: '1.7' }, text:
          '피아노 연습 앱 v6 — 템포가 아니라 표현을 중심에 둔 연습 기록기. ' +
          '어쿠스틱 그랜드 전용으로, MIDI 대신 마이크 녹음의 음량 곡선을 읽습니다. ' +
          '앱은 학습하지 않습니다. 쌓인 기록이 AI 코칭의 재료가 될 뿐입니다.' }),
      ]),
    ]);

    goal.addEventListener('change', () => {
      PA.store.setSettings({ practiceGoalMin: U.clamp(parseInt(goal.value, 10) || 60, 10, 300) });
    });
    key.addEventListener('change', () => PA.store.setApiKey(key.value.trim(), remember.checked));

    const sheet = PA.sheets.open({ title: '설정', body });
    return sheet;
  }

  /* ---------------- 첫 실행 안내 ----------------
     공개 주소로 처음 들어온 사람은 이게 무엇이고 자기 기록이 어디에 남는지 모른다.
     계정도 서버도 없다는 점을 먼저 알려 준다. 한 번만 뜬다. */
  const SEEN_KEY = 'pianoapp.welcomeSeen';

  function maybeWelcome() {
    let seen = null;
    try { seen = localStorage.getItem(SEEN_KEY); } catch (e) { return; }
    if (seen === PA.VERSION) return;

    const line = (t, s) => el('div', { style: { marginBottom: '12px' } }, [
      el('div', { class: 'small', style: { fontWeight: 700 }, text: t }),
      el('p', { class: 'small muted', style: { marginTop: '2px', lineHeight: '1.6' }, text: s }),
    ]);

    const sheet = PA.sheets.open({
      title: '피아노 연습 (베타)',
      dismissible: false,
      body: el('div', {}, [
        el('p', { class: 'small muted', style: { marginBottom: '14px', lineHeight: '1.65' }, text:
          '템포가 아니라 표현을 기록하는 연습장입니다. 구간마다 다이내믹·레가토·프레이징·페달링·음색을 따로 매기고, 녹음의 음량 곡선으로 실제로 달라졌는지 확인합니다.' }),
        line('기록은 이 브라우저에만 남습니다',
          '계정도 서버도 없습니다. 별점·메모·녹음이 모두 이 기기에 저장되므로, 브라우저 데이터를 지우면 함께 사라집니다. 설정에서 JSON으로 내보내 백업하세요.'),
        line('AI 없이도 다 됩니다',
          '레슨 분석과 오늘의 처방은 규칙 엔진이 처리합니다. Anthropic API 키를 넣으면 그 자리를 Claude가 대신하며, 키는 기본적으로 탭을 닫으면 지워집니다.'),
        line('녹음하려면 마이크 권한이 필요합니다',
          '어쿠스틱 피아노에는 MIDI가 없어 녹음이 유일한 관측 수단입니다. 소리는 기기 밖으로 나가지 않습니다.'),
        el('p', { class: 'tiny faint', style: { marginTop: '4px' }, text: '베타 ' + PA.VERSION + ' — 예시로 단테 소나타와 쇼팽 에튀드가 들어 있습니다. 지우고 직접 곡을 넣으셔도 됩니다.' }),
      ]),
      actions: [{
        label: '시작하기', kind: 'primary', block: true,
        onClick: (a) => {
          try { localStorage.setItem(SEEN_KEY, PA.VERSION); } catch (e) {}
          a.close();
        },
      }],
    });
    return sheet;
  }

  PA.views = PA.views || {};
  PA.views.app = { boot, go, refresh, openSettings, maybeWelcome, TABS };

  document.addEventListener('DOMContentLoaded', boot);
})(window.PA);
