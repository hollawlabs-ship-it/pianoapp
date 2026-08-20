/* ===== 메트로놈 =====
   setInterval은 드리프트가 있으므로 AudioContext 시계로 미리 스케줄한다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';

  const LOOKAHEAD = 0.12;   // 초 — 앞당겨 예약하는 구간
  const TICK_MS = 25;

  function create() {
    let bpm = 60, beatsPerBar = 4, running = false;
    let nextTime = 0, beat = 0, timer = null, accent = true;
    let onBeat = null;

    function click(time, isDown) {
      const ctx = PA.envelope.audioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const band = ctx.createBiquadFilter();

      band.type = 'bandpass';
      band.frequency.value = isDown ? 1800 : 1200;
      band.Q.value = 1.2;

      osc.type = 'square';
      osc.frequency.value = isDown ? 1600 : 1050;

      const peak = isDown ? 0.30 : 0.17;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(peak, time + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);

      osc.connect(band); band.connect(gain); gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 0.07);
    }

    function schedule() {
      const ctx = PA.envelope.audioCtx();
      while (nextTime < ctx.currentTime + LOOKAHEAD) {
        const isDown = accent && beat % beatsPerBar === 0;
        click(nextTime, isDown);
        if (onBeat) {
          const b = beat, t = nextTime;
          setTimeout(() => onBeat(b % beatsPerBar, b), Math.max(0, (t - ctx.currentTime) * 1000));
        }
        nextTime += 60 / bpm;
        beat++;
      }
    }

    function start() {
      if (running) return;
      const ctx = PA.envelope.audioCtx();
      running = true;
      beat = 0;
      nextTime = ctx.currentTime + 0.06;
      schedule();
      timer = setInterval(schedule, TICK_MS);
    }

    function stop() {
      running = false;
      clearInterval(timer);
      timer = null;
    }

    function toggle() { running ? stop() : start(); return running; }

    return {
      start, stop, toggle,
      get running() { return running; },
      get bpm() { return bpm; },
      set bpm(v) { bpm = PA.util.clamp(Math.round(v), 20, 260); },
      get beatsPerBar() { return beatsPerBar; },
      set beatsPerBar(v) { beatsPerBar = PA.util.clamp(Math.round(v), 1, 12); },
      set accent(v) { accent = !!v; },
      onBeat(fn) { onBeat = fn; },
    };
  }

  /* ---------- 연습 타이머 ---------- */
  function createTimer() {
    let startAt = 0, acc = 0, running = false, raf = null;
    let onTick = null;

    function loop() {
      if (onTick) onTick(elapsed());
      raf = requestAnimationFrame(loop);
    }
    function elapsed() {
      return acc + (running ? (performance.now() - startAt) / 1000 : 0);
    }
    return {
      start() {
        if (running) return;
        running = true; startAt = performance.now(); loop();
      },
      pause() {
        if (!running) return;
        acc = elapsed(); running = false; cancelAnimationFrame(raf);
      },
      reset() { acc = 0; startAt = performance.now(); if (onTick) onTick(0); },
      get running() { return running; },
      get elapsed() { return elapsed(); },
      onTick(fn) { onTick = fn; },
    };
  }

  PA.metronome = { create, createTimer };
})(window.PA);
