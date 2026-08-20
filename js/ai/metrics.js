/* ===== 데이터 분석: 완성도 지수 · 향상도 · 정체 감지 =====
   완성도 = 템포 30 + 표현 30 + 녹음검증 20 + 지적해소 20 (합 100)
   앱 자체는 학습하지 않는다. 쌓인 데이터를 읽어 숫자로 옮길 뿐이다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';
  const { clamp, todayKey, addDays, daysBetween, avg } = PA.util;
  const DIMS = PA.store.DIMENSIONS;

  const RECENT_DAYS = 14;      // 녹음 검증 유효 기간
  const STAGNANT_DAYS = 12;    // 정체 판정 기준
  const GRACE_DAYS = 2;        // 지적을 받은 직후엔 아직 못 고친 게 정상이다

  /* ---------- 항목별 점수 ---------- */

  /** 템포 30점 — 목표 대비 현재 템포. 목표의 70%부터 점수가 붙는다. */
  function tempoScore(song) {
    const target = song.tempoTarget || 1;
    const cur = song.tempoCurrent || 0;
    const ratio = clamp(cur / target, 0, 1);
    const scaled = clamp((ratio - 0.5) / 0.5, 0, 1);   // 목표의 50% 이하 = 0점
    return Math.round(scaled * 30);
  }

  /** 표현 30점 — 전 구간 × 5차원 별점 평균. */
  function expressionScore(song) {
    const secs = song.sections || [];
    if (!secs.length) return 0;
    const vals = [];
    secs.forEach((sec) => {
      const r = song.ratings[sec.id];
      DIMS.forEach((d) => vals.push(r ? (r[d.id] || 0) : 0));
    });
    return Math.round((avg(vals) / 5) * 30);
  }

  /** 녹음검증 20점 — 최근 14일 안에 녹음으로 확인된 구간의 비율. */
  function recordScore(song) {
    const secs = song.sections || [];
    if (!secs.length) return 0;
    const cutoff = addDays(todayKey(), -RECENT_DAYS);
    const verified = secs.filter((sec) =>
      (song.recordings || []).some((r) => r.sectionId === sec.id && r.createdAt >= cutoff)
    ).length;
    return Math.round((verified / secs.length) * 20);
  }

  /**
   * 지적해소 20점 — 해소 기한이 지난 지적 중 실제로 해소된 비율.
   *
   * 두 가지를 일부러 피한다.
   *  1) 오늘 받은 지적 때문에 완성도가 떨어지는 것 — 어제 들은 말을 오늘 못 고친 건 정상이다.
   *     그래서 GRACE_DAYS 안의 지적은 분모에서 뺀다.
   *  2) 레슨을 한 번도 안 받은 곡이 "지적 0건"으로 공짜 20점을 먹는 것.
   *     측정할 근거가 없으면 만점이 아니라 '측정 불가'로 두고, 나머지 80점을 100점으로 환산한다.
   */
  function issueScore(song) {
    const issues = PA.store.allIssues(song);
    const today = todayKey();
    const due = issues.filter((i) => daysBetween(i.lessonDate, today) >= GRACE_DAYS);
    const hasAnalysis = (song.lessons || []).some((l) => l.analysis);

    if (!due.length) {
      // 기한이 지난 지적이 없다 → 분석된 레슨이 있으면 만점, 아니면 측정 불가
      if (!hasAnalysis) return { value: 0, applicable: false, due: 0, done: 0 };
      return { value: 20, applicable: true, due: 0, done: issues.filter((i) => i.resolved).length };
    }
    const done = due.filter((i) => i.resolved).length;
    return { value: Math.round((done / due.length) * 20), applicable: true, due: due.length, done };
  }

  /* ---------- 완성도 지수 ---------- */
  function completeness(song) {
    const t = tempoScore(song);
    const e = expressionScore(song);
    const r = recordScore(song);
    const iss = issueScore(song);
    const raw = t + e + r + (iss.applicable ? iss.value : 0);
    const total = iss.applicable ? raw : Math.round((raw / 80) * 100);
    return {
      tempoScore: t,
      expressionScore: e,
      recordScore: r,
      issueScore: iss.value,
      issueApplicable: iss.applicable,
      issuesDue: iss.due,
      issuesDone: iss.done,
      completeness: clamp(total, 0, 100),
    };
  }

  /* ---------- 과거 완성도 재구성 ----------
     스냅샷이 있으면 그것을, 없으면 별점 히스토리로 표현 점수만 되짚어 근사한다. */
  function completenessAt(song, dateKey) {
    const snap = (song.snapshots || []).filter((s) => s.date <= dateKey).pop();
    if (snap && snap.completeness != null) return snap.completeness;

    const secs = song.sections || [];
    if (!secs.length) return null;
    const vals = [];
    secs.forEach((sec) => {
      const r = song.ratings[sec.id];
      if (!r || !r.history || !r.history.length) { DIMS.forEach(() => vals.push(0)); return; }
      const past = r.history.filter((h) => h.date <= dateKey).pop();
      DIMS.forEach((d) => vals.push(past ? (past[d.id] || 0) : 0));
    });
    const expr = Math.round((avg(vals) / 5) * 30);

    // 그 시점 이후의 연습 로그를 뺀 템포 근사 (기록이 없으면 현재값 유지)
    const t = tempoScore(song);
    const cutoff = addDays(dateKey, -RECENT_DAYS);
    const verified = secs.filter((sec) =>
      (song.recordings || []).some((x) => x.sectionId === sec.id && x.createdAt >= cutoff && x.createdAt <= dateKey)
    ).length;
    const rec = Math.round((verified / secs.length) * 20);

    // 지적해소도 현재와 같은 규칙(유예 기간 · 측정 불가)으로 계산해야 향상도가 일관된다
    const issues = PA.store.allIssues(song).filter((i) => i.lessonDate <= dateKey);
    const due = issues.filter((i) => daysBetween(i.lessonDate, dateKey) >= GRACE_DAYS);
    const hadAnalysis = (song.lessons || []).some((l) => l.analysis && l.date <= dateKey);
    const resolvedBy = (i) => i.resolved && i.resolvedAt && i.resolvedAt <= dateKey;

    let iScore = 0, applicable = true;
    if (!due.length) {
      if (hadAnalysis) iScore = 20;
      else applicable = false;
    } else {
      iScore = Math.round((due.filter(resolvedBy).length / due.length) * 20);
    }

    const raw = t + expr + rec + (applicable ? iScore : 0);
    return clamp(applicable ? raw : Math.round((raw / 80) * 100), 0, 100);
  }

  /** 향상도 — 7일 전 대비 완성도 변화. */
  function improvement(song, days) {
    days = days || 7;
    const now = completeness(song).completeness;
    const then = completenessAt(song, addDays(todayKey(), -days));
    if (then == null) return 0;
    return Math.round(now - then);
  }

  /* ---------- 정체 감지 ---------- */
  /**
   * 세 갈래로 본다.
   *  1) 전체 완성도가 12일간 거의 안 움직였는데 연습은 계속하고 있다 → 방법의 문제
   *  2) 특정 구간의 별점이 12일 넘게 그대로이고 3점 이하 → 그 구간이 막혔다
   *  3) 레슨 지적이 두 번의 레슨을 넘겨 미해소 → 같은 말을 또 듣게 된다
   */
  function stagnation(song) {
    const out = [];
    const today = todayKey();

    // 1) 완성도 정체
    const now = completeness(song).completeness;
    const before = completenessAt(song, addDays(today, -STAGNANT_DAYS));
    const recentPractice = (song.practiceLog || [])
      .filter((l) => l.date >= addDays(today, -STAGNANT_DAYS))
      .reduce((a, b) => a + (b.seconds || 0), 0);
    if (before != null && Math.abs(now - before) < 3 && recentPractice > 3 * 3600) {
      out.push({
        kind: 'overall',
        severity: 'high',
        text: `${STAGNANT_DAYS}일간 완성도가 ${Math.abs(now - before)}점밖에 움직이지 않았습니다`,
        hint: '연습량은 유지되고 있으니 시간이 아니라 방법을 바꿔야 합니다. 오늘은 차원을 하나만 골라 그것만 하세요.',
      });
    }

    // 2) 구간 정체
    (song.sections || []).forEach((sec) => {
      const r = song.ratings[sec.id];
      if (!r) return;
      const mean = avg(DIMS.map((d) => r[d.id] || 0));
      if (mean > 3.2) return;
      const last = r.updatedAt;
      if (!last) return;
      const idle = daysBetween(last, today);
      if (idle >= STAGNANT_DAYS) {
        out.push({
          kind: 'section',
          sectionId: sec.id,
          severity: mean <= 2 ? 'high' : 'mid',
          text: `${sec.name} — 평균 ${PA.util.round1(mean)}점에서 ${idle}일째 그대로`,
          hint: '별점이 안 움직인다는 건 최근에 이 구간을 다시 듣지 않았다는 뜻일 수도 있습니다. 녹음부터 하세요.',
        });
      }
    });

    // 3) 지적 미해소
    const issues = PA.store.allIssues(song).filter((i) => !i.resolved);
    const lessonsSince = {};
    (song.lessons || []).forEach((l) => { lessonsSince[l.date] = true; });
    issues.forEach((i) => {
      const age = daysBetween(i.lessonDate, today);
      const laterLessons = (song.lessons || []).filter((l) => l.date > i.lessonDate).length;
      if (laterLessons >= 2 || age >= 14) {
        out.push({
          kind: 'issue',
          severity: 'high',
          sectionId: i.sectionId,
          text: `${age}일 전 지적이 아직 그대로: "${i.text.slice(0, 44)}${i.text.length > 44 ? '…' : ''}"`,
          hint: '오늘 이것 하나만 붙잡으세요. 해결되면 지적 카드를 체크해 두면 됩니다.',
        });
      }
    });

    return out.slice(0, 6);
  }

  /* ---------- 구간별 향상 곡선 ---------- */
  function sectionCurve(song, sectionId, days) {
    days = days || 14;
    const r = song.ratings[sectionId];
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = addDays(todayKey(), -i);
      let val = null;
      if (r && r.history && r.history.length) {
        const past = r.history.filter((h) => h.date <= k).pop();
        if (past) val = avg(DIMS.map((d) => past[d.id] || 0));
      }
      out.push({ date: k, value: val });
    }
    // 앞쪽 null은 첫 실측값으로 채워 선이 끊기지 않게 한다
    const firstIdx = out.findIndex((p) => p.value != null);
    if (firstIdx > 0) for (let i = 0; i < firstIdx; i++) out[i].value = out[firstIdx].value;
    let last = null;
    out.forEach((p) => { if (p.value == null) p.value = last; else last = p.value; });
    return out;
  }

  /* ---------- 곡 전체 요약 ---------- */
  function summary(song) {
    const c = completeness(song);
    return Object.assign(c, {
      improvement: improvement(song, 7),
      stagnation: stagnation(song),
      totalPractice: PA.store.totalPractice(song),
      openIssues: PA.store.allIssues(song).filter((i) => !i.resolved).length,
      totalIssues: PA.store.allIssues(song).length,
      sectionsVerified: (song.sections || []).filter((sec) =>
        (song.recordings || []).some((r) => r.sectionId === sec.id && r.createdAt >= addDays(todayKey(), -RECENT_DAYS))
      ).length,
    });
  }

  /** 하루 한 번 스냅샷을 남겨 다음 향상도 계산의 기준으로 삼는다. */
  function snapshotAll() {
    PA.store.songs().forEach((song) => {
      const c = completeness(song);
      PA.store.pushSnapshot(song.id, c);
    });
  }

  /** 곡 간 연습량 비교 */
  function compareSongs(days) {
    days = days || 14;
    const since = addDays(todayKey(), -days + 1);
    return PA.store.songs().map((song) => {
      const secs = (song.practiceLog || [])
        .filter((l) => l.date >= since)
        .reduce((a, b) => a + (b.seconds || 0), 0);
      const c = completeness(song);
      return {
        id: song.id, title: song.title, composer: song.composer, glyph: song.glyph,
        seconds: secs, completeness: c.completeness, improvement: improvement(song, 7),
      };
    }).sort((a, b) => b.seconds - a.seconds);
  }

  PA.metrics = {
    completeness, completenessAt, improvement, stagnation, sectionCurve,
    summary, snapshotAll, compareSongs,
    tempoScore, expressionScore, recordScore, issueScore,
    RECENT_DAYS, STAGNANT_DAYS,
  };
})(window.PA);
