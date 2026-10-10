// 라이츠 아웃 3D - offline cache and automatic updates for the installed web app.
// Made by make-sw.py - do not edit by hand: change the game files, then run  python3 make-sw.py
// - The game page (index.html): the newest copy from the site when online (waits at most 4 s), otherwise the saved copy.
// - Every other file: the saved copy (fast, works offline); a file that is not saved yet comes from the site and is kept.
// - FILES lists every game file with a fingerprint of its content. When any file changes, VERSION changes: the browser
//   installs this new worker, the page switches to the new files (in the menu, never during a race).
// - A file whose fingerprint does not match (the site is still being updated) stops the install: the old version keeps
//   running and the browser tries again on the next visit.
const VERSION = '110508558c62';
const SCOPE = new URL(self.registration.scope).pathname;
const CACHE = 'lo3d:' + SCOPE + ':' + VERSION;
const FILES = [["index.html", "c0f2661730374dbb"], ["font-saira-condensed-latin-500-normal.woff2", "22c6c5bf5a71e10f"], ["font-saira-condensed-latin-700-normal.woff2", "eb1cf59a1f785a89"], ["font-saira-condensed-latin-800-normal.woff2", "5afa98eefcd54d5e"], ["font-saira-condensed-latin-ext-500-normal.woff2", "da5cf8e6bb5d0632"], ["font-saira-condensed-latin-ext-700-normal.woff2", "f15c9a22d2d8f00b"], ["font-saira-condensed-latin-ext-800-normal.woff2", "645272c3bc699905"], ["font-saira-latin-400-normal.woff2", "f477825b1d839c77"], ["font-saira-latin-600-normal.woff2", "4f11a1744bd77518"], ["font-saira-latin-ext-400-normal.woff2", "cb487591a953711a"], ["font-saira-latin-ext-600-normal.woff2", "60964ee6d65e51e5"], ["icon-192.png", "53cbb1a1d6b0ea2d"], ["icon-512.png", "a2717d2438795214"], ["icon-apple-touch.png", "c66653f44581c746"], ["icon-favicon-32.png", "e77958553d142eab"], ["icon-maskable-512.png", "52e7ca1d83bf7b21"], ["lib-CopyShader.js", "6b5da4fe3b410286"], ["lib-EffectComposer.js", "4fc320fa31858477"], ["lib-FXAAShader.js", "0ea1d37b0b4568fd"], ["lib-GammaCorrectionShader.js", "77c8fdedf8f488b7"], ["lib-LuminosityHighPassShader.js", "00ed0682e61ca207"], ["lib-RenderPass.js", "57a549b2d6a947cd"], ["lib-ShaderPass.js", "2e64890b8e4c4daf"], ["lib-Sky.js", "c9d42cfe17d1ac33"], ["lib-UnrealBloomPass.js", "1ed342b273e9b077"], ["lib-three.min.js", "9274bbcec8d96168"], ["manifest.webmanifest", "d33e4395727a43f6"], ["tex-asphalt_c.jpg", "6251c8df4064eebe"], ["tex-asphalt_n.jpg", "31135a0da3628980"], ["tex-asphalt_r.jpg", "c409f783b6567b2e"], ["tex-carbon_c.jpg", "37ac437e96a9916a"], ["tex-carbon_n.jpg", "cd33b4b1d0529702"], ["tex-env_city_day.jpg", "54eb91ab4dd704ef"], ["tex-env_city_sunset.jpg", "86c2f56f15e2e413"], ["tex-env_desert_day.jpg", "4493c7f0bfa13adc"], ["tex-env_desert_sunset.jpg", "3aee415a33ebfc8f"], ["tex-env_forest_day.jpg", "33de7d0c506f6d65"], ["tex-env_forest_sunset.jpg", "82d92e8f09f40d06"], ["tex-env_park_day.jpg", "3dcdbef46189e86c"], ["tex-env_park_sunset.jpg", "cfc5af19d6b187fe"], ["tex-env_rain.jpg", "c63a7b8248a5af65"], ["tex-facade_c.jpg", "b3422d2011a8805d"], ["tex-facade_rm.jpg", "032df70d65fd0999"], ["tex-fence.png", "07d59743e2c1f498"], ["tex-grass_c.jpg", "532b87f4c5e889f5"], ["tex-grass_n.jpg", "3426a5445b1e021b"], ["tex-gravel_c.jpg", "2ee67abf8dccef18"], ["tex-gravel_n.jpg", "71cd7e0cec2ec7f5"], ["tex-kerb_c.jpg", "5e5b1aea6abe37c9"], ["tex-kerb_n.jpg", "fa1e2e3eb1dd9a0c"], ["tex-tree_a.png", "87925e71e5ebbe19"], ["tex-tree_b.png", "08808868c1c33e56"], ["tex-tree_c.png", "30df15757ff13e5d"], ["tex-tree_fir.png", "c84acbdef384f843"], ["tex-tree_palm.png", "26ddaffb8d4c4a52"]];
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
