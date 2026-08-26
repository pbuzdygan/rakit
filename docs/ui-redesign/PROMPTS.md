# Prompty mockupów

Wszystkie obrazy wygenerowano w trybie wbudowanym `imagegen`, jako `ui-mockup`. Wspólne ograniczenia: profesjonalna konsola Operations, płaski ciemny interfejs, gęstość informacji, promień 4–6 px, obramowania 1 px, brak dużych zaokrąglonych kart, pigułek, gradientów, glassmorphismu, poświaty, dużych pustych przestrzeni, emoji i stylistyki neon sci-fi.

## 01 — Rack elevation

Pełnoekranowy desktop 16:9. Stała lewa nawigacja RAKIT z modułami Overview, Racks, IP Addressing, Port Map, Wake on LAN i Audit Log; Racks aktywny. Wąski topbar z breadcrumbs `Infrastructure / Warsaw HQ / EDGE-A`, wyszukiwaniem i stanem `UniFi Connected`. Nagłówek `EDGE-A · Core room` oraz statystyki 42U, 9 devices, 23U free. Centralnie realistyczna 42U szafa z firewall, patch panelem, switchem 48-portowym, serwerami i UPS; wybrany switch z cienkim cyan obramowaniem. Po prawej inspektor `USW-Pro-48-PoE`, zakładki Details/Ports/Links, Position U16, Management IP 10.20.0.2, VLAN 10, Status Online i linked endpoints. Paleta graphite/slate, cyan tylko dla selekcji, kolory semantyczne tylko dla stanów.

## 02 — Port Map

Ten sam shell produktu, aktywny Port Map. Breadcrumbs `Infrastructure / Warsaw HQ / Port Map`. Kolumna DEVICES z `PP-01 · Patch Panel 24p`, `SW-CORE-01 · 48 ports`, `SW-ACCESS-02 · 24 ports`. Środkowe płótno `Patch panel to switch` z realistycznym patch panelem i switchem, numerowanymi RJ45, kontrolkami stanu i czytelnymi trasami kabli. Wybrana ścieżka cyan z `PP-01 / 12` do `SW-CORE-01 / 17`. Poniżej gęsta tabela Connections: Source, Destination, VLAN, IP / Device, Status. Po prawej Connection details z tagiem Office-12, VLAN 120, urządzeniem AP-3F-WEST, IP 10.120.3.17 oraz Save changes/Unlink.

## 03 — IP Addressing

Ten sam shell produktu, aktywny IP Addressing. Breadcrumbs `Infrastructure / Warsaw HQ / IP Addressing`, status UniFi Connected i Sync now. Kolumna NETWORKS z Management, Servers, Users i IoT wraz z wykorzystaniem; Servers aktywny. Główny nagłówek `Servers · 10.20.0.0/24`, statystyki 62 reserved, 18 online, 74% available i akcja Reserve address. Gęsta tabela IP address, Name, Hostname, MAC address, Source, Status, Updated z rozróżnieniem UniFi/Manual i stanami Online/Reserved/Conflict. Po prawej inspektor IP reservation dla 10.20.0.42 BUILD-AGENT-02, MAC 3C:52:82:AF:10:42, Source Manual, Linked device EDGE-A / U14 oraz Save changes/Release reservation.

## 04 — Wake on LAN

Ten sam shell produktu, aktywny Wake on LAN. Breadcrumbs `Infrastructure / Warsaw HQ / Wake on LAN`, globalny stan `3 of 7 online`. Nagłówek Wake on LAN / Machines and schedules, akcje Wake selected i Add machine. Pasek podsumowania: 7 machines, 3 online, 2 scheduled, Last check 09:42:18. Gęsta tabela z checkboxami i kolumnami Machine, IP address, MAC address, Broadcast, Status, Last seen, Schedule, Action; w każdym wierszu kompaktowe Wake. Wybrany BUILD-AGENT-02. Po prawej Machine details z IP, MAC, broadcast, linked device, schedule i akcjami Wake now, Save changes, Delete machine; niżej Upcoming schedules.
