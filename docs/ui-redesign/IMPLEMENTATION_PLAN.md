# Plan wdrożenia Rakit Operations Console

## Cel

Przebudować Rakit z zestawu osobnych, miękkich dashboardów w spójną konsolę operacyjną. Zmiana obejmuje architekturę nawigacji, system wizualny i sposób pracy z obiektami infrastruktury. Dane użytkownika i istniejące API muszą pozostać zgodne w trakcie migracji.

## Stan wdrożenia — 19 sierpnia 2026

Produkcyjny zakres Operations Console jest wdrożony w bieżącej gałęzi:

- gotowy: Operations Shell, zwijany sidebar, topbar, lokalny zestaw ikon SVG i nowy system wizualny,
- gotowy: Racks z czytelnym nagłówkiem szafy (capacity/devices/free U), przełącznikiem wielu szaf, elewacją, front/rear, drag-and-drop, metadanymi urządzeń i prawym inspektorem,
- gotowy: numeracja U od dołu albo od góry, wybierana przy tworzeniu i edytowalna później; zmiana kierunku przelicza pozycje bez fizycznego przesuwania urządzeń,
- gotowy: urządzenia pełnej szerokości oraz półszerokie `left`/`right`; przeciągnięcie na zajęte U proponuje automatyczny podział półki, a reguły kolizji uwzględniają zajmowaną stronę,
- gotowy: ujednolicona, większa typografia tekstów operacyjnych w Racks, Port Map, IP Addressing, WOL, tabelach, formularzach i inspektorach,
- gotowy: trwały model `port_connections`, API CRUD, wizualne trasy, tabela Connections i inspektor połączenia,
- gotowy: WOL machines, magic packet, operacje zbiorcze, harmonogramy cron, rate limit oraz osiągalność przez opcjonalną, cache'owaną sondę TCP,
- gotowy: nowy IP Addressing z przeglądarką sieci, paginowaną tabelą/gridem, Source/Status/Linked device, wykrywaniem konfliktu MAC, edycją lokalnych rezerwacji i tworzeniem targetu WOL,
- gotowy: Overview oraz Audit Log z filtrami serwerowymi, paginacją kursorową, CSV i opcjonalną retencją przez `AUDIT_RETENTION_DAYS`,
- gotowy: eksport XLSX szaf, urządzeń (wraz z szerokością rack), Connections, WOL/schedules i IP Addressing.

Migracje SQLite są addytywne i są wykonywane przez istniejący mechanizm startowy backendu.

Weryfikacja bieżącego zakresu:

- TypeScript (`tsc --noEmit`) i produkcyjny build Vite przechodzą,
- migracje oraz nowe obiekty schematu przechodzą na świeżej bazie SQLite,
- test integracyjny API obejmuje współdzielenie U przez `left + right`, atomowy podział urządzenia `full`, blokadę trzeciego urządzenia po tej samej stronie, zmianę kierunku numeracji bez przesunięcia fizycznego, mapę portów, linked device w IPAM, sondę WOL, paginację/filtry/CSV Audit oraz odczyt wygenerowanego XLSX,
- workbook testowy zawiera arkusze `Cabinet devices`, `Port connections`, `WOL machines`, `WOL schedules` i `IP Dash – Management`.

## Zasady migracji

- Najpierw powstaje shell i zestaw komponentów, później wymieniane są pojedyncze widoki.
- Migracje SQLite są addytywne; istniejące dane szaf, portów i IP nie są usuwane.
- Każdy moduł dostaje widok listy/płótna oraz jeden wspólny prawy inspektor.
- Operacje destrukcyjne wymagają potwierdzenia i trafiają do Audit Log.
- Widok desktopowy jest priorytetem, ale shell od początku zachowuje możliwość zwinięcia nawigacji.

## Etap 0 — zatwierdzenie prototypu

Zakres:

- klikalna nawigacja modułów,
- zwijany lewy sidebar,
- Racks z realistyczną elewacją i inspektorem urządzenia,
- Port Map z portami, trasami i tabelą połączeń,
- IP Addressing z sieciami, tabelą i rezerwacją,
- Wake on LAN z listą, akcjami i harmonogramem,
- Overview oraz Audit Log jako elementy docelowego shellu.

Rezultat: [prototyp HTML](prototype/index.html).

## Etap 1 — fundament frontendu

1. Zastąpić `MainBar` komponentami `AppShell`, `Sidebar`, `Topbar` i `Inspector`.
2. Rozszerzyć store widoków do: `overview`, `racks`, `ip`, `ports`, `wol`, `audit`.
3. Wydzielić tokeny Operations Dark i przenieść komponenty na promienie 4–6 px oraz obramowania 1 px.
4. Zastąpić emoji ikonami SVG z jednego lokalnego zestawu.
5. Dodać wspólne komponenty: `DataTable`, `StatusDot`, `Toolbar`, `ContextPane`, `ConfirmAction`, `EmptyState`.
6. Zapisać stan zwinięcia sidebara oraz ostatnio wybrany moduł w localStorage.

Warunek odbioru: istniejące API działa przez nowy shell, a PIN guard, eksport i ustawienia pozostają dostępne.

## Etap 2 — Racks

1. Przebudować `CabinetView` na elewację prawdziwej szafy z numeracją U po obu stronach.
2. Po kliknięciu urządzenia pokazywać inspektor Details / Ports / Links.
3. Zachować drag-and-drop i kontrolę kolizji; dodać wyraźny tryb edycji, aby przypadkowy drag nie zmieniał układu.
4. Dodać opcjonalne pola urządzenia: management IP, asset ID, status i face (`front`, `rear`, `both`).
5. Powiązać urządzenie z rezerwacją IP oraz portami bez duplikowania danych.
6. Dodać `rack_lane` (`full`, `left`, `right`) i zezwolić na współdzielenie zakresu U tylko przez parę lewa/prawa strona.
7. Dodać kierunek numeracji szafy (`bottom-up`, `top-down`) i zachować fizyczny układ urządzeń podczas jego zmiany.

Zmiany bazy:

- `cabinet_devices.management_ip`
- `cabinet_devices.asset_tag`
- `cabinet_devices.status`
- `cabinet_devices.face`
- `cabinet_devices.rack_lane`
- `cabinets.numbering_direction`

Warunek odbioru: dodawanie, edycja, usuwanie i przesuwanie urządzeń działa jak wcześniej, a wybrany obiekt ma kompletny inspektor.

## Etap 3 — Port Map

Aktualny `device_ports` opisuje port, ale nie modeluje relacji między dwoma portami. Potrzebny jest osobny obiekt połączenia.

Proponowana tabela:

```sql
CREATE TABLE port_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_port_id INTEGER NOT NULL,
  destination_port_id INTEGER NOT NULL,
  tag TEXT,
  vlan TEXT,
  ip_address TEXT,
  linked_asset_id INTEGER,
  status TEXT NOT NULL DEFAULT 'connected',
  comment TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(source_port_id) REFERENCES device_ports(id) ON DELETE CASCADE,
  FOREIGN KEY(destination_port_id) REFERENCES device_ports(id) ON DELETE CASCADE,
  CHECK(source_port_id <> destination_port_id),
  UNIQUE(source_port_id),
  UNIQUE(destination_port_id)
);
```

API:

- `GET /api/port-connections`
- `POST /api/port-connections`
- `PATCH /api/port-connections/:id`
- `DELETE /api/port-connections/:id`
- odpowiedzi zawierają oba urządzenia, porty i cabinet context, aby frontend nie wykonywał zapytań N+1.

Frontend:

1. Lista urządzeń port-aware po lewej.
2. Jedno płótno z wybranymi urządzeniami i nieaktywnymi trasami w tle.
3. Kliknięcie portu lub wiersza wybiera całą ścieżkę.
4. Tryb Link ports prowadzi użytkownika przez wybór dwóch wolnych końców.
5. Tabela Connections ma filtrowanie po urządzeniu, porcie, tagu, VLAN, IP i statusie.

Warunek odbioru: port nie może należeć do dwóch połączeń, a usunięcie urządzenia pokazuje wpływ na istniejące linki przed potwierdzeniem.

## Etap 4 — IP Addressing

1. Zachować profile i integrację UniFi, ale ujednolicić dane UniFi oraz local-offline do jednego modelu widoku.
2. Zastąpić wielokolumnowe grupy adresów jedną tabelą z wirtualizacją lub paginacją.
3. Dodać kolumny Source, Status oraz Linked device.
4. Dodać wykrywanie konfliktów IP/MAC i wyraźny stan synchronizacji.
5. Pozwolić utworzyć maszynę WOL z istniejącej rezerwacji.

Warunek odbioru: istniejące profile, scope i ręczne rezerwacje są zachowane po migracji UI.

## Etap 5 — Wake on LAN

Nowe tabele:

```sql
CREATE TABLE wol_machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ip_address TEXT,
  mac_address TEXT NOT NULL,
  broadcast_address TEXT,
  port INTEGER NOT NULL DEFAULT 9,
  linked_device_id INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_device_id) REFERENCES cabinet_devices(id) ON DELETE SET NULL
);

CREATE TABLE wol_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL,
  name TEXT,
  cron TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(machine_id) REFERENCES wol_machines(id) ON DELETE CASCADE
);
```

API:

- CRUD `/api/wol/machines`
- `POST /api/wol/machines/:id/wake`
- CRUD `/api/wol/schedules`
- `GET /api/wol/status` z ograniczoną współbieżnością i krótkim cache

Bezpieczeństwo:

- walidacja MAC, IPv4/hostname, broadcast i portu,
- rate limit dla akcji Wake,
- brak możliwości wysyłania pakietów poza dozwolone interfejsy/broadcasty skonfigurowane przez administratora,
- logowanie akcji Wake do Audit Log.

Warunek odbioru: maszyny można dodawać z UI albo tworzyć z urządzenia/rezerwacji; działa Wake, wybór zbiorczy, status i harmonogram.

## Etap 6 — Audit Log i stabilizacja

1. Dodać tabelę `audit_events` z aktorem, akcją, typem obiektu, identyfikatorem, rezultatem i bezpiecznym payloadem bez sekretów.
2. Rejestrować zmiany rack, linków, rezerwacji, profili UniFi i WOL.
3. Dodać eksport CSV, retencję i paginację.
4. Przeprowadzić testy klawiatury, kontrastu, reduced motion i małych ekranów.
5. Zaktualizować eksport XLSX tak, aby zawierał Connections i WOL bez ujawniania sekretów.

## Kolejność pull requestów

1. `feat(ui): operations shell and design tokens`
2. `feat(racks): elevation workspace and device inspector`
3. `feat(ports): explicit port connection domain model`
4. `feat(ports): visual port map and connections table`
5. `feat(ipam): table workspace and linked assets`
6. `feat(wol): machines, wake action and schedules`
7. `feat(audit): operational event log`
8. `chore(ui): remove legacy mainbar and soft design styles`

## Główne ryzyka

- Przebudowa Port Hub bez migracji do `port_connections` utrwaliłaby niejednoznaczne pola tekstowe `patch_panel`.
- Realistyczne faceplate'y muszą mieć wariant uproszczony dla małych ekranów i długich szaf.
- Status WOL oparty wyłącznie na ICMP może być fałszywie ujemny; UI musi rozróżniać Offline i Unknown.
- Powiązania Rack ↔ IP ↔ Port ↔ WOL powinny używać identyfikatorów, nie nazw podatnych na zmianę.
