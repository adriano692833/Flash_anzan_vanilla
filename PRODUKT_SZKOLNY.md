# Anzan School Pro — przygotowanie do sprzedaży

## Co szkoła dostaje

- 20 poziomów Kyu z generatorem zgodnym z technikami sorobanu.
- Flash Anzan, tryb głosowy, arkusze PDF, survival i zajęcia multiplayer.
- Oddzielne role administratora szkoły, nauczyciela i ucznia.
- Organizację szkoły, wielu nauczycieli i współdzielone klasy.
- Kontrolowane wejście uczniów do pokoju i serwerową walidację wyników.
- Ranking klasy, ranking globalny oraz raport ostatnich 30 zajęć.
- Podsumowanie skuteczności, liczby prób, średniego czasu i XP per uczeń.
- Eksport raportu do CSV dla dyrektora lub rodzica.
- Instalowalną PWA na komputerach, tabletach i telefonach.

## Prosty model sprzedaży na start

Nie warto wdrażać płatności i skomplikowanego panelu billingowego przed pierwszymi klientami.
Najtańszy proces sprzedaży:

1. Umowa/faktura obsługiwana ręcznie.
2. Jedna szkoła otrzymuje konto właściciela i kod zaproszenia nauczycieli.
3. Administrator uruchamia `npm run school:license -- SCHOOL_ID active school`.
4. Po zakończeniu umowy `status: suspended` blokuje tworzenie klas i nowych zajęć, ale nie kasuje danych.

Proponowane pakiety do zweryfikowania rozmowami z klientami:

| Pakiet | Dla kogo | Zakres |
|---|---|---|
| Start | mała szkoła / prowadzący | 1–2 nauczycieli, raporty i eksport |
| School | rozwijająca się szkoła | wielu nauczycieli, wspólne klasy, priorytetowe wsparcie |
| Network | sieć placówek | osobne organizacje, onboarding i warunki indywidualne |

Nie wpisuj cen na stałe w kodzie. Najpierw przeprowadź 5–10 pilotaży i wyceń wartość na podstawie
liczby nauczycieli, uczniów oraz oszczędzonego czasu raportowania.

## Checklista pilotażu

- Utworzenie szkoły i obrócenie kodu nauczycieli.
- Założenie dwóch kont nauczycieli oraz klasy testowej.
- Dołączenie uczniów, lekcja manualna i automatyczna.
- Zamknięcie pokoju, odczyt raportu i eksport CSV.
- Test na szkolnym Wi‑Fi, Chromebooku/tablecie i projektorze.
- Uzgodnienie retencji danych, procesu usuwania kont oraz kontaktu wsparcia.
- Pomiar: czas uruchomienia lekcji, liczba błędów, aktywność i opinia nauczyciela.

## Czego nie należy obiecywać bez osobnego wdrożenia

- gwarantowanej pracy aktywnego multiplayera bez internetu,
- pełnego LMS, dziennika elektronicznego ani integracji SSO,
- formalnej zgodności prawnej bez analizy umów, polityki prywatności i procesów klienta,
- wysokiej dostępności wielu regionów — obecny wariant świadomie optymalizuje koszt.
