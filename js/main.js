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
})();
