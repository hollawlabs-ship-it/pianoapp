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

    // 드롭박스 리디렉트 처리와 폴더 권한 복구. 실패해도 앱은 그대로 돈다.
    PA.backup.init().catch(function () {});

    // 브라우저가 기록을 임의로 지우지 못하게 영구 저장소를 요청한다.
    // 폰에서는 이게 데이터 유실을 막는 첫 번째 방어선이다.
    PA.storage.requestPersist().catch(function () {});

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

    const viewer = PA.store.isReadOnly();
    topbar.appendChild(el('div', { style: { minWidth: 0 } }, [
      el('div', { class: 'row', style: { gap: '7px' } }, [
        el('h1', { text: tab.title }),
        // 편집이 왜 안 되는지 화면에서 바로 보이게 한다
        viewer ? el('span', { class: 'badge stale', text: '보기 전용' }) : null,
      ]),
      el('div', { class: 'sub truncate', text: viewer
        ? (song ? `${song.title} · ${PA.backup.lastSyncLabel()}` : PA.backup.lastSyncLabel())
        : (song ? `${song.title} · ${tab.sub}` : tab.sub) }),
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

      /* 기기 역할 */
      roleSection(),

      /* 저장 공간 */
      storageSection(),

      /* 저장 드라이브 */
      driveSection(),

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

  /* ---------------- 기기 역할 (주 기기 / 보기 전용) ---------------- */
  function roleSection() {
    const host = el('div');
    const render = () => {
      clear(host);
      const viewer = PA.store.isReadOnly();

      host.appendChild(el('div', { class: 'section-title', style: { marginTop: 0 } }, [
        el('span', { text: '이 기기의 역할' }), el('span', { class: 'rule' }),
      ]));
      host.appendChild(el('p', { class: 'small muted', style: { marginBottom: '10px' }, text:
        '한 기록을 두 폰에서 함께 볼 때, 양쪽이 다 편집하면 나중에 백업한 쪽이 상대의 기록을 덮어씁니다. ' +
        '그래서 쓰는 기기는 하나로 정합니다.' }));

      const opt = (id, title, desc) => {
        const on = (id === 'viewer') === viewer;
        const card = el('div', {
          class: 'card tap',
          style: on ? { borderColor: 'var(--ebony)', borderWidth: '1.5px', marginBottom: '8px' } : { marginBottom: '8px' },
        }, [
          el('div', { class: 'row' }, [
            el('span', { style: { fontWeight: 700 }, text: title }),
            el('span', { class: 'spacer' }),
            on ? el('span', { class: 'badge stale', text: '현재' }) : null,
          ]),
          el('p', { class: 'tiny muted', style: { marginTop: '4px', lineHeight: '1.6' }, text: desc }),
        ]);
        card.addEventListener('click', async () => {
          if (on) return;
          if (id === 'viewer') {
            const ok = await PA.sheets.confirm({
              title: '보기 전용으로 바꾸기',
              message: '이 기기에서는 더 이상 별점·메모·녹음·레슨을 바꿀 수 없게 됩니다. ' +
                       '앱을 열 때마다 주 기기의 최신 기록을 자동으로 받아옵니다.\n\n' +
                       '이 기기에만 있는 기록이 있다면 먼저 백업하세요. 받아오는 순간 덮어써집니다.',
              danger: true, confirmLabel: '보기 전용으로',
            });
            if (!ok) return;
          }
          PA.store.setRole(id);
          toast(id === 'viewer' ? '보기 전용 기기가 됐습니다.' : '주 기기가 됐습니다.');
          openSettings();
        });
        return card;
      };

      host.appendChild(opt('owner', '주 기기 — 아이 폰',
        '연습·녹음·별점·레슨을 기록합니다. 드라이브에 백업하는 쪽입니다.'));
      host.appendChild(opt('viewer', '보기 전용 — 부모 폰',
        '기록을 보기만 합니다. 편집이 잠기고, 열 때마다 주 기기의 최신 기록을 받아옵니다.'));

      if (viewer) {
        const pullBtn = el('button', {
          class: 'btn block', html: icon('refresh', 16) + '<span>지금 새로 받기</span>',
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            try {
              const r = await PA.backup.pullIfNewer();
              if (r.pulled) { toast('최신 기록을 받았습니다.'); PA.views.app.refresh(); }
              else if (r.reason === 'up-to-date') toast('이미 최신입니다.');
              else if (r.reason === 'no-backup') toast('드라이브에 백업이 없습니다.', 'warn');
              else toast('드라이브가 연결돼 있지 않습니다.', 'warn');
            } catch (err) { toast(err.message, 'warn'); }
            e.currentTarget.disabled = false;
          },
        });
        host.appendChild(pullBtn);
      }
      return host;
    };
    return render();
  }

  /* ---------------- 저장 공간 · 유실 위험 ---------------- */
  function storageSection() {
    const host = el('div');
    host.appendChild(el('div', { class: 'section-title', style: { marginTop: 0 } }, [
      el('span', { text: '저장 공간' }), el('span', { class: 'rule' }),
    ]));
    const box = el('div', { class: 'card' }, [el('span', { class: 'thinking', html: '<i></i><i></i><i></i>' })]);
    host.appendChild(box);

    (async () => {
      const S = PA.storage;
      const [est, persisted, r] = await Promise.all([S.estimate(), S.isPersisted(), S.risk()]);
      clear(box);

      if (r.level !== 'none') {
        // 위험이 있으면 가장 위에, 가장 크게 말한다
        box.appendChild(el('div', { style: { borderLeft: '4px solid var(--ebony)', paddingLeft: '10px', marginBottom: '12px' } }, [
          el('div', { class: 'row', style: { gap: '7px' } }, [
            el('span', { html: icon('alert', 15) }),
            el('span', { class: 'small', style: { fontWeight: 700 }, text: r.text }),
          ]),
          el('p', { class: 'tiny muted', style: { marginTop: '4px', lineHeight: '1.6' }, text: r.fix }),
        ]));
      }

      if (est && est.quota) {
        const pct = (est.usage / est.quota) * 100;
        box.appendChild(el('div', { class: 'row', style: { marginBottom: '5px' } }, [
          el('span', { class: 'tiny muted', text: '사용 중' }),
          el('span', { class: 'spacer' }),
          el('span', { class: 'tiny mono', text: `${S.fmtBytes(est.usage)} / ${S.fmtBytes(est.quota)}` }),
        ]));
        box.appendChild(U.barEl(pct));
      }

      const rows = [
        ['홈 화면 앱', S.isStandalone() ? '예' : '아니오'],
        ['영구 저장소', persisted ? '허용됨' : '아님'],
      ];
      box.appendChild(el('div', { class: 'row wrap', style: { gap: '6px', marginTop: '10px' } },
        rows.map(([k, v]) => el('span', { class: 'badge', text: `${k}: ${v}` }))));

      // iOS는 storage.persist()가 없어 홈 화면 추가가 유일한 방어책이다
      if (S.isIOS() && !S.isStandalone()) {
        box.appendChild(el('div', { class: 'card', style: { background: 'var(--surface-2)', marginTop: '10px' } }, [
          el('div', { class: 'small', style: { fontWeight: 700, marginBottom: '4px' }, text: '홈 화면에 추가하세요' }),
          el('p', { class: 'tiny', style: { lineHeight: '1.7' }, text:
            '사파리 아래쪽 공유 버튼(□↑) → "홈 화면에 추가". ' +
            'iOS는 홈 화면에 추가하지 않은 사이트의 저장소를 7일 미방문 시 삭제합니다. ' +
            '추가하면 이 규칙에서 벗어나고 전체 화면으로도 열립니다.' }),
        ]));
      } else if (!persisted && !S.isIOS()) {
        box.appendChild(el('button', {
          class: 'btn sm block', style: { marginTop: '10px' },
          html: icon('key', 15) + '<span>영구 저장소 요청</span>',
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            const res = await PA.storage.requestPersist();
            toast(res.granted ? '영구 저장소가 허용됐습니다.' :
              '브라우저가 거부했습니다. 홈 화면에 추가하면 승인될 가능성이 높습니다.', res.granted ? '' : 'warn');
            openSettings();
          },
        }));
      }
    })();

    return host;
  }

  /* ---------------- 저장 드라이브 ---------------- */
  function driveSection() {
    const host = el('div');
    const render = () => {
      clear(host);
      const B = PA.backup;
      const p = B.provider();
      const connected = B.isConnected();
      const opts = B.options();

      host.appendChild(el('div', { class: 'section-title', style: { marginTop: 0 } }, [
        el('span', { text: '저장 드라이브' }), el('span', { class: 'rule' }),
      ]));

      if (!connected) {
        host.appendChild(el('p', { class: 'small muted', style: { marginBottom: '10px' }, text:
          '기록은 기본적으로 이 브라우저에만 남습니다. 드라이브를 연결하면 백업과 기기 간 이동이 됩니다.' }));

        PA.providers.list.forEach((prov) => {
          const usable = prov.available();
          const card = el('div', { class: 'card', style: { marginBottom: '8px', opacity: usable ? 1 : .55 } }, [
            el('div', { class: 'row' }, [
              el('span', { style: { fontWeight: 700 }, text: prov.label }),
              el('span', { class: 'spacer' }),
              el('button', {
                class: 'btn sm primary', text: '연결', disabled: !usable,
                onclick: () => connect(prov),
              }),
            ]),
            el('p', { class: 'tiny muted', style: { marginTop: '4px' }, text:
              usable ? prov.note : '폰·태블릿에서는 쓸 수 없습니다. 데스크톱 크롬·엣지에서만 동작합니다.' }),
          ]);
          host.appendChild(card);
        });
        return;
      }

      /* 연결됨 */
      const info = p.info();
      host.appendChild(el('div', { class: 'card', style: { borderLeft: '4px solid var(--ebony)' } }, [
        el('div', { class: 'row' }, [
          el('span', { style: { fontWeight: 700 }, text: p.label }),
          el('span', { class: 'badge done', text: '연결됨' }),
          el('span', { class: 'spacer' }),
          el('button', {
            class: 'btn sm ghost', text: '연결 해제',
            onclick: async () => {
              const ok = await PA.sheets.confirm({
                title: '연결 해제',
                message: '드라이브의 백업 파일은 지워지지 않습니다. 이 기기에서 연결만 끊습니다.',
                confirmLabel: '해제',
              });
              if (!ok) return;
              await p.disconnect();
              PA.backup.setProvider(null);
              render();
            },
          }),
        ]),
        info.account ? el('div', { class: 'tiny muted', style: { marginTop: '2px' }, text: info.account }) : null,
        el('div', { class: 'tiny faint', style: { marginTop: '4px' }, text: PA.backup.lastSyncLabel() + ' · 기기 이름: ' + PA.backup.deviceName() }),
      ]));

      const progress = el('div', { class: 'tiny muted', style: { minHeight: '16px', marginTop: '8px' } });

      const backupBtn = el('button', {
        class: 'btn primary', html: icon('upload', 16) + '<span>지금 백업</span>',
        onclick: async () => {
          try {
            const c = await PA.backup.checkConflict();
            if (c.kind === 'remote-newer') {
              const when = new Date(c.remote.savedAt).toLocaleString('ko-KR');
              const ok = await PA.sheets.confirm({
                title: '드라이브에 더 최신 백업이 있습니다',
                message: `${c.remote.deviceName || '다른 기기'}가 ${when}에 백업했습니다 (곡 ${c.remote.counts.songs}개). ` +
                         '지금 백업하면 그 기록이 이 기기 내용으로 덮어써집니다. 계속할까요?',
                danger: true, confirmLabel: '덮어쓰기',
              });
              if (!ok) return;
            }
            const r = await PA.backup.backup();
            toast(`백업 완료 — 녹음 ${r.uploaded}개 새로 올림`);
          } catch (e) { toast(e.message, 'warn'); }
          render();
        },
      });

      const restoreBtn = el('button', {
        class: 'btn', html: icon('download', 16) + '<span>복원</span>',
        onclick: async () => {
          try {
            const m = await PA.backup.preview();
            if (!m) { toast('드라이브에 백업이 없습니다.', 'warn'); return; }
            const when = new Date(m.savedAt).toLocaleString('ko-KR');
            const ok = await PA.sheets.confirm({
              title: '백업에서 복원',
              message: `${m.deviceName || '알 수 없는 기기'} · ${when}\n` +
                       `곡 ${m.counts.songs}개 · 레슨 ${m.counts.lessons}개 · 녹음 ${m.counts.recordings}개\n\n` +
                       '이 기기의 현재 기록은 백업 내용으로 대체됩니다. 되돌릴 수 없습니다.',
              danger: true, confirmLabel: '복원',
            });
            if (!ok) return;
            const r = await PA.backup.restore();
            toast(`복원 완료 — 녹음 ${r.restored}개 받음` + (r.missing ? `, ${r.missing}개 누락` : ''));
            PA.views.app.refresh();
          } catch (e) { toast(e.message, 'warn'); }
          render();
        },
      });

      host.appendChild(el('div', { class: 'row wrap', style: { gap: '8px', marginTop: '10px' } }, [backupBtn, restoreBtn]));
      host.appendChild(progress);

      const unsub = PA.backup.subscribe((st) => {
        progress.textContent = st.busy ? `${st.step}… ${Math.round(st.progress * 100)}%` : (st.error ? st.error : '');
        backupBtn.disabled = st.busy;
        restoreBtn.disabled = st.busy;
      });
      host.addEventListener('DOMNodeRemoved', unsub, { once: true });

      /* 옵션 */
      const mkCheck = (id, label, checked, note, onChange) => {
        const box = el('input', { type: 'checkbox', id, style: { width: '18px', height: '18px', accentColor: '#0D0D0D' } });
        box.checked = checked;
        box.addEventListener('change', () => onChange(box.checked));
        return el('div', { style: { marginTop: '10px' } }, [
          el('label', { for: id, class: 'row', style: { gap: '8px', cursor: 'pointer' } }, [
            box, el('span', { class: 'small', text: label }),
          ]),
          el('p', { class: 'tiny faint', text: note }),
        ]);
      };

      host.appendChild(mkCheck('bkAuto', '자동 백업', opts.auto,
        '기록이 바뀌고 90초쯤 조용해지면 알아서 올립니다. 자동 백업은 기록만 올리고 녹음 파일은 올리지 않습니다.',
        (v) => { PA.backup.setOptions({ auto: v }); toast(v ? '자동 백업을 켰습니다.' : '자동 백업을 껐습니다.'); }));

      host.appendChild(mkCheck('bkAudio', '녹음 파일까지 백업', opts.includeAudio,
        '끄면 별점·메모·레슨·음량 곡선만 올립니다. 녹음 원본은 용량이 커서 드라이브를 많이 씁니다.',
        (v) => { PA.backup.setOptions({ includeAudio: v }); render(); }));

      if (opts.includeAudio) {
        const scope = el('div', { class: 'pill-group', style: { marginTop: '6px' } });
        [['all', '전부'], ['key', '기준 + 구간별 최신만']].forEach(([id, label]) => {
          const chip = el('button', { class: 'chip' + (opts.audioScope === id ? ' on' : ''), text: label });
          chip.addEventListener('click', () => { PA.backup.setOptions({ audioScope: id }); render(); });
          scope.appendChild(chip);
        });
        host.appendChild(scope);
        host.appendChild(el('p', { class: 'tiny faint', text:
          opts.audioScope === 'key'
            ? '「기준」으로 표시한 녹음과 구간마다 가장 최근 것만 올립니다. 용량이 크게 줄고 A/B 비교에는 지장이 없습니다.'
            : '모든 녹음을 올립니다. 매일 녹음하면 용량이 빠르게 찹니다.' }));
      }

      host.appendChild(el('button', {
        class: 'btn sm ghost block', style: { marginTop: '10px' },
        html: icon('edit', 15) + '<span>이 기기 이름 바꾸기</span>',
        onclick: async () => {
          const v = await PA.sheets.prompt({
            title: '기기 이름', label: '백업에 기록되어 어느 기기에서 올렸는지 구분합니다.',
            value: PA.backup.deviceName(),
          });
          if (v) { PA.backup.setDeviceName(v); render(); }
        },
      }));
    };

    const connect = async (prov) => {
      try {
        if (prov.id === 'dropbox') {
          let appKey = (prov.info().appKey || '').trim();
          if (!appKey) {
            appKey = await PA.sheets.prompt({
              title: '드롭박스 앱 키',
              label: 'App key',
              hint: 'dropbox.com/developers → Create app → Scoped access → App folder 로 앱을 만들고, ' +
                    'Permissions에서 files.content.read / files.content.write 를 켠 뒤, ' +
                    'Redirect URI에 ' + PA.providers.dropbox.redirectUri() + ' 를 등록하세요. ' +
                    '앱 키는 비밀번호가 아니라 공개 식별자입니다.',
            });
            if (!appKey) return;
          }
          await prov.connect(appKey);   // 드롭박스로 이동 → 돌아오면 init()이 마무리
          return;
        }
        const name = await prov.connect();
        PA.backup.setProvider(prov.id);
        toast(`${name} 폴더에 연결했습니다.`);
        render();
      } catch (e) {
        if (e && e.name === 'AbortError') return;   // 사용자가 선택창을 닫음
        toast(e.message, 'warn');
      }
    };

    render();
    return host;
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
