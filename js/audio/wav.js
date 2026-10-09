/* ===== WAV 내보내기 =====
   앱은 녹음을 m4a·webm으로 담는다. 브라우저가 그것만 내주기 때문이다.
   그런데 분석 도구들은 그 형식을 잘 못 읽는다 — Audacity는 m4a를 열려면
   FFmpeg를 따로 깔아야 하고, Sonic Visualiser도 WAV·FLAC 쪽이 확실하다.
   그래서 꺼낼 때 WAV로 바꿔 준다.

   ⚠️ 여기서 진짜 문제는 메모리다.
   decodeAudioData는 파일 전체를 Float32 배열로 펼친다. 두 시간짜리
   레슨을 원본 48kHz로 펼치면 1.3GB다. 폰에서는 탭이 죽는다.

     연습 녹음 2분 · 48kHz    디코딩   22MB   → 원본 그대로
     레슨 1시간 · 48kHz       디코딩  659MB   → 위험
     레슨 2시간 · 48kHz       디코딩 1318MB   → 불가
     레슨 2시간 · 16kHz 모노  디코딩  439MB   → 가능하지만 무겁다

   그래서 두 가지를 한다.
     1) 레슨처럼 긴 말소리는 16kHz 모노로 낮춰 받는다. decodeAudioData는
        컨텍스트의 샘플레이트로 리샘플해 주므로, 낮은 레이트의
        OfflineAudioContext로 디코딩하면 펼치는 단계부터 작아진다.
     2) 그래도 예산을 넘으면 시작하지 않고 미리 막는다. 변환을 돌리다
        탭이 죽는 것보다 "여기서는 안 된다"고 말하는 편이 낫다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';

  /* 펼친 오디오가 차지해도 괜찮다고 보는 한계.
     폰은 보수적으로 잡는다 — iOS는 한도를 넘으면 경고 없이 탭을 버린다. */
  const budget = () => (PA.storage && PA.storage.isMobile && PA.storage.isMobile() ? 260 : 1200) * 1048576;

  /* 말소리는 16kHz 모노면 충분하다. 음성인식도 이 값을 쓰고,
     레슨 녹음 자체가 이미 그 언저리로 담긴다. */
  const SPEECH_RATE = 16000;

  /** 이 길이·설정이면 펼쳤을 때 몇 바이트인가. */
  const decodedBytes = (seconds, rate, channels) => seconds * rate * channels * 4;

  /**
   * AudioBuffer를 16비트 PCM WAV로 만든다.
   * @param {AudioBuffer} buf
   * @param {boolean} [mono] 채널을 섞어 하나로
   */
  function encode(buf, mono) {
    const ch = mono ? 1 : buf.numberOfChannels;
    const n = buf.length;
    const rate = buf.sampleRate;
    const bytes = 44 + n * ch * 2;
    const out = new ArrayBuffer(bytes);
    const v = new DataView(out);

    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF');
    v.setUint32(4, bytes - 8, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);          // PCM 헤더 길이
    v.setUint16(20, 1, true);           // 1 = 비압축 PCM
    v.setUint16(22, ch, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * ch * 2, true);
    v.setUint16(32, ch * 2, true);
    v.setUint16(34, 16, true);          // 비트 깊이
    str(36, 'data');
    v.setUint32(40, n * ch * 2, true);

    const src = [];
    for (let c = 0; c < buf.numberOfChannels; c++) src.push(buf.getChannelData(c));

    let o = 44;
    if (mono && buf.numberOfChannels > 1) {
      const k = buf.numberOfChannels;
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let c = 0; c < k; c++) sum += src[c][i];
        o = writeSample(v, o, sum / k);
      }
    } else {
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < ch; c++) o = writeSample(v, o, src[c][i]);
      }
    }
    return new Blob([out], { type: 'audio/wav' });
  }

  /* -1..1을 16비트 정수로. 범위를 넘는 값은 자른다 —
     넘긴 채 두면 숫자가 한 바퀴 돌아 딱딱거리는 잡음이 된다. */
  function writeSample(view, offset, x) {
    const s = x < -1 ? -1 : x > 1 ? 1 : x;
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    return offset + 2;
  }

  /** 길이를 메타데이터로만 잰다. 통째로 펼치지 않는다. */
  function probeDuration(blob) {
    return new Promise((resolve) => {
      const a = document.createElement('audio');
      const url = URL.createObjectURL(blob);
      const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
      a.addEventListener('loadedmetadata', () => done(isFinite(a.duration) ? a.duration : 0));
      a.addEventListener('error', () => done(0));
      a.preload = 'metadata';
      a.src = url;
    });
  }

  /**
   * 녹음 blob을 WAV로 바꾼다.
   * @param {Blob} blob
   * @param {object} [opts]
   *   speech  : true면 16kHz 모노로 받는다 (레슨처럼 긴 말소리)
   *   rate    : 직접 지정할 샘플레이트
   *   mono    : 채널을 섞을지
   * @returns {Promise<{blob:Blob, rate:number, channels:number, seconds:number}>}
   */
  async function fromBlob(blob, opts) {
    opts = opts || {};
    if (!blob || !blob.size) throw new Error('변환할 오디오가 없습니다.');

    const seconds = await probeDuration(blob);
    const mono = opts.mono !== undefined ? !!opts.mono : !!opts.speech;
    const rate = opts.rate || (opts.speech ? SPEECH_RATE : 0);

    /* 예산 검사는 리샘플 뒤 기준으로 한다. 레이트를 낮춰 받으면
       펼치는 단계부터 작아지기 때문이다. 채널 수는 아직 모르니
       스테레오로 가정해 보수적으로 잡는다.

       길이를 못 읽는 경우가 있다 — 조각을 이어붙인 파일은 컨테이너에
       길이가 비어 있다. 그때 검사를 건너뛰면 가장 큰 파일이 무사통과해
       탭이 죽는다. 그래서 모르면 파일 크기에서 되짚는다. 낮은 비트레이트를
       가정하면 길이가 길게 나오므로 안전한 쪽으로 틀린다. */
    const ASSUMED_BPS = 24000 / 8;          // 가장 낮은 녹음 설정 기준
    const guessed = blob.size / ASSUMED_BPS;
    const forGuard = seconds || guessed;
    const assumedRate = rate || 48000;
    const need = decodedBytes(forGuard, assumedRate, 2);
    if (need > budget()) {
      const mins = Math.round(forGuard / 60);
      throw new Error(
        `${mins}분짜리는 이 기기에서 WAV로 바꾸기에 너무 큽니다(약 ${Math.round(need / 1048576)}MB를 펼쳐야 합니다). `
        + '원본을 드라이브에서 받아 컴퓨터에서 변환하세요.'
      );
    }

    const arr = await blob.arrayBuffer();

    /* decodeAudioData는 컨텍스트의 샘플레이트로 리샘플해 준다.
       그래서 낮은 레이트의 컨텍스트로 디코딩하면 펼친 결과가 작아진다. */
    let ctx;
    try {
      ctx = rate ? new OfflineAudioContext(1, 1, rate) : new OfflineAudioContext(1, 1, 44100);
    } catch (e) {
      throw new Error('이 브라우저는 오디오 변환을 지원하지 않습니다.');
    }

    let buf;
    try {
      buf = await ctx.decodeAudioData(arr);
    } catch (e) {
      throw new Error('오디오를 읽지 못했습니다. 손상된 파일일 수 있습니다.');
    }

    const wav = encode(buf, mono);
    return {
      blob: wav,
      rate: buf.sampleRate,
      channels: mono ? 1 : buf.numberOfChannels,
      seconds: buf.duration,
    };
  }

  /** 내보내기. 공유 시트가 있으면 그쪽으로, 없으면 내려받기. */
  async function deliver(wavBlob, name) {
    const file = new File([wavBlob], `${name || '녹음'}.wav`, { type: 'audio/wav' });
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name || '녹음' });
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
      }
    }
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || '녹음'}.wav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return 'downloaded';
  }

  /**
   * 저장된 녹음을 꺼내 WAV로 바꿔 내보내는 한 묶음.
   * 화면마다 버튼 모양은 달라도 흐름은 같으므로 여기 둔다.
   * @param {string} blobKey IndexedDB 키
   * @param {object} opts { speech, mono, rate, name }
   */
  async function exportFrom(blobKey, opts) {
    opts = opts || {};
    const src = await PA.store.getBlob(blobKey);
    if (!src) throw new Error('오디오 파일을 찾을 수 없습니다. 폰에서 비웠다면 먼저 다시 받으세요.');
    const out = await fromBlob(src, opts);
    const how = await deliver(out.blob, opts.name);
    return Object.assign(out, { how });
  }

  PA.wav = { encode, fromBlob, deliver, exportFrom, probeDuration, SPEECH_RATE, budget };
})(window.PA);
