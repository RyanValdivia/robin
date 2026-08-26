// Service worker de Web Push — el mínimo necesario para levantar la
// notificación del sistema operativo cuando llega un push (scheduler.ts /
// brain/webPush.ts mandan el payload como JSON {title, body}). No cachea
// nada ni intercepta fetch — Robin no es una PWA offline, esto es solo el
// hook que exige la Push API para poder mostrar notificaciones.
self.addEventListener("push", (event) => {
  let data = { title: "Robin", body: "Tenés un recordatorio." };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // payload no era JSON — se usa el default de arriba
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Robin", {
      body: data.body || "",
      tag: "robin-reminder",
    }),
  );
});

// Click en la notificación -> foco a una pestaña de Robin ya abierta, o abre una nueva.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    }),
  );
});
