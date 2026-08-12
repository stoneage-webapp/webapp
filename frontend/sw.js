/* 석기시대 PWA 서비스워커 — 오프라인 대비 + 빠른 로딩 (#8 운영/안정성)
 * 전략:
 *  - 앱 셸(HTML/CSS/JS): 네트워크 우선(항상 최신 우선, 실패 시 캐시) → 새 배포가 곧바로 반영되고 오프라인도 동작
 *  - 아이콘/이미지: 캐시 우선(정적이라 오래 캐시)
 *  - 크로스 오리진(GAS API 등): 손대지 않고 그대로 통과
 */
const CACHE = 'sga-v1';
const CORE = ['/', '/index.html', '/css/style.css', '/js/api.js', '/js/app.js', '/js/mock.js',
  '/manifest.json', '/favicon.ico', '/icons/icon-192.png'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE).catch(function () {}); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // GAS API 등은 통과 (SW가 관여 안 함)

  const isAsset = /\.(png|jpe?g|ico|svg|webp|gif)$/i.test(url.pathname);
  if (isAsset) {
    // 캐시 우선
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        });
      })
    );
  } else {
    // 네트워크 우선 (셸) — 실패 시 캐시, 그것도 없으면 홈으로 폴백
    e.respondWith(
      fetch(req).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) { return hit || caches.match('/index.html'); });
      })
    );
  }
});
