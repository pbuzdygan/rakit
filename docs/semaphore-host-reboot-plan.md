# Plan naprawy restartu hosta Semaphore

Data: 2026-10-09
Status: do realizacji

## Problem

Semaphore działa na BUZHULK. Restart tego serwera wykonany przez obecny playbook przerywa również proces Ansible, który miał czekać na powrót hosta i potwierdzić zakończenie operacji. Po uruchomieniu Semaphore zadanie może pozostać jako `Running`, mimo że wykonujący je proces już nie istnieje.

Rakit zachowuje poprzedni status Reboot `Required`, ponieważ obecnie aktualizuje go po zakończeniu zadania Semaphore i uzyskaniu wyniku albo statusu sukcesu. Dostępność sieciowa i wcześniejszy wynik Health nie potwierdzają restartu.

Przypadek zgłoszony: zadanie Semaphore #95, BUZHULK, 192.168.68.5. Host i usługi wróciły po restarcie, ale zadanie nie zostało zakończone.

## Docelowe działanie

Dodać osobny tryb restartu hosta Semaphore. Rakit potwierdzi zakończenie operacji po powrocie hosta, niezależnie od przerwanego zadania Ansible. Zwykłe restarty innych serwerów zachowają obecny przebieg.

### 1. Jawne wskazanie hosta Semaphore

- W konfiguracji integracji dodać wybór serwera, na którym działa Semaphore lub jego lokalny runner.
- Dla wskazanego serwera wybierać specjalny tryb restartu.
- Nie opierać rozpoznania wyłącznie na URL Semaphore, który może prowadzić przez proxy.
- Przy implementacji uwzględnić rozróżnienie hosta Semaphore i runnera, jeżeli integracja obsługuje runner zdalny.

### 2. Trwały zapis przed restartem

- Przed zleceniem restartu odczytać `/proc/sys/kernel/random/boot_id`.
- Trwale zapisać w bazie Rakita identyfikator uruchomienia systemu, identyfikator operacji, powiązane zadania Semaphore, etap operacji i termin zakończenia weryfikacji.
- Bez zapisanego identyfikatora uruchomienia nie zlecać restartu.
- Zapis musi przetrwać również restart Rakita.
- Rozdzielić przygotowanie, zlecenie restartu i weryfikację. Nie polegać na logu wypisanym tuż przed utratą procesu jako jedynym trwałym zapisie.

### 3. Zlecenie restartu z opóźnieniem

- Specjalny playbook zaplanuje restart po krótkim opóźnieniu, pozwalającym zakończyć zadanie i zapisać jego wynik w Semaphore.
- Playbook nie będzie czekał na powrót własnego hosta.
- Sukces zadania oznacza „restart zlecony”, a nie „restart zakończony”.
- Obsłużyć również przerwanie zadania mimo opóźnienia.
- Dobrać i zweryfikować mechanizm zaplanowania restartu dla obsługiwanych systemów. Musi działać po zakończeniu sesji SSH i procesu Ansible.

### 4. Weryfikacja po powrocie

- Po odzyskaniu dostępności Semaphore uruchomić kontrolę hosta.
- Odczytać nowy `boot_id`, stan zdrowia i znacznik `/var/run/reboot-required`.
- Zmieniony `boot_id` potwierdzi restart; sama dostępność sieciowa nie wystarcza.
- Po potwierdzeniu zakończyć operację sukcesem i odświeżyć dane serwera.
- Kolumna Reboot ma wynikać z aktualnego znacznika, zamiast być bezwarunkowo zerowana.

### 5. Odzyskiwanie niedokończonych operacji

- Rozszerzyć okresowe uzgadnianie statusów o nowy przepływ.
- Wznawiać weryfikację po ponownym uruchomieniu Rakita.
- Nie nadpisywać zakończonej weryfikacji starym statusem `Running` z Semaphore.
- Po przekroczeniu limitu czasu ustawić wynik „Nie udało się potwierdzić restartu” i zwolnić blokadę kolejnych akcji.
- Ponowienie kontroli nie może ponownie zlecać restartu.
- Zabezpieczyć przed równoległym uruchamianiem tych samych etapów i dublowaniem zadań weryfikacyjnych.
- Zachować aktualność danych: starsze wyniki nie mogą nadpisywać nowszych odczytów Reboot i Health.

### 6. Status w interfejsie i osierocone zadania

- Pokazać etapy: „Restart zlecony”, „Oczekiwanie na powrót”, „Weryfikacja”, „Zakończono”.
- Oddzielnie zachować rzeczywisty status zadania Semaphore oraz wynik operacji w Rakit.
- Sprawdzić możliwość zatrzymania osieroconego zadania przez API Semaphore.
- Nie zmieniać bezpośrednio bazy Semaphore i nie przedstawiać przerwanego zadania jako zakończonego sukcesem.
- Zachować powiązania z logami zlecenia i weryfikacji oraz audyt potwierdzenia restartu.

## Zakres implementacji

- Playbooki Ansible: przygotowanie, zlecenie restartu i odczyt danych weryfikacyjnych.
- Baza danych: konfiguracja hosta oraz trwały stan operacji i jej etapów.
- Backend: uruchamianie akcji, uzgadnianie statusów, odzyskiwanie po restarcie, parsowanie wyników i ochrona przed starszymi danymi.
- Frontend: konfiguracja hosta i prezentacja etapów operacji.
- Dokumentacja: konfiguracja, wdrożenie playbooków oraz diagnostyka.

Punkty wyjścia w repozytorium:

- `ansible/playbooks/reboot.yml`
- `ansible/playbooks/health-check.yml`
- `backend/server.js`: `launchServerAction`, `reconcileServerAction` i okresowe uzgadnianie z Semaphore
- `backend/db.js`
- `backend/semaphoreResults.js`
- `backend/semaphoreTaskImport.js`
- `semaphore/SETUP.pl.md`

## Kryteria odbioru

- Restart BUZHULK kończy się potwierdzonym sukcesem w Rakit, również gdy Semaphore i Rakit zostają przerwane.
- Sam powrót sieci albo restart kontenera Semaphore nie potwierdza restartu hosta.
- Brak restartu, brak SSH oraz przekroczenie czasu mają jednoznaczny wynik.
- Ponowne kontrole i restart backendu nie powodują kolejnego restartu hosta ani dublowania etapów.
- Zwykły restart innego serwera nadal działa.
- Kolumna Reboot odzwierciedla świeży odczyt znacznika.
- Health jest odświeżany po powrocie hosta.
- Starsze wyniki nie nadpisują aktualnych danych.
- Operacja zakończona lub po przekroczeniu czasu nie blokuje bezterminowo następnych akcji.
- Status zadania Semaphore i potwierdzenie restartu w Rakit pozostają rozróżnialne.

Weryfikacja obejmie testy logiki stanów, parsowania i trwałego odzyskiwania oraz kontrolowany test rzeczywistego restartu hosta Semaphore. Test rzeczywistego restartu wymaga osobnego, świadomego zlecenia w odpowiednim oknie serwisowym.

## Istniejące zadanie #95

Dla zadania #95 nie zapisano wcześniejszego `boot_id`. Naprawa nie powinna automatycznie uznać tego zadania za potwierdzony restart na podstawie samej dostępności hosta.

Doraźna obsługa: zakończyć osierocone zadanie w Semaphore i wykonać świeże `Check updates` oraz `Server health` dla BUZHULK. Ten dokument nie oznacza wykonania tych czynności.

## Kolejność realizacji

1. Doprecyzować model konfiguracji hosta/runnera i sprawdzić dostępne API zatrzymywania zadań Semaphore.
2. Zaimplementować trwały model etapów i odczyt identyfikatora uruchomienia.
3. Dodać playbook zlecenia restartu z opóźnieniem.
4. Zaimplementować odzyskiwanie i weryfikację po powrocie.
5. Dodać prezentację etapów, aktualizację danych oraz obsługę osieroconych zadań.
6. Wykonać testy i zaktualizować instrukcję wdrożenia.
7. Po osobnym zleceniu wykonać kontrolowany restart hosta Semaphore.

Plan jest zapisany do późniejszej realizacji. Kod aplikacji nie został zmieniony w ramach zapisu planu.
