// Service worker for the installed app: caches this one page so it keeps working
// with no network. It never requests anything from another origin, and there is
// nothing else to cache - the page carries its own libraries, fonts and OCR engine.
const CACHE = 'pdf-tool-kit-a9be57f8cfa1';
const PAGE = './';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll([PAGE, './manifest.webmanifest', './icon.svg']))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;   // nothing off this origin, ever
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit =>
    hit || fetch(e.request).then(res => {
      if (res && res.ok && e.request.method === 'GET') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(PAGE))));
});
