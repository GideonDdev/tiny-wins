"use strict";

const CACHE_NAME = "tinywins-shell-v13";
const FIREBASE_SDK_FILES = [
  "https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js"
];
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=7",
  "./script.js?v=7",
  "./firebase-config.js",
  "./manifest.json",
  "./icons/tinywins.svg",
  "./icons/tinywins-192.png",
  "./icons/tinywins-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
      caches.open(CACHE_NAME).then((cache) => Promise.all(
        FIREBASE_SDK_FILES.map(async (url) => {
          try {
            const response = await fetch(url, { mode: "cors" });
            if (!response.ok) throw new Error(`Firebase SDK request failed with status ${response.status}.`);
            await cache.put(url, response);
          } catch (error) {
            console.warn(`Could not cache Firebase SDK file ${url}:`, error);
          }
        })
      ))
    ])
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("tinywins-shell-") && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || "./", self.location.origin);
    if (target.origin !== self.location.origin) target.href = new URL("./", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.navigate(target.href);
      await client.focus();
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  if (request.method !== "GET") return;

  if (FIREBASE_SDK_FILES.includes(request.url)) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;
        throw new Error("Firebase SDK is unavailable offline and has no cached copy.");
      })
    );
    return;
  }

  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          }
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match("./index.html");
          if (cachedPage) return cachedPage;
          return new Response("Tiny Wins is offline. Reconnect to the internet and try again.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
          });
        })
    );
    return;
  }

  if (requestUrl.pathname.endsWith(".js") || requestUrl.pathname.endsWith(".css") ||
      requestUrl.pathname.endsWith(".json") || requestUrl.pathname.endsWith(".svg") ||
      requestUrl.pathname.endsWith(".png")) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(async () => {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;
        throw new Error(`No cached offline copy for ${requestUrl.pathname}`);
      })
    );
  }
});
