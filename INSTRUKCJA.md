# Flash Anzan School Operations — instrukcja

Aplikacja: **https://anzan-web.ew.r.appspot.com**

## Bezpieczne zakładanie szkoły i kont

Nie ma otwartej rejestracji ani wyboru roli przez użytkownika. Każde nowe konto wymaga
jednorazowego kodu, który przypisuje rolę, szkołę, a uczniowi również klasę.

1. Operator platformy tworzy zaproszenie właściciela szkoły:
   `cd server` i `npm run invite:owner -- --school "Nazwa szkoły" --email owner@example.com --days 7`.
   Parametr `--email` można pominąć; wtedy kod nadal jest jednorazowy, a owner poda e-mail przy rejestracji.
2. Właściciel otwiera wygenerowany link, zakłada konto, podaje przypisany e-mail i tworzy szkołę.
   Przed operacjami administracyjnymi potwierdza e-mail i loguje się ponownie.
3. W **Plan szkoły → Zaproszenia** właściciel tworzy jednorazowe zaproszenia nauczycieli.
4. Właściciel tworzy klasę i przypisuje nauczyciela. Właściciel lub nauczyciel tworzy pulę
   kodów uczniowskich dla konkretnej klasy.
   Właściciel może przypisać klasę także sobie i prowadzić zajęcia jak nauczyciel.
5. Dla opiekuna tworzy się osobne zaproszenie powiązane z konkretnym uczniem.

Kod jest widoczny w całości tylko przy tworzeniu, wygasa po 1–30 dniach i działa jeden raz.
Można skopiować kod albo gotowy link rejestracyjny. Automatyczna wysyłka e-mail/SMS wymaga
podłączenia zewnętrznego dostawcy; aplikacja nie udaje wysłania wiadomości.

## Plan szkoły

Właściciel widzi całą szkołę, a nauczyciel tylko przypisane klasy i zajęcia. Można dodać
zajęcia jednorazowe albo cotygodniowe, przypisać klasę, nauczyciela, salę/link i okres trwania.
Serwer blokuje kolizje nauczyciela, klasy i sali. Uczeń i opiekun widzą wyłącznie plan swojej
klasy. Plan można wyeksportować jako `.ics`; strefą źródłową jest `Europe/Warsaw`.

## Zadania, obecność i odrabianie

- Nauczyciel publikuje zadanie z terminem, opisem i poziomem Kyū/konfiguracją treningu.
- Przy zajęciach pracownik otwiera listę obecności i oznacza: obecny, nieobecny, spóźniony,
  usprawiedliwiony.
- Uczeń lub opiekun może wysłać prośbę o termin odrobienia zajęć.
- Właściciel ma dziennik audytowy najważniejszych działań.

## Zajęcia Flash Anzan

Nauczyciel otwiera **Multiplayer**, wybiera klasę, poziom 20 Kyū–1 Kyū albo własną konfigurację,
tworzy krótkotrwały pokój i przekazuje jego kod obecnym uczniom. Kod pokoju nie służy do
zakładania konta ani dołączania do klasy.

## Dane i prywatność

E-mail jest wymagany dla właściciela, nauczyciela i opiekuna. Dla ucznia jest opcjonalny;
telefon jest zawsze opcjonalny. W **Plan szkoły → Twoje dane** użytkownik może zgłosić eksport,
korektę lub usunięcie danych. Wniosek wymaga weryfikacji administratora; dane wymagane prawem
mogą podlegać okresowi retencji.

Nowe konto z e-mailem loguje się tym adresem; konto bez e-maila — nazwą użytkownika. Przycisk **Nie pamiętam
hasła** wysyła bezpieczny link Firebase na podany e-mail. Konto ucznia bez e-maila resetuje
nauczyciel w liście uczniów. Odzyskiwanie przez SMS wymaga zewnętrznego dostawcy i pozostaje
wyłączone, dopóki taka usługa nie zostanie podłączona.

## Najczęstsze problemy

- **Kod jest błędny/wygasł/wykorzystany** — właściciel lub nauczyciel tworzy nowe zaproszenie.
- **E-mail nie zgadza się z zaproszeniem** — użyj adresu przypisanego przez szkołę.
- **Kolizja planu** — zmień nauczyciela, klasę, salę albo godzinę.
- **Licencja szkoły jest nieaktywna** — operator musi ją aktywować.
- **Nie widzę pokoju** — poproś nauczyciela o bieżący kod krótkotrwałego pokoju.
