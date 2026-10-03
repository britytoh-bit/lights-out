#!/usr/bin/env python3
# sw.js를 다시 만듭니다. 게임 파일(index.html, lib-*, font-*, icon-*, tex-*, manifest.webmanifest)을 고치거나 더한 뒤에는
# 꼭 이 폴더에서 실행하세요:  python3 make-sw.py
# Rebuilds sw.js (offline cache + automatic updates): every game file in this folder with a fingerprint of its content
# (sha-256, first 16 hex digits) and a version made from those fingerprints. Run it after changing any game file.
import hashlib, json, os

D = os.path.dirname(os.path.abspath(__file__))


def is_game(f):
    return f in ('index.html', 'manifest.webmanifest') or f.startswith(('lib-', 'font-', 'icon-', 'tex-'))


names = sorted(f for f in os.listdir(D) if os.path.isfile(os.path.join(D, f)) and is_game(f))
assert 'index.html' in names, 'index.html not found next to make-sw.py'
names.remove('index.html')
names.insert(0, 'index.html')
FILES = [[f, hashlib.sha256(open(os.path.join(D, f), 'rb').read()).hexdigest()[:16]] for f in names]
VERSION = hashlib.sha256(json.dumps(FILES).encode()).hexdigest()[:12]

SW = '''// 라이츠 아웃 3D - offline cache and automatic updates for the installed web app.
// Made by make-sw.py - do not edit by hand: change the game files, then run  python3 make-sw.py
// - The game page (index.html): the newest copy from the site when online (waits at most 4 s), otherwise the saved copy.
// - Every other file: the saved copy (fast, works offline); a file that is not saved yet comes from the site and is kept.
// - FILES lists every game file with a fingerprint of its content. When any file changes, VERSION changes: the browser
//   installs this new worker, the page switches to the new files (in the menu, never during a race).
// - A file whose fingerprint does not match (the site is still being updated) stops the install: the old version keeps
//   running and the browser tries again on the next visit.
const VERSION = '%s';
const SCOPE = new URL(self.registration.scope).pathname;
const CACHE = 'lo3d:' + SCOPE + ':' + VERSION;
const FILES = %s;
const hex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    try {
      await Promise.all(FILES.map(async ([f, h]) => {
        const res = await fetch(new Request(f, { cache: 'no-cache' }));
        if (!res.ok) throw new Error(f + ': ' + res.status);
        const buf = await res.arrayBuffer();
        if (hex(await crypto.subtle.digest('SHA-256', buf)).slice(0, 16) !== h) throw new Error(f + ': not updated yet');
        await c.put(f, new Response(buf, { status: res.status, statusText: res.statusText, headers: res.headers }));
      }));
    } catch (err) { await caches.delete(CACHE); throw err; }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k.startsWith('lo3d:' + SCOPE + ':')) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  if (r.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const net = fetch(new Request(r.url, { cache: 'no-cache' }))
        .then(res => { if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) c.put('index.html', res.clone()); return res; })
        .catch(() => null);
      const first = await Promise.race([net, new Promise(ok => setTimeout(ok, 4000, null))]);
      if (first && first.ok) return first;
      return (await c.match('index.html')) || (await net) || Response.error();
    })());
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(r, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(r);
    if (res.ok) c.put(r, res.clone());
    return res;
  })());
});
''' % (VERSION, json.dumps(FILES))
open(os.path.join(D, 'sw.js'), 'w', encoding='utf-8').write(SW)
print(f'sw.js: {len(FILES)} game files, version {VERSION}')
