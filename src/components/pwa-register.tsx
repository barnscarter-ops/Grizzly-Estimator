"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";

    if (process.env.NODE_ENV !== "production" || isLocalhost) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          void registration.unregister();
        });
      });

      if ("caches" in window) {
        void caches.keys().then((keys) => {
          keys
            .filter((key) => key.startsWith("grizzly-estimator-"))
            .forEach((key) => {
              void caches.delete(key);
            });
        });
      }

      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      return;
    });
  }, []);

  return null;
}
