/* sw.js - offline support for the QR machine info sheets.
 *
 * Put this file in the ROOT of the fitterdm.github.io site so that it is reachable at
 *     https://fitterdm.github.io/sw.js
 * One copy covers every machine page on the site.
 *
 *  - Pages: network first (you always get the newest page when online, with a short
 *           time-out on slow signal), then the saved copy when offline.
 *  - Fonts / same-site files: saved on first use, refreshed in the background.
 */
const VERSION = 'fitter-qr-v1';
const PAGES   = VERSION + '-pages';
const ASSETS  = VERSION + '-assets';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const NAV_TIMEOUT_MS = 5000;

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* Page asks us to save itself right after its first visit. */
self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'CACHE_URL' && d.url) event.waitUntil(savePageAndFonts(d.url));
});

function pageKey(u) { return u.origin + u.pathname; }          // ignore ?query so QR links with tags still match

async function savePageAndFonts(href) {
  const u = new URL(href);
  if (u.origin !== self.location.origin) return;
  let html = '';
  try {
    const res = await fetch(u.href, { cache: 'reload' });
    if (res.ok) {
      const copy = res.clone();
      html = await res.text();
      await (await caches.open(PAGES)).put(pageKey(u), copy);
    }
  } catch (e) { return; }
  await saveFonts(html);
}

/* Find the Google Fonts stylesheet in the page, then save it and the font files it names. */
async function saveFonts(html) {
  const m = html.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"'<> ]+/);
  if (!m) return;
  const cssUrl = m[0].replace(/&amp;/g, '&');
  try {
    const cache = await caches.open(ASSETS);
    const cssRes = await fetch(cssUrl);
    if (!cssRes.ok) return;
    const css = await cssRes.clone().text();
    await cache.put(cssUrl, cssRes);
    const files = css.match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) || [];
    await Promise.all(files.map(async (f) => {
      try { const r = await fetch(f); if (r.ok) await cache.put(f, r); } catch (e) {}
    }));
  } catch (e) {}
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  if (req.mode === 'navigate') {
    if (url.origin === self.location.origin) event.respondWith(pageNetworkFirst(req, url));
    return;
  }
  if (url.origin === self.location.origin || FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(assetStaleWhileRevalidate(event, req));
  }
});

async function lookupPage(cache, url) {
  const key = pageKey(url);
  return (await cache.match(key)) ||
         (key.endsWith('/') ? await cache.match(key + 'index.html') : null) ||
         (key.endsWith('/index.html') ? await cache.match(key.slice(0, -'index.html'.length)) : null) ||
         (!key.endsWith('/') ? await cache.match(key + '/') : null);
}

async function pageNetworkFirst(req, url) {
  const cache = await caches.open(PAGES);
  const saved = await lookupPage(cache, url);
  try {
    const net = fetch(req);
    // With a saved copy, don't make the student wait on a bad signal; without one, wait for the network.
    const res = saved
      ? await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), NAV_TIMEOUT_MS))])
      : await net;
    if (res && res.ok && res.type === 'basic') cache.put(pageKey(url), res.clone());
    return res;
  } catch (e) {
    if (saved) return saved;
    return new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function assetStaleWhileRevalidate(event, req) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req, { ignoreVary: true });
  const refresh = fetch(req).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (hit) { event.waitUntil(refresh); return hit; }
  return (await refresh) || Response.error();
}

const OFFLINE_HTML = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<body style="font:17px/1.6 sans-serif;padding:32px;text-align:center;color:#0f172a">' +
  '<p>This page is not saved on this phone yet. Open it once while online, then it will work offline.</p>' +
  '<p>हे पृष्ठ अजून या फोनवर सेव्ह केलेले नाही. एकदा ऑनलाइन उघडा, मग ते ऑफलाइन चालेल.</p></body>';
