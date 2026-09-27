# Architektura Anzan School Pro — wariant niskokosztowy

## Cel

Jedna instalacja obsługuje wiele szkół, nauczycieli i klas. Architektura jest celowo prostym
modularnym monolitem: jeden proces Node.js podaje aplikację, obsługuje Socket.IO i zapisuje trwałe
dane w Firestore. To najtańszy rozsądny wariant dla produktu na etapie pierwszych płacących szkół.

## Źródła prawdy

- Frontend rozwijamy w `index.html`, `css/`, `icons/` i `js/` w katalogu głównym.
- `server/public/` jest kopią wdrożeniową tworzoną przez `cd server && npm run sync`.
- `js/soroban-generator.js` jest wspólnym generatorem. Synchronizacja kopiuje go do backendu.
- Firestore jest źródłem prawdy dla kont, szkół, klas, rankingów i raportów zajęć.

## Model danych

- `users/{uid}` — profil i jawna rola `school_admin`, `teacher` albo `student`, szkoła, XP i bieżąca klasa.
- `schools/{schoolId}` — właściciel, plan, status licencji i rotowany kod zaproszenia nauczycieli.
- `classes/{classId}` — szkoła, nauczyciel założyciel, rok, kod dołączenia i status.
- `classes/{classId}/members/{uid}` — uczeń, punkty i ostatnia aktywność.
- `classes/{classId}/sessions/{sessionId}` — jeden zagregowany raport zakończonych zajęć.

Raport jest zapisywany raz przy zamykaniu pokoju, nie po każdej odpowiedzi. Ogranicza to liczbę
operacji Firestore i koszt. Aktywne pokoje pozostają w pamięci procesu.

## Izolacja i uprawnienia

- Tożsamość pochodzi z tokenu Firebase Auth zweryfikowanego przez serwer.
- Klient nie ma bezpośredniego dostępu do Firestore (`firestore.rules` blokuje wszystko).
- Administrator tworzy organizację i zaprasza nauczycieli; nauczyciel prowadzi klasy i zajęcia.
- Administrator ma szkolny podgląd nauczycieli, klas, uczniów, rankingów i raportów, ale operacje
  takie jak reset hasła, usuwanie ucznia, zamykanie klasy i prowadzenie pokoju pozostają u nauczyciela.
- Kod szkoły zaprasza nauczyciela, a administrator może go w każdej chwili obrócić.
- `schools.status = active` jest lekkim przełącznikiem licencji. Zawieszenie blokuje nowe klasy i pokoje.

## Uruchomienie i koszt

- App Engine Standard F1, `min_instances: 0`, `max_instances: 1`.
- Express podaje frontend i Socket.IO z tej samej usługi.
- Firebase Authentication przechowuje loginy, Firestore dane biznesowe.
- PWA pozwala zainstalować aplikację; powłoka i trening solo korzystają z cache przeglądarki.
- Brak Redis, osobnego hostingu frontendu, hurtowni danych i cyklicznych workerów.

`max_instances` musi pozostać równe 1, dopóki pokoje są w pamięci. Restart kończy bieżące zajęcia,
ale nie traci kont, klas, punktów ani zapisanych raportów. Po przekroczeniu możliwości jednej
instancji należy przenieść stan pokojów do wspólnego magazynu i dodać adapter Socket.IO; samo
zwiększenie liczby instancji rozdzieliłoby uczestników.

## Obserwowalność

- `/health` — tani liveness bez odczytu bazy.
- `/ready` — readiness z kontrolą Firestore; używać oszczędnie.
- Logi aplikacji trafiają do standardowych logów App Engine.
- `npm test` sprawdza generator, spójność kopii frontendu oraz HTTP/PWA.

## Bezpieczne wdrożenie

1. `cd server`
2. `npm ci`
3. `npm run sync`
4. `npm test`
5. Skopiuj `app.deploy.yaml.example` do `app.deploy.yaml` i ustaw losowy `TEACHER_ACCESS_CODE`.
6. `gcloud app deploy app.deploy.yaml`

`app.deploy.yaml` jest ignorowany przez Git. Kod uruchomieniowy służy wyłącznie pierwszemu
właścicielowi szkoły; następni nauczyciele korzystają z rotowanego kodu danej szkoły.
