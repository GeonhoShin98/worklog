"use strict";

var CACHE_NAME = "field-worklog-v10-20260825";
var APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./vendor/jszip.min.js",
  "./app.js",
  "./manifest.webmanifest",
  "./data/mold-master.json",
  "./data/employee-master.json",
  "./data/master-data.xlsx"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) {
          return key !== CACHE_NAME;
        }).map(function (key) {
          return caches.delete(key);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(function (response) {
        if (response.ok) {
          var copy = response.clone();
          return caches.open(CACHE_NAME).then(function (cache) {
            return cache.put("./index.html", copy);
          }).then(function () {
            return response;
          });
        }
        return response;
      }).catch(function () {
        return caches.match("./index.html");
      })
    );
    return;
  }

  event.respondWith(
    fetch(request).then(function (response) {
      if (response.ok) {
        var copy = response.clone();
        return caches.open(CACHE_NAME).then(function (cache) {
          return cache.put(request, copy);
        }).then(function () {
          return response;
        });
      }
      return response;
    }).catch(function () {
      return caches.match(request).then(function (cached) {
        if (cached) {
          return cached;
        }
        return new Response("오프라인 상태에서 이 파일을 불러올 수 없습니다.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      });
    })
  );
});
