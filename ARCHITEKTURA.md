# Architektura Flash Anzan School Operations 7.0

## Założenie kosztowe

System pozostaje modularnym monolitem: jedna usługa Node.js na App Engine Standard F1 podaje
frontend, obsługuje Socket.IO i zapisuje dane w Firestore. `min_instances: 0` i
`max_instances: 1` ograniczają koszt. Serie planu lekcji są pojedynczymi dokumentami zamiast
kopii dla każdego tygodnia, a raport zajęć jest zapisywany zbiorczo po zakończeniu sesji.

## Źródła prawdy

- Firebase Authentication — hasła i UID.
- Firestore — role, tenant szkoły, klasy, zaproszenia i dane biznesowe.
- Serwer — jedyna warstwa uprawniona do Firestore; reguły klienta blokują bezpośredni dostęp.
- Katalog główny — źródła frontendu. `server/public/` powstaje przez `npm run sync`.

## Role i granice dostępu

- `school_admin` / owner — cała szkoła, nauczyciele, klasy, plan, rankingi, historia i audyt;
  ma również uprawnienie prowadzącego, bo w małej szkole owner często sam uczy.
- `teacher` — przypisane klasy, uczniowie, zajęcia, obecność, zadania i zaproszenia uczniów.
- `student` — własna klasa, plan, zadania, trening i wyniki.
- `guardian` — odczyt planu/zadań powiązanego ucznia i prośby o odrabianie.

Rola podczas logowania pochodzi wyłącznie z Firestore. Nowe konto dostaje rolę z jednorazowego
zaproszenia. Operator tworzy zaproszenie ownera skryptem `npm run invite:owner`; stały kod
bootstrap działa tylko przy świadomej fladze `ALLOW_OWNER_BOOTSTRAP=true`.

## Model danych

- `users/{uid}` — rola, szkoła, klasa/powiązany uczeń, kontakty, XP i konfiguracje treningu.
- `schools/{schoolId}` — owner, status licencji, plan i limit miejsc.
- `schools/{schoolId}/teachers/{uid}` — tani katalog pracowników.
- `schools/{schoolId}/auditLogs/{id}` — działania administracyjne.
- `classes/{classId}` — szkoła, nauczyciel, rok i status.
- `classes/{classId}/members/{uid}` — roster i punkty.
- `classes/{classId}/sessions/{id}` — zagregowana historia zajęć.
- `invitations/{sha256(code)}` — rola, zakres, ważność i status; nigdy jawny kod.
- `scheduleEvents/{id}` — termin jednorazowy lub seria tygodniowa w `Europe/Warsaw`.
- `scheduleEvents/{id}/attendance/{date_uid}` — obecność dla wystąpienia zajęć.
- `assignments/{id}` — zadanie klasy.
- `privacyRequests/{id}` i `makeupRequests/{id}` — kontrolowane workflow.

## Bezpieczeństwo

- Token Firebase jest weryfikowany z `checkRevoked=true`.
- Login jest unikalnym aliasem przechowywanym jako skrót SHA-256. Logowanie aliasem weryfikuje
  hasło w Firebase po stronie serwera, nie ujawniając powiązanego adresu e-mail.
- E-mail tokenu musi odpowiadać kontaktowi z zaproszenia; mutacje pracownika wymagają
  potwierdzonego adresu e-mail.
- Zaproszenia mają 12 znaków z alfabetu bez mylących znaków, SHA-256 w bazie, status,
  termin ważności, unieważnianie i atomowe zużycie.
- Dane wejściowe są ograniczane długością i zakresem; akcje mają limity częstotliwości.
- Tenant jest sprawdzany na serwerze przy każdej operacji szkoły/klasy.
- Kontakty nie trafiają do rankingów. Dla dzieci obowiązuje minimalizacja danych.
- Dziennik audytowy obejmuje rejestrację, zaproszenia, klasy, plan, zadania, obecność i prywatność.

## Ograniczenia świadome

- Pokoje multiplayer są w pamięci procesu. `max_instances` musi pozostać równe 1; restart kończy
  aktywną sesję, ale nie usuwa danych trwałych.
- Reset hasła e-mailem obsługuje Firebase Authentication. Automatyczna wysyłka zaproszeń oraz
  odzyskiwanie przez SMS wymagają zewnętrznego dostawcy; obecnie zaproszenie kopiuje pracownik.
- Powiadomienia w aplikacji są wyprowadzane z planu i zadań bez kosztownego fan-out per uczeń.

## Weryfikacja i wdrożenie

1. `cd server`
2. `npm ci`
3. `npm run sync`
4. `npm test`
5. `gcloud app deploy app.deploy.yaml`

`/health` jest tanim liveness, `/ready` sprawdza Firestore. `app.deploy.yaml` jest ignorowany
przez Git i przechowuje ustawienia środowiska bez publikowania sekretów.
