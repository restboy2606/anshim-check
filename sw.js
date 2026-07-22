/* 안심체크 service worker
 * 전략: 온라인이면 항상 최신(network-first), 오프라인일 때만 캐시로 폴백.
 *  - 배포 직후 재방문자도 바로 새 버전을 보게 함 (cache-first의 stale 문제 회피)
 *  - /api/* 는 항상 네트워크
 *  - 오프라인 대비로 정적 셸은 설치 시 미리 캐시
 */
const CACHE_NAME = "anshim-check-v2";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.webmanifest",
  "./assets/mascot-officer.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // API는 항상 네트워크 (캐시 금지)
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req));
    return;
  }

  // 동일 출처 정적 자원: network-first → 실패 시 캐시 → 최후 index.html
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type !== "opaque") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(req)
            .then((cached) => cached || caches.match("./index.html"))
        )
    );
  }
});
