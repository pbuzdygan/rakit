# Rakit 1.4.0 + Semaphore 2.19 — konfiguracja

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
    volumes:
      - /srv/docker/semaphore/data:/var/lib/semaphore
      - /srv/docker/semaphore/config:/etc/semaphore
      - /srv/docker/semaphore/ansible:/opt/semaphore/ansible:ro
```

Skopiuj zawartość katalogu `ansible/` z projektu Rakit do `/srv/docker/semaphore/ansible`. W kontenerze musi istnieć:

```text
/opt/semaphore/ansible/playbooks/check-updates.yml
```

Wolumen może być tylko do odczytu. Rakit publikuje inventory przez REST API, a nie przez plik w tym katalogu.

Oficjalne tagi obrazu mają prefiks `v`. Tag `2.19.0` ani `v2.19.0` nie jest dostępny w Docker Hub; użycie nieistniejącego tagu może pozostać niezauważone, dopóki Compose nie spróbuje ponownie utworzyć kontenera.

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
2. edytuj `Rakit Sudo`, ustaw login `ansible` i podaj hasło utworzone wyżej.

Hasło służy tylko do eskalacji `become: true`; logowanie SSH nadal odbywa się kluczem.

### Wariant B — bezhasłowe `sudo` (wygodniejszy, szersze uprawnienie)

Jeżeli świadomie akceptujesz pełne `sudo` dla konta technicznego w swoim homelabie:

```bash
echo 'ansible ALL=(ALL:ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/90-ansible
sudo chmod 440 /etc/sudoers.d/90-ansible
sudo visudo -cf /etc/sudoers.d/90-ansible
```

Następnie w inventory `RAKIT Managed Servers` ustaw **Sudo Credentials / Become Key** na `None`. Wpis `Rakit Sudo` nie będzie używany.

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

Jeśli zadanie zwraca `Permission denied`, sprawdź publiczny klucz i login `ansible`. Jeśli zatrzymuje się na `sudo`, sprawdź `Rakit Sudo` albo `Become Key = None` przy wariancie `NOPASSWD`.
