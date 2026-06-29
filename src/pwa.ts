// PWA assets served from routes (no binary files to commit). A maskable SVG icon
// keeps things simple while remaining installable on Android via "Add to Home Screen".

const THEME = '#2563eb';

export const MANIFEST = JSON.stringify({
  name: 'Library Card Tracker',
  short_name: 'Library',
  description: 'Physical checkout capacity across your library cards.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#ffffff',
  theme_color: THEME,
  icons: [
    { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
  ],
});

// Simple book glyph on a rounded brand-colored tile. Centered in an 80% safe zone
// so it survives maskable cropping.
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${THEME}"/>
  <g fill="#ffffff">
    <path d="M150 150c40-18 86-18 106 4 20-22 66-22 106-4v210c-40-18-86-18-106 0-20-18-66-18-106 0V150z" opacity="0.95"/>
    <rect x="248" y="150" width="16" height="214" rx="8"/>
  </g>
</svg>`;

// App-shell service worker: network-first for navigations (fresh capacity when
// online, last-known page when offline), cache-first for the icon/manifest.
export const SW_JS = `const CACHE = 'libcard-v1';
const SHELL = ['/icons/icon.svg', '/manifest.webmanifest'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('/', copy));
        return res;
      }).catch(() => caches.match('/').then((r) => r || caches.match('/manifest.webmanifest'))),
    );
    return;
  }
  if (SHELL.includes(new URL(req.url).pathname)) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req)));
  }
});`;

// Tags injected into the dashboard <head>.
export const HEAD_TAGS = `
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="${THEME}" />
  <link rel="apple-touch-icon" href="/icons/icon.svg" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="Library" />
  <script>if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}</script>`;
