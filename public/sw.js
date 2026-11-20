/*
 * Zaki Workspace's service worker. Two jobs.
 *
 * 1. Notifications (src/server/calls/push.ts sends them, src/server/notify.ts the notes, src/server/push-chat.ts a private chat's follow-up messages): show a
 *    ring, a missed call or one of the bell's notifications that arrives while the site is closed, and open its page on a tap. A chat message is ONE notification
 *    per conversation (its `tag` is the conversation's id, `renotify` alerts again on each new message, the last few lines stack in its body). The words come
 *    from the server, already in Arabic.
 *
 * 2. The installed app's shell (M1a): a versioned cache named from the build (`zaki-shell-<build>`, the page sends the build's id and files in a `zaki-shell`
 *    message), served cache-first for the build's hashed files (`/_next/static/`), the fonts and the icons; a navigation goes to the NETWORK first and, only
 *    when there is no network, gets the offline page (`/offline`). What is NEVER touched: `/api/` (the data lives in the chat's IndexedDB, which sign-out wipes),
 *    and any page's HTML is never stored (it carries the person's own data and would outlive their sign-out). Nothing else is intercepted, so the site works
 *    exactly as without the worker.
 */
"use strict";

var SHELL_PREFIX = "zaki-shell-";
var META_CACHE = "zaki-meta";
var CURRENT_KEY = "/__current";
var OFFLINE_URL = "/offline";
var SHELL_PATHS = ["/_next/static/", "/fonts/", "/icons/"];
var MAX_FILES = 120;
var MAX_LINES = 5;
/* The same sentence as src/lib/i18n/ar.nav-v2.json `mobile.offline.message` (tests/pwa-offline.test.ts pins that they agree). */
var OFFLINE_MESSAGE = "ما في نت — الرسائل اللي بتكتبها رح تنبعت لما يرجع";

self.addEventListener("install", function () {
  self.skipWaiting();
});
self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

/** The conversation a push's page is (`/chat/<id>`, also wrapped in `/go?...&next=`), or null. Same rules as src/lib/pwa/notifications.ts. */
function conversationOfUrl(url) {
  if (!url) return null;
  var target;
  try {
    target = new URL(url, self.location.origin);
  } catch (e) {
    return null;
  }
  if (target.pathname === "/go") {
    var next = target.searchParams.get("next");
    if (!next) return null;
    try {
      target = new URL(next, self.location.origin);
    } catch (e) {
      return null;
    }
  }
  var parts = target.pathname.split("/").filter(Boolean);
  if (parts[0] !== "chat" || parts.length < 2 || parts[1] === "s") return null;
  try {
    return decodeURIComponent(parts[1]) || null;
  } catch (e) {
    return null;
  }
}

/** A line of a stacked notification: {t: who, b: the words}; the first version stored bare strings. */
function lineOf(entry) {
  if (typeof entry === "string") return { t: "", b: entry };
  return { t: entry && entry.t ? String(entry.t) : "", b: entry && entry.b ? String(entry.b) : "" };
}

function isShellPath(path) {
  return typeof path === "string" && SHELL_PATHS.some(function (prefix) {
    return path.indexOf(prefix) === 0;
  });
}

/** Only a plain, successful answer from this site is worth keeping (a redirect to the sign-in page is not the page that was asked for). */
function storable(res) {
  return !!res && res.ok && res.type === "basic" && !res.redirected;
}

async function currentCacheName() {
  try {
    var meta = await caches.open(META_CACHE);
    var hit = await meta.match(CURRENT_KEY);
    return hit ? await hit.text() : null;
  } catch (e) {
    return null;
  }
}

/** Opens this build's cache, fills it with the offline page and the files the page loaded, makes it the current one and deletes the caches of older builds. */
async function prepareShell(build, files) {
  if (typeof build !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(build)) return;
  var name = SHELL_PREFIX + build;
  var cache = await caches.open(name);
  var wanted = [OFFLINE_URL].concat(files.filter(isShellPath).slice(0, MAX_FILES));
  for (var i = 0; i < wanted.length; i += 6) {
    await Promise.all(
      wanted.slice(i, i + 6).map(async function (path) {
        try {
          if (await cache.match(path)) return;
          var res = await fetch(path, { credentials: "same-origin" });
          if (storable(res)) await cache.put(path, res);
        } catch (e) {
          // a file that did not come is fetched from the network when it is asked for
        }
      }),
    );
  }
  var meta = await caches.open(META_CACHE);
  await meta.put(CURRENT_KEY, new Response(name));
  var keys = await caches.keys();
  for (var k = 0; k < keys.length; k++) {
    if (keys[k].indexOf(SHELL_PREFIX) === 0 && keys[k] !== name) await caches.delete(keys[k]);
  }
}

self.addEventListener("message", function (event) {
  var data = event.data;
  if (!data || data.type !== "zaki-shell") return;
  // only this site's own pages may fill the cache
  try {
    if (event.source && event.source.url && new URL(event.source.url).origin !== self.location.origin) return;
  } catch (e) {
    return;
  }
  event.waitUntil(prepareShell(data.build, Array.isArray(data.files) ? data.files : []));
});

/** The offline page in its smallest form, for a person who goes offline before the shell cache holds the real one (or whose session had ended when it was fetched). */
function offlineFallback() {
  var html =
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>زاكي</title></head>' +
    '<body style="font-family:system-ui,sans-serif;text-align:center;padding:2rem"><p style="font-size:1.125rem;line-height:1.8">' +
    OFFLINE_MESSAGE +
    "</p></body></html>";
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}

/** A page: the network first; with no network, the offline page; never stored. */
async function pageNetworkFirst(request) {
  try {
    return await fetch(request);
  } catch (err) {
    return (await caches.match(OFFLINE_URL)) || offlineFallback();
  }
}

/** A hashed build file, a font or an icon: the cache first; a build file the network gave is kept for next time (`store`). */
async function shellCacheFirst(event, request, store) {
  var hit = await caches.match(request);
  if (hit) return hit;
  var res = await fetch(request);
  if (store && storable(res)) {
    var name = await currentCacheName();
    if (name) {
      var copy = res.clone();
      event.waitUntil(
        caches
          .open(name)
          .then(function (cache) {
            return cache.put(request, copy);
          })
          .catch(function () {}),
      );
    }
  }
  return res;
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  var path = url.pathname;
  // the data is never cached here: it lives in the chat's own IndexedDB, which the sign-out wipes
  if (path === "/api" || path.indexOf("/api/") === 0) return;
  if (request.mode === "navigate") {
    event.respondWith(pageNetworkFirst(request));
    return;
  }
  if (path.indexOf("/_next/static/") === 0) {
    event.respondWith(shellCacheFirst(event, request, true));
    return;
  }
  if (path === OFFLINE_URL || path.indexOf("/icons/") === 0 || path.indexOf("/fonts/") === 0) {
    event.respondWith(shellCacheFirst(event, request, false));
  }
});

self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  if (!data || !data.title || !data.url) return;
  event.waitUntil(
    (async function () {
      var windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // the open app rings by itself (its own card and tone) and has its bell: nothing on top of it
      if ((data.kind === "ring" || data.kind === "note") && windows.some(function (w) { return w.visibilityState === "visible"; })) return;
      // a chat message is one notification per conversation: the tag is the conversation's id, so the next message replaces it (with a new alert) and the last lines stack
      var conversationId = data.kind === "note" ? conversationOfUrl(data.url) : null;
      var tag = conversationId || data.tag || data.url;
      var entries = data.body ? [{ t: String(data.title), b: String(data.body) }] : [];
      if (conversationId) {
        var shown = await self.registration.getNotifications({ tag: tag });
        var before = shown[0] && shown[0].data && Array.isArray(shown[0].data.lines) ? shown[0].data.lines : [];
        entries = before.map(lineOf).concat(entries).slice(-MAX_LINES);
      }
      // one sender: the lines are just the words; several (a topic: somebody mentioned me, somebody replied): each line says who
      var oneSender = entries.every(function (e) {
        return !e.t || e.t === String(data.title);
      });
      await self.registration.showNotification(data.title, {
        body: entries
          .map(function (e) {
            return oneSender || !e.t ? e.b : e.t + ": " + e.b;
          })
          .join("\n"),
        tag: tag,
        renotify: true,
        requireInteraction: data.kind === "ring",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        vibrate: data.kind === "ring" ? [400, 200, 400, 200, 400, 200, 400] : [200],
        dir: "rtl",
        lang: "ar",
        data: { url: data.url, lines: entries },
      });
    })(),
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async function () {
      var windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      var open = windows.find(function (w) { return new URL(w.url).origin === self.location.origin; });
      if (open) {
        await open.focus();
        if ("navigate" in open) await open.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
