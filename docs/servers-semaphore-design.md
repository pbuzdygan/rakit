# Servers + Semaphore — projekt modułu

Status: projekt do implementacji  
Zakres: MVP oraz ścieżka rozwoju  
Data: 2026-09-17

## 1. Decyzje architektoniczne

### Źródła prawdy

| Obszar | Źródło prawdy |
| --- | --- |
| Serwery, adresy zarządzające, port SSH, środowisko, role i grupy | Rakit |
| Powiązanie serwera z urządzeniem w szafie i adresem IP | Rakit |
| Treść dedykowanego inventory Ansible | generowana przez Rakit |
| Klucze SSH, hasła sudo i Vault | Semaphore Key Store |
| Projekt, repository, szablony, harmonogramy i logi zadań | Semaphore |
| Ostatni znormalizowany stan aktualizacji widoczny na dashboardzie | Rakit, na podstawie wyników Ansible |

Wybrane w Semaphore inventory pozostaje typu `static`, ale nie jest drugą ręcznie utrzymywaną bazą serwerów. Jest projekcją danych Rakita, publikowaną przez REST API. Należy utworzyć osobne inventory przeznaczone wyłącznie dla Rakita, np. `RAKIT Managed Servers`.

Ręczna edycja tego inventory w Semaphore jest traktowana jako konflikt. Rakit nie nadpisze obcej zmiany automatycznie. Pozostałe inventory w Semaphore mogą być nadal zarządzane ręcznie i nie są dotykane przez Rakit.

### Granica bezpieczeństwa

Rakit nie wykonuje SSH i nie przechowuje kluczy hostów. Backend Rakita posiada wyłącznie token REST API Semaphore. Frontend nigdy nie otrzymuje tokenu ani możliwości przesłania dowolnego `template_id`, argumentów Ansible lub wzorca `limit`.

Semaphore wykonuje playbooki i zachowuje pełne logi. Rakit udostępnia zamknięty katalog akcji: sprawdzenie aktualizacji, instalacja aktualizacji i restart.

## 2. Zakres MVP

MVP obejmuje:

1. Jeden aktywny profil integracji Semaphore.
2. CRUD serwerów i grup w Rakit.
3. Dedykowane statyczne inventory generowane w formacie INI.
4. Podgląd różnic i jawne pierwsze opublikowanie inventory.
5. Automatyczną publikację po zmianach serwerów/grup oraz możliwość ponowienia synchronizacji.
6. Akcję `Check updates` dla jednego serwera i grupy.
7. Akcję `Update packages` dla jednego serwera, z potwierdzeniem.
8. Akcję `Reboot` dla jednego serwera, z potwierdzeniem.
9. Śledzenie statusu zadania Semaphore oraz link do pełnego logu.
10. Zapis ustrukturyzowanego wyniku kontroli aktualizacji w Rakit.
11. Linki `Cockpit`, `Semaphore` i opcjonalny URI `ssh://` na karcie serwera.
12. Audit Log dla zmian danych, synchronizacji inventory i operacji.

Poza MVP pozostają: automatyczne pełne aktualizacje, rozbudowane maintenance windows, callback Ansible do Rakita, wiele profili Semaphore, GitHub jako źródło inventory oraz pełny monitoring CPU/RAM w czasie rzeczywistym.

## 3. Model domeny

### 3.1 `semaphore_profiles`

Profil opisuje połączenie Rakita z kontrolerem Semaphore i mapowanie do zasobów wykonawczych.

```sql
CREATE TABLE semaphore_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  api_url TEXT NOT NULL,
  ui_url TEXT NOT NULL,
  api_token_encrypted TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  inventory_id INTEGER NOT NULL,
  check_template_id INTEGER,
  update_template_id INTEGER,
  reboot_template_id INTEGER,
  health_template_id INTEGER,
  allow_self_signed INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  inventory_last_hash TEXT,
  inventory_last_synced_at TEXT,
  inventory_sync_state TEXT NOT NULL DEFAULT 'uninitialized',
  inventory_sync_error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  CHECK(inventory_sync_state IN ('uninitialized', 'synced', 'pending', 'conflict', 'failed'))
);
```

Token jest szyfrowany istniejącym mechanizmem AES-256-GCM i `APP_ENC_KEY`. Odpowiedzi API zwracają jedynie `hasToken: true/false`.

W MVP interfejs pozwala utworzyć tylko jeden aktywny profil, lecz schema nie zamyka drogi do wielu instancji w przyszłości.

### 3.2 `servers`

```sql
CREATE TABLE servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ansible_alias TEXT NOT NULL UNIQUE COLLATE NOCASE,
  hostname TEXT,
  primary_ip TEXT NOT NULL,
  ssh_port INTEGER NOT NULL DEFAULT 22,
  os_family TEXT NOT NULL DEFAULT 'linux',
  os_name TEXT,
  os_version TEXT,
  environment TEXT,
  role TEXT,
  location TEXT,
  cockpit_url TEXT,
  notes TEXT,
  linked_device_id INTEGER,
  ansible_enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_device_id) REFERENCES cabinet_devices(id) ON DELETE SET NULL,
  CHECK(ssh_port BETWEEN 1 AND 65535),
  CHECK(status IN ('unknown', 'online', 'offline', 'error', 'maintenance'))
);
```

`ansible_alias` jest stabilnym identyfikatorem technicznym. Po pierwszym udanym uruchomieniu zadania jego zmiana wymaga osobnego potwierdzenia, ponieważ wpływa na historię i `--limit`.

Dozwolony format aliasu w MVP:

```text
^[a-z0-9][a-z0-9_-]{0,62}$
```

`primary_ip` przyjmuje IPv4, IPv6 albo poprawną nazwę DNS. W inventory jest publikowany jako `ansible_host`. `name` jest nazwą prezentacyjną i może zawierać spacje.

### 3.3 Grupy

```sql
CREATE TABLE server_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ansible_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT,
  color TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE server_group_members (
  server_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(server_id, group_id),
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE,
  FOREIGN KEY(group_id) REFERENCES server_groups(id) ON DELETE CASCADE
);
```

Grupa ma nazwę prezentacyjną i osobną stabilną nazwę Ansible. Jeden serwer może należeć do wielu grup. Wartości `environment` i `role` pozostają polami opisowymi; nie tworzą niejawnie grup. UI może zaproponować utworzenie odpowiadającej grupy, ale użytkownik zatwierdza to jawnie.

### 3.4 Stan aktualizacji

```sql
CREATE TABLE server_update_status (
  server_id INTEGER PRIMARY KEY,
  updates_available INTEGER,
  security_updates INTEGER,
  reboot_required INTEGER,
  packages_json TEXT,
  kernel TEXT,
  uptime_seconds INTEGER,
  checked_at TEXT,
  check_result TEXT NOT NULL DEFAULT 'never',
  source_task_id INTEGER,
  raw_result_json TEXT,
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE,
  CHECK(check_result IN ('never', 'ok', 'partial', 'failed', 'stale'))
);
```

`packages_json` jest opcjonalne i ma limit rozmiaru. Lista serwerów korzysta z pól liczbowych, a szczegóły pakietów są ładowane dopiero w inspektorze.

### 3.5 Historia operacji

```sql
CREATE TABLE server_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER,
  group_id INTEGER,
  action TEXT NOT NULL,
  semaphore_profile_id INTEGER NOT NULL,
  semaphore_template_id INTEGER NOT NULL,
  semaphore_task_id INTEGER,
  target_limit TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitting',
  requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT,
  result_summary TEXT,
  error_message TEXT,
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE SET NULL,
  FOREIGN KEY(group_id) REFERENCES server_groups(id) ON DELETE SET NULL,
  FOREIGN KEY(semaphore_profile_id) REFERENCES semaphore_profiles(id) ON DELETE RESTRICT,
  CHECK(action IN ('check_updates', 'update_packages', 'reboot', 'health_check')),
  CHECK(status IN ('submitting', 'queued', 'running', 'success', 'failed', 'stopped', 'unknown'))
);
```

Nie zapisujemy pełnego logu Ansible w SQLite. Historia Rakita przechowuje stan, krótkie podsumowanie i identyfikator zadania. Pełny log pozostaje w Semaphore.

## 4. Generowanie inventory

### Format MVP

Rakit generuje deterministyczne INI. Serwery i grupy są sortowane po technicznym aliasie, dzięki czemu ten sam stan danych zawsze daje identyczny dokument i hash.

```ini
# Managed by Rakit. Manual changes will cause a synchronization conflict.

[rakit_managed]
buzhulk ansible_host=192.168.68.20 ansible_port=22
buzhulk-dev ansible_host=192.168.68.30 ansible_port=22

[production]
buzhulk

[development]
buzhulk-dev

[docker_hosts]
buzhulk
buzhulk-dev
```

Wyłączony `ansible_enabled` usuwa host z projekcji, ale nie usuwa rekordu serwera z Rakita.

Rakit nie publikuje w inventory sekretów, haseł, prywatnych kluczy ani dowolnych wartości przekazanych przez frontend. W MVP publikuje tylko alias, `ansible_host`, `ansible_port` i członkostwo w grupach.

### Synchronizacja i konflikt

Każde inventory ma zapamiętany hash ostatniej treści skutecznie opublikowanej przez Rakit.

Przed aktualizacją backend:

1. pobiera bieżące inventory z Semaphore,
2. normalizuje końce linii i oblicza SHA-256,
3. porównuje hash z `inventory_last_hash`,
4. generuje nową treść z lokalnej bazy,
5. wykonuje `PUT` tylko wtedy, gdy zdalna treść nadal odpowiada ostatnio opublikowanej wersji.

Jeżeli zdalny hash różni się od ostatniego znanego, stan przechodzi na `conflict`. Użytkownik otrzymuje podgląd różnic oraz akcje:

- `Import as draft` — późniejszy etap; próba utworzenia rekordów w Rakit,
- `Replace with Rakit inventory` — jawne nadpisanie po potwierdzeniu,
- `Cancel` — pozostawienie konfliktu.

Pierwsza konfiguracja również wymaga jawnej akcji `Adopt inventory`. Domyślnie Rakit nie nadpisuje istniejącej treści.

### Zachowanie przy awarii Semaphore

Zmiana serwera jest najpierw zapisywana w Rakit, ponieważ to Rakit jest źródłem prawdy. Następnie wykonywana jest próba synchronizacji.

Jeżeli Semaphore jest niedostępny:

- zapis serwera pozostaje wykonany,
- profil otrzymuje `inventory_sync_state = 'failed'`,
- UI pokazuje `Inventory out of sync`,
- akcje Ansible dla niesynchronizowanego nowego/zmienionego hosta są zablokowane,
- użytkownik może użyć `Retry sync`.

Nie próbujemy udawać transakcji rozproszonej między SQLite i Semaphore.

## 5. Klient Semaphore po stronie backendu

Powstaje osobny moduł `backend/semaphoreClient.js`, odpowiedzialny za:

- nagłówek `Authorization: Bearer ...`,
- limit czasu połączenia,
- limit rozmiaru odpowiedzi,
- normalizację błędów i statusów tasków,
- pobranie projektu, inventory, templates, tasku i outputu,
- aktualizację inventory,
- uruchomienie tasku.

Profil jest testowany przez odczyt projektu, inventory i skonfigurowanych templates. Sam sukces TCP/HTTP nie oznacza poprawnej konfiguracji.

Podobnie jak w integracji UniFi, adres docelowy musi być walidowany po rozwiązaniu DNS. Prywatne adresy LAN są dozwolone. Loopback wymaga osobnego, świadomego opt-in przez zmienną środowiskową `SEMAPHORE_ALLOW_LOOPBACK=true`, ponieważ Rakit i Semaphore mogą działać na tym samym hoście. Przekierowania HTTP są wyłączone albo ponownie walidowane po każdym kroku.

Proponowane ustawienia:

```text
SEMAPHORE_TIMEOUT_MS=15000
SEMAPHORE_MAX_RESPONSE_MB=10
SEMAPHORE_ALLOW_LOOPBACK=false
```

## 6. Kontrakt uruchamiania zadań

Frontend przesyła wyłącznie nazwę dozwolonej operacji przez dedykowany endpoint. Backend wybiera template zapisany w profilu oraz `limit` zapisany na serwerze lub grupie.

Przykładowe wywołanie Semaphore:

```http
POST /api/project/1/tasks
Authorization: Bearer <token>
Content-Type: application/json

{
  "template_id": 12,
  "limit": "buzhulk"
}
```

W każdym szablonie używanym przez Rakit musi być włączony Ansible Prompt `Limit`. Test profilu powinien zgłosić ostrzeżenie, jeżeli konfiguracja szablonu nie pozwala na override limitu.

Backend przed uruchomieniem sprawdza, czy:

- profil i template są aktywne,
- inventory jest zsynchronizowane,
- alias nadal istnieje w lokalnej projekcji,
- na serwerze nie trwa konfliktująca operacja,
- operacja destrukcyjna ma poprawne potwierdzenie.

`Update packages` i `Reboot` przyjmują pole `confirmation` równe aktualnemu aliasowi serwera. Operacje grupowe aktualizacji i restartu nie wchodzą do MVP.

## 7. Ustrukturyzowany wynik playbooka

Playbook kontrolny emituje dokładnie jeden rekord na host, z ustalonym prefiksem i wersją schematu:

```text
RAKIT_RESULT_V1={"host":"buzhulk","updates":14,"security":3,"rebootRequired":true,"kernel":"6.8.0-xx","uptimeSeconds":2419200}
```

Parser:

- czyta wyłącznie linie z prefiksem `RAKIT_RESULT_V1=`,
- przyjmuje maksymalnie jeden wynik na host,
- ogranicza rozmiar rekordu,
- waliduje alias względem targetu i lokalnej bazy,
- waliduje typy i zakresy liczb,
- ignoruje nieznane pola,
- nie interpretuje kodu ani sekwencji terminalowych.

Brak rekordu przy zakończonym tasku oznacza `partial` lub `failed`, a nie zero aktualizacji.

W późniejszym etapie parser logu można zastąpić uwierzytelnionym callbackiem HTTP z pluginu Ansible. Format `RAKIT_RESULT_V1` pozostaje wspólnym kontraktem danych.

## 8. REST API Rakita

### Profil integracji

```text
GET    /api/semaphore/profile
POST   /api/semaphore/profile
PATCH  /api/semaphore/profile/:id
POST   /api/semaphore/profile/test
POST   /api/semaphore/profile/:id/discover
GET    /api/semaphore/profile/:id/inventory-diff
POST   /api/semaphore/profile/:id/inventory-adopt
POST   /api/semaphore/profile/:id/inventory-sync
```

`discover` zwraca listę projektów, inventory i templates możliwych do wybrania, ale nie zapisuje zmian. Token nigdy nie występuje w odpowiedzi.

### Serwery i grupy

```text
GET    /api/servers
POST   /api/servers
GET    /api/servers/:id
PATCH  /api/servers/:id
DELETE /api/servers/:id

GET    /api/server-groups
POST   /api/server-groups
PATCH  /api/server-groups/:id
DELETE /api/server-groups/:id
PUT    /api/server-groups/:id/members
```

Lista obsługuje filtry `query`, `group`, `environment`, `status`, `updates` oraz sortowanie po nazwie, ostatnim sprawdzeniu i liczbie aktualizacji.

Usunięcie serwera usuwa go z następnej projekcji inventory, ale zachowuje skrócone wpisy historyczne przez `ON DELETE SET NULL` w tabeli operacji. Przed usunięciem UI pokazuje wpływ na grupy i inventory.

### Akcje

```text
POST /api/servers/:id/actions/check-updates
POST /api/servers/:id/actions/update-packages
POST /api/servers/:id/actions/reboot
POST /api/server-groups/:id/actions/check-updates
GET  /api/server-actions?serverId=&status=&limit=&cursor=
GET  /api/server-actions/:id
POST /api/server-actions/:id/refresh
```

Odpowiedź uruchomienia ma status `202 Accepted`:

```json
{
  "action": {
    "id": 41,
    "status": "queued",
    "semaphoreTaskId": 928,
    "target": "buzhulk",
    "logUrl": "https://semaphore.example/project/1/history/928"
  }
}
```

Frontend odpytuje aktywną operację co 3 sekundy. Po zamknięciu widoku nic nie zostaje utracone: ponowne wejście lub `refresh` uzgadnia stan z Semaphore. Backend nie utrzymuje długotrwałego procesu oczekującego na zakończenie tasku.

## 9. Widoki

### Lista `Servers`

Nowy element sidebara znajduje się w sekcji `Infrastructure`, bez ukrywania istniejących `Racks`.

```text
Servers                                      [Sync inventory] [Add server]
Inventory: Synced · 17 Sep 2026, 10:42

[Search] [All groups] [All environments] [Updates: any]

SERVER          STATUS   GROUPS              UPDATES   SECURITY   REBOOT   LAST CHECK
BUZHULK         Online   Production, Docker       3          1       No   8 min ago
BUZHULK-DEV     Online   Development, Docker     18          4      Yes   8 min ago
BUZLAP01        Offline  Workstations              —          —        —   Failed
```

Wielokrotny wybór w MVP pozwala wykonać tylko `Check updates`. Zbiorcze update/reboot są celowo niedostępne.

### Inspektor serwera

Kliknięcie wiersza otwiera prawy inspektor zgodny z istniejącym Operations Console:

```text
BUZHULK                                      Online
192.168.68.20 · Ubuntu · Docker Host

Updates
3 available · 1 security · reboot not required
Last checked 8 minutes ago

[Check updates] [Update packages]

Management
[Open Cockpit] [Open Semaphore task] [SSH]

Tabs: Overview | Updates | Automation | Details | History
```

`Cockpit` otwiera tylko zapisany URL. Rakit nie proxy'uje ani nie osadza Cockpit w iframe. Obecna polityka CSP `frame-ancestors` i różne mechanizmy logowania przemawiają za otwarciem nowej karty.

### Konfiguracja Semaphore

Profil znajduje się w ustawieniach/integrations i prowadzi użytkownika kolejno:

1. URL i token,
2. `Test connection`,
3. wybór projektu,
4. wybór dedykowanego inventory,
5. mapowanie czterech templates,
6. podgląd inventory i pierwsze `Adopt inventory`.

Wybór identyfikatorów odbywa się z danych odkrytych przez API, nie przez ręczne przepisywanie numerów, choć zaawansowany tryb może je pokazywać.

## 10. Harmonogramy

Harmonogramy pozostają konfigurowane w Semaphore. Rakit ich nie duplikuje, ale okresowo importuje zakończone zadania posiadające `schedule_id` i przypisany template.

Pierwszy zalecany harmonogram:

```text
Template: Check updates
Cron: 0 6 * * *
Limit: rakit_managed
Timezone: Europe/Warsaw
```

Backend pobiera ostatnie taski co 10 sekund, filtruje wyłącznie zadania harmonogramowe i rozpisuje znaczniki `RAKIT_RESULT_V1`, `RAKIT_HEALTH_V1` oraz `RAKIT_OPERATION_V1` na wszystkie pasujące hosty. Identyfikator taska jest zapisywany jako zaimportowany, więc wynik nie jest przetwarzany ponownie. Zadania uruchomione ręcznie bezpośrednio w Semaphore nie zmieniają stanu Rakita.

## 11. Stany błędów widoczne w UI

| Stan | Zachowanie |
| --- | --- |
| Brak profilu Semaphore | lista serwerów działa, akcje automatyzacji pokazują konfigurator |
| Błędny/wygasły token | profil `Disconnected`, akcje zablokowane, istniejące dane pozostają widoczne |
| Semaphore niedostępny | lokalne CRUD działa, sync `failed`, retry dostępne |
| Inventory zmienione ręcznie | `conflict`, brak automatycznego nadpisania |
| Brak template | tylko odpowiadająca akcja jest zablokowana |
| Limit prompt wyłączony | template oznaczony jako niebezpiecznie skonfigurowany; akcja zablokowana |
| Host poza zsynchronizowanym inventory | akcja zablokowana do czasu synchronizacji |
| Task bez `RAKIT_RESULT_V1` | task może być `success`, ale wynik checku jest `partial` |
| Serwer niedostępny po SSH | status operacji `failed`; nie zmieniamy automatycznie ogólnego statusu na trwałe `offline` po pojedynczej próbie |

## 12. Audyt

Do `audit_events` trafiają co najmniej:

- `server.create`, `server.update`, `server.delete`,
- `server_group.create`, `server_group.update`, `server_group.delete`,
- `semaphore_profile.create`, `semaphore_profile.update`, `semaphore_profile.test`,
- `inventory.sync`, `inventory.conflict`, `inventory.force_replace`,
- `server_action.request`, `server_action.finish`.

Payload audytu nie zawiera tokenu, treści kluczy, haseł, pełnego outputu Ansible ani wartości oznaczonych jako secret.

## 13. Etapy implementacji

### Etap A — model i profil integracji

- addytywne tabele/migracje SQLite,
- `semaphoreClient.js`, szyfrowanie tokenu i test połączenia,
- formularz profilu z discovery projektu/inventory/templates,
- testy błędnego tokenu, timeoutu, TLS i limitów odpowiedzi.

### Etap B — katalog serwerów i grupy

- CRUD i walidacja,
- widok listy, filtry, inspektor i powiązanie z rack device,
- link Cockpit,
- Audit Log.

### Etap C — projekcja inventory

- generator deterministycznego INI,
- preview/diff, pierwsza adopcja, hash i wykrywanie konfliktu,
- automatyczna synchronizacja po CRUD,
- stany pending/failed/conflict oraz retry.

### Etap D — operacje

- mapowanie templates,
- uruchamianie ograniczone przez `limit`,
- polling statusu i link do logu,
- potwierdzenia update/reboot oraz blokada konfliktujących operacji.

### Etap E — wyniki aktualizacji

- playbook `check-updates.yml`,
- kontrakt `RAKIT_RESULT_V1`, parser i zapis snapshotu,
- badge aktualizacji, security i reboot,
- historia kontroli.

### Etap F — automatyzacja

- callback albo ingestia scheduled tasks,
- powiadomienia,
- maintenance windows,
- opcjonalne automatyczne security updates per grupa.

## 14. Kryteria odbioru MVP

1. Dodanie serwera w Rakit powoduje deterministyczną zmianę dedykowanego inventory Semaphore.
2. Awaria Semaphore nie usuwa ani nie cofa danych serwera w Rakit.
3. Ręczna zmiana inventory w Semaphore powoduje konflikt i nie jest automatycznie nadpisywana.
4. Token nie występuje w odpowiedziach API, logach, eksporcie ani Audit Log.
5. Akcja pojedynczego serwera zawsze wysyła dokładny alias jako `limit`; brak włączonego promptu blokuje akcję.
6. Frontend nie może wskazać dowolnego template ani dowolnego targetu.
7. Update i reboot wymagają jawnego potwierdzenia i są audytowane.
8. Sukces zadania bez poprawnego rekordu wynikowego nie jest prezentowany jako `0 updates`.
9. Pełny log pozostaje w Semaphore, a Rakit przechowuje tylko stan i podsumowanie.
10. Moduł działa bez Semaphore jako lokalny katalog serwerów, pokazując jednoznaczny stan integracji.

## 15. Stan realizacji 1.4.0

Etapy A–E zostały zrealizowane. Integracja używa dedykowanego inventory typu `static`, a przed każdą akcją backend sprawdza w template obecność `task_params.params.limit`. Brak promptu `Limit` blokuje wykonanie zamiast ryzykować uruchomienie playbooka na całym inventory.

Gotowy backup projektu i szczegółowa instrukcja znajdują się w `semaphore/`. Backup został próbnie zaimportowany i ponownie wyeksportowany w czystym Semaphore `v2.19.14`; zachowane zostały inventory, repository, credentials, templates oraz ustawienie promptu `Limit`.

Etap F pozostaje rozwojem po MVP. Harmonogramy nadal konfiguruje się bezpośrednio w Semaphore, a Rakit zachowuje lokalny katalog i wszystkie dane również bez skonfigurowanej integracji.
