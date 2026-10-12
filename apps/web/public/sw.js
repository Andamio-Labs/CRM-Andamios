// Service worker de BeeCRM: solo muestra notificaciones push y abre su enlace al tocarlas.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'BeeCRM', {
      body: data.body || undefined,
      tag: data.tag,
      data: { link: data.link || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Solo enlaces internos: el servidor siempre manda rutas relativas.
  const target = new URL(event.notification.data?.link || '/', self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (!open) return self.clients.openWindow(url);
      return open.focus().then((w) => w.navigate(url));
    }),
  );
});
