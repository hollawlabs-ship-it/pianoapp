/* ===== 초기 데이터 =====
   첫 실행 시 단테 소나타 6개 구간 카드를 깔아 둔다.
   레슨 1건은 "예시" 표시가 붙어 있고 지워도 된다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';
  const { uid, todayKey, addDays } = PA.util;

  const DANTE_SECTIONS = [
    {
      name: '서주 — 하강 트라이톤',
      bars: 'mm. 1–34',
      character: '지옥문. 옥타브 트라이톤이 세 번 떨어진다.',
      focus: 'tone',
      note: '느리게, 그러나 늘어지지 않게. 각 하강의 무게가 달라야 한다.',
    },
    {
      name: '제1주제 — 절규',
      bars: 'mm. 35–102',
      character: 'Presto agitato assai. 옥타브의 격류.',
      focus: 'dynamics',
      note: '빠르기보다 음량 곡선. ff가 계속 ff면 아무것도 아니다.',
    },
    {
      name: '경과부 — 반음계 상승',
      bars: 'mm. 103–123',
      character: '레치타티보풍. 숨을 고르는 자리.',
      focus: 'phrasing',
      note: '자유롭되 박은 살아 있어야 한다. 쉼표가 음악이다.',
    },
    {
      name: '제2주제 — F# 장조의 천상',
      bars: 'mm. 124–180',
      character: 'Andante. 프란체스카의 노래.',
      focus: 'legato',
      note: '손가락 레가토 먼저, 페달은 나중. 오른손 선율만 남기기.',
    },
    {
      name: '전개·재현 — 격정',
      bars: 'mm. 181–290',
      character: '두 주제가 맞붙는다.',
      focus: 'pedal',
      note: '화성이 바뀌는 지점마다 페달을 갈아야 흐려지지 않는다.',
    },
    {
      name: '코다 — D장조 승천',
      bars: 'mm. 291–끝',
      character: '트라이톤이 완전5도로 풀린다.',
      focus: 'dynamics',
      note: '마지막 세 마디를 위해 앞의 20마디를 아껴 둘 것.',
    },
  ];

  const CHOPIN_SECTIONS = [
    { name: '제시 — 첫 16마디', bars: 'mm. 1–16', character: '오른손 16분음표의 사슬.', focus: 'legato' },
    { name: '왼손 전환부', bars: 'mm. 17–34', character: '주도권이 왼손으로 넘어간다.', focus: 'phrasing' },
    { name: '전개 — 반음계', bars: 'mm. 35–58', character: '양손 교차.', focus: 'tone' },
    { name: '코다', bars: 'mm. 59–끝', character: 'presto con fuoco.', focus: 'dynamics' },
  ];

  function makeSections(list, targetTempo) {
    return list.map((s) =>
      Object.assign({ id: uid('sec'), targetTempo: targetTempo, note: '' }, s)
    );
  }

  function sampleLesson(sections) {
    const [intro, theme1, , theme2] = sections;
    return {
      id: uid('lesson'),
      date: addDays(todayKey(), -2),
      teacher: '',
      sample: true,
      transcript:
        '(예시 데이터입니다. 실제 클로바노트 전사를 붙여넣고 다시 분석하세요.)\n\n' +
        '선생님: 서주에서 세 번 떨어지는 트라이톤이 다 똑같은 소리로 들려요. ' +
        '첫 번째는 묻는 소리, 두 번째는 좀 더 확신, 세 번째는 체념. 무게를 다르게 두세요.\n' +
        '선생님: 제1주제는 지금 처음부터 끝까지 포르티시모예요. 그러면 클라이맥스가 없어요. ' +
        '들어갈 때는 메조포르테로 시작해서 40마디쯤에서 한 번 부풀렸다가 다시 빼고, 그다음에 진짜로 올라가야 합니다.\n' +
        '선생님: F# 장조 부분은 페달로 이어 붙이고 있는데, 손가락으로 먼저 이어 보세요. ' +
        '페달 떼고 오른손 선율만 레가토로 완성한 다음에 페달을 얹는 순서로.',
      analyzedAt: addDays(todayKey(), -2),
      analyzedBy: 'sample',
      analysis: {
        summary:
          '표현의 층위가 평평하다는 지적이 반복됨. 세 구간 모두 "차이를 만들라"는 같은 주문이며, ' +
          '해결 순서는 서주(무게) → 제1주제(음량 곡선) → 제2주제(손가락 레가토).',
        issues: [
          { text: '서주 트라이톤 세 번이 모두 같은 무게로 들림', sectionId: intro.id, dimension: 'tone', severity: 'high', resolved: false, resolvedAt: null },
          { text: '제1주제가 처음부터 ff로 시작해 클라이맥스가 사라짐', sectionId: theme1.id, dimension: 'dynamics', severity: 'high', resolved: false, resolvedAt: null },
          { text: '제2주제를 손가락이 아니라 페달로 잇고 있음', sectionId: theme2.id, dimension: 'legato', severity: 'mid', resolved: false, resolvedAt: null },
        ],
        directives: [
          '서주는 세 번의 하강에 각각 "질문 / 확신 / 체념"의 성격을 붙여 무게를 나눈다.',
          '제1주제는 mf로 시작해 40마디 부근에서 1차 부풀림, 되돌린 뒤 재상승하는 2단 구조로 설계한다.',
          '제2주제는 페달을 완전히 떼고 오른손 선율만 손가락 레가토로 완성한 다음 페달을 얹는다.',
        ],
        schedule: [
          { day: 1, focus: 'tone', tasks: [
            { text: '서주만 3회, 매회 하강의 성격을 다르게 두고 녹음', done: false },
            { text: '녹음 3개의 음량 곡선을 겹쳐 보고 차이가 보이는지 확인', done: false },
          ] },
          { day: 2, focus: 'dynamics', tasks: [
            { text: '제1주제 mm.35–70을 mf로만 통과 (ff 금지)', done: false },
            { text: '2단 부풀림 지점을 악보에 연필로 표시', done: false },
          ] },
          { day: 3, focus: 'legato', tasks: [
            { text: '제2주제 페달 없이 오른손만 느리게', done: false },
            { text: '왼손 추가, 여전히 페달 없이', done: false },
          ] },
          { day: 4, focus: 'legato', tasks: [
            { text: '제2주제에 페달을 얹고 녹음, 3일차 녹음과 A/B 비교', done: false },
          ] },
        ],
        engine: 'sample',
      },
    };
  }

  function samplePractice(sections) {
    const log = [];
    const pattern = [0, 45, 38, 0, 52, 61, 40, 55, 0, 48, 66, 35, 58, 50];
    pattern.forEach((min, i) => {
      if (!min) return;
      const date = addDays(todayKey(), -(pattern.length - 1 - i));
      log.push({
        id: uid('log'), date, seconds: min * 60,
        sectionId: sections[i % sections.length].id,
        tempo: 52 + i * 2, note: '',
      });
    });
    return log;
  }

  function sampleRatings(sections) {
    const r = {};
    const seedVals = [
      [3, 2, 3, 2, 2], [2, 3, 2, 2, 3], [3, 3, 2, 3, 3],
      [2, 2, 3, 2, 2], [2, 2, 2, 2, 2], [3, 3, 3, 2, 3],
    ];
    sections.forEach((sec, i) => {
      const v = seedVals[i] || [2, 2, 2, 2, 2];
      r[sec.id] = {
        dynamics: v[0], legato: v[1], phrasing: v[2], pedal: v[3], tone: v[4],
        memo: '', updatedAt: addDays(todayKey(), -3),
        history: [
          { date: addDays(todayKey(), -10), dynamics: Math.max(1, v[0] - 1), legato: Math.max(1, v[1] - 1), phrasing: Math.max(1, v[2] - 1), pedal: Math.max(1, v[3] - 1), tone: Math.max(1, v[4] - 1) },
          { date: addDays(todayKey(), -3), dynamics: v[0], legato: v[1], phrasing: v[2], pedal: v[3], tone: v[4] },
        ],
      };
    });
    return r;
  }

  function install(state) {
    const danteSections = makeSections(DANTE_SECTIONS, 84);
    const dante = {
      id: uid('song'),
      title: '단테 소나타',
      composer: 'F. Liszt',
      work: 'Après une lecture du Dante, S.161/7',
      keySig: 'd단조',
      glyph: '☠',
      tempoTarget: 84,
      tempoCurrent: 58,
      createdAt: addDays(todayKey(), -14),
      sections: danteSections,
      ratings: sampleRatings(danteSections),
      recordings: [],
      lessons: [sampleLesson(danteSections)],
      practiceLog: samplePractice(danteSections),
      roleModels: [],
      snapshots: [],
    };

    const chopinSections = makeSections(CHOPIN_SECTIONS, 152);
    const chopin = {
      id: uid('song'),
      title: '에튀드 Op.10 No.4',
      composer: 'F. Chopin',
      work: 'Étude in C♯ minor',
      keySig: 'c#단조',
      glyph: '⚡',
      tempoTarget: 152,
      tempoCurrent: 104,
      createdAt: addDays(todayKey(), -6),
      sections: chopinSections,
      ratings: {},
      recordings: [],
      lessons: [],
      practiceLog: [],
      roleModels: [],
      snapshots: [],
    };

    state.songs = [dante, chopin];
    state.activeSongId = dante.id;
    return state;
  }

  PA.seed = { install, DANTE_SECTIONS, CHOPIN_SECTIONS };
})(window.PA);
