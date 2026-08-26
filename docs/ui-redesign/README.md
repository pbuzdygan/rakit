# Rakit — kierunek UI „Operations Console”

Ten pakiet rozpoczął się jako koncepcja wzornicza. Zatwierdzony kierunek ma już pierwszy produkcyjny pionowy wycinek w aplikacji React/Express; pliki poniżej pozostają referencją projektową i klikalnym prototypem niezależnym od danych użytkownika.

## Interaktywny prototyp

Otwórz [prototype/index.html](prototype/index.html) bezpośrednio w przeglądarce. Prototyp działa bez buildu i bez zewnętrznych zależności. Można w nim:

- zwijać główne menu,
- przełączać wszystkie moduły,
- wybierać urządzenia w szafie i zakładki inspektora,
- wybierać porty, trasy i filtrować Connections,
- zmieniać sieci, wybierać oraz dodawać rezerwacje IP,
- dodawać maszyny WOL, edytować je i symulować akcję Wake,
- filtrować Audit Log.

Porównanie czterech wariantów wielkości i organizacji portów znajduje się w [port-map-port-options/index.html](port-map-port-options/index.html). Wariant `Previous Rakit` odtwarza zweryfikowaną skalę wcześniejszego interfejsu i zestawia ją z nowym nagłówkiem urządzenia zawierającym IP, status oraz lokalizację.

Odświeżony, klikalny pulpit operatorski Overview znajduje się w [overview-mockup/index.html](overview-mockup/index.html). Łączy stan usług, kolejkę problemów, pojemność szaf i aktywność bez zwiększania wizualnego ciężaru interfejsu.

Plan przeniesienia prototypu do produkcyjnego Reacta i wymagane migracje backendu opisuje [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Mockupy

1. [Rack elevation](mockups/01-rack-elevation.png) — widok szafy jako główne płótno robocze, z inspektorem urządzenia.
2. [Port Map](mockups/02-port-map.png) — bezpośrednia mapa połączeń patch panel ↔ switch, tabela połączeń i inspektor zaznaczonego łącza.
3. [IP Addressing](mockups/03-ip-addressing.png) — widok IPAM łączący dane UniFi z ręcznymi rezerwacjami.
4. [Wake on LAN](mockups/04-wake-on-lan.png) — maszyny, stan osiągalności, akcja Wake i harmonogramy w jednym module.

## Dlaczego obecny interfejs wydaje się „cukierkowy”

W aktualnym systemie wizualnym nakładają się na siebie duże promienie narożników, pigułkowe kontrolki, miękkie gradienty tła, rozległe cienie i duże pionowe odstępy. Efekt jest estetyczny, lecz przypomina bardziej ogólny dashboard niż narzędzie operatorskie, w którym ważne są gęstość informacji, szybkie skanowanie i relacje między zasobami.

## Proponowany język produktu

- Stały lewy pasek modułów: Overview, Racks, IP Addressing, Port Map, Wake on LAN, Audit Log.
- Wąski pasek górny: breadcrumbs, globalne wyszukiwanie, stan integracji i narzędzia sesji.
- Środkowe płótno zależne od zadania oraz stały prawy inspektor zaznaczonego obiektu.
- Promień 4–6 px, cienkie obramowania 1 px, mało cieni, brak dekoracyjnych gradientów.
- Akcent cyan wyłącznie dla zaznaczenia i głównej akcji. Zielony, bursztynowy i czerwony wyłącznie dla stanu.
- Tabele i realistyczne reprezentacje sprzętu zamiast dużych kart, gdy użytkownik porównuje wiele rekordów.
- Cyfry tabularne lub monospace dla U, adresów IP, MAC, VLAN i numerów portów.

## Tokeny startowe

| Rola | Wartość |
| --- | --- |
| Tło aplikacji | `#11151B` |
| Panel | `#1A2029` |
| Panel aktywny | `#202A35` |
| Obramowanie | `#303945` |
| Tekst główny | `#E7ECF2` |
| Tekst pomocniczy | `#9BA7B4` |
| Akcent | `#2FA8C9` |
| Sukces | `#54C86A` |
| Ostrzeżenie | `#E6A82E` |
| Błąd | `#E05A5A` |
| Radius | `4px` / `6px` |
| Bazowy odstęp | `8px` |

## Architektura ekranów

### Racks

Widok szafy powinien być centralnym, możliwie realistycznym modelem urządzeń. Lista szaf może wejść do panelu kontekstowego, a wybrane urządzenie otwiera inspektor z pozycją U, adresem zarządzającym, VLAN-em i odnośnikami do jego portów. Warto docelowo wspierać front/rear oraz bibliotekę typów urządzeń.

### Port Map

Podstawową interakcją jest wskazanie dwóch wolnych portów i utworzenie łącza. Połączenie jest widoczne jednocześnie na urządzeniach i w tabeli. Kliknięcie dowolnego końca wybiera całą ścieżkę i pokazuje tag, VLAN, IP/urządzenie oraz akcję rozłączenia. Dzięki temu operator natychmiast widzi relację patch panel → switch.

### IP Addressing

Sieci są nawigacją, a hosty pozostają jedną gęstą tabelą. Kolumna Source rozróżnia UniFi i wpis ręczny. Konflikt ma wyraźny stan, ale nie zmienia całego wiersza w jaskrawy blok. Rezerwację edytuje się w stałym inspektorze, bez otwierania kilku poziomów modali.

### Wake on LAN

Maszyny dodaje się bezpośrednio w Rakit. Opcjonalnie można je tworzyć na podstawie istniejącego urządzenia rack albo rezerwacji IP, aby nie powielać MAC/IP. Najczęstsza akcja, Wake, pozostaje dostępna w każdym wierszu; operacje zbiorcze i harmonogramy są drugorzędne, lecz łatwo dostępne.

## Inspiracje funkcjonalne

- [Trugamr/wol](https://github.com/Trugamr/wol): prosta lista maszyn, akcja Wake, monitoring stanu, broadcast per host i harmonogramy.
- [ECCM](https://github.com/bijomaru78/eccm): porty jako obiekty pierwszej klasy, szybkie łączenie dwóch portów, aliasy, profile i tabela połączeń.
- [Rackula](https://github.com/RackulaLives/Rackula): układ biblioteka → płótno → inspektor, rzeczywiste urządzenia, widok front/rear i eksport dokumentacji.

Mockupy są oryginalnym kierunkiem dla Rakita; nie kopiują layoutu ani identyfikacji żadnego z tych projektów.

## Stan wdrożenia

Shell oraz moduły Racks, Port Map, IP Addressing, Wake on LAN, Overview i Audit Log są już przeniesione do produkcyjnego Reacta i API. Racks ma nagłówek i pasek sterowania zgodny z prototypem, obsługuje wiele szaf, numerację U od góry lub od dołu oraz urządzenia `left`/`right`. Przeciągnięcie urządzenia na zajęte U pozwala rozdzielić półkę na dwie strony, dzięki czemu dwa małe urządzenia mogą leżeć obok siebie. Dalsze prace mogą skupić się na testach dostępności, responsywności i wyspecjalizowanych faceplate'ach urządzeń.

Pełny zestaw promptów użytych do przygotowania wizualizacji znajduje się w [PROMPTS.md](PROMPTS.md).
