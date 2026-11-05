/* Service worker mínimo: permite instalar a app no ecrã inicial. Os avisos no telemóvel são acrescentados na fase seguinte. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
