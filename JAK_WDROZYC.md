# Jak wdrożyć Anzan możliwie tanio

Frontend i backend działają w jednej usłudze Google App Engine Standard. Konfiguracja F1 z
`min_instances: 0` usypia aplikację przy braku ruchu, a `max_instances: 1` jest wymagana, ponieważ
aktywne pokoje multiplayer są przechowywane w pamięci.

## Pierwsze przygotowanie

1. Włącz Firebase Authentication Email/Password w projekcie `anzan-web`.
2. Utwórz bazę Firestore `anzan-db` i wdróż reguły z `firestore.rules`.
3. Upewnij się, że konto usługi App Engine ma dostęp do Firestore i Firebase Authentication.
4. W katalogu `server` wykonaj `npm ci`.

## Wdrożenie

```powershell
cd server
npm run sync
npm test
Copy-Item app.deploy.yaml.example app.deploy.yaml
```

W `app.deploy.yaml` zastąp przykładowy `TEACHER_ACCESS_CODE` długim, losowym kodem. Plik jest
ignorowany przez Git i nie wolno go commitować.

```powershell
gcloud auth login
gcloud config set project TWOJ_PROJECT_ID
gcloud app deploy app.deploy.yaml
```

Po wdrożeniu aplikacja i Socket.IO są dostępne pod tym samym adresem App Engine. Nie trzeba
utrzymywać osobnego projektu Vercel.

Pierwszy nauczyciel rejestruje się kodem `TEACHER_ACCESS_CODE`, zakłada organizację szkoły,
a następnych nauczycieli zaprasza rotowanym kodem widocznym w panelu. Licencję można na początku
obsługiwać bez integracji płatniczej: pole `schools/{schoolId}.status` przyjmuje `active` albo
`suspended`. Zawieszenie nie kasuje danych.

```powershell
cd server
npm run school:license -- SCHOOL_ID active school
# albo po wygaśnięciu umowy:
npm run school:license -- SCHOOL_ID suspended school
```

Polecenie korzysta z bieżących poświadczeń Google Cloud i zapisuje również czas zmiany licencji.

Endpoint `/health` nie odczytuje Firestore i nadaje się do częstego monitoringu. `/ready` sprawdza
również bazę i generuje odczyt, dlatego należy wywoływać go rzadziej.

## Przed każdym kolejnym wdrożeniem

```powershell
cd server
npm run sync
npm test
gcloud app deploy app.deploy.yaml
```

Szczegóły decyzji technicznych znajdują się w `ARCHITEKTURA.md`.
Zakres produktu i checklista sprzedażowa są w `PRODUKT_SZKOLNY.md`, a kwestie danych w
`OCHRONA_DANYCH.md`.
