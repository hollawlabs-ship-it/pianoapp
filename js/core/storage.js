/* ===== 저장 공간 관리 =====
   폰에서 쓸 때 이 앱의 가장 큰 위험은 버그가 아니라 '기록이 조용히 사라지는 것'이다.

   iOS 사파리는 홈 화면에 추가하지 않은 사이트의 저장소(localStorage·IndexedDB)를
   7일간 방문이 없으면 통째로 지운다. 안드로이드 크롬도 저장 공간이 부족하면
   'best-effort' 저장소를 먼저 버린다. 둘 다 경고 없이 일어난다.

   그래서 두 가지를 한다.
     1) navigator.storage.persist()로 '지우지 말 것' 표시를 요청한다.
     2) 남은 용량을 사람이 볼 수 있게 노출한다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';

  const ua = navigator.userAgent;
  const isIOS = () => /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS는 Mac으로 위장한다
  const isAndroid = () => /Android/.test(ua);
  const isMobile = () => isIOS() || isAndroid();

  /** 홈 화면에서 실행 중인가 (iOS는 standalone, 그 외는 display-mode) */
  function isStandalone() {
    if (window.navigator.standalone === true) return true;
    return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  }

  /** 이미 영구 저장소로 표시돼 있는가 */
  async function isPersisted() {
    if (!navigator.storage || !navigator.storage.persisted) return false;
    try { return await navigator.storage.persisted(); } catch (e) { return false; }
  }

  /**
   * 영구 저장소를 요청한다.
   * 크롬은 사용 이력·홈화면 추가 여부 등을 보고 조용히 허용/거부한다.
   * 사파리는 이 API를 지원하지 않으므로 홈 화면 추가가 유일한 방어책이다.
   */
  async function requestPersist() {
    if (!navigator.storage || !navigator.storage.persist) return { supported: false, granted: false };
    try {
      if (await isPersisted()) return { supported: true, granted: true };
      const granted = await navigator.storage.persist();
      return { supported: true, granted };
    } catch (e) {
      return { supported: true, granted: false, error: e.message };
    }
  }

  /** 사용량/할당량 (바이트). 지원하지 않으면 null */
  async function estimate() {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    try {
      const e = await navigator.storage.estimate();
      return { usage: e.usage || 0, quota: e.quota || 0 };
    } catch (e) { return null; }
  }

  const fmtBytes = (n) => {
    if (n == null) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  };

  /**
   * 이 기기에서 기록이 사라질 위험이 있는지 한 줄로 판정한다.
   * 위험을 낮게 말하지 않는다 — 사라진 뒤에는 되돌릴 방법이 없다.
   */
  async function risk() {
    const persisted = await isPersisted();
    const standalone = isStandalone();
    const backedUp = PA.backup && PA.backup.isConnected();

    if (isIOS() && !standalone) {
      return {
        level: 'high',
        text: '7일 동안 열지 않으면 iOS가 기록을 통째로 지웁니다',
        fix: '공유 버튼 → "홈 화면에 추가"를 하면 이 규칙에서 벗어납니다.',
      };
    }
    if (!persisted && !backedUp) {
      return {
        level: 'mid',
        text: '저장 공간이 부족해지면 브라우저가 기록을 먼저 지울 수 있습니다',
        fix: '드라이브를 연결해 백업해 두거나, 홈 화면에 추가하세요.',
      };
    }
    if (!backedUp) {
      return {
        level: 'low',
        text: '이 기기에만 기록이 있습니다',
        fix: '기기를 잃어버리면 함께 사라집니다. 드라이브 연결을 권합니다.',
      };
    }
    return { level: 'none', text: '백업되어 있습니다', fix: '' };
  }

  /* ---------- 화면 꺼짐 방지 ----------
     폰에서 녹음 중 화면이 꺼지면 브라우저가 정지되어 녹음이 끊긴다. */
  let lock = null;
  async function keepAwake() {
    if (!('wakeLock' in navigator)) return false;
    try {
      lock = await navigator.wakeLock.request('screen');
      // 탭이 백그라운드로 갔다 오면 잠금이 풀려 있으므로 다시 건다
      document.addEventListener('visibilitychange', reacquire);
      return true;
    } catch (e) { return false; }
  }
  async function reacquire() {
    if (document.visibilityState === 'visible' && lock !== null) {
      try { lock = await navigator.wakeLock.request('screen'); } catch (e) {}
    }
  }
  async function releaseAwake() {
    document.removeEventListener('visibilitychange', reacquire);
    try { if (lock) await lock.release(); } catch (e) {}
    lock = null;
  }

  PA.storage = {
    isIOS, isAndroid, isMobile, isStandalone,
    isPersisted, requestPersist, estimate, fmtBytes, risk,
    keepAwake, releaseAwake,
  };
})(window.PA);
