(function () {
  if (typeof window === 'undefined' || !window.app) return;

  const app = window.app;

  // Default adapter (single-player)
  if (app.adapters && app.adapters.local) {
    app.adapter = app.adapters.local;
  }

  // Boot
  try {
    app.init();
  } catch (e) {
    console.error(e);
    if (app.ui && app.ui.modal) app.ui.modal('Błąd Krytyczny', 'Nie udało się uruchomić aplikacji: ' + e.message);
    else alert('Błąd inicjalizacji aplikacji: ' + e.message);
  }

  // Inicjalizacja logowania (Firebase). Nie blokuje trybów solo — dotyczy tylko
  // sekcji multiplayer/ranking. Działa tylko, gdy Firebase jest skonfigurowany.
  try {
    if (app.auth && typeof app.auth.init === 'function') app.auth.init();
  } catch (e) {
    console.warn('Auth init pominięty:', e && e.message);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      const hadController = Boolean(navigator.serviceWorker.controller);
      let refreshing = false;
      if (hadController) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing) return;
          refreshing = true;
          location.reload();
        });
      }
      navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' }).then(registration => {
        registration.update().catch(() => { /* kolejna wizyta ponowi aktualizację */ });
        if (registration.waiting) registration.waiting.postMessage('SKIP_WAITING');
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              worker.postMessage('SKIP_WAITING');
            }
          });
        });
      }).catch(error => {
        console.warn('Service Worker:', error && error.message);
      });
    });
  }
})();
