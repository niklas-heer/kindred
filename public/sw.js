// Kindred's service worker. It only shows the reminders the server pushes (src/lib/reminders.ts) and opens the family
// when one is tapped. It caches nothing, so no family data is kept on the device beyond what the browser keeps anyway.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(message.title || 'Kindred', {
      body: message.body || '',
      tag: message.tag || 'kindred',
      data: { url: message.url || '/' },
    }),
  );
});

// Focus an open window of the app and go to the person, or open a new window.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => client.url.startsWith(self.registration.scope));
      if (!open) return self.clients.openWindow(target);
      return open.focus().then((client) => (client.navigate ? client.navigate(target) : client));
    }),
  );
});
