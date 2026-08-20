/* ===== 백업 · 복원 =====
   저장 드라이브에 다음 구조로 쓴다.

     manifest.json            언제·어느 기기가 백업했는지, 녹음 목록
     state.json               곡·구간·별점·메모·레슨·연습기록·음량 곡선
     recordings/<key>.<ext>   녹음 원본 (선택)

   '실시간 동기화'가 아니라 '백업·복원'이다. 두 기기가 동시에 편집하는 상황을
   조용히 병합하면 어느 쪽 기록이 사라졌는지 아무도 모르게 된다. 그래서
   덮어쓰기 전에 항상 상대편 백업의 시각과 기기를 보여 주고 사람이 판단하게 한다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';
  const U = PA.util;

  const DEVICE_KEY = 'pianoapp.deviceId';
  const NAME_KEY = 'pianoapp.deviceName';
  const SYNC_KEY = 'pianoapp.lastSync';     // { at, provider, remoteSavedAt }
  const PROVIDER_KEY = 'pianoapp.provider';
  const OPTS_KEY = 'pianoapp.backupOpts';   // { auto, includeAudio }

  const MANIFEST = 'manifest.json';
  const STATE = 'state.json';
  const REC_DIR = 'recordings';

  const EXT = {
    'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3', 'audio/wav': 'wav',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  };
  const extOf = (mime) => EXT[(mime || '').split(';')[0]] || 'bin';

  /* ---------- 기기 식별 ----------
     상태(state) 안이 아니라 localStorage에 따로 둔다. 상태에 넣으면 복원한 순간
     두 기기가 같은 id를 갖게 되어 충돌 감지가 무력해진다. */
  function deviceId() {
    let v = null;
    try { v = localStorage.getItem(DEVICE_KEY); } catch (e) {}
    if (!v) {
      v = 'dev_' + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(DEVICE_KEY, v); } catch (e) {}
    }
    return v;
  }
  function deviceName() {
    let v = null;
    try { v = localStorage.getItem(NAME_KEY); } catch (e) {}
    return v || guessDeviceName();
  }
  function setDeviceName(name) {
    try { localStorage.setItem(NAME_KEY, (name || '').trim()); } catch (e) {}
  }
  function guessDeviceName() {
    const ua = navigator.userAgent;
    if (/iPad/.test(ua)) return '아이패드';
    if (/iPhone/.test(ua)) return '아이폰';
    if (/Android/.test(ua)) return '안드로이드';
    if (/Mac/.test(ua)) return '맥';
    if (/Windows/.test(ua)) return '윈도우 PC';
    return '이 기기';
  }

  const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  const lastSync = () => readJSON(SYNC_KEY, null);
  const options = () => Object.assign({ auto: false, includeAudio: true, audioScope: 'all' }, readJSON(OPTS_KEY, {}));
  const setOptions = (patch) => { writeJSON(OPTS_KEY, Object.assign(options(), patch)); emit(); };

  /* ---------- 현재 공급자 ---------- */
  function currentId() {
    try { return localStorage.getItem(PROVIDER_KEY) || null; } catch (e) { return null; }
  }
  function provider() {
    const id = currentId();
    return id ? (PA.providers[id] || null) : null;
  }
  function setProvider(id) {
    try {
      if (id) localStorage.setItem(PROVIDER_KEY, id);
      else localStorage.removeItem(PROVIDER_KEY);
    } catch (e) {}
    emit();
  }
  function isConnected() {
    const p = provider();
    return !!(p && p.isConnected());
  }

  /* ---------- 상태 통지 ---------- */
  const listeners = new Set();
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  let status = { busy: false, step: '', progress: 0, error: null };
  function emit(patch) {
    if (patch) status = Object.assign({}, status, patch);
    listeners.forEach((fn) => { try { fn(status); } catch (e) {} });
  }
  const getStatus = () => status;

  /* ---------- 원격 매니페스트 ---------- */
  async function readManifest() {
    const p = provider();
    if (!p) return null;
    const blob = await p.getFile(MANIFEST);
    if (!blob) return null;
    try { return JSON.parse(await blob.text()); } catch (e) { return null; }
  }

  /**
   * 덮어쓰기 전 충돌 점검.
   * 마지막으로 내가 동기화한 시점 이후에 '다른 기기'가 백업했다면 알려 준다.
   */
  async function checkConflict() {
    const remote = await readManifest();
    if (!remote) return { kind: 'none', remote: null };
    const mine = deviceId();
    const seen = lastSync();
    const newerThanMine = !seen || !seen.remoteSavedAt || remote.savedAt > seen.remoteSavedAt;
    if (remote.deviceId !== mine && newerThanMine) {
      return { kind: 'remote-newer', remote };
    }
    return { kind: 'none', remote };
  }

  /* ---------- 백업 ---------- */
  async function backup(opts) {
    opts = Object.assign({}, options(), opts || {});
    const p = provider();
    if (!p) throw new Error('저장 드라이브가 연결돼 있지 않습니다.');
    if (status.busy) throw new Error('이미 작업 중입니다.');

    emit({ busy: true, step: '기록을 모으는 중', progress: 0, error: null });
    try {
      const stateText = PA.store.exportJSON();   // API 키는 여기 포함되지 않는다
      const songs = PA.store.songs();

      // 어떤 녹음을 올릴지 — 상태가 참조하는 blob만 대상으로 한다.
      //
      // 폰에서 매일 녹음하면 용량이 금방 찬다. 그런데 모든 녹음이 남길 가치가
      // 같은 것은 아니다. '기준'으로 표시한 녹음과 구간별 최신 것만 남겨도
      // 비교의 목적은 달성되고 용량은 크게 줄어든다.
      const wanted = [];
      songs.forEach((s) => {
        let list = (s.recordings || []).filter((r) => r.blobKey);
        if (opts.audioScope === 'key') {
          const latestPerSection = new Map();
          list.forEach((r) => {
            const k = r.sectionId || '-';
            const prev = latestPerSection.get(k);
            if (!prev || (r.at || 0) > (prev.at || 0)) latestPerSection.set(k, r);
          });
          const keep = new Set(list.filter((r) => r.isReference).map((r) => r.id));
          latestPerSection.forEach((r) => keep.add(r.id));
          list = list.filter((r) => keep.has(r.id));
        }
        list.forEach((r) => wanted.push({ key: r.blobKey, mime: r.mime, songId: s.id, id: r.id }));
      });

      let remoteRecs = [];
      if (opts.includeAudio) {
        emit({ step: '드라이브 상태 확인 중', progress: 0.05 });
        try { remoteRecs = await p.listFiles(REC_DIR); } catch (e) { remoteRecs = []; }
      }
      const remoteSet = new Set(remoteRecs.map((f) => f.path));

      const entries = [];
      let uploaded = 0;
      const todo = opts.includeAudio
        ? wanted.filter((w) => !remoteSet.has(`${REC_DIR}/${w.key}.${extOf(w.mime)}`))
        : [];

      // 녹음 업로드 (이미 올라간 것은 건너뛴다 — 매번 전부 올리면 느리고 비싸다)
      for (let i = 0; i < todo.length; i++) {
        const w = todo[i];
        emit({ step: `녹음 올리는 중 ${i + 1}/${todo.length}`, progress: 0.1 + 0.75 * (i / Math.max(1, todo.length)) });
        const blob = await PA.store.getBlob(w.key);
        if (!blob) continue;
        const path = `${REC_DIR}/${w.key}.${extOf(w.mime)}`;
        await p.putFile(path, blob);
        uploaded++;
      }
      if (opts.includeAudio) {
        wanted.forEach((w) => entries.push({ key: w.key, path: `${REC_DIR}/${w.key}.${extOf(w.mime)}`, mime: w.mime }));
      }

      emit({ step: '기록 저장 중', progress: 0.9 });
      await p.putFile(STATE, new Blob([stateText], { type: 'application/json' }));

      // 사람이 읽는 리포트도 함께 쓴다. 몇 년 뒤 앱 없이 폴더만 열어도
      // 무슨 일이 있었는지 알 수 있어야 아카이빙이다.
      if (opts.reports !== false && PA.report) {
        emit({ step: '리포트 만드는 중', progress: 0.95 });
        for (const f of PA.report.files()) {
          try { await p.putFile(f.path, f.blob); } catch (e) { /* 리포트 실패가 백업을 막지는 않는다 */ }
        }
      }

      const manifest = {
        format: 'pianoapp-backup',
        version: 1,
        app: PA.VERSION,
        deviceId: deviceId(),
        deviceName: deviceName(),
        savedAt: new Date().toISOString(),
        includesAudio: !!opts.includeAudio,
        counts: {
          songs: songs.length,
          recordings: entries.length,
          lessons: songs.reduce((a, s) => a + (s.lessons || []).length, 0),
        },
        recordings: entries,
      };
      await p.putFile(MANIFEST, new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));

      writeJSON(SYNC_KEY, { at: new Date().toISOString(), provider: p.id, remoteSavedAt: manifest.savedAt });
      emit({ busy: false, step: '', progress: 1, error: null });
      return { uploaded, manifest };
    } catch (e) {
      emit({ busy: false, step: '', progress: 0, error: e.message });
      throw e;
    }
  }

  /* ---------- 복원 ---------- */
  /** 미리보기: 무엇이 들어 있는지 보여 주고 사람이 결정하게 한다. */
  async function preview() {
    const p = provider();
    if (!p) throw new Error('저장 드라이브가 연결돼 있지 않습니다.');
    const manifest = await readManifest();
    if (!manifest) return null;
    if (manifest.format !== 'pianoapp-backup') throw new Error('이 폴더의 백업 형식을 알 수 없습니다.');
    return manifest;
  }

  async function restore(opts) {
    opts = Object.assign({ audio: true }, opts || {});
    const p = provider();
    if (!p) throw new Error('저장 드라이브가 연결돼 있지 않습니다.');
    if (status.busy) throw new Error('이미 작업 중입니다.');

    emit({ busy: true, step: '백업을 읽는 중', progress: 0.05, error: null });
    try {
      const manifest = await readManifest();
      if (!manifest) throw new Error('백업을 찾을 수 없습니다.');

      const stateBlob = await p.getFile(STATE);
      if (!stateBlob) throw new Error('state.json이 없습니다. 백업이 손상됐을 수 있습니다.');
      const text = await stateBlob.text();

      // 상태를 먼저 바꾼다. 여기서 실패하면 녹음은 건드리지 않는다.
      emit({ step: '기록 복원 중', progress: 0.2 });
      PA.store.importJSON(text);

      let restored = 0, missing = 0;
      if (opts.audio && (manifest.recordings || []).length) {
        const have = new Set(await PA.store.listBlobKeys());
        const need = manifest.recordings.filter((r) => !have.has(r.key));
        for (let i = 0; i < need.length; i++) {
          const r = need[i];
          emit({ step: `녹음 내려받는 중 ${i + 1}/${need.length}`, progress: 0.25 + 0.7 * (i / Math.max(1, need.length)) });
          try {
            const blob = await p.getFile(r.path);
            if (blob) { await PA.store.putBlob(r.key, blob); restored++; }
            else missing++;
          } catch (e) { missing++; }
        }
      }

      writeJSON(SYNC_KEY, { at: new Date().toISOString(), provider: p.id, remoteSavedAt: manifest.savedAt });
      emit({ busy: false, step: '', progress: 1, error: null });
      return { manifest, restored, missing };
    } catch (e) {
      emit({ busy: false, step: '', progress: 0, error: e.message });
      throw e;
    }
  }

  /* ---------- 자동 백업 ----------
     기록이 바뀔 때마다 올리면 요청이 폭주한다. 조용해진 뒤 한 번만 올린다.
     자동 백업은 상태만 올린다 — 녹음은 크고, 자동으로 올리다 실패하면
     사용자가 눈치채기 어렵다. */
  const AUTO_DELAY = 90 * 1000;
  let autoTimer = null;

  function scheduleAuto() {
    if (!options().auto || !isConnected() || status.busy) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(async () => {
      if (!options().auto || !isConnected() || status.busy) return;
      try {
        const c = await checkConflict();
        if (c.kind === 'remote-newer') {
          U.toast('다른 기기의 백업이 더 최신이라 자동 백업을 멈췄습니다. 설정에서 확인해 주세요.', 'warn');
          setOptions({ auto: false });
          return;
        }
        await backup({ includeAudio: false });
      } catch (e) {
        U.toast('자동 백업 실패: ' + e.message, 'warn');
      }
    }, AUTO_DELAY);
  }

  /* ---------- 시작 시 복구 ---------- */
  async function init() {
    deviceId();
    // 드롭박스 리디렉트로 돌아온 경우
    if (/[?&]code=/.test(location.search)) {
      try {
        const ok = await PA.providers.dropbox.finishAuth();
        if (ok) {
          setProvider('dropbox');
          U.toast('드롭박스에 연결됐습니다.');
        }
      } catch (e) {
        U.toast(e.message, 'warn');
      }
    }
    // 로컬 폴더 권한 되살리기
    if (currentId() === 'folder') {
      try { await PA.providers.folder.restore(); } catch (e) {}
    }
    PA.store.subscribe(() => scheduleAuto());
    emit();
  }

  /** 사람이 읽는 마지막 백업 시각 */
  function lastSyncLabel() {
    const s = lastSync();
    if (!s || !s.at) return '아직 백업한 적 없음';
    const d = new Date(s.at);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return '방금 백업함';
    if (mins < 60) return `${mins}분 전 백업`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}시간 전 백업`;
    return `${U.fmtDate(U.dateKey(d))} 백업`;
  }

  PA.backup = {
    init, backup, restore, preview, checkConflict, readManifest,
    provider, setProvider, currentId, isConnected,
    options, setOptions, subscribe, getStatus,
    deviceId, deviceName, setDeviceName, lastSync, lastSyncLabel,
    scheduleAuto, extOf,
  };
})(window.PA);
