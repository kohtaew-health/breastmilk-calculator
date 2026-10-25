/* Service Worker — เครื่องคำนวณน้ำนมแม่ รพ.สต.เกาะแต้ว
   เมื่อแก้ไขเว็บ ให้เปลี่ยนเลข VERSION ด้านล่าง เพื่อให้เครื่องผู้ใช้อัปเดต */
const VERSION = 'v1.0.0';
const CACHE = 'breastmilk-' + VERSION;
const FONT_CACHE = 'breastmilk-fonts-v1';

const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&family=Prompt:wght@400;500;600;700&display=swap';

// เก็บฟอนต์ภาษาไทย + ละติน ไว้ใช้ออฟไลน์
async function cacheFonts() {
  try {
    const cache = await caches.open(FONT_CACHE);
    const res = await fetch(FONT_CSS, { mode: 'cors' });
    if (!res.ok) return;
    const css = await res.clone().text();
    await cache.put(FONT_CSS, res);

    // แยกเฉพาะ subset thai และ latin
    const blocks = css.split('/*').slice(1);
    const urls = [];
    for (const b of blocks) {
      const label = b.slice(0, b.indexOf('*/')).trim();
      if (label === 'thai' || label === 'latin') {
        const m = b.match(/url\((https:[^)]+)\)/);
        if (m) urls.push(m[1]);
      }
    }
    await Promise.all(urls.map(async (u) => {
      try {
        const r = await fetch(u, { mode: 'cors' });
        if (r.ok) await cache.put(u, r);
      } catch (e) {}
    }));
  } catch (e) { /* ไม่มีเน็ตตอนติดตั้ง ก็ข้ามไป */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    await cacheFonts();
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('breastmilk-') && k !== CACHE && k !== FONT_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ลองโหลดจากเน็ตก่อน (เพื่อให้ได้เวอร์ชันใหม่) ถ้าช้า/ไม่มีเน็ต ใช้จากแคช
function networkFirst(request, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const useCache = async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      return cached || caches.match('./index.html');
    };
    const timer = setTimeout(async () => {
      const c = await useCache();
      if (c && !settled) { settled = true; resolve(c); }
    }, timeoutMs);

    fetch(request).then(async (res) => {
      clearTimeout(timer);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      if (!settled) { settled = true; resolve(res); }
    }).catch(async () => {
      clearTimeout(timer);
      if (!settled) { settled = true; resolve(await useCache() || Response.error()); }
    });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // หน้าเว็บหลัก
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, 3000));
    return;
  }

  // ฟอนต์ Google: cache-first
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(req, { ignoreVary: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (e) {
        return Response.error();
      }
    })());
    return;
  }

  // ไฟล์ในเว็บเดียวกัน: cache-first แล้วอัปเดตเบื้องหลัง
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      const fetching = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return hit || (await fetching) || Response.error();
    })());
  }
});
