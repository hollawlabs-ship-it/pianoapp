/* ===== 마이크 녹음 =====
   어쿠스틱 그랜드 전용. MIDI가 없으므로 마이크 입력이 유일한 관측 채널이다.
   자동이득(AGC)·노이즈억제를 끄지 않으면 다이내믹이 뭉개지므로 반드시 끈다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';

  const CONSTRAINTS = {
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,   // ★ 다이내믹 분석의 전제
      channelCount: 1,
      sampleRate: 48000,
    },
  };

  function pickMime() {
    const list = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const m of list) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    }
    return '';
  }

  function create() {
    let stream = null, rec = null, chunks = [];
    let analyser = null, srcNode = null, rafId = null;
    let startAt = 0, live = [];
    const handlers = { level: null, tick: null };

    async function start() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('이 브라우저는 마이크 녹음을 지원하지 않습니다.');
      }
      stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);

      const ctx = PA.envelope.audioCtx();
      srcNode = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      srcNode.connect(analyser);   // destination에는 연결하지 않음 (하울링 방지)

      const mimeType = pickMime();
      rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 128000 } : undefined);
      chunks = [];
      live = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.start(250);
      startAt = performance.now();

      const buf = new Float32Array(analyser.fftSize);
      let lastPush = 0;
      const loop = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0, peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i];
          sum += v * v;
          if (Math.abs(v) > peak) peak = Math.abs(v);
        }
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        if (now - lastPush > 40) { live.push(rms); lastPush = now; }   // 25 Hz
        if (handlers.level) handlers.level(rms, peak, live);
        if (handlers.tick) handlers.tick((now - startAt) / 1000);
        rafId = requestAnimationFrame(loop);
      };
      rafId = requestAnimationFrame(loop);
    }

    function stop() {
      return new Promise((resolve) => {
        if (!rec || rec.state === 'inactive') { teardown(); resolve(null); return; }
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          const duration = (performance.now() - startAt) / 1000;
          const liveEnv = PA.envelope.resample(PA.envelope.normalizeDb(live.slice()), PA.envelope.BUCKETS);
          teardown();
          resolve({ blob, duration, liveEnvelope: liveEnv });
        };
        rec.stop();
      });
    }

    function cancel() {
      try { rec && rec.state !== 'inactive' && rec.stop(); } catch (e) {}
      teardown();
    }

    function teardown() {
      cancelAnimationFrame(rafId);
      try { srcNode && srcNode.disconnect(); } catch (e) {}
      try { analyser && analyser.disconnect(); } catch (e) {}
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null; rec = null; analyser = null; srcNode = null;
    }

    return {
      start, stop, cancel,
      onLevel(fn) { handlers.level = fn; },
      onTick(fn) { handlers.tick = fn; },
      get state() { return rec ? rec.state : 'inactive'; },
    };
  }

  /** 업로드된 파일(오디오/영상)에서 트랙을 분석한다. */
  async function analyzeFile(file, onProgress) {
    const isVideo = (file.type || '').startsWith('video');
    const res = await PA.envelope.analyzeBlob(file, { onProgress });
    return {
      blob: file,
      duration: res.duration,
      envelope: res.envelope,
      kind: isVideo ? 'video' : 'audio',
      method: res.method,
      mime: file.type || (isVideo ? 'video/mp4' : 'audio/mpeg'),
    };
  }

  PA.recorder = { create, analyzeFile, pickMime, CONSTRAINTS };
})(window.PA);
