# Jak umieścić grę Anzan w Internecie?

Twoja aplikacja składa się z dwóch części:
1.  **Frontend (Gra)**: To co widzi użytkownik (`index.html`, style, skrypty).
2.  **Backend (Serwer)**: Obsługuje multiplayer (`server/server.js`).

Aby wszystko działało dla każdego w internecie, musisz wdrożyć obie te części.

---

## Opcja 1: Najprostsza (Vercel + Google Cloud) - Polecana

Ta metoda jest darmowa (dla frontendu) i tania/darmowa (dla backendu w ramach limitów).

### Krok 1: Wdrożenie Serwera (Google Cloud)
W folderze `server/` masz już gotowe pliki konfiguracyjne dla Google Cloud App Engine.

1.  Zainstaluj [Google Cloud SDK](https://cloud.google.com/sdk/docs/install).
2.  Otwórz terminal w folderze `server`.
3.  Zaloguj się: `gcloud auth login`.
4.  Utwórz projekt: `gcloud projects create anzan-twoja-nazwa` (zmień nazwę na unikalną).
5.  Ustaw projekt: `gcloud config set project anzan-twoja-nazwa`.
6.  Wdróż: `gcloud app deploy`.
7.  Po zakończeniu otrzymasz adres, np.: `https://anzan-twoja-nazwa.ew.r.appspot.com`.
8.  **SKOPIUJ TEN ADRES**.

### Krok 2: Konfiguracja Gry
1.  Otwórz plik `js/app.js` (w głównym folderze).
2.  Znajdź linię z `SOCKET_URL` (ok. linii 56).
3.  Wklej tam swój nowy adres serwera:
    ```javascript
    const SOCKET_URL = 'https://anzan-twoja-nazwa.ew.r.appspot.com';
    ```
4.  Zapisz plik.

### Krok 3: Wdrożenie Gry (Frontend) na Vercel
1.  Wejdź na stronę [Vercel.com](https://vercel.com) i załóż darmowe konto.
2.  Najłatwiej: Jeśli masz kod na GitHubie, połącz konto i zaimportuj projekt.
3.  Metoda ręczna (z terminala):
    *   Zainstaluj Node.js.
    *   Wpisz w terminalu: `npm i -g vercel`.
    *   Będąc w głównym folderze projektu (tam gdzie `index.html`), wpisz: `vercel`.
    *   Klikaj `Enter` (potwierdź domyślne ustawienia).
4.  Po chwili otrzymasz link do swojej gry (np. `https://anzan-game.vercel.app`).
5.  **Wyślij ten link znajomym!**

---

## Opcja 2: "Wszystko w jednym" (Tylko Google Cloud)

Jeśli wolisz jeden serwer do wszystkiego (łatwiejsze zarządzanie jednym linkiem, ale trudniejsza konfiguracja plików):

1.  W folderze `server/` stwórz folder `public`.
2.  Skopiuj do niego pliki: `index.html`, folder `css`, folder `js`.
3.  Zmodyfikuj `server/server.js` dodając po linii `app.use(cors());`:
    ```javascript
    app.use(express.static('public'));
    ```
4.  Wdróż folder `server` (`gcloud app deploy`).
5.  Twoja gra będzie dostępna bezpośrednio pod adresem serwera.

---

## Ważne uwagi
*   **Koszty**: Google Cloud ma darmowy limit (Free Tier), ale miej na uwadze ewentualne koszty przy dużym ruchu. Vercel jest darmowy dla projektów hobbystycznych.
*   **Multiplayer**: Aby działał, `SOCKET_URL` w pliku `js/app.js` musi prowadzić do działającego serwera.
