/* Service Worker(SPEC §8.10)
 * ・アプリシェルは install 時の precache だけで持つ。更新は SW_VERSION を上げたときだけ(新しいキャッシュ名で再 precache、activate で旧キャッシュ削除)。
 *   ※ シェル(JS/CSS/i18n など)のファイルを変更したら必ず SW_VERSION を上げること。
 * ・同一 SW_VERSION の間は、シェルのファイルを実行時に取得して上書きしない(JS/CSS/i18n が新旧混在になるのを防ぐ)。
 * ・唯一の例外はナビゲーション(HTMLへの遷移)だけ stale-while-revalidate。
 * ・APIは一切キャッシュしない(別オリジンは素通し)。 */
var SW_VERSION = '1.0.0-7';
var CACHE = 'katawaku-shell-' + SW_VERSION;
var SHELL = [
  './', 'index.html', 'styles.css', 'config.js', 'i18n.js', 'manifest.webmanifest',
  'vendor/qrcode.js',
  'js/core.js', 'js/time.js', 'js/db.js', 'js/api.js', 'js/validate.js', 'js/outbox.js', 'js/photo.js', 'js/data.js', 'js/sync.js',
  'js/ui/components.js', 'js/ui/modals.js', 'js/ui/s01.js', 'js/ui/s03.js', 'js/ui/s06.js', 'js/ui/s08.js', 'js/ui/s09.js', 'js/ui/s10.js', 'js/ui/s11.js', 'js/ui/s16.js',
  'js/app.js', 'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('katawaku-shell-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API(別オリジン)は素通し
  if (req.mode === 'navigate') {
    // ナビゲーションのみ: キャッシュを返しつつ裏で取得して更新
    e.respondWith(caches.open(CACHE).then(function (cache) {
      return cache.match('./').then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.ok) cache.put('./', res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    }));
    return;
  }
  // それ以外: precache のみ。ヒットすれば返し、無ければネットワーク(キャッシュには書かない)
  e.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(req).then(function (hit) { return hit || fetch(req); });
  }));
});
