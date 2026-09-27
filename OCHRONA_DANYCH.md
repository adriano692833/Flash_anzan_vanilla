# Ochrona danych — checklista przed sprzedażą

Kod ogranicza dostęp techniczny, ale sam kod nie stanowi kompletnej zgodności prawnej. Przed
sprzedażą szkołom należy przygotować z prawnikiem politykę prywatności, regulamin i umowę
powierzenia danych, szczególnie że użytkownikami mogą być dzieci.

## Dane przetwarzane przez aplikację

- nazwa użytkownika, rola i techniczny identyfikator Firebase,
- przynależność do szkoły i klasy,
- wyniki, czas odpowiedzi, XP i historia zajęć,
- techniczne logi serwera.

Nie są potrzebne: data urodzenia, adres, numer telefonu ani prawdziwy adres e-mail ucznia.
Należy utrzymać tę minimalizację.

## Zabezpieczenia już w kodzie

- autorytatywna tożsamość z tokenu Firebase,
- brak bezpośredniego dostępu klienta do Firestore,
- role szkoły, klasy i pokoju rozdzielone po stronie serwera,
- limity żądań na zdarzeniach Socket.IO,
- rotowany kod zaproszenia nauczycieli,
- raporty dostępne wyłącznie nauczycielom danej szkoły,
- brak sekretów wdrożeniowych w repozytorium.

## Procesy wymagane przed produkcją

- Ustalić administratora danych i role szkoły/dostawcy.
- Określić podstawę prawną oraz sposób zgody/opieki nad kontem dziecka.
- Ustalić retencję, np. archiwizacja po roku szkolnym i usunięcie po zakończeniu umowy.
- Przygotować procedurę eksportu, korekty i trwałego usunięcia danych użytkownika/szkoły.
- Ograniczyć dostęp administratorów do Firebase/GCP i włączyć MFA.
- Skonfigurować budżet oraz alerty błędów; okresowo sprawdzać logi i zależności.
- Przeprowadzić test odtworzenia danych i udokumentować reakcję na incydent.

Usuwanie danych powinno być operacją administracyjną z potwierdzeniem i kopią bezpieczeństwa,
nie przypadkowym przyciskiem w panelu nauczyciela.
