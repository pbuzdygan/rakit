# Plan ustawień Rakit — wersja 1.4.2

**Status: wdrożony w kodzie (1.4.2 Unreleased).**

Weryfikacja: testy frontendu i backendu, sprawdzenie typów zmienionych komponentów,
build frontendu oraz oba audity npm zakończone powodzeniem (0 podatności).
Testy Playwright z mockowanym API potwierdziły zapis preferencji, nawigację,
przywracanie domyślnych wartości, klawiaturę i fokus, desktop/mobile w obu motywach,
komunikaty About, ładowanie strefy czasowej przy zamkniętych ustawieniach i callback
sprawdzania wersji co sześć godzin. Otwarcie About nie uruchamia dodatkowego pollera.

## Zakres

Rozbudować istniejące ustawienia o wybór widocznych modułów i sekcję About.
Ustawienia otwiera stały przycisk z ikoną koła zębatego w dolnej części menu
bocznego, dostępny również po zwinięciu menu i na urządzeniach mobilnych.

## Układ

W istniejącym dialogu Settings umieścić trzy zakładki:

- General: motyw oraz blokowanie sesji.
- Modules: przełączniki Racks, Servers, IP Addressing, Port Map i Wake on LAN.
- About: bieżąca wersja, kanał wydania, ostatnia sprawdzona dostępna wersja,
  stan sprawdzenia i link do odpowiedniego wydania/repozytorium.

Overview, Audit Log i Settings pozostają zawsze dostępne. Informację o wersji
usunąć ze stopki menu bocznego. Dostępność nowego wydania sygnalizować dyskretną
kropką przy Settings i opisać szczegółowo w About.

## Zachowanie przełączników

Domyślnie wszystkie pięć modułów jest widocznych, również dla istniejących
instalacji. Zmiany zapisywać od razu, bez dodatkowego przycisku Save.
Dodać przycisk Restore defaults przywracający widoczność wszystkich modułów.

Preferencje przechowywać lokalnie w przeglądarce, zgodnie z obecnym zapisem
motywu i nawigacji. Nie są to ustawienia całej instancji ani uprawnienia użytkownika.
Zapis przetrwa odświeżenie i ponowne otwarcie aplikacji w tej przeglądarce.
Nieprawidłowy zapis oraz brak preferencji mają bezpiecznie przywracać domyślne wartości.

Przełączniki sterują widocznością modułów w nawigacji oraz związanych z nimi
skrótów i sekcji Overview. Ukrycie aktywnego modułu przenosi do Overview.
Przy starcie odrzucać zapisaną nawigację do ukrytego modułu; tę samą regułę
stosować we wspólnej funkcji zmiany widoku. Można ukryć wszystkie pięć modułów.

Ukrycie modułu nie usuwa jego danych i nie wyłącza backendu, istniejących
harmonogramów ani integracji Semaphore/WOL. Ponowne pokazanie modułu odtwarza
dostęp do jego dotychczasowych danych.

## Implementacja

1. Utworzyć wspólny katalog modułów z identyfikatorami, nazwami i ikonami.
2. W `frontend/src/store.ts` dodać preferencje widoczności, walidację zapisu,
   zmianę pojedynczego przełącznika, przywracanie domyślnych wartości oraz
   ochronę wyboru ukrytego widoku.
3. W `OperationsShell.tsx` filtrować nawigację i dodać stały przycisk Settings.
   W `OverviewView.tsx` dostosować skróty i sekcje do widoczności modułów.
4. Rozbudować `SettingsModal.tsx`, używając obecnych kontrolek i wyglądu Rakit.
   Zakładki i przełączniki muszą obsługiwać klawiaturę oraz czytelne etykiety.
5. Oddzielić pobieranie metadanych i sprawdzanie wydań od wyświetlania informacji
   o wersji. Obecny `VersionIndicator.tsx` ładuje także strefę czasową aplikacji;
   ten mechanizm musi działać po zalogowaniu również przy zamkniętych ustawieniach.
   About korzysta ze wspólnego stanu zamiast uruchamiać osobny polling.
6. Zachować sprawdzanie wydań co sześć godzin i właściwy kanał stable/dev.
   W About rozróżnić brak wyniku sprawdzenia od potwierdzonej aktualności wersji.
7. Uzupełnić dokumentację i changelog 1.4.2 po wdrożeniu funkcji.

## Weryfikacja

- Domyślne menu i zachowane preferencje po odświeżeniu.
- Każdy przełącznik osobno, wszystkie moduły ukryte i Restore defaults.
- Ukrycie aktualnego widoku i uruchomienie z wcześniej zapisanym ukrytym widokiem.
- Spójność nawigacji i skrótów Overview.
- Settings przy rozwiniętym i zwiniętym menu, na desktopie i mobile.
- Jasny i ciemny motyw, obsługa klawiatury i widoczny fokus.
- About dla stable, dev, dostępnej aktualizacji i niedostępnego GitHub.
- Poprawna strefa czasowa bez otwierania Settings.
- Build frontendu, testy dotyczące preferencji/nawigacji i oba audity CI.
