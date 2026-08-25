/* ===== 서비스 워커 =====
   목적은 속도가 아니라 오프라인이다. 피아노 앞에서 인터넷이 끊겨도
   구간·별점·녹음·메트로놈은 그대로 돌아가야 한다.

   전략: 같은 출처는 network-first, 실패하면 캐시.
   cache-first를 쓰면 배포 직후 낡은 파일이 계속 나오는 사고가 나기 쉽다.
   앱이 작아서 network-first로도 충분히 빠르다.

   ⚠️ 자산을 바꾸면 아래 VERSION을 반드시 올릴 것. 안 올리면 옛 캐시가 남는다. */

const VERSION = 'v6.11.0';
const CACHE = `pianoapp-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/base.css',
  './css/components.css',
  './js/core/util.js',
  './js/core/seed.js',
  './js/core/store.js',
  './js/core/storage.js',
  './js/core/intake.js',
  './js/audio/envelope.js',
  './js/audio/recorder.js',
  './js/audio/lessonrec.js',
  './js/audio/metronome.js',
  './js/ai/client.js',
  './js/ai/stt.js',
  './js/ai/analysis.js',
  './js/ai/metrics.js',
  './js/sync/providers.js',
  './js/sync/report.js',
  './js/sync/backup.js',
  './js/ui/sheets.js',
  './js/ui/charts.js',
  './js/ui/player.js',
  './js/ui/practice.js',
  './js/ui/home.js',
  './js/ui/lesson.js',
  './js/ui/trends.js',
  './js/ui/rolemodel.js',
  './js/ui/app.js',
  './assets/icon.svg',
  './assets/icon-maskable.svg',
  './assets/apple-touch-icon-180.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // 하나라도 실패하면 설치 전체가 실패하는 addAll 대신 개별 처리한다.
      // 자산 하나 때문에 오프라인 기능을 통째로 잃는 편이 더 나쁘다.
      .then((cache) => Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n.startsWith('pianoapp-') && n !== CACHE)
             .map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // GET만 다룬다
  if (req.method !== 'GET') return;

  // 다른 출처는 손대지 않는다.
  // api.anthropic.com(키가 실린 요청)·유튜브 썸네일 등이 캐시에 남으면 안 된다.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // 정상 응답만 캐시에 반영
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => {
          if (hit) return hit;
          // 페이지 이동인데 캐시에도 없으면 앱 껍데기라도 돌려준다
          if (req.mode === 'navigate') return caches.match('./index.html');
          return new Response('오프라인입니다.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        })
      )
  );
});
