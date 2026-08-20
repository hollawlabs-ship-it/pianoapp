/* ===== Claude API 클라이언트 (브라우저 직접 호출) =====
   ⚠️ 보안 주의
   이 앱은 아이 1인용 로컬 앱이라는 전제 아래, API 키를 브라우저(localStorage)에 두고
   api.anthropic.com 을 직접 호출한다. 키가 이 기기에 평문으로 남는다는 뜻이므로
   공용 PC에는 넣지 말 것. 여러 사람이 쓰게 될 경우엔 키를 서버로 옮겨야 한다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';

  const ENDPOINT = 'https://api.anthropic.com/v1/messages';
  const VERSION = '2023-06-01';
  const MODEL = 'claude-opus-5';

  const settings = () => (PA.store.get().settings || {});
  const apiKey = () => PA.store.getApiKey();      // 상태가 아니라 별도 보관소에서 읽는다
  const available = () => !!apiKey();

  function headers() {
    return {
      'content-type': 'application/json',
      'x-api-key': apiKey(),
      'anthropic-version': VERSION,
      // 브라우저에서 직접 호출할 때 필요한 opt-in 헤더
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }

  function friendlyError(status, body) {
    const type = body && body.error && body.error.type;
    if (status === 401) return 'API 키가 올바르지 않습니다. 설정에서 다시 확인해 주세요.';
    if (status === 403) return '이 키로는 요청 권한이 없습니다.';
    if (status === 429) return '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.';
    if (status >= 500) return 'Anthropic 서버가 일시적으로 응답하지 않습니다. 잠시 후 재시도해 주세요.';
    if (type === 'invalid_request_error') {
      return '요청 형식 오류: ' + ((body.error && body.error.message) || '알 수 없음');
    }
    return `요청 실패 (${status})`;
  }

  /**
   * Messages API 호출.
   * @param {object} opts
   *   system      : 시스템 프롬프트 문자열
   *   messages    : [{role, content}]
   *   schema      : JSON Schema — 주면 구조화 출력으로 강제하고 json 필드에 파싱 결과를 담는다
   *   tools       : 서버 도구 배열 (예: 웹 검색)
   *   maxTokens   : 기본 16000
   *   effort      : low | medium | high | xhigh | max
   *   signal      : AbortSignal
   */
  async function complete(opts) {
    if (!available()) throw new Error('AI 코치를 쓰려면 설정에서 API 키를 넣어야 합니다.');

    const body = {
      model: settings().model || MODEL,
      max_tokens: opts.maxTokens || 16000,
      messages: opts.messages,
    };
    if (opts.system) body.system = opts.system;
    if (opts.tools && opts.tools.length) body.tools = opts.tools;

    const outputConfig = {};
    if (opts.effort) outputConfig.effort = opts.effort;
    if (opts.schema) outputConfig.format = { type: 'json_schema', schema: opts.schema };
    if (Object.keys(outputConfig).length) body.output_config = outputConfig;

    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('네트워크에 연결할 수 없습니다. 인터넷 상태를 확인해 주세요.');
    }

    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }

    if (!res.ok) throw new Error(friendlyError(res.status, data));

    // 안전장치가 요청을 거절한 경우 content가 비어 있을 수 있다
    if (data.stop_reason === 'refusal') {
      throw new Error('이 요청은 모델이 응답을 거절했습니다. 문장을 바꿔 다시 시도해 주세요.');
    }

    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    let json = null;
    if (opts.schema) {
      try { json = JSON.parse(text); } catch (e) { json = looseJSON(text); }
    }

    return { text, json, raw: data, usage: data.usage, stopReason: data.stop_reason };
  }

  /** 모델이 코드펜스나 서두를 붙였을 때를 위한 관대한 JSON 파서. */
  function looseJSON(text) {
    if (!text) return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : text;
    const start = body.search(/[[{]/);
    if (start < 0) return null;
    const open = body[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0, inStr = false, escNext = false;
    for (let i = start; i < body.length; i++) {
      const ch = body[i];
      if (escNext) { escNext = false; continue; }
      if (ch === '\\') { escNext = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(body.slice(start, i + 1)); } catch (e) { return null; }
        }
      }
    }
    return null;
  }

  /** 키가 살아 있는지 아주 짧은 요청으로 확인한다. */
  async function ping() {
    const r = await complete({
      messages: [{ role: 'user', content: 'OK 한 단어로만 답하세요.' }],
      maxTokens: 16,
      effort: 'low',
    });
    return r.text;
  }

  const WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: 6 };

  PA.ai = { complete, available, ping, looseJSON, MODEL, WEB_SEARCH_TOOL };
})(window.PA);
