/* ===== 오디오 → 음량(RMS) 곡선 =====
   그랜드 피아노 녹음에서 MIDI 없이 표현을 읽어내기 위한 신호처리 층.
   - decodeAudioData 로 오프라인 분석(빠름)
   - 실패 시(주로 영상 컨테이너) 미디어 엘리먼트 + AnalyserNode 실시간 분석으로 대체 */
window.PA = window.PA || {};

(function (PA) {
  'use strict';
  const { clamp, avg } = PA.util;

  const BUCKETS = 420;      // 곡선 해상도
  const AC = window.AudioContext || window.webkitAudioContext;

  let ctx = null;
  function audioCtx() {
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  /* ---------- 오프라인: 디코드 후 RMS ---------- */
  async function fromArrayBuffer(buf) {
    const c = audioCtx();
    const audio = await c.decodeAudioData(buf.slice(0));
    return { envelope: rmsEnvelope(audio, BUCKETS), duration: audio.duration };
  }

  function rmsEnvelope(audioBuffer, buckets) {
    const chs = [];
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) chs.push(audioBuffer.getChannelData(i));
    const len = audioBuffer.length;
    const per = Math.max(1, Math.floor(len / buckets));
    const out = new Array(buckets).fill(0);
    for (let b = 0; b < buckets; b++) {
      const start = b * per;
      const end = Math.min(len, start + per);
      let sum = 0, n = 0;
      for (let i = start; i < end; i += 2) {       // 2배 데시메이션 — 곡선 정확도엔 충분
        let v = 0;
        for (let c2 = 0; c2 < chs.length; c2++) v += chs[c2][i];
        v /= chs.length;
        sum += v * v; n++;
      }
      out[b] = n ? Math.sqrt(sum / n) : 0;
    }
    return normalizeDb(out);
  }

  /** 선형 RMS → 0..1 정규화. dB 스케일로 옮겨야 사람 귀와 비슷하게 보인다. */
  function normalizeDb(arr, floorDb) {
    const FLOOR = floorDb == null ? -52 : floorDb;
    const peak = Math.max.apply(null, arr) || 1e-6;
    return arr.map((v) => {
      const db = 20 * Math.log10(Math.max(v, 1e-6) / peak);
      return clamp((db - FLOOR) / -FLOOR, 0, 1);
    });
  }

  /* ---------- 실시간: 영상/미지원 컨테이너 대체 경로 ---------- */
  function fromMediaElement(url, kind, onProgress) {
    return new Promise((resolve, reject) => {
      const media = document.createElement(kind === 'video' ? 'video' : 'audio');
      media.src = url;
      media.crossOrigin = 'anonymous';
      media.preload = 'auto';
      media.muted = false;

      const c = audioCtx();
      let src, analyser, sink, raf;
      const samples = [];

      const cleanup = () => {
        cancelAnimationFrame(raf);
        try { media.pause(); } catch (e) {}
        try { src && src.disconnect(); } catch (e) {}
        try { analyser && analyser.disconnect(); } catch (e) {}
        try { sink && sink.disconnect(); } catch (e) {}
      };

      media.addEventListener('error', () => { cleanup(); reject(new Error('미디어를 읽을 수 없습니다.')); });

      media.addEventListener('canplay', () => {
        if (src) return;
        try {
          src = c.createMediaElementSource(media);
          analyser = c.createAnalyser();
          analyser.fftSize = 2048;
          sink = c.createGain();
          sink.gain.value = 0;                 // 분석 중 소리는 내지 않는다
          src.connect(analyser);
          analyser.connect(sink);
          sink.connect(c.destination);
        } catch (e) { cleanup(); reject(e); return; }

        const data = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
          samples.push(Math.sqrt(sum / data.length));
          if (onProgress && media.duration) onProgress(media.currentTime / media.duration);
          raf = requestAnimationFrame(tick);
        };

        media.addEventListener('ended', () => {
          cleanup();
          resolve({ envelope: resample(normalizeDb(samples), BUCKETS), duration: media.duration || samples.length / 60 });
        }, { once: true });

        media.play().then(() => { raf = requestAnimationFrame(tick); }).catch((e) => { cleanup(); reject(e); });
      });

      media.load();
    });
  }

  /** Blob 하나에서 음량 곡선을 뽑는다. 오프라인 우선, 실패 시 실시간. */
  async function analyzeBlob(blob, opts) {
    opts = opts || {};
    const kind = (blob.type || '').startsWith('video') ? 'video' : 'audio';
    try {
      const buf = await blob.arrayBuffer();
      const res = await fromArrayBuffer(buf);
      if (res.envelope.some((v) => v > 0.02)) return Object.assign(res, { method: 'offline', kind });
    } catch (e) { /* 컨테이너 미지원 → 실시간 경로 */ }

    const url = URL.createObjectURL(blob);
    try {
      const res = await fromMediaElement(url, kind, opts.onProgress);
      return Object.assign(res, { method: 'realtime', kind });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  /* ---------- 곡선 연산 ---------- */
  function resample(arr, n) {
    if (!arr || !arr.length) return new Array(n).fill(0);
    if (arr.length === n) return arr.slice();
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * (arr.length - 1);
      const lo = Math.floor(t), hi = Math.min(arr.length - 1, lo + 1);
      out[i] = arr[lo] + (arr[hi] - arr[lo]) * (t - lo);
    }
    return out;
  }

  function smooth(arr, w) {
    w = w || 5;
    const half = Math.floor(w / 2);
    return arr.map((_, i) => {
      let s = 0, n = 0;
      for (let j = i - half; j <= i + half; j++) {
        if (j < 0 || j >= arr.length) continue;
        s += arr[j]; n++;
      }
      return s / n;
    });
  }

  /* ---------- 표현 지표 ---------- */
  /**
   * 음량 곡선에서 다이내믹 관련 지표를 뽑는다.
   *  range      : 다이내믹 폭 (0..1) — 클수록 셈여림 층이 넓다
   *  variability: 표준편차 — 평평함의 반대
   *  shape      : 곡선의 '방향성' — 정점이 하나로 모이는지, 계단인지
   *  peakAt     : 정점 위치(0..1) — 클라이맥스가 어디인가
   *  steps      : 계단 수 — 크레셴도가 매끄러운지 층계인지
   */
  function metrics(envelope) {
    if (!envelope || envelope.length < 8) {
      return { range: 0, variability: 0, shape: 0, peakAt: 0, steps: 0, mean: 0 };
    }
    const e = smooth(envelope, 9);
    const sorted = e.slice().sort((a, b) => a - b);
    const p05 = sorted[Math.floor(sorted.length * 0.05)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const mean = avg(e);
    const variance = avg(e.map((v) => (v - mean) * (v - mean)));
    let peakAt = 0, peak = -1;
    e.forEach((v, i) => { if (v > peak) { peak = v; peakAt = i; } });

    const range = clamp(p95 - p05, 0, 1);

    // 방향 전환 횟수를 센다 — 봉우리의 '돌출(prominence)' 기준.
    //
    // 고정 간격으로 기울기를 비교하는 방식은 완만한 기복을 놓친다. 봉우리가 넓게
    // 퍼져 있으면 정점 근처의 기울기가 0에 가까워 어떤 문턱값에도 걸리지 않기 때문이다.
    // 그래서 간격이 아니라 '마지막 극값에서 얼마나 되돌아왔는가'로 판정한다.
    // 판정 폭은 곡선 자신의 다이내믹 폭에 비례시키되, 잡음 수준의 최소값을 둔다.
    const prom = Math.max(0.04, range * 0.18);
    let turns = 0, dir = 0, ext = e[0], hi = e[0], lo = e[0];
    for (let i = 1; i < e.length; i++) {
      const v = e[i];
      if (dir === 1) {
        if (v > ext) ext = v;
        else if (ext - v > prom) { turns++; dir = -1; ext = v; }
      } else if (dir === -1) {
        if (v < ext) ext = v;
        else if (v - ext > prom) { turns++; dir = 1; ext = v; }
      } else {
        if (v > hi) hi = v;
        if (v < lo) lo = v;
        if (hi - v > prom) { dir = -1; ext = v; }
        else if (v - lo > prom) { dir = 1; ext = v; }
      }
    }
    const variability = Math.sqrt(variance);
    // 잘 만들어진 프레이즈는 오르고 내리는 전환이 한 번이다. 그 한 번은 벌하지 않는다.
    const shape = clamp(1 - Math.max(0, turns - 1) / 10, 0, 1);
    return {
      range: PA.util.round1(range * 100) / 100,
      variability: PA.util.round1(variability * 100) / 100,
      shape: PA.util.round1(shape * 100) / 100,
      peakAt: e.length ? peakAt / (e.length - 1) : 0,
      steps: turns,
      mean,
    };
  }

  /** 두 곡선의 A/B 비교. 같은 길이로 정규화한 뒤 차이·상관을 낸다. */
  function compare(a, b) {
    const n = 240;
    const A = resample(smooth(a || [], 7), n);
    const B = resample(smooth(b || [], 7), n);
    const mA = avg(A), mB = avg(B);
    let num = 0, dA = 0, dB = 0, absDiff = 0;
    for (let i = 0; i < n; i++) {
      const x = A[i] - mA, y = B[i] - mB;
      num += x * y; dA += x * x; dB += y * y;
      absDiff += Math.abs(A[i] - B[i]);
    }
    const corr = dA && dB ? num / Math.sqrt(dA * dB) : 0;
    const mA2 = metrics(a), mB2 = metrics(b);
    return {
      a: A, b: B,
      correlation: PA.util.round1(corr * 100) / 100,
      meanDiff: PA.util.round1((absDiff / n) * 100) / 100,
      rangeDelta: PA.util.round1((mB2.range - mA2.range) * 100) / 100,
      shapeDelta: PA.util.round1((mB2.shape - mA2.shape) * 100) / 100,
      metricsA: mA2, metricsB: mB2,
    };
  }

  /**
   * 지표를 사람이 읽는 한 줄 평으로.
   * 폭이 거의 없는 곡선에서는 '정점'이나 '형태'를 말하지 않는다.
   * 평평한 선에도 정점은 계산되지만, 그건 소리에 존재하지 않는 정점이다.
   */
  function readMetrics(m) {
    const out = [];
    if (m.range < 0.15) {
      out.push('음량이 거의 일정합니다 — 셈여림이라고 부를 만한 변화가 없습니다.');
      out.push('폭이 이만큼 좁으면 정점을 따질 수 없습니다. 우선 크고 작음의 차이부터 만드세요.');
      return out;
    }
    if (m.range < 0.28) out.push('다이내믹 폭이 좁습니다 — 전체가 비슷한 음량입니다.');
    else if (m.range > 0.62) out.push('다이내믹 폭이 넓습니다.');
    else out.push('다이내믹 폭은 무난합니다.');

    if (m.shape < 0.45) out.push('음량이 여러 번 오르내려 클라이맥스가 흩어집니다.');
    else if (m.shape > 0.75) out.push('한 덩어리의 곡선으로 정점이 또렷합니다.');

    if (m.peakAt < 0.2) out.push('정점이 너무 앞에 있습니다 — 뒤에 쓸 여지가 없습니다.');
    else if (m.peakAt > 0.85) out.push('정점이 거의 끝에 있습니다.');
    return out;
  }

  PA.envelope = {
    BUCKETS, audioCtx, analyzeBlob, fromArrayBuffer, rmsEnvelope,
    resample, smooth, metrics, compare, readMetrics, normalizeDb,
  };
})(window.PA);
