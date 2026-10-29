/*
 * Dynty Tower Defense service worker (offline play).
 * Template: customize_browser_html.py replaces 5a3f7468867286cf and {"release": "5a3f7468867286cf", "apk": "endless-crafting-defense.apk?release=5a3f7468867286cf", "precache": ["index.html", "release-manifest.json", "endless-crafting-defense.apk?release=5a3f7468867286cf", "favicon.png", "manifest.webmanifest", "icon-192.png", "icon-512.png", "https://pygame-web.github.io/archives/0.9/pythons.js", "https://pygame-web.github.io/archives/0.9/browserfs.min.js", "https://pygame-web.github.io/archives/0.9/cpython312/main.js", "https://pygame-web.github.io/archives/0.9/cpython312/main.data", "https://pygame-web.github.io/archives/0.9/cpython312/main.wasm", "https://pygame-web.github.io/archives/repo/index-090-cp312.json", "https://pygame-web.github.io/archives/repo/repodata.json", "https://pygame-web.github.io/archives/repo/cp312/pygame_static-1.0-cp312-cp312-wasm32_bi_emscripten.whl"]} when it writes sw.js
 * into the browser release, so every release gets its own cache (dynty-td-<release key>).
 *
 * Strategies:
 *  - Pygbag runtime (pygame-web.github.io/archives/*) and the APK: cache-first. Their URLs are versioned
 *    or immutable, so a cached copy never goes stale; a miss is fetched once and stored.
 *  - index.html and release-manifest.json (and navigations): network-first with a timeout, cache fallback.
 *  - *.supabase.co (leaderboard API): never cached, never intercepted.
 *  - Everything else: left to the browser.
 */
const CONFIG = {"release": "5a3f7468867286cf", "apk": "endless-crafting-defense.apk?release=5a3f7468867286cf", "precache": ["index.html", "release-manifest.json", "endless-crafting-defense.apk?release=5a3f7468867286cf", "favicon.png", "manifest.webmanifest", "icon-192.png", "icon-512.png", "https://pygame-web.github.io/archives/0.9/pythons.js", "https://pygame-web.github.io/archives/0.9/browserfs.min.js", "https://pygame-web.github.io/archives/0.9/cpython312/main.js", "https://pygame-web.github.io/archives/0.9/cpython312/main.data", "https://pygame-web.github.io/archives/0.9/cpython312/main.wasm", "https://pygame-web.github.io/archives/repo/index-090-cp312.json", "https://pygame-web.github.io/archives/repo/repodata.json", "https://pygame-web.github.io/archives/repo/cp312/pygame_static-1.0-cp312-cp312-wasm32_bi_emscripten.whl"]};
const CACHE = "dynty-td-5a3f7468867286cf";
const CDN_HOST = "pygame-web.github.io";
const NETWORK_TIMEOUT_MS = 4000;
const NETWORK_FIRST_FILES = ["index.html", "release-manifest.json"];

function scopeUrl(path) {
  return new URL(path, self.registration.scope).href;
}

function basename(url) {
  return url.pathname.split("/").pop();
}

function isCdnArchive(url) {
  return url.hostname === CDN_HOST && url.pathname.startsWith("/archives/");
}

function isSameOriginApk(url) {
  return url.origin === self.location.origin && url.pathname.endsWith(".apk");
}

function isCacheableUrl(url) {
  return isCdnArchive(url) || isSameOriginApk(url);
}

// Fetch with CORS; cross-origin files that refuse CORS are stored as opaque responses (status 0).
async function storeFromNetwork(cache, url, init) {
  let response;
  try {
    response = await fetch(url, Object.assign({ mode: "cors" }, init));
  } catch (error) {
    response = await fetch(url, Object.assign({ mode: "no-cors" }, init));
  }
  if (response.ok || response.type === "opaque") {
    await cache.put(url, response.clone());
  }
  return response;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("network timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function networkFirst(request, url) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then(async (response) => {
    if (response.ok) {
      await cache.put(url.href, response.clone());
    }
    return response;
  });
  network.catch(() => undefined);
  try {
    return await withTimeout(network, NETWORK_TIMEOUT_MS);
  } catch (error) {
    const cached = await cache.match(url.href, { ignoreSearch: true })
      || (request.mode === "navigate" ? await cache.match(scopeUrl("index.html"), { ignoreSearch: true }) : undefined);
    if (cached) {
      return cached;
    }
    return network;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request.url);
  if (cached) {
    return cached;
  }
  return storeFromNetwork(cache, request.url);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(CONFIG.precache.map((path) => (
      storeFromNetwork(cache, scopeUrl(path), { cache: "reload" }).catch(() => undefined)
    )));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith("dynty-td-") && key !== CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.hostname.endsWith(".supabase.co")) {
    return;
  }
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && (request.mode === "navigate" || NETWORK_FIRST_FILES.includes(basename(url)))) {
    event.respondWith(networkFirst(request, url));
  } else if (isCacheableUrl(url)) {
    event.respondWith(cacheFirst(request));
  }
});

// The page reports the runtime files it actually loaded (Resource Timing), so the first online
// visit fills the cache even though the service worker only controls the page after it activates.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "warm" || !Array.isArray(data.urls)) {
    return;
  }
  const urls = data.urls.filter((value) => {
    try {
      return typeof value === "string" && isCacheableUrl(new URL(value));
    } catch (error) {
      return false;
    }
  });
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of urls) {
      if (!(await cache.match(url))) {
        await storeFromNetwork(cache, url).catch(() => undefined);
      }
    }
  })());
});
