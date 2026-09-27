# Wdrożenie serwera Multiplayer na Google Cloud

1. Zainstaluj [Google Cloud SDK](https://cloud.google.com/sdk/docs/install).
2. Otwórz terminal w tym folderze (`c:\projekty\anzan_v2\server`).
3. Zaloguj się: `gcloud auth login`.
4. Stwórz projekt (lub wybierz istniejący): `gcloud projects create twoj-projekt-anzan`.
5. Ustaw projekt: `gcloud config set project twoj-projekt-anzan`.
6. Wdróż aplikację: `gcloud app deploy`.
7. Po zakończeniu otrzymasz URL (np. `https://twoj-projekt-anzan.uc.r.appspot.com`).
8. Skopiuj ten URL.
9. W pliku `app_v2.html` (w katalogu głównym) znajdź linię:
   `const SOCKET_URL = 'http://localhost:8080';`
   i zamień ją na swój nowy URL z chmury.
10. Gotowe! Teraz możesz grać ze znajomymi przez internet.

## Uruchomienie lokalne (dla testów)
1. Zainstaluj [Node.js](https://nodejs.org/).
2. W folderze `server` wpisz: `npm install`.
3. Uruchom serwer: `npm start`.
4. Twoja aplikacja połączy się z `localhost:8080`.
