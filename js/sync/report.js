/* ===== 아카이브용 리포트 생성 =====
   state.json은 앱이 읽는 형식이지 사람이 읽는 형식이 아니다.
   몇 년 뒤에 폴더를 열었을 때 앱 없이도 무슨 일이 있었는지 알 수 있어야
   아카이빙이라고 할 수 있다. 그래서 마크다운 리포트와 CSV를 함께 쓴다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';
  const U = PA.util;
  const DIMS = PA.store.DIMENSIONS;

  const pad = (s, n) => String(s == null ? '' : s).padEnd(n);
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));

  /* ---------- 마크다운 분석 리포트 ---------- */
  function markdown() {
    const st = PA.store.get();
    const now = new Date();
    const L = [];

    L.push('# 피아노 연습 아카이브');
    L.push('');
    L.push(`생성: ${now.toLocaleString('ko-KR')}`);
    L.push(`앱 버전: ${PA.VERSION} · 기기: ${PA.backup.deviceName()}`);
    L.push('');

    /* 전체 요약 */
    const totalSec = st.songs.reduce((a, s) => a + PA.store.totalPractice(s), 0);
    const allDays = new Set();
    st.songs.forEach((s) => (s.practiceLog || []).forEach((l) => allDays.add(l.date)));
    L.push('## 전체');
    L.push('');
    L.push(`- 곡 ${st.songs.length}개`);
    L.push(`- 누적 연습 ${U.fmtMinutes(totalSec)} (${allDays.size}일)`);
    L.push(`- 녹음 ${st.songs.reduce((a, s) => a + (s.recordings || []).length, 0)}개`);
    L.push(`- 레슨 ${st.songs.reduce((a, s) => a + (s.lessons || []).length, 0)}회`);
    L.push('');

    /* 곡별 */
    st.songs.forEach((song) => {
      const m = PA.metrics.summary(song);
      L.push('---');
      L.push('');
      L.push(`## ${song.title}${song.composer ? ' — ' + song.composer : ''}`);
      L.push('');
      if (song.work) L.push(`*${song.work}*`);
      L.push('');
      L.push(`- **완성도 ${m.completeness}/100**` +
        ` (템포 ${m.tempoScore}/30 · 표현 ${m.expressionScore}/30 · 녹음검증 ${m.recordScore}/20 · ` +
        (m.issueApplicable ? `지적해소 ${m.issueScore}/20` : '지적해소 측정불가') + ')');
      L.push(`- 7일 향상도 ${m.improvement >= 0 ? '+' : ''}${m.improvement}점`);
      L.push(`- 템포 ♩=${song.tempoCurrent} / 목표 ♩=${song.tempoTarget}`);
      L.push(`- 누적 연습 ${U.fmtMinutes(PA.store.totalPractice(song))}`);
      L.push('');

      /* 구간별 별점표 */
      if (song.sections.length) {
        L.push('### 구간별 표현 5차원');
        L.push('');
        L.push('| 구간 | 마디 | ' + DIMS.map((d) => d.label).join(' | ') + ' | 평균 |');
        L.push('|---|---|' + DIMS.map(() => '---').join('|') + '|---|');
        song.sections.forEach((sec) => {
          const r = song.ratings[sec.id] || {};
          const vals = DIMS.map((d) => r[d.id] || 0);
          L.push(`| ${sec.name} | ${sec.bars || '-'} | ` +
            vals.map((v) => stars(v)).join(' | ') +
            ` | ${U.round1(U.avg(vals)).toFixed(1)} |`);
        });
        L.push('');

        // 구간 메모
        const memos = song.sections.filter((s) => (song.ratings[s.id] || {}).memo);
        if (memos.length) {
          L.push('#### 구간 메모');
          L.push('');
          memos.forEach((sec) => {
            L.push(`**${sec.name}**`);
            L.push('');
            L.push('> ' + song.ratings[sec.id].memo.replace(/\n/g, '\n> '));
            L.push('');
          });
        }
      }

      /* 정체 신호 */
      if (m.stagnation.length) {
        L.push('### 정체 신호');
        L.push('');
        m.stagnation.forEach((s) => L.push(`- **${s.text}** — ${s.hint}`));
        L.push('');
      }

      /* 녹음 */
      const recs = song.recordings || [];
      if (recs.length) {
        L.push('### 녹음');
        L.push('');
        L.push('| 날짜 | 구간 | 길이 | 템포 | 다이내믹 폭 | 곡선 일관성 | 정점 | 파일 |');
        L.push('|---|---|---|---|---|---|---|---|');
        recs.forEach((rec) => {
          const sec = song.sections.find((x) => x.id === rec.sectionId);
          const em = PA.envelope.metrics(rec.envelope || []);
          const file = rec.blobKey ? `recordings/${rec.blobKey}.${PA.backup.extOf(rec.mime)}` : '-';
          L.push(`| ${rec.createdAt} | ${sec ? sec.name : '-'} | ${U.fmtDur(rec.duration)} | ` +
            `${rec.tempo || '-'} | ${em.range.toFixed(2)} | ${em.shape.toFixed(2)} | ` +
            `${Math.round(em.peakAt * 100)}% | ${file} |`);
        });
        L.push('');
      }

      /* 레슨 */
      (song.lessons || []).forEach((les) => {
        L.push(`### 레슨 — ${les.date}${les.teacher ? ' (' + les.teacher + ')' : ''}`);
        L.push('');
        const a = les.analysis;
        if (!a) { L.push('*분석 전*'); L.push(''); return; }
        L.push(a.summary || '');
        L.push('');
        if ((a.issues || []).length) {
          L.push('**지적사항**');
          L.push('');
          a.issues.forEach((it) => {
            const sec = song.sections.find((x) => x.id === it.sectionId);
            const dim = (PA.store.DIM_MAP[it.dimension] || {}).label || '';
            L.push(`- [${it.resolved ? 'x' : ' '} ] ${it.text}` +
              `  \n  *${dim}${sec ? ' · ' + sec.name : ''}${it.severity === 'high' ? ' · 중요' : ''}` +
              `${it.resolved && it.resolvedAt ? ' · ' + it.resolvedAt + ' 해소' : ''}*`);
          });
          L.push('');
        }
        if ((a.directives || []).length) {
          L.push('**연습 지시**');
          L.push('');
          a.directives.forEach((d, i) => L.push(`${i + 1}. ${d}`));
          L.push('');
        }
        if ((a.schedule || []).length) {
          L.push('**하루별 스케줄**');
          L.push('');
          a.schedule.forEach((day) => {
            const dim = (PA.store.DIM_MAP[day.focus] || {}).label || '';
            L.push(`- **${day.day}일차 — ${dim}**`);
            (day.tasks || []).forEach((t) => L.push(`  - [${t.done ? 'x' : ' '}] ${t.text}`));
          });
          L.push('');
        }
        if (les.transcript) {
          L.push('<details><summary>원본 전사</summary>');
          L.push('');
          L.push('```');
          L.push(les.transcript);
          L.push('```');
          L.push('');
          L.push('</details>');
          L.push('');
        }
      });

      /* 롤모델 */
      if ((song.roleModels || []).length) {
        L.push('### 롤모델');
        L.push('');
        song.roleModels.forEach((rm) => {
          L.push(`**${rm.performer}${rm.year ? ' (' + rm.year + ')' : ''}**${rm.isPrimary ? ' — 주 롤모델' : ''}`);
          if (rm.url) L.push(`  \n  ${rm.url}`);
          const ip = rm.interpretation || {};
          [['템포', ip.tempo], ['다이내믹', ip.dynamics], ['페달', ip.pedal], ['성격', ip.character]]
            .filter(([, v]) => v).forEach(([k, v]) => L.push(`  - ${k}: ${v}`));
          if (rm.compare) { L.push(''); L.push('  > ' + rm.compare.replace(/\n/g, '\n  > ')); }
          L.push('');
        });
      }
    });

    L.push('---');
    L.push('');
    L.push('*이 파일은 앱이 자동 생성했습니다. 원본 데이터는 같은 폴더의 `state.json`에 있습니다.*');
    return L.join('\n');
  }

  /* ---------- CSV ----------
     엑셀이 UTF-8을 제대로 읽으려면 BOM이 필요하다. */
  const BOM = '﻿';
  const csvCell = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csvRows = (rows) => BOM + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

  function practiceCsv() {
    const rows = [['날짜', '곡', '구간', '분', '템포', '메모']];
    PA.store.songs().forEach((song) => {
      (song.practiceLog || []).slice()
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .forEach((l) => {
          const sec = song.sections.find((x) => x.id === l.sectionId);
          rows.push([l.date, song.title, sec ? sec.name : '', Math.round((l.seconds || 0) / 60), l.tempo || '', l.note || '']);
        });
    });
    return csvRows(rows);
  }

  function ratingCsv() {
    const rows = [['날짜', '곡', '구간', ...DIMS.map((d) => d.label), '평균']];
    PA.store.songs().forEach((song) => {
      song.sections.forEach((sec) => {
        const r = song.ratings[sec.id];
        if (!r || !r.history) return;
        r.history.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((h) => {
          const vals = DIMS.map((d) => h[d.id] || 0);
          rows.push([h.date, song.title, sec.name, ...vals, U.round1(U.avg(vals)).toFixed(1)]);
        });
      });
    });
    return csvRows(rows);
  }

  function recordingCsv() {
    const rows = [['날짜', '곡', '구간', '이름', '길이(초)', '템포', '다이내믹폭', '곡선일관성', '정점위치', '방향전환', '파일']];
    PA.store.songs().forEach((song) => {
      (song.recordings || []).slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).forEach((rec) => {
        const sec = song.sections.find((x) => x.id === rec.sectionId);
        const m = PA.envelope.metrics(rec.envelope || []);
        rows.push([
          rec.createdAt, song.title, sec ? sec.name : '', rec.label || '',
          Math.round(rec.duration || 0), rec.tempo || '',
          m.range.toFixed(3), m.shape.toFixed(3), (m.peakAt).toFixed(3), m.steps,
          rec.blobKey ? `recordings/${rec.blobKey}.${PA.backup.extOf(rec.mime)}` : '',
        ]);
      });
    });
    return csvRows(rows);
  }

  /** 백업에 함께 쓸 파일 묶음 */
  function files() {
    return [
      { path: 'reports/분석리포트.md', blob: new Blob([markdown()], { type: 'text/markdown;charset=utf-8' }) },
      { path: 'reports/연습기록.csv', blob: new Blob([practiceCsv()], { type: 'text/csv;charset=utf-8' }) },
      { path: 'reports/별점이력.csv', blob: new Blob([ratingCsv()], { type: 'text/csv;charset=utf-8' }) },
      { path: 'reports/녹음분석.csv', blob: new Blob([recordingCsv()], { type: 'text/csv;charset=utf-8' }) },
    ];
  }

  PA.report = { markdown, practiceCsv, ratingCsv, recordingCsv, files };
})(window.PA);
