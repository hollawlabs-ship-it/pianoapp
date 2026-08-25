/* ===== 음성 → 텍스트 (Groq Whisper) =====
   ⚠️ 왜 Claude가 아닌가
   Claude Messages API는 오디오를 입력으로 받지 않는다. 받는 것은 텍스트·이미지·
   PDF뿐이다. 그래서 전사에는 음성인식 모델이 따로 하나 필요하다.

   ⚠️ 왜 Groq인가
   브라우저에서 직접 부를 수 있는 유일한 곳이라서다. 배포 주소에서 실제로
   확인한 결과:
     OpenAI Whisper   CORS 차단
     CLOVA Speech     CORS 차단 (게다가 서버 대 서버 전용)
     Groq             통과
   서버가 없는 앱이라 프록시를 세우지 않으려면 선택지가 이것뿐이다.

   ⚠️ 클로바노트에는 공개 API가 없다
   그래서 클로바노트 자동화는 불가능하고, 수동 경로(공유 → 전사 → 붙여넣기)를
   그대로 남겨 둔다. 정확도가 아쉬우면 그쪽으로 돌아가면 된다.

   ⚠️ 키가 브라우저에 남는다
   Anthropic 키와 같은 조건이다. 무료 등급이라 새더라도 피해 범위는 작지만,
   공용 기기에는 넣지 말 것. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';

  const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
  const MODEL = 'whisper-large-v3-turbo';

  /* 무료 등급의 업로드 한도. 넘으면 요청을 보내기 전에 막는다 —
     25MB를 올려놓고 거절당하면 폰 데이터만 버린다. */
  const MAX_BYTES = 25 * 1024 * 1024;

  /* Whisper는 prompt로 어휘를 유도할 수 있다. 레슨에 나올 말을 미리 알려
     주면 한국어 음악 용어의 인식률이 올라간다. 이 필드는 길이 제한이
     있으므로(약 224토큰) 헷갈리기 쉬운 것만 골라 넣는다. */
  const VOCAB = [
    '피아노 레슨 녹취입니다.',
    '레가토, 논 레가토, 스타카토, 포르타토, 프레이징, 아티큘레이션,',
    '다이내믹, 크레셴도, 디미누엔도, 스포르찬도, 페달링, 하프 페달,',
    '루바토, 아고기크, 리타르단도, 아첼레란도, 템포 루바토,',
    '트라이톤, 아르페지오, 옥타브, 프레이즈, 카덴차, 모티프,',
    '터치, 타건, 손목, 팔무게, 이명동음, 화성, 전조.',
  ].join(' ');

  const key = () => PA.store.getSttKey();
  const available = () => !!key();

  function friendlyError(status, body) {
    const msg = (body && body.error && body.error.message) || '';
    if (status === 401) return 'Groq 키가 올바르지 않습니다. 설정에서 다시 확인해 주세요.';
    if (status === 413) return '파일이 너무 큽니다. 더 짧게 나눠서 전사해 주세요.';
    if (status === 429) {
      return /rate limit/i.test(msg)
        ? '오늘 무료 한도를 다 썼습니다. 내일 다시 시도하거나 클로바노트로 전사해 주세요.'
        : '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.';
    }
    if (status >= 500) return 'Groq 서버가 일시적으로 응답하지 않습니다. 잠시 후 재시도해 주세요.';
    return msg ? `전사 실패: ${msg}` : `전사 실패 (${status})`;
  }

  /** 확장자를 붙여 준다. Whisper는 컨테이너를 확장자로도 판단한다. */
  function nameFor(blob) {
    const t = (blob.type || '').split(';')[0];
    const ext = t === 'audio/mp4' || t === 'video/mp4' ? 'm4a'
      : t === 'audio/mpeg' ? 'mp3'
      : t === 'audio/wav' ? 'wav'
      : t === 'audio/ogg' ? 'ogg'
      : t === 'audio/flac' ? 'flac'
      : t === 'audio/webm' || t === 'video/webm' ? 'webm'
      : 'm4a';
    return `lesson.${ext}`;
  }

  /**
   * 오디오를 텍스트로 바꾼다.
   * @param {Blob} blob
   * @param {object} [opts] { signal }
   * @returns {Promise<{text:string, model:string, bytes:number}>}
   */
  async function transcribe(blob, opts) {
    opts = opts || {};
    if (!available()) {
      throw new Error('자동 전사를 쓰려면 설정에서 Groq 키를 넣어야 합니다.');
    }
    if (!blob || !blob.size) throw new Error('전사할 오디오가 없습니다.');
    if (blob.size > MAX_BYTES) {
      throw new Error(
        `파일이 ${PA.storage.fmtBytes(blob.size)}입니다. 무료 한도는 25MB까지라 이 파일은 보낼 수 없습니다. `
        + '클로바노트로 전사하거나, 더 짧게 나눠 주세요.'
      );
    }

    const form = new FormData();
    form.append('file', new File([blob], nameFor(blob), { type: blob.type || 'audio/mp4' }));
    form.append('model', MODEL);
    form.append('language', 'ko');
    form.append('response_format', 'json');
    form.append('prompt', VOCAB);
    /* 0으로 두면 모델이 지어내는 정도가 줄어든다. 레슨 전사는 상상력이
       필요한 일이 아니라 받아적는 일이다. */
    form.append('temperature', '0');

    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key() },
        body: form,
        signal: opts.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('네트워크에 연결할 수 없습니다. 인터넷 상태를 확인해 주세요.');
    }

    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new Error(friendlyError(res.status, data));

    const text = ((data && data.text) || '').trim();
    if (!text) throw new Error('전사 결과가 비어 있습니다. 녹음에 말소리가 담겼는지 확인해 주세요.');
    return { text, model: MODEL, bytes: blob.size };
  }

  /** 키가 살아 있는지 아주 짧은 무음으로 확인한다. */
  async function ping() {
    /* 0.2초짜리 무음 WAV. 실제 전사 결과는 비어도 상관없다 —
       인증과 연결만 확인하면 된다. */
    const sr = 8000, n = Math.floor(sr * 0.2);
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const put = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    put(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); put(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    put(36, 'data'); v.setUint32(40, n * 2, true);
    const blob = new Blob([buf], { type: 'audio/wav' });

    if (!available()) throw new Error('설정에서 Groq 키를 넣어 주세요.');
    const form = new FormData();
    form.append('file', new File([blob], 'ping.wav', { type: 'audio/wav' }));
    form.append('model', MODEL);
    form.append('language', 'ko');
    form.append('response_format', 'json');

    const res = await fetch(ENDPOINT, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + key() }, body: form,
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(friendlyError(res.status, data));
    return true;
  }

  PA.stt = { transcribe, ping, available, MODEL, MAX_BYTES, provider: 'groq' };
})(window.PA);
