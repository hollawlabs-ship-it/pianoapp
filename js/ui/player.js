/* ===== 하단 플레이어 =====
   녹음 재생을 앱 어디서나 이어서 들을 수 있게 하단에 고정한다.
   재생 위치는 구독자(파형 캔버스 등)에게 브로드캐스트한다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';
  const { el, icon, fmtDur, toast } = PA.util;

  let bar, titleEl, subEl, playBtn, prog;
  let media = null, current = null, objectUrl = null;
  const listeners = new Set();

  function mount(root) {
    bar = el('div', { class: 'player', hidden: true });
    const btnBack = el('button', { class: 'btn icon sm', 'aria-label': '10초 뒤로', html: icon('refresh', 16), onclick: () => seekBy(-10) });
    playBtn = el('button', { class: 'btn icon primary', 'aria-label': '재생', html: icon('play', 18), onclick: toggle });
    const meta = el('div', { class: 'meta' }, [
      (titleEl = el('div', { class: 't', text: '' })),
      (subEl = el('div', { class: 's', text: '' })),
    ]);
    const closeBtn = el('button', { class: 'btn icon sm', 'aria-label': '닫기', html: icon('x', 16), onclick: stop });
    prog = el('progress', { value: 0, max: 1 });

    bar.appendChild(playBtn);
    bar.appendChild(btnBack);
    bar.appendChild(meta);
    bar.appendChild(closeBtn);
    bar.appendChild(prog);
    root.appendChild(bar);
  }

  /** 녹음 하나를 재생한다. rec = store의 recording 엔트리 */
  async function play(rec, song) {
    if (!rec || !rec.blobKey) { toast('재생할 오디오가 없습니다.', 'warn'); return; }
    if (current && current.id === rec.id && media) { toggle(); return; }

    stop();
    const blob = await PA.store.getBlob(rec.blobKey);
    if (!blob) { toast('녹음 파일을 찾을 수 없습니다.', 'warn'); return; }

    objectUrl = URL.createObjectURL(blob);
    const isVideo = (rec.kind === 'video');
    media = document.createElement(isVideo ? 'video' : 'audio');
    media.src = objectUrl;
    media.preload = 'auto';
    if (isVideo) {
      // 영상은 소리만 쓴다. 화면은 녹음 상세 시트에서 따로 본다.
      media.style.display = 'none';
      document.body.appendChild(media);
    }

    current = rec;
    const sec = song && (song.sections || []).find((s) => s.id === rec.sectionId);
    titleEl.textContent = rec.label || (sec ? sec.name : '녹음');
    subEl.textContent = [
      song ? song.title : '',
      PA.util.relDays(rec.createdAt),
      fmtDur(rec.duration),
    ].filter(Boolean).join(' · ');

    media.addEventListener('timeupdate', onTime);
    media.addEventListener('ended', onEnded);
    media.addEventListener('play', syncBtn);
    media.addEventListener('pause', syncBtn);

    bar.hidden = false;
    try { await media.play(); } catch (e) { /* 사용자 제스처 필요 시 무시 */ }
    syncBtn();
    emit();
  }

  function onTime() {
    if (!media || !media.duration) return;
    prog.value = media.currentTime / media.duration;
    emit();
  }
  function onEnded() { syncBtn(); emit(); }

  function syncBtn() {
    if (!playBtn) return;
    const playing = media && !media.paused && !media.ended;
    playBtn.innerHTML = icon(playing ? 'pause' : 'play', 18);
    playBtn.setAttribute('aria-label', playing ? '일시정지' : '재생');
  }

  function toggle() {
    if (!media) return;
    if (media.paused) media.play().catch(() => {});
    else media.pause();
    syncBtn();
  }

  function seekBy(sec) {
    if (!media) return;
    media.currentTime = PA.util.clamp(media.currentTime + sec, 0, media.duration || 0);
  }
  function seekTo(ratio) {
    if (!media || !media.duration) return;
    media.currentTime = PA.util.clamp(ratio, 0, 1) * media.duration;
  }

  function stop() {
    if (media) {
      media.pause();
      media.removeEventListener('timeupdate', onTime);
      media.removeEventListener('ended', onEnded);
      if (media.parentNode) media.parentNode.removeChild(media);
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    media = null; objectUrl = null; current = null;
    if (bar) { bar.hidden = true; prog.value = 0; }
    emit();
  }

  function emit() {
    const state = {
      recordingId: current ? current.id : null,
      progress: media && media.duration ? media.currentTime / media.duration : 0,
      playing: !!(media && !media.paused && !media.ended),
      currentTime: media ? media.currentTime : 0,
      duration: media ? media.duration : 0,
    };
    listeners.forEach((fn) => { try { fn(state); } catch (e) {} });
  }

  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const currentId = () => (current ? current.id : null);

  PA.player = { mount, play, stop, toggle, seekBy, seekTo, subscribe, currentId };
})(window.PA);
