/* ===== 상태 저장소 =====
   - 상태(JSON)는 localStorage, 녹음 파일(Blob)은 IndexedDB에 보관.
   - 곡(song)마다 구간·녹음·레슨·추이·롤모델이 독립적으로 귀속된다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';
  const { uid, todayKey, clamp } = PA.util;

  const LS_KEY = 'pianoapp.v6.state';
  const KEY_STORE = 'pianoapp.apiKey';
  const DB_NAME = 'pianoapp-media';
  const DB_STORE = 'blobs';
  const SCHEMA = 6;

  /* ---------- API 키 보관소 ----------
     키는 상태 JSON 바깥에 따로 둔다. 이유가 둘 있다.
      1) 내보내기(JSON)에 키가 섞여 파일로 새어 나가는 것을 막는다.
      2) 공개 URL에서는 "탭을 닫으면 사라지는" 세션 저장이 기본이어야 한다.
     '이 기기에 기억'을 켠 경우에만 localStorage로 옮긴다. */
  const keystore = {
    get() {
      try {
        return (localStorage.getItem(KEY_STORE) || sessionStorage.getItem(KEY_STORE) || '').trim();
      } catch (e) { return ''; }
    },
    set(value, remember) {
      const v = (value || '').trim();
      try {
        sessionStorage.removeItem(KEY_STORE);
        localStorage.removeItem(KEY_STORE);
        if (!v) return;
        (remember ? localStorage : sessionStorage).setItem(KEY_STORE, v);
      } catch (e) { /* 저장 불가(시크릿 모드 등)여도 앱은 계속 돈다 */ }
    },
    clear() {
      try { sessionStorage.removeItem(KEY_STORE); localStorage.removeItem(KEY_STORE); } catch (e) {}
    },
    /** 이 키가 이 기기에 영구 저장돼 있는가 */
    isRemembered() {
      try { return !!localStorage.getItem(KEY_STORE); } catch (e) { return false; }
    },
  };

  /* ---------- 표현 5차원 ---------- */
  const DIMENSIONS = [
    { id: 'dynamics', label: '다이내믹', color: 'var(--dim-dynamics)', hint: '셈여림의 폭과 방향. 크레셴도가 계단이 아니라 곡선인가.' },
    { id: 'legato', label: '레가토', color: 'var(--dim-legato)', hint: '음과 음 사이의 이음. 손가락으로 잇는가, 페달로 덮는가.' },
    { id: 'phrasing', label: '프레이징', color: 'var(--dim-phrasing)', hint: '악구의 시작·정점·끝. 어디서 숨을 쉬는가.' },
    { id: 'pedal', label: '페달링', color: 'var(--dim-pedal)', hint: '밟는 깊이와 바꾸는 시점. 화성이 흐려지지 않는가.' },
    { id: 'tone', label: '음색·터치', color: 'var(--dim-tone)', hint: '건반에 닿는 방식. 같은 f라도 어떤 소리인가.' },
  ];
  const DIM_MAP = Object.fromEntries(DIMENSIONS.map((d) => [d.id, d]));

  /* ---------- IndexedDB (녹음 Blob) ---------- */
  let dbPromise = null;
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(DB_STORE)) d.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function putBlob(key, blob) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(blob, key);
      tx.oncomplete = () => res(key);
      tx.onerror = () => rej(tx.error);
    });
  }
  async function getBlob(key) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction(DB_STORE, 'readonly');
      const r = tx.objectStore(DB_STORE).get(key);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  }
  async function delBlob(key) {
    const d = await db();
    return new Promise((res) => {
      const tx = d.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(key);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  }
  /** 저장된 녹음 blob 키 전체 — 백업이 무엇을 올려야 하는지 알기 위해 필요하다. */
  async function listBlobKeys() {
    const d = await db();
    return new Promise((res) => {
      const tx = d.transaction(DB_STORE, 'readonly');
      const r = tx.objectStore(DB_STORE).getAllKeys();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => res([]);
    });
  }

  /* ---------- 상태 ---------- */
  let state = null;
  const listeners = new Set();

  function defaults() {
    return {
      schema: SCHEMA,
      activeSongId: null,
      settings: {
        // apiKey는 여기 두지 않는다 — keystore 참고
        rememberKey: false,
        model: 'claude-opus-5',
        aiEnabled: false,
        metronomeSound: 'wood',
        practiceGoalMin: 60,
        // AI 코치에게 "누구를 가르치는지" 알려 주는 한 줄. 이 기기에만 저장된다.
        learnerProfile: '피아노를 전공하는 중학생',
      },
      songs: [],
    };
  }

  function load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { raw = null; }
    if (!raw || !raw.songs) {
      state = defaults();
      PA.seed.install(state);
    } else {
      state = migrate(raw);
    }
    if (!state.activeSongId && state.songs.length) state.activeSongId = state.songs[0].id;
    return state;
  }

  function migrate(raw) {
    const s = Object.assign(defaults(), raw);
    s.settings = Object.assign(defaults().settings, raw.settings || {});

    // 예전 버전은 키를 상태 안에 저장했다. 밖으로 옮기고 상태에서는 지운다.
    if (s.settings.apiKey) {
      keystore.set(s.settings.apiKey, true);   // 이미 기기에 있던 키이므로 기억 유지
      s.settings.rememberKey = true;
    }
    delete s.settings.apiKey;

    s.songs = (raw.songs || []).map((song) =>
      Object.assign(
        {
          id: uid('song'), title: '', composer: '', work: '', keySig: '',
          tempoTarget: 120, tempoCurrent: 60, glyph: '♪',
          sections: [], ratings: {}, recordings: [], lessons: [],
          practiceLog: [], roleModels: [], snapshots: [], createdAt: todayKey(),
        },
        song
      )
    );
    s.schema = SCHEMA;
    return s;
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(state));
      } catch (e) {
        PA.util.toast('저장 공간이 부족합니다. 오래된 녹음을 지워 주세요.', 'warn');
      }
    }, 120);
  }

  function emit(reason) {
    save();
    listeners.forEach((fn) => {
      try { fn(state, reason); } catch (e) { console.error(e); }
    });
  }

  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  /* ---------- 접근자 ---------- */
  const get = () => state;
  const songs = () => state.songs;
  const activeSong = () => state.songs.find((s) => s.id === state.activeSongId) || state.songs[0] || null;
  const songById = (id) => state.songs.find((s) => s.id === id) || null;

  function setActiveSong(id) {
    if (!songById(id)) return;
    state.activeSongId = id;
    emit('song');
  }

  /* ---------- 곡 ---------- */
  function addSong(data) {
    const song = Object.assign(
      {
        id: uid('song'), title: '새 곡', composer: '', work: '', keySig: '',
        tempoTarget: 120, tempoCurrent: 60, glyph: '♪',
        sections: [], ratings: {}, recordings: [], lessons: [],
        practiceLog: [], roleModels: [], snapshots: [], createdAt: todayKey(),
      },
      data || {}
    );
    state.songs.push(song);
    state.activeSongId = song.id;
    emit('song');
    return song;
  }

  function updateSong(id, patch) {
    const s = songById(id);
    if (!s) return null;
    Object.assign(s, patch);
    emit('song');
    return s;
  }

  async function removeSong(id) {
    const s = songById(id);
    if (!s) return;
    for (const r of s.recordings) if (r.blobKey) await delBlob(r.blobKey);
    state.songs = state.songs.filter((x) => x.id !== id);
    if (state.activeSongId === id) state.activeSongId = state.songs[0] ? state.songs[0].id : null;
    emit('song');
  }

  /* ---------- 구간 ---------- */
  function addSection(songId, data) {
    const s = songById(songId);
    if (!s) return null;
    const sec = Object.assign(
      { id: uid('sec'), name: '새 구간', bars: '', character: '', focus: 'dynamics', targetTempo: s.tempoTarget },
      data || {}
    );
    s.sections.push(sec);
    emit('section');
    return sec;
  }
  function updateSection(songId, secId, patch) {
    const s = songById(songId);
    const sec = s && s.sections.find((x) => x.id === secId);
    if (!sec) return;
    Object.assign(sec, patch);
    emit('section');
  }
  function removeSection(songId, secId) {
    const s = songById(songId);
    if (!s) return;
    s.sections = s.sections.filter((x) => x.id !== secId);
    delete s.ratings[secId];
    emit('section');
  }

  /* ---------- 평가(별점·메모) ---------- */
  function rating(songId, secId) {
    const s = songById(songId);
    if (!s) return null;
    if (!s.ratings[secId]) {
      s.ratings[secId] = { dynamics: 0, legato: 0, phrasing: 0, pedal: 0, tone: 0, memo: '', updatedAt: null, history: [] };
    }
    const r = s.ratings[secId];
    if (!r.history) r.history = [];
    return r;
  }

  function setRating(songId, secId, dim, value) {
    const r = rating(songId, secId);
    if (!r) return;
    r[dim] = clamp(value, 0, 5);
    r.updatedAt = todayKey();
    const today = r.history.find((h) => h.date === todayKey());
    const snap = { dynamics: r.dynamics, legato: r.legato, phrasing: r.phrasing, pedal: r.pedal, tone: r.tone };
    if (today) Object.assign(today, snap);
    else r.history.push(Object.assign({ date: todayKey() }, snap));
    if (r.history.length > 120) r.history = r.history.slice(-120);
    emit('rating');
  }

  function setMemo(songId, secId, memo) {
    const r = rating(songId, secId);
    if (!r) return;
    r.memo = memo;
    r.updatedAt = todayKey();
    emit('memo');
  }

  /* ---------- 녹음 ---------- */
  async function addRecording(songId, rec, blob) {
    const s = songById(songId);
    if (!s) return null;
    const entry = Object.assign(
      {
        id: uid('rec'), sectionId: null, label: '', createdAt: todayKey(), at: Date.now(),
        duration: 0, envelope: [], peak: 0, rms: 0, kind: 'audio', source: 'mic',
        mime: 'audio/webm', blobKey: null, isReference: false, tempo: null, note: '',
      },
      rec || {}
    );
    if (blob) {
      entry.blobKey = uid('blob');
      entry.mime = blob.type || entry.mime;
      await putBlob(entry.blobKey, blob);
    }
    s.recordings.unshift(entry);
    emit('recording');
    return entry;
  }
  function updateRecording(songId, recId, patch) {
    const s = songById(songId);
    const r = s && s.recordings.find((x) => x.id === recId);
    if (!r) return;
    Object.assign(r, patch);
    emit('recording');
  }
  async function removeRecording(songId, recId) {
    const s = songById(songId);
    if (!s) return;
    const r = s.recordings.find((x) => x.id === recId);
    if (r && r.blobKey) await delBlob(r.blobKey);
    s.recordings = s.recordings.filter((x) => x.id !== recId);
    emit('recording');
  }
  const recordingsFor = (song, secId) =>
    (song.recordings || []).filter((r) => (secId ? r.sectionId === secId : true));

  /* ---------- 레슨 ---------- */
  function addLesson(songId, data) {
    const s = songById(songId);
    if (!s) return null;
    const lesson = Object.assign(
      {
        id: uid('lesson'), date: todayKey(), teacher: '', transcript: '',
        analysis: null, analyzedAt: null, analyzedBy: null,
      },
      data || {}
    );
    s.lessons.unshift(lesson);
    emit('lesson');
    return lesson;
  }
  function updateLesson(songId, lessonId, patch) {
    const s = songById(songId);
    const l = s && s.lessons.find((x) => x.id === lessonId);
    if (!l) return;
    Object.assign(l, patch);
    emit('lesson');
  }
  function removeLesson(songId, lessonId) {
    const s = songById(songId);
    if (!s) return;
    s.lessons = s.lessons.filter((x) => x.id !== lessonId);
    emit('lesson');
  }

  /** 모든 레슨의 지적사항을 평평하게 편다. */
  function allIssues(song) {
    const out = [];
    (song.lessons || []).forEach((l) => {
      const issues = (l.analysis && l.analysis.issues) || [];
      issues.forEach((it, i) => out.push(Object.assign({ lessonId: l.id, lessonDate: l.date, index: i }, it)));
    });
    return out;
  }

  function toggleIssue(songId, lessonId, index) {
    const s = songById(songId);
    const l = s && s.lessons.find((x) => x.id === lessonId);
    const it = l && l.analysis && l.analysis.issues && l.analysis.issues[index];
    if (!it) return;
    it.resolved = !it.resolved;
    it.resolvedAt = it.resolved ? todayKey() : null;
    emit('issue');
  }

  function toggleTask(songId, lessonId, dayIndex, taskIndex) {
    const s = songById(songId);
    const l = s && s.lessons.find((x) => x.id === lessonId);
    const day = l && l.analysis && l.analysis.schedule && l.analysis.schedule[dayIndex];
    const task = day && day.tasks && day.tasks[taskIndex];
    if (!task) return;
    task.done = !task.done;
    emit('task');
  }

  /* ---------- 연습 기록 ---------- */
  function logPractice(songId, entry) {
    const s = songById(songId);
    if (!s) return;
    s.practiceLog.push(
      Object.assign({ id: uid('log'), date: todayKey(), seconds: 0, sectionId: null, tempo: null, note: '' }, entry || {})
    );
    if (s.practiceLog.length > 2000) s.practiceLog = s.practiceLog.slice(-2000);
    emit('practice');
  }

  function practiceByDay(song, days) {
    const out = [];
    const end = todayKey();
    for (let i = days - 1; i >= 0; i--) {
      const k = PA.util.addDays(end, -i);
      const secs = (song.practiceLog || []).filter((l) => l.date === k).reduce((a, b) => a + (b.seconds || 0), 0);
      out.push({ date: k, seconds: secs });
    }
    return out;
  }

  function totalPractice(song) {
    return (song.practiceLog || []).reduce((a, b) => a + (b.seconds || 0), 0);
  }

  /* ---------- 롤모델 ---------- */
  function addRoleModel(songId, data) {
    const s = songById(songId);
    if (!s) return null;
    const rm = Object.assign(
      {
        id: uid('rm'), performer: '', year: '', url: '', videoId: null, source: 'youtube',
        note: '', isPrimary: false, addedAt: todayKey(),
        interpretation: { tempo: '', dynamics: '', pedal: '', character: '' },
        compare: '',
      },
      data || {}
    );
    if (!s.roleModels.length) rm.isPrimary = true;
    s.roleModels.push(rm);
    emit('rolemodel');
    return rm;
  }
  function updateRoleModel(songId, rmId, patch) {
    const s = songById(songId);
    const rm = s && s.roleModels.find((x) => x.id === rmId);
    if (!rm) return;
    Object.assign(rm, patch);
    emit('rolemodel');
  }
  function setPrimaryRoleModel(songId, rmId) {
    const s = songById(songId);
    if (!s) return;
    s.roleModels.forEach((rm) => { rm.isPrimary = rm.id === rmId; });
    emit('rolemodel');
  }
  function removeRoleModel(songId, rmId) {
    const s = songById(songId);
    if (!s) return;
    s.roleModels = s.roleModels.filter((x) => x.id !== rmId);
    if (s.roleModels.length && !s.roleModels.some((r) => r.isPrimary)) s.roleModels[0].isPrimary = true;
    emit('rolemodel');
  }

  /* ---------- 설정 ---------- */
  function setSettings(patch) {
    // 키가 실수로 상태에 섞여 들어오면 보관소로 돌려보낸다
    if (Object.prototype.hasOwnProperty.call(patch, 'apiKey')) {
      setApiKey(patch.apiKey, state.settings.rememberKey);
      patch = Object.assign({}, patch);
      delete patch.apiKey;
    }
    Object.assign(state.settings, patch);
    emit('settings');
  }

  const getApiKey = () => keystore.get();

  function setApiKey(value, remember) {
    const keep = remember === undefined ? state.settings.rememberKey : !!remember;
    keystore.set(value, keep);
    state.settings.rememberKey = keep && !!(value || '').trim();
    emit('settings');
  }

  /** 저장 위치만 바꾼다(키 값은 유지). */
  function setRememberKey(remember) {
    const current = keystore.get();
    keystore.set(current, !!remember);
    state.settings.rememberKey = !!remember && !!current;
    emit('settings');
  }

  function clearApiKey() {
    keystore.clear();
    state.settings.rememberKey = false;
    emit('settings');
  }

  /* ---------- 스냅샷(추이 그래프용) ---------- */
  function pushSnapshot(songId, snap) {
    const s = songById(songId);
    if (!s) return;
    const today = s.snapshots.find((x) => x.date === todayKey());
    if (today) Object.assign(today, snap);
    else s.snapshots.push(Object.assign({ date: todayKey() }, snap));
    if (s.snapshots.length > 400) s.snapshots = s.snapshots.slice(-400);
    save();
  }

  /* ---------- 내보내기 / 가져오기 ---------- */
  /** 키는 상태 밖에 있으므로 내보낸 파일에는 절대 담기지 않는다. */
  function exportJSON() {
    const copy = JSON.parse(JSON.stringify(state));
    if (copy.settings) delete copy.settings.apiKey;   // 혹시 모를 잔여물 제거
    return JSON.stringify(copy, null, 2);
  }
  function importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.songs)) throw new Error('형식이 올바르지 않습니다.');
    state = migrate(parsed);
    if (!state.activeSongId && state.songs.length) state.activeSongId = state.songs[0].id;
    emit('import');
  }

  PA.store = {
    DIMENSIONS, DIM_MAP,
    load, get, subscribe, emit, save,
    songs, activeSong, songById, setActiveSong,
    addSong, updateSong, removeSong,
    addSection, updateSection, removeSection,
    rating, setRating, setMemo,
    addRecording, updateRecording, removeRecording, recordingsFor,
    addLesson, updateLesson, removeLesson, allIssues, toggleIssue, toggleTask,
    logPractice, practiceByDay, totalPractice,
    addRoleModel, updateRoleModel, setPrimaryRoleModel, removeRoleModel,
    setSettings, pushSnapshot, exportJSON, importJSON,
    getApiKey, setApiKey, setRememberKey, clearApiKey, keyIsRemembered: keystore.isRemembered,
    getBlob, putBlob, delBlob, listBlobKeys,
  };
})(window.PA);
