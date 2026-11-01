"use strict";
// Service worker for published sites: it shows the reminders the site's server pushes and opens the site when one
// is tapped. It caches nothing, so the archive is never stored on the device beyond the browser's normal cache.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch { message = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(message.title || "Kindred", {
    body: message.body || "",
    tag: message.tag || "kindred",
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: { url: message.url || "./" }
  }));
});

// Focus an open window of the site and show the person, or open a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const open = clients.find((client) => client.url.startsWith(self.registration.scope));
    if (!open) return self.clients.openWindow(target);
    return open.focus().then((client) => (client.navigate ? client.navigate(target) : client));
  }));
});
