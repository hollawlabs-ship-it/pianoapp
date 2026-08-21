/* ===== 레슨 장시간 녹음 =====
   연습 녹음(js/audio/recorder.js)과는 요구가 다르다.

   연습 녹음은 30초~2분이고, 실패하면 다시 치면 된다.
   레슨은 40~60분이고 다시 찍을 수 없다. 그래서 설계 기준이 다르다.

   iOS Safari는 화면이 꺼지거나 다른 앱으로 넘어가면 녹음을 멈춘다.
   레슨 중에 전화가 오거나 아이가 화면을 끄면 그걸로 끝이다.
   그래서 메모리에 쌓아두고 마지막에 한 번에 저장하지 않는다.
   조각이 나올 때마다 즉시 IndexedDB에 쓴다. 중간에 끊겨도
   끊긴 시점까지는 남고, 다음에 앱을 열 때 복구할 수 있다.

   여기서는 음량 곡선을 뽑지 않는다. 레슨 오디오는 표현 분석 대상이 아니라
   전사(클로바노트)에 넘길 원본이다. 분석은 전사 텍스트로 한다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';

  /* 진행 중인 세션을 가리키는 표식. 상태(state)가 아니라 localStorage에 둔다.
     상태는 내보내기·백업에 실려 기기 사이를 오가는데, 이건 이 기기에서
     녹음이 끊겼는지를 말하는 값이라 따라다니면 안 된다. */
  const SESSION_KEY = 'pianoapp.lessonRecSession';

  /* 조각 하나의 길이. 짧을수록 손실이 적지만 IndexedDB 쓰기가 잦아진다.
     5초면 최악의 경우 5초만 잃고, 한 시간 녹음에 720번 쓴다. */
  const SLICE_MS = 5000;

  /* 레슨은 말소리다. 연습 녹음과 달리 다이내믹을 보존할 이유가 없고,
     한 시간을 담아야 하므로 용량을 우선한다. 다만 자동이득은 켜둔다 —
     선생님이 멀리서 말할 때 알아듣는 편이 중요하다. */
  const CONSTRAINTS = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  };

  const BITRATE = 64000;   // 말소리 기준. 한 시간에 약 29MB.

  function pickMime() {
    /* iOS Safari는 audio/mp4만 낸다. 안드로이드 크롬은 webm/opus를 낸다.
       클로바노트가 둘 다 받으므로 브라우저가 주는 것을 그대로 쓴다. */
    const list = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    for (const m of list) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  const chunkKey = (sid, i) => `lessonchunk.${sid}.${i}`;

  const readSession = () => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (e) { return null; }
  };
  const writeSession = (s) => {
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* 용량이 꽉 찼어도 녹음 자체는 계속되어야 한다 */ }
  };

  /** 흩어진 조각을 순서대로 모아 한 덩어리로 만든다. */
  async function assemble(session) {
    const parts = [];
    for (let i = 0; i < session.chunks; i++) {
      const b = await PA.store.getBlob(chunkKey(session.id, i));
      if (b) parts.push(b);
    }
    if (!parts.length) return null;
    return new Blob(parts, { type: session.mime || 'audio/mp4' });
  }

  /** 조각들을 지운다. 합쳐서 저장한 뒤, 또는 버릴 때 부른다. */
  async function discardChunks(session) {
    for (let i = 0; i < session.chunks; i++) {
      try { await PA.store.delBlob(chunkKey(session.id, i)); } catch (e) {}
    }
  }

  /* ---- 복구 ---------------------------------------------------------- */

  /** 끊긴 채 남아 있는 녹음이 있으면 그 정보를 준다. 없으면 null. */
  function pending() {
    const s = readSession();
    if (!s || s.done || !s.chunks) return null;
    return {
      id: s.id, songId: s.songId, lessonId: s.lessonId || null,
      startedAt: s.startedAt, chunks: s.chunks,
      seconds: Math.round((s.chunks * SLICE_MS) / 1000),
      mime: s.mime,
    };
  }

  /** 끊긴 녹음을 한 덩어리로 만들어 돌려준다. 조각은 정리한다. */
  async function recover() {
    const s = readSession();
    if (!s || !s.chunks) return null;
    const blob = await assemble(s);
    await discardChunks(s);
    writeSession(null);
    if (!blob) return null;
    return { blob, duration: (s.chunks * SLICE_MS) / 1000, mime: s.mime, songId: s.songId, lessonId: s.lessonId || null };
  }

  /** 끊긴 녹음을 버린다. */
  async function dropPending() {
    const s = readSession();
    if (s) await discardChunks(s);
    writeSession(null);
  }

  /* ---- 녹음 ---------------------------------------------------------- */

  function create() {
    let stream = null, rec = null, session = null;
    let startAt = 0, tickId = null, interrupted = false;
    let analyser = null, srcNode = null, rafId = null;
    const handlers = { tick: null, level: null, interrupt: null };

    /* 화면이 꺼지면 iOS는 녹음을 멈춘다. Wake Lock이 최선이지만
       사용자가 전원 버튼을 직접 누르면 소용없다. 그래서 숨김 전환을
       감지해 알리고, 이미 저장된 조각으로 손실을 최소화한다. */
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && rec && rec.state === 'recording') {
        interrupted = true;
        if (handlers.interrupt) handlers.interrupt();
      }
    };

    async function start(songId, lessonId) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('이 브라우저는 마이크 녹음을 지원하지 않습니다.');
      }
      /* 시작 전에 앞선 세션이 남아 있으면 정리한다. 복구를 제안하는 건
         앱을 열 때이고, 여기까지 왔다는 건 새로 찍겠다는 뜻이다. */
      const old = readSession();
      if (old && !old.done) await discardChunks(old);

      stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
      const mime = pickMime();

      session = {
        id: 'ls' + Date.now().toString(36),
        songId, lessonId: lessonId || null,
        startedAt: Date.now(), chunks: 0, mime, done: false,
      };
      writeSession(session);

      rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: BITRATE } : undefined);

      /* 핵심: 조각이 나오는 즉시 디스크로 보낸다. 메모리에 쌓지 않는다. */
      rec.ondataavailable = async (e) => {
        if (!e.data || !e.data.size || !session) return;
        const i = session.chunks;
        try {
          await PA.store.putBlob(chunkKey(session.id, i), e.data);
          session.chunks = i + 1;
          writeSession(session);
        } catch (err) {
          /* 저장에 실패하면 그 조각은 잃지만 녹음은 계속한다.
             남은 조각이라도 건지는 편이 낫다. */
        }
      };

      rec.start(SLICE_MS);
      startAt = Date.now();
      interrupted = false;
      document.addEventListener('visibilitychange', onHidden);

      /* 레벨 표시는 있으면 안심이 되지만 한 시간짜리 rAF는 배터리를 먹는다.
         화면이 보일 때만 돌린다. */
      try {
        const ctx = PA.envelope.audioCtx();
        srcNode = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        srcNode.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const loop = () => {
          if (document.visibilityState === 'visible' && handlers.level) {
            analyser.getFloatTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
            handlers.level(Math.sqrt(sum / buf.length));
          }
          rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
      } catch (e) { /* 레벨 표시는 없어도 그만 */ }

      tickId = setInterval(() => {
        if (handlers.tick) handlers.tick((Date.now() - startAt) / 1000, interrupted);
      }, 500);

      if (PA.storage && PA.storage.keepAwake) { try { await PA.storage.keepAwake(); } catch (e) {} }
      return session.id;
    }

    /** 녹음을 끝내고 조각을 합쳐 돌려준다. */
    function stop() {
      return new Promise((resolve) => {
        if (!rec || rec.state === 'inactive') { teardown(); resolve(null); return; }
        rec.onstop = async () => {
          /* 마지막 ondataavailable이 비동기라 먼저 끝나도록 한 틱 넘긴다. */
          await new Promise((r) => setTimeout(r, 0));
          const s = session;
          const blob = s ? await assemble(s) : null;
          const duration = (Date.now() - startAt) / 1000;
          if (s) {
            await discardChunks(s);
            writeSession(null);
          }
          teardown();
          resolve(blob ? { blob, duration, mime: (s && s.mime) || blob.type } : null);
        };
        try { rec.requestData(); } catch (e) {}
        rec.stop();
      });
    }

    /** 녹음을 버린다. */
    async function cancel() {
      const s = session;
      try { rec && rec.state !== 'inactive' && rec.stop(); } catch (e) {}
      teardown();
      if (s) { await discardChunks(s); writeSession(null); }
    }

    function teardown() {
      clearInterval(tickId);
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onHidden);
      try { srcNode && srcNode.disconnect(); } catch (e) {}
      try { analyser && analyser.disconnect(); } catch (e) {}
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (PA.storage && PA.storage.releaseAwake) { try { PA.storage.releaseAwake(); } catch (e) {} }
      stream = null; rec = null; analyser = null; srcNode = null; session = null;
    }

    return {
      start, stop, cancel,
      onTick(fn) { handlers.tick = fn; },
      onLevel(fn) { handlers.level = fn; },
      onInterrupt(fn) { handlers.interrupt = fn; },
      get state() { return rec ? rec.state : 'inactive'; },
      get wasInterrupted() { return interrupted; },
    };
  }

  /* ---- 클로바노트로 넘기기 -------------------------------------------- */

  /** 파일 공유가 가능한 환경인지. iOS Safari는 된다. */
  function canShareFile(file) {
    return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
  }

  /**
   * 녹음 파일을 다른 앱(클로바노트)으로 넘긴다.
   * 공유 시트를 띄우는 것까지가 앱의 몫이고, 어디로 보낼지는 사용자가 고른다.
   * @returns {'shared'|'cancelled'|'unsupported'}
   */
  async function shareForTranscript(blob, name) {
    const ext = /mp4/.test(blob.type) ? 'm4a' : /webm/.test(blob.type) ? 'webm' : 'ogg';
    const file = new File([blob], `${name || '레슨'}.${ext}`, { type: blob.type || 'audio/mp4' });
    if (!canShareFile(file)) return 'unsupported';
    try {
      await navigator.share({ files: [file], title: name || '레슨 녹음' });
      return 'shared';
    } catch (e) {
      /* 사용자가 공유 시트를 닫은 경우도 여기로 온다 — 오류가 아니다. */
      if (e && e.name === 'AbortError') return 'cancelled';
      return 'unsupported';
    }
  }

  /** 공유가 안 되는 환경을 위한 대체 경로. */
  function download(blob, name) {
    const ext = /mp4/.test(blob.type) ? 'm4a' : /webm/.test(blob.type) ? 'webm' : 'ogg';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || '레슨'}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  PA.lessonrec = {
    create, pending, recover, dropPending,
    shareForTranscript, canShareFile, download,
    pickMime, SLICE_MS, BITRATE,
  };
})(window.PA);
