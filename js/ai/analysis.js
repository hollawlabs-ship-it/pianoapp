/* ===== 분석 엔진 =====
   레슨 전사 → 지적사항 / 연습 지시 / 하루별 스케줄.
   API 키가 있으면 Claude가, 없으면 규칙 기반 엔진이 처리한다.
   규칙 엔진은 "키 없이도 앱이 굴러가야 한다"는 요구를 위한 것이지 AI의 대체물이 아니다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';
  const { uid, todayKey, addDays } = PA.util;
  const DIMS = PA.store.DIMENSIONS;

  /* ---------- 사전: 표현 차원 키워드 ---------- */
  const DIM_WORDS = {
    dynamics: ['다이내믹', '셈여림', '크레', '크레셴도', '디미누엔도', '데크레', '포르테', '피아노로', '음량', '소리 크기', '세게', '여리게', 'ff', 'pp', 'mf', '클라이맥스', '정점', '부풀', '평평'],
    legato: ['레가토', '이어', '이음', '끊기', '끊어', '연결', '손가락으로 잇', '레가티시모', '붙여'],
    phrasing: ['프레이', '악구', '프레이징', '숨', '호흡', '문장', '마디 단위', '노래', '흐름', '루바토', '아고긱', '방향'],
    pedal: ['페달', '댐퍼', '소스테누토', '우나코르다', '밟', '떼', '흐려', '탁해', '뭉개', '갈아', '바꿔', '화성이 바뀔'],
    tone: ['음색', '터치', '타건', '소리가', '톤', '무게', '손목', '팔', '깊이', '단단', '거칠', '날카'],
  };

  /**
   * 지적으로 볼 문장의 표지.
   * 선생님 말투에서 지적은 두 형태로 나온다.
   *  (1) 현상 서술 — "…하고 있어요", "너무 …해요"
   *  (2) 지시 — "…해 주세요", "…해 보세요"
   * 둘 다 잡아야 한다. 지시만 잡으면 습관을 짚는 문장을 통째로 놓친다.
   */
  const ISSUE_MARKERS = [
    // 지시
    '해야', '하세요', '해보세요', '해 보세요', '보세요', '주세요', '주십시오', '합시다',
    '다시', '고쳐', '말고', '대신', '지 마', '지 말',
    // 현상 서술 · 부정
    '주의', '안 돼', '안돼', '않아요', '않습니다', '없어요', '없습니다', '너무',
    '고 있어', '고 있습니다', '버릇', '습관',
    // 평가
    '부족', '약해', '약합니다', '평평', '뭉개', '흐려', '탁해', '틀렸', '틀려',
    '놓쳤', '빠졌', '급해', '서둘', '늘어', '문제', '아쉬', '들려요', '들립니다',
  ];
  const POSITIVE_MARKERS = ['좋아졌', '좋습니다', '훨씬', '잘했', '괜찮', '됐어요', '해결'];

  const SEVERITY_HIGH = ['전혀', '아직도', '계속', '늘', '항상', '매번', '전부', '완전히', '심각'];

  /* ---------- 유틸 ---------- */
  function sentences(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .split(/(?<=[.!?。？！])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 4);
  }

  function guessDimension(sentence) {
    let best = null, bestScore = 0;
    for (const dim in DIM_WORDS) {
      let score = 0;
      DIM_WORDS[dim].forEach((w) => { if (sentence.includes(w)) score += w.length > 2 ? 2 : 1; });
      if (score > bestScore) { bestScore = score; best = dim; }
    }
    return bestScore > 0 ? best : null;
  }

  /** 문장이 어느 구간을 가리키는지 추정: 구간 이름 토큰 · 마디 번호 범위 */
  function guessSection(sentence, sections) {
    for (const sec of sections) {
      const tokens = String(sec.name).split(/[\s—·,()]+/).filter((t) => t.length >= 2);
      if (tokens.some((t) => sentence.includes(t))) return sec.id;
    }
    // 마디 번호로 매칭
    const nums = (sentence.match(/(\d{1,3})\s*마디/g) || []).map((m) => parseInt(m, 10));
    if (nums.length) {
      for (const sec of sections) {
        const range = String(sec.bars || '').match(/(\d{1,3})\D+(\d{1,3})/);
        if (!range) continue;
        const lo = +range[1], hi = +range[2];
        if (nums.some((n) => n >= lo && n <= hi)) return sec.id;
      }
    }
    return null;
  }

  /* ---------- 규칙 기반 분석 ---------- */
  function heuristicAnalyze(transcript, song) {
    const sections = song.sections || [];
    const sents = sentences(transcript);
    const issues = [];
    const positives = [];

    sents.forEach((s) => {
      // 괄호로 감싼 줄은 전사자 메모나 상황 설명이지 선생님 말이 아니다
      if (/^[([（]/.test(s)) return;
      const isPositive = POSITIVE_MARKERS.some((w) => s.includes(w));
      const isIssue = ISSUE_MARKERS.some((w) => s.includes(w));
      if (isPositive && !isIssue) { positives.push(s); return; }
      if (!isIssue) return;
      const dim = guessDimension(s);
      const secId = guessSection(s, sections);
      if (!dim && !secId) return;
      const severity = SEVERITY_HIGH.some((w) => s.includes(w)) ? 'high' : 'mid';
      issues.push({
        text: s.replace(/^(선생님|teacher)\s*[:：]\s*/i, '').slice(0, 180),
        sectionId: secId,
        dimension: dim || 'phrasing',
        severity,
        resolved: false,
        resolvedAt: null,
      });
    });

    // 같은 구간·차원 중복 제거. 더 심각한 것을, 같은 심각도면 더 구체적인(긴) 문장을 남긴다.
    const seen = new Map();
    issues.forEach((it) => {
      const k = (it.sectionId || '-') + '/' + it.dimension;
      const prev = seen.get(k);
      if (!prev) { seen.set(k, it); return; }
      const better =
        (it.severity === 'high' && prev.severity !== 'high') ||
        (it.severity === prev.severity && it.text.length > prev.text.length);
      if (better) seen.set(k, it);
    });
    // 같은 차원에 구간이 붙은 지적이 이미 있으면, 구간 미연결 지적은 그 그림자다. 버린다.
    const all = Array.from(seen.values());
    const linkedDims = new Set(all.filter((i) => i.sectionId).map((i) => i.dimension));
    const uniq = all.filter((i) => i.sectionId || !linkedDims.has(i.dimension)).slice(0, 8);

    const directives = uniq.map((it) => {
      const dimLabel = (PA.store.DIM_MAP[it.dimension] || {}).label || '표현';
      const sec = sections.find((x) => x.id === it.sectionId);
      const where = sec ? `${sec.name}` : '지적된 구간';
      return `${where}: ${dimLabel} 한 차원만 붙잡고 통과 — ${it.text.slice(0, 60)}`;
    });

    // 하루에 한 차원씩. 심각한 것부터.
    // 지적이 없으면 스케줄도 없다 — 빈 과제를 지어내면 그날의 집중이 가짜가 된다.
    const ordered = uniq.slice().sort((a, b) => (a.severity === 'high' ? -1 : 1) - (b.severity === 'high' ? -1 : 1));
    const schedule = [];
    const days = Math.min(4, ordered.length);
    for (let d = 0; d < days; d++) {
      const it = ordered[d];
      const sec = sections.find((x) => x.id === it.sectionId);
      const dimLabel = (PA.store.DIM_MAP[it.dimension] || {}).label || '표현';
      schedule.push({
        day: d + 1,
        focus: it.dimension,
        tasks: [
          { text: `${sec ? sec.name : '해당 구간'} — ${dimLabel}만 의식하고 느린 템포로 2회`, done: false },
          { text: `같은 구간 녹음 후 음량 곡선 확인 (어제 녹음과 A/B)`, done: false },
        ],
      });
    }

    const summary = uniq.length
      ? `지적 ${uniq.length}건. 가장 많이 걸린 차원은 ${topDim(uniq)}. ` +
        (positives.length ? `칭찬 ${positives.length}건도 함께 기록됨.` : '')
      : '전사에서 뚜렷한 지적 문장을 찾지 못했습니다. 문장을 다듬거나 AI 분석을 켜 보세요.';

    return {
      summary,
      issues: uniq,
      directives,
      schedule,
      positives: positives.slice(0, 5),
      engine: 'rules',
    };
  }

  function topDim(issues) {
    const count = {};
    issues.forEach((i) => { count[i.dimension] = (count[i.dimension] || 0) + 1; });
    const best = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    return (PA.store.DIM_MAP[best] || {}).label || '표현';
  }

  /* ---------- AI 분석 ---------- */
  const LESSON_SCHEMA = {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '레슨 전체를 2~3문장으로. 반복되는 주문이 있으면 그걸 중심으로.' },
      issues: {
        type: 'array',
        description: '선생님이 실제로 지적한 것만. 추측해서 만들어내지 말 것.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '지적 내용을 한 문장으로' },
            /* 구조화 출력은 {"type":["string","null"]} 유니온을 받지 않는다.
               nullable은 anyOf로 적어야 하고, 아니면 400으로 거절당한다. */
            sectionId: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
              description: '주어진 구간 목록의 id. 특정할 수 없으면 null',
            },
            dimension: { type: 'string', enum: ['dynamics', 'legato', 'phrasing', 'pedal', 'tone'] },
            severity: { type: 'string', enum: ['high', 'mid', 'low'] },
          },
          required: ['text', 'sectionId', 'dimension', 'severity'],
          additionalProperties: false,
        },
      },
      directives: {
        type: 'array',
        description: '구체적인 연습 지시. 각 항목은 그대로 실행 가능해야 한다.',
        items: { type: 'string' },
      },
      schedule: {
        type: 'array',
        description: '하루에 한 차원씩. 2~5일.',
        items: {
          type: 'object',
          properties: {
            day: { type: 'integer' },
            focus: { type: 'string', enum: ['dynamics', 'legato', 'phrasing', 'pedal', 'tone'] },
            tasks: { type: 'array', items: { type: 'string' } },
          },
          required: ['day', 'focus', 'tasks'],
          additionalProperties: false,
        },
      },
      positives: { type: 'array', items: { type: 'string' }, description: '칭찬·개선 확인 문장' },
    },
    required: ['summary', 'issues', 'directives', 'schedule', 'positives'],
    additionalProperties: false,
  };

  /**
   * 코치 시스템 프롬프트.
   * 학습자 소개는 설정값에서 가져온다. 코드에 특정 학교·학년을 박아 두면
   * (1) 공개 저장소에 개인 신상이 남고 (2) 다른 사용자도 그 사람으로 코칭받는다.
   */
  function coachSystem() {
    const who = ((PA.store.get().settings || {}).learnerProfile || '').trim() || '피아노를 전공하는 학생';
    return COACH_SYSTEM_BASE.replace('{{LEARNER}}', who);
  }

  const COACH_SYSTEM_BASE = [
    '당신은 {{LEARNER}}의 연습 코치입니다.',
    '',
    '연습 철학 — 이 원칙에서 벗어나지 마세요:',
    '- 템포를 올리는 것이 목표가 아닙니다. 표현이 목표입니다.',
    '- 다이내믹·레가토·프레이징·페달링·음색을 구간별로, 한 번에 한 차원씩 다룹니다.',
    '- 하루 과제에 두 개 이상의 차원을 섞지 마세요.',
    '- 학생은 어쿠스틱 그랜드로 연습하며 MIDI가 없습니다. 검증 수단은 녹음과 음량 곡선뿐입니다.',
    '',
    '작성 규칙:',
    '- 전사에 없는 지적을 지어내지 마세요. 선생님이 말한 것만 옮깁니다.',
    '- 지시는 실행 가능해야 합니다. "표현을 살리세요"가 아니라 "페달을 떼고 오른손만 느리게 2회".',
    '- 학습자의 수준에 맞는 문장으로 쓰되 아이 취급하지 마세요.',
    '- 한국어로 답합니다.',
  ].join('\n');

  async function aiAnalyzeLesson(transcript, song, signal) {
    const secList = (song.sections || [])
      .map((s) => `- id=${s.id} | ${s.name} | ${s.bars || '마디 미상'} | 성격: ${s.character || '-'}`)
      .join('\n');

    const prompt = [
      `곡: ${song.composer ? song.composer + ' — ' : ''}${song.title}${song.work ? ' (' + song.work + ')' : ''}`,
      `목표 템포 ♩=${song.tempoTarget}, 현재 ♩=${song.tempoCurrent}`,
      '',
      '구간 목록 (sectionId는 반드시 이 목록의 id 중 하나이거나 null):',
      secList || '(구간 없음)',
      '',
      '아래는 오늘 레슨의 전사입니다. 자동 전사라 오탈자와 잡담이 섞여 있습니다.',
      '---',
      transcript,
      '---',
      '',
      '이 레슨에서 나온 지적사항을 구간과 표현 차원에 연결하고, 다음 레슨까지의 하루별 연습 스케줄을 짜 주세요.',
    ].join('\n');

    const res = await PA.ai.complete({
      system: coachSystem(),
      messages: [{ role: 'user', content: prompt }],
      schema: LESSON_SCHEMA,
      effort: 'high',
      maxTokens: 12000,
      signal,
    });

    if (!res.json) throw new Error('AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.');
    const j = res.json;
    const valid = new Set((song.sections || []).map((s) => s.id));
    return {
      summary: j.summary || '',
      issues: (j.issues || []).map((it) => ({
        text: it.text,
        sectionId: valid.has(it.sectionId) ? it.sectionId : null,
        dimension: it.dimension,
        severity: it.severity || 'mid',
        resolved: false,
        resolvedAt: null,
      })),
      directives: j.directives || [],
      schedule: (j.schedule || []).map((d) => ({
        day: d.day,
        focus: d.focus,
        tasks: (d.tasks || []).map((t) => ({ text: t, done: false })),
      })),
      positives: j.positives || [],
      engine: 'claude',
    };
  }

  /** 레슨 분석 진입점. AI 가능하면 AI, 아니면 규칙. */
  async function analyzeLesson(transcript, song, opts) {
    opts = opts || {};
    if (PA.ai.available() && !opts.forceRules) {
      try {
        return await aiAnalyzeLesson(transcript, song, opts.signal);
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        PA.util.toast('AI 분석 실패 — 규칙 분석으로 대체합니다. (' + e.message + ')', 'warn');
      }
    }
    return heuristicAnalyze(transcript, song);
  }

  /* ---------- 오늘의 연습 코치 ---------- */
  async function coachToday(song, metrics, signal) {
    const openIssues = PA.store.allIssues(song).filter((i) => !i.resolved);
    const secLines = (song.sections || []).map((s) => {
      const r = song.ratings[s.id] || {};
      const scores = DIMS.map((d) => `${d.label} ${r[d.id] || 0}`).join(' / ');
      const recs = (song.recordings || []).filter((x) => x.sectionId === s.id).length;
      return `- ${s.name} (${s.bars || '-'}) — ${scores} · 녹음 ${recs}개`;
    }).join('\n');

    const prompt = [
      `곡: ${song.composer} — ${song.title}`,
      `완성도 ${metrics.completeness}점 (템포 ${metrics.tempoScore}/30, 표현 ${metrics.expressionScore}/30, 녹음검증 ${metrics.recordScore}/20, 지적해소 ${metrics.issueScore}/20)`,
      `7일 향상도 ${metrics.improvement >= 0 ? '+' : ''}${metrics.improvement}점`,
      metrics.stagnation.length ? `정체 신호: ${metrics.stagnation.map((s) => s.text).join(' / ')}` : '정체 신호 없음',
      '',
      '구간별 별점(5점 만점):',
      secLines,
      '',
      openIssues.length ? '미해소 지적:\n' + openIssues.map((i) => `- ${i.text}`).join('\n') : '미해소 지적 없음',
      '',
      '오늘 45~60분 동안 무엇을 어떤 순서로 연습해야 하는지 정해 주세요.',
      '한 차원만 고르고, 왜 그 차원인지 한 문장으로 말한 뒤, 3~4개의 실행 단계를 주세요.',
      '마지막에 오늘 녹음해서 확인할 것 한 가지를 지정하세요.',
    ].join('\n');

    const res = await PA.ai.complete({
      system: coachSystem(),
      messages: [{ role: 'user', content: prompt }],
      effort: 'high',
      maxTokens: 4000,
      signal,
    });
    return res.text;
  }

  /** 키 없이 쓰는 규칙 기반 오늘의 처방 */
  function coachTodayRules(song, metrics) {
    const open = PA.store.allIssues(song).filter((i) => !i.resolved);
    const weakest = weakestDimension(song);
    const dimLabel = (PA.store.DIM_MAP[weakest.dim] || {}).label || '표현';
    const sec = song.sections.find((s) => s.id === weakest.sectionId);
    const lines = [];
    lines.push(`오늘의 한 차원: **${dimLabel}**`);
    lines.push(`이유: ${sec ? sec.name : '전체'} 구간의 ${dimLabel} 점수가 ${weakest.value}점으로 가장 낮습니다.`);
    lines.push('');
    lines.push(`1. ${sec ? sec.name : '가장 약한 구간'}을 목표 템포의 60%로 2회 — ${dimLabel}만 의식합니다.`);
    lines.push(`2. 같은 구간을 녹음하고 음량 곡선을 봅니다.`);
    lines.push(`3. 곡선에서 눈에 띄는 문제 하나만 고쳐 다시 녹음하고 A/B로 겹쳐 봅니다.`);
    if (open.length) lines.push(`4. 미해소 지적 확인: "${open[0].text.slice(0, 60)}"`);
    lines.push('');
    lines.push(`오늘 검증할 것: ${sec ? sec.name : '해당 구간'}의 ${dimLabel} — 두 녹음의 곡선이 눈으로 구분되면 성공입니다.`);
    return lines.join('\n');
  }

  function weakestDimension(song) {
    let best = { dim: 'dynamics', sectionId: null, value: 5 };
    (song.sections || []).forEach((sec) => {
      const r = song.ratings[sec.id];
      if (!r) { if (best.value > 0) best = { dim: sec.focus || 'dynamics', sectionId: sec.id, value: 0 }; return; }
      DIMS.forEach((d) => {
        const v = r[d.id] || 0;
        if (v < best.value) best = { dim: d.id, sectionId: sec.id, value: v };
      });
    });
    return best;
  }

  /* ---------- 롤모델: 명연주 발굴 ---------- */
  async function findRoleModels(song, signal) {
    const prompt = [
      `${song.composer} — ${song.title}${song.work ? ' (' + song.work + ')' : ''} 의 유튜브 명연주를 찾아 주세요.`,
      '',
      '조건:',
      '- 실제로 유튜브에 존재하는 영상만. 링크를 확인하고 제시하세요.',
      '- 해석이 서로 뚜렷하게 다른 연주 3~5개를 고르세요. 비슷한 연주만 모으지 마세요.',
      '- 각각에 대해 템포 / 다이내믹 / 페달링 / 성격을 한 줄씩 적고, 어떤 점에서 서로 다른지 밝히세요.',
      '- 중학생이 참고할 만한지도 한 줄로 판단해 주세요.',
      '',
      '아래 JSON 형식으로만 답하세요. 다른 말은 붙이지 마세요.',
      '{"results":[{"performer":"","year":"","url":"","title":"","tempo":"","dynamics":"","pedal":"","character":"","forStudent":""}],"comparison":""}',
    ].join('\n');

    const res = await PA.ai.complete({
      system: coachSystem(),
      messages: [{ role: 'user', content: prompt }],
      tools: [PA.ai.WEB_SEARCH_TOOL],
      effort: 'high',
      maxTokens: 8000,
      signal,
    });
    const parsed = PA.ai.looseJSON(res.text);
    if (!parsed || !Array.isArray(parsed.results)) {
      throw new Error('검색 결과를 해석하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
    return parsed;
  }

  /** 내 녹음 vs 롤모델 해석 비교 노트 */
  async function compareWithRoleModel(song, roleModel, myMetrics, signal) {
    const prompt = [
      `곡: ${song.composer} — ${song.title}`,
      `롤모델: ${roleModel.performer}${roleModel.year ? ' (' + roleModel.year + ')' : ''}`,
      roleModel.url ? `링크: ${roleModel.url}` : '',
      '',
      '롤모델 해석 메모:',
      `- 템포: ${roleModel.interpretation.tempo || '(미입력)'}`,
      `- 다이내믹: ${roleModel.interpretation.dynamics || '(미입력)'}`,
      `- 페달: ${roleModel.interpretation.pedal || '(미입력)'}`,
      `- 성격: ${roleModel.interpretation.character || '(미입력)'}`,
      '',
      '내 최근 녹음의 음량 곡선 지표:',
      `- 다이내믹 폭 ${myMetrics.range} (0~1)`,
      `- 곡선 일관성 ${myMetrics.shape} (1에 가까울수록 정점이 하나)`,
      `- 정점 위치 ${Math.round(myMetrics.peakAt * 100)}% 지점`,
      `- 방향 전환 ${myMetrics.steps}회`,
      '',
      '내 연주가 이 롤모델과 어디서 갈라지는지, 그 차이가 의도인지 미숙인지 짚어 주세요.',
      '따라 해야 할 것 2가지와 따라 하지 않아도 될 것 1가지를 구분해 주세요.',
    ].join('\n');

    const res = await PA.ai.complete({
      system: coachSystem(),
      messages: [{ role: 'user', content: prompt }],
      effort: 'high',
      maxTokens: 4000,
      signal,
    });
    return res.text;
  }

  /** 녹음 음량 곡선에 대한 짧은 코멘트 */
  async function commentOnRecording(song, section, m, compareResult, signal) {
    const lines = [
      `곡: ${song.composer} — ${song.title}`,
      section ? `구간: ${section.name} (${section.bars || '-'}) · 성격: ${section.character || '-'}` : '구간: 지정 안 됨',
      '',
      '이번 녹음의 음량 곡선 지표:',
      `- 다이내믹 폭 ${m.range}`,
      `- 곡선 일관성 ${m.shape}`,
      `- 정점 위치 ${Math.round(m.peakAt * 100)}%`,
      `- 방향 전환 ${m.steps}회`,
    ];
    if (compareResult) {
      lines.push('', '이전 녹음과 비교:',
        `- 상관 ${compareResult.correlation}`,
        `- 다이내믹 폭 변화 ${compareResult.rangeDelta >= 0 ? '+' : ''}${compareResult.rangeDelta}`,
        `- 곡선 일관성 변화 ${compareResult.shapeDelta >= 0 ? '+' : ''}${compareResult.shapeDelta}`);
    }
    lines.push('', '이 수치가 실제 연주에서 무엇을 뜻하는지 3문장 이내로 말하고, 다음 녹음에서 바꿀 것 하나만 지정해 주세요.');

    const res = await PA.ai.complete({
      system: coachSystem(),
      messages: [{ role: 'user', content: lines.join('\n') }],
      effort: 'medium',
      maxTokens: 1500,
      signal,
    });
    return res.text;
  }

  PA.analysis = {
    analyzeLesson, heuristicAnalyze, coachToday, coachTodayRules,
    findRoleModels, compareWithRoleModel, commentOnRecording,
    weakestDimension, sentences, guessDimension, guessSection,
  };
})(window.PA);
