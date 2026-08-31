// config.js
// Jedno miejsce na adres serwera gier (dotąd był zaszyty w app.js i multiplayer.js).
// Zmieniaj TYLKO tutaj przy zmianie środowiska.
(function () {
    const isLocal = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    window.ANZAN_SOCKET_URL = isLocal
        ? 'http://localhost:8080'
        : 'https://anzan-web.ew.r.appspot.com';
})();
