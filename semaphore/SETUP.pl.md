# Rakit 1.4.2 + Semaphore 2.19 — konfiguracja

Ten katalog zawiera backup projektu Semaphore gotowy do użycia przez **Restore Project**:

- `rakit-buzlab-project.backup.json` — projekt, statyczne inventory, cztery szablony i puste wpisy credentials,
- `../ansible/playbooks/` — playbooki wykonywane przez Semaphore.

Backup celowo **nie zawiera sekretów**. Po imporcie trzeba uzupełnić prywatny klucz SSH i hasło `sudo` albo wybrać wariant `NOPASSWD` opisany poniżej.

## 1. Zamontowanie playbooków

Katalog zawierający `playbooks/` musi być widoczny w kontenerze Semaphore jako `/opt/semaphore/ansible`. Przykładowy fragment Compose:

```yaml
services:
  semaphore:
    image: semaphoreui/semaphore:v2.19.14
    environment:
      - TZ=Europe/Warsaw
      - SEMAPHORE_SCHEDULE_TIMEZONE=Europe/Warsaw
    volumes:
      - /srv/docker/semaphore/data:/var/lib/semaphore
      - /srv/docker/semaphore/config:/etc/semaphore
      - /srv/docker/semaphore/ansible:/opt/semaphore/ansible:ro
```

Skopiuj całą zawartość katalogu `ansible/` z projektu Rakit do `/srv/docker/semaphore/ansible`, również podkatalog `playbooks/tasks/`. W kontenerze muszą istnieć:

```text
/opt/semaphore/ansible/playbooks/check-updates.yml
/opt/semaphore/ansible/playbooks/tasks/privilege-preflight.yml
```

Wolumen może być tylko do odczytu. Rakit publikuje inventory przez REST API, a nie przez plik w tym katalogu.

Oficjalne tagi obrazu mają prefiks `v`. Tag `2.19.0` ani `v2.19.0` nie jest dostępny w Docker Hub; użycie nieistniejącego tagu może pozostać niezauważone, dopóki Compose nie spróbuje ponownie utworzyć kontenera.

Strefa musi być poprawną nazwą IANA z ukośnikiem, np. `Europe/Warsaw`. `SEMAPHORE_SCHEDULE_TIMEZONE` steruje wykonaniem harmonogramów Semaphore, natomiast `TZ` czasem procesu i logów. W Rakit użyj `TZ=Europe/Warsaw` albo `APP_TIME_ZONE=Europe/Warsaw`; Rakit toleruje też historyczny zapis z ukośnikiem odwrotnym i normalizuje go przed wysłaniem do interfejsu.

## 2. Import projektu

1. Zaloguj się do Semaphore.
2. Otwórz menu projektów i wybierz **Restore Project**.
3. Wskaż `semaphore/rakit-buzlab-project.backup.json`.
4. Semaphore utworzy nowy projekt **RAKIT Infrastructure**. Import nie nadpisuje istniejącego projektu.
5. Sprawdź obecność inventory `RAKIT Managed Servers`, repository `Rakit Local Playbooks`, widoku `Maintenance` i czterech templates.

## 3. Dedykowany klucz SSH

Semaphore pyta o **private key**, ponieważ to on jest klientem SSH. Serwery dostają wyłącznie odpowiadający mu **public key**. Prywatnego klucza nigdy nie kopiuj na zarządzane serwery.

W bezpiecznym katalogu na komputerze administratora utwórz osobną parę tylko dla Semaphore:

```bash
ssh-keygen -t ed25519 -a 100 -f ./semaphore_ansible_ed25519 -C "semaphore-rakit"
```

Powstaną:

- `semaphore_ansible_ed25519` — klucz prywatny; wklejasz go tylko do Semaphore,
- `semaphore_ansible_ed25519.pub` — klucz publiczny; instalujesz na każdym serwerze.

Na każdym Ubuntu/Debian utwórz użytkownika technicznego. W miejsce `WKLEJ_KLUCZ_PUBLICZNY` wstaw całą zawartość pliku `.pub`:

```bash
sudo adduser --disabled-password --gecos "" ansible
sudo usermod -aG sudo ansible
sudo install -d -m 700 -o ansible -g ansible /home/ansible/.ssh
echo 'WKLEJ_KLUCZ_PUBLICZNY' | sudo tee /home/ansible/.ssh/authorized_keys >/dev/null
sudo chown ansible:ansible /home/ansible/.ssh/authorized_keys
sudo chmod 600 /home/ansible/.ssh/authorized_keys
```

Na serwerze musi działać OpenSSH Server i Python 3. Nie instaluje się żadnego agenta Ansible ani Semaphore. Najpierw sprawdź połączenie:

```bash
ssh -i ./semaphore_ansible_ed25519 ansible@ADRES_IP
```

### Wariant A — hasło `sudo` (zalecany na początek)

Ustaw silne, osobne hasło użytkownika:

```bash
sudo passwd ansible
```

W Semaphore otwórz **Key Store**:

1. edytuj `Rakit SSH`, ustaw login `ansible` i wklej cały prywatny klucz,
2. edytuj `Rakit Sudo` (typ **Login with password**), ustaw login `ansible` i podaj hasło utworzone wyżej.
3. otwórz **Inventory → RAKIT Managed Servers → Edit** i upewnij się, że **Sudo Credentials / Become Key** wskazuje `Rakit Sudo`.

Hasło służy tylko do eskalacji `become: true`; logowanie SSH nadal odbywa się kluczem.

### Diagnostyka: timeout przy `sudo` z hasłem

Jeżeli ręczne `sudo /usr/bin/id -u` zwraca `0`, ale Ansible zgłasza
`Timeout (12s) waiting for privilege escalation prompt`, sprawdź implementację
`sudo`. Prompt `[sudo: authenticate] Password:` wskazuje na `sudo-rs`.
To mocna wskazówka problemu rozpoznawania promptu przez Ansible, a nie dowód
błędnego hasła. Problem jest opisany w [zgłoszeniu Ansible #85837](https://github.com/ansible/ansible/issues/85837)
i [dokumentacji Ubuntu](https://ubuntu.com/server/docs/reference/other-tools/sudo-rs/).
Sukces na hostach z `NOPASSWD` nie weryfikuje przekazania hasła z Semaphore,
ponieważ te hosty w ogóle go nie potrzebują.

Na problematycznym serwerze, jako `ansible`, wykonaj:

```bash
sudo --version
command -v sudo.ws
```

Jeżeli istnieje `/usr/bin/sudo.ws`, sprawdź klasyczne sudo z wymuszonym nowym
uwierzytelnieniem i własnym promptem:

```bash
/usr/bin/sudo.ws -k -S -p 'RAKIT sudo password: ' /usr/bin/id -u
```

Wpisz hasło interaktywnie. Wynik musi być `0`; nie wpisuj hasła do polecenia,
inventory, Extra Variables ani logów. `sudo.ws` jest nadal wspierane w Ubuntu
25.10 i 26.04, zgodnie z [dokumentacją Ubuntu](https://ubuntu.com/server/docs/how-to/security/user-management/).

Od 1.4.2 playbooki Check updates, Update packages i Reboot wykrywają `sudo-rs`
bez eskalacji i wybierają `/usr/bin/sudo.ws`, jeśli jest dostępne i wykonywalne.
Nie zmieniają systemowego `sudo`, reguł sudoers ani credentials w Semaphore.
Jawne zmienne `ansible_become_exe` i `ansible_sudo_exe` wyłączają automatyczny
wybór. Jeśli `sudo.ws` nie istnieje, playbook pozostawia domyślne `sudo` i
wyświetla wskazówkę diagnostyczną. W takim przypadku sprawdź możliwość instalacji
klasycznego pakietu `sudo` na hoście albo wersję Ansible z obsługą używanego
`sudo-rs` w runnerze Semaphore; sam numer głównej wersji Ansible nie wystarcza.

Po skopiowaniu całego zaktualizowanego katalogu `ansible/` uruchom w Semaphore
**Check updates** z **Limit = buzpc00-dev**,
z przypisanym **Sudo Credentials = Rakit Sudo** (lub własną nazwą tego wpisu).
Log powinien pokazać wykrywanie sudo, wybór klasycznego sudo na hoście z `sudo-rs`,
test UID `0`, a dopiero potem zbieranie faktów i kontrolę APT.
Nie trzeba ponownie importować backupu projektu.

Jeżeli timeout pozostaje, sprawdź wersję Ansible **w runnerze wykonującym zadanie**
(`ansible-playbook --version`), oba jawne nadpisania executable oraz przypisanie
Sudo Credentials do inventory używanego przez ten konkretny template.
Możesz tymczasowo zwiększyć verbosity zadania do `-vvv`, żeby sprawdzić wywoływany
program sudo i prompt; przed udostępnieniem logu usuń dane wrażliwe.
Ostrzeżenie o odkrytym interpreterze Python oraz komunikaty o braku
`requirements.yml` nie są przyczyną tego timeoutu.

Hasło nie ogranicza listy dozwolonych poleceń: członkostwo w grupie `sudo`
standardowo daje pełne uprawnienia root również w wariancie A. `NOPASSWD: ALL`
usuwa dodatkowy wymóg uwierzytelnienia. Jeśli potrzebujesz rzeczywiście
ograniczonego konta, wymaga to osobnego projektu uprawnień; prosta lista
`apt-get` i `reboot` w sudoers nie pasuje do tych playbooków, ponieważ Ansible
uruchamia moduły Python przez powłokę z uprawnieniami root.

### Wariant B — bezhasłowe `sudo` (wygodniejszy, szersze uprawnienie)

Jeżeli świadomie akceptujesz pełne `sudo` dla konta technicznego w swoim homelabie:

```bash
echo 'ansible ALL=(ALL:ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/90-ansible
sudo chmod 440 /etc/sudoers.d/90-ansible
sudo visudo -cf /etc/sudoers.d/90-ansible
```

Następnie w inventory `RAKIT Managed Servers` ustaw **Sudo Credentials / Become Key** na `None`. Wpis `Rakit Sudo` nie będzie używany.

W obu wariantach sprawdź uprawnienia bezpośrednio po zalogowaniu jako użytkownik techniczny:

```bash
ssh -i ./semaphore_ansible_ed25519 ansible@ADRES_IP
sudo -k
sudo /usr/bin/id -u
```

Ostatnie polecenie musi zwrócić `0`. W wariancie A podaj hasło użytkownika `ansible`; w wariancie B polecenie nie powinno pytać o hasło.

## 4. Ustawienia wymagane po Restore Project

Backup odtwarza strukturę projektu i nazwy credentials, ale nie ich sekrety. Po imporcie:

1. Uzupełnij `Rakit SSH` oraz `Rakit Sudo` zgodnie z wybranym wariantem.
2. Sprawdź ścieżkę repository `Rakit Local Playbooks`: `/opt/semaphore/ansible`.
3. Otwórz każdy template i sprawdź, czy w sekcji **Ansible Prompt** pole **Limit** jest włączone. Backup ustawia je automatycznie, ale kontrola jest obowiązkowa: Rakit przekazuje alias konkretnego serwera jako `limit`, aby aktualizacja lub restart nie objęły wszystkich hostów.
4. Nie włączaj automatycznego harmonogramu dla `Update packages` ani `Reboot server` przed testami na hoście deweloperskim.

## 5. Połączenie z Rakit

W Rakit otwórz **Servers → Semaphore** i wpisz:

- **API URL** — adres osiągalny z kontenera Rakit, np. `http://semaphore:3000` we wspólnej sieci Docker albo adres LAN,
- **UI URL** — adres otwierany w przeglądarce, np. `https://semaphore.buzlab.net`,
- **API token** — token wygenerowany w Semaphore,
- projekt `RAKIT Infrastructure`, inventory `RAKIT Managed Servers` i odpowiadające cztery templates.

Jeśli oba kontenery są w `bridge_v90`, preferuj nazwę usługi i port kontenera (`http://semaphore:3000`), a nie `localhost`. `localhost` wewnątrz kontenera Rakit oznacza sam kontener Rakit. Jeśli celowo używasz loopback, ustaw w kontenerze Rakit `SEMAPHORE_ALLOW_LOOPBACK=true`.

Kliknij **Test & discover**, wybierz zasoby i zapisz profil. Następnie otwórz **Inventory**, porównaj obie wersje i wykonaj pierwszy, świadomy **Publish**. Publikacja zastąpi zawartość tylko wskazanego inventory.

## 6. Rakit bez Semaphore

Integracja jest opcjonalna. Bez profilu Semaphore można dodawać i edytować serwery, tworzyć grupy, przechowywać dane zarządcze i oznaczać hosty jako włączone do przyszłego inventory.

Dane pozostają w SQLite Rakita. Po późniejszym podłączeniu Semaphore generator użyje wszystkich lokalnych serwerów z włączoną opcją managed inventory. Niczego nie trzeba wpisywać drugi raz.

## 7. Pierwszy test

1. Dodaj jeden serwer testowy w Rakit i ustaw unikalny alias, np. `buzhulk_dev`.
2. Opublikuj inventory.
3. W Semaphore uruchom ręcznie `Server health` z `Limit = buzhulk_dev`.
4. Uruchom ręcznie `Check updates` z tym samym limitem.
5. Dopiero po sukcesie wywołaj kontrolę z karty serwera w Rakit.
6. `Update packages` i `Reboot server` przetestuj najpierw poza produkcją.

Od 1.4.2 Rakit pobiera także wyniki zadań uruchomionych ręcznie w Semaphore,
jeśli ich template jest jednym z czterech przypisanych w profilu Rakit.
Backend sprawdza ostatnie 200 zadań co 10 sekund; lista Servers i otwarty panel
serwera odświeżają się co 30 sekund. `Check updates` aktualizuje Updates,
Security i Reboot. `Server health` aktualizuje Health i Last health.
`Last update` dotyczy instalacji pakietów przez Update packages.
Ta zmiana wymaga wdrożenia nowej wersji aplikacji Rakit; sama podmiana
playbooków w Semaphore nie zmienia sposobu importu wyników.

Jeśli APT zgłasza brak dostępu do `/var/lib/dpkg/lock-frontend`, zadanie nie otrzymało uprawnień root. Dla wariantu A sprawdź sekret `Rakit Sudo` i przypisanie `Become Key = Rakit Sudo` do inventory. Dla wariantu B sprawdź regułę przez `sudo visudo -cf /etc/sudoers.d/90-ansible` i ustaw `Become Key = None`. Sam działający `Check updates` nie potwierdza poprawnego sudo, jeżeli cache APT był jeszcze aktualny; dołączone playbooki wykonują teraz osobny test efektywnego UID.
