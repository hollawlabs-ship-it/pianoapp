/* ===== 전사 텍스트 받아들이기 =====
   클로바노트에서 나온 텍스트를 앱으로 옮기는 통로를 모아 둔다.

   왜 필요한가:
   클로바노트에는 공개 API가 없고, Web Share Target은 iOS Safari가 지원하지
   않는다. 그래서 '클로바노트가 앱으로 밀어넣는' 길은 아이폰에서 막혀 있다.
   남은 건 '앱이 가져오는' 길뿐이라, 그 손품을 최대한 줄이는 게 목표다.

   세 갈래를 둔다.
     1) 붙여넣기 버튼  — 클립보드를 읽는다. iOS는 누를 때마다 확인을 띄우지만
                        길게 눌러 선택하는 것보다 훨씬 짧다. 어디서나 된다.
     2) 공유 대상      — 안드로이드에서 공유 시트에 이 앱이 뜬다. (iOS 미지원)
     3) URL 파라미터   — iOS 단축어가 텍스트를 실어 앱을 열 수 있게 한다.

   클립보드 읽기는 반드시 사용자 제스처 안에서 불러야 한다. 앱이 알아서
   훔쳐보는 동작은 만들지 않는다 — iOS가 막기도 하고, 그래서도 안 된다. */
window.PA = window.PA || {};

(function (PA) {
  'use strict';

  /** 클립보드 읽기가 가능한 환경인지. */
  const canRead = () => !!(navigator.clipboard && navigator.clipboard.readText);

  /**
   * 클립보드에서 글을 읽는다. 반드시 클릭 핸들러 안에서 부를 것.
   * @returns {Promise<string>} 읽은 글. 실패하면 사람이 읽을 수 있는 오류를 던진다.
   */
  async function readText() {
    if (!canRead()) {
      throw new Error('이 브라우저는 붙여넣기 버튼을 지원하지 않습니다. 전사 칸에 직접 붙여넣어 주세요.');
    }
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch (e) {
      /* iOS에서 확인 팝업을 취소해도 여기로 온다 — 오류가 아니라 취소다. */
      if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
        throw new Error('붙여넣기를 취소했습니다.');
      }
      throw new Error('클립보드를 읽지 못했습니다. 전사 칸에 직접 붙여넣어 주세요.');
    }
    if (!(text || '').trim()) {
      throw new Error('클립보드가 비어 있습니다. 클로바노트에서 전사를 먼저 복사하세요.');
    }
    return text;
  }

  /* ---- 밖에서 들어온 텍스트 ---------------------------------------- */

  /**
   * 주소에 실려 온 전사를 꺼낸다. 두 경로가 같은 모양이라 함께 처리한다.
   *   - 안드로이드 공유 대상:  ?text=...&title=...
   *   - iOS 단축어:           ?t=... (짧게 쓰려고 따로 둔다)
   * 꺼낸 뒤에는 주소에서 지운다. 새로고침할 때 또 들어오면 곤란하다.
   */
  function takeIncoming() {
    let q;
    try { q = new URLSearchParams(location.search); } catch (e) { return null; }
    const text = (q.get('t') || q.get('text') || '').trim();
    if (!text) return null;

    const title = (q.get('title') || '').trim();
    /* 주소를 즉시 비운다. 전사가 주소창과 방문 기록에 남지 않게 하는
       뜻도 있다 — 레슨 내용은 아이에 대한 기록이다. */
    try {
      history.replaceState(null, '', location.origin + location.pathname + location.hash);
    } catch (e) {}

    return { text, title };
  }

  /** 전사로 볼 만한 길이인지. 너무 짧으면 잘못 복사한 것이다. */
  const looksLikeTranscript = (t) => (t || '').trim().length >= 30;

  PA.intake = { canRead, readText, takeIncoming, looksLikeTranscript };
})(window.PA);
