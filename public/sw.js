"use strict";
// Replacement for the old cache worker: remove sensitive cached masters, then retire.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (/^field-worklog-/.test(key)) await caches.delete(key);
  await self.clients.claim();
  await self.registration.unregister();
})()));

