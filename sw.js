// Service worker: guarda la app para que abra sin señal en planta.
// Estrategia "red primero": con señal siempre baja lo último; sin señal usa la copia.
// Al cambiar cualquier archivo de la app, subí VERSION para que se renueve la copia.
var VERSION = 'qualityos-v10';
var ARCHIVOS = [
  './', './index.html', './manifest.json', './css/styles.css',
  './vendor/supabase.js', './js/config.js', './js/reglas.js', './js/store.js',
  './js/nube.js', './js/imprimir.js', './js/app.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/qualityos.svg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(ARCHIVOS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (claves) {
    return Promise.all(claves.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  // Solo los archivos de la app. Los pedidos a Supabase van directo (nunca cacheados).
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(function (r) {
      if (r.ok) { var copia = r.clone(); caches.open(VERSION).then(function (c) { c.put(e.request, copia); }); }
      return r;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match('./index.html'); });
    })
  );
});
