const devices = [
  { id: 'core', name: 'Core Switch', model: 'USW-Pro-48-PoE', cabinet: 'Szafa2 · U05', asset: 'FD2-SW-01', ip: '192.168.68.2', status: 'online', ports: 48, perRow: 24, mapped: 34 },
  { id: 'edge16', name: 'Access Switch', model: 'USW-Lite-16-PoE', cabinet: 'Szafa2 · U08', asset: 'FD2-SW-04', ip: '192.168.68.21', status: 'maintenance', ports: 16, perRow: 8, mapped: 9 },
  { id: 'patch24', name: 'Patch Panel', model: 'PP-CAT6-24', cabinet: 'Szafa2 · U04', asset: 'FD2-PP-01', ip: 'No management IP', status: 'planned', ports: 24, perRow: 24, mapped: 2 },
  { id: 'gateway8', name: 'Gateway', model: 'UXG-Max', cabinet: 'Szafa2 · U01', asset: 'FD2-GW-01', ip: '192.168.68.1', status: 'offline', ports: 8, perRow: 8, mapped: 1 },
];

const connections = [
  { id: 1, a: ['core', 1], b: ['edge16', 16], tag: 'ACCESS-04', vlan: '20', status: 'connected' },
  { id: 2, a: ['core', 5], b: ['patch24', 3], tag: 'PP-OFFICE', vlan: '120', status: 'connected' },
  { id: 3, a: ['core', 48], b: ['gateway8', 1], tag: 'CORE-UPLINK', vlan: 'trunk', status: 'connected' },
];

const variants = {
  physical: {
    title: 'Variant A · Large physical ports',
    name: 'A · Large physical',
    summary: 'Stały port 28×28 px. Urządzenie zachowuje fizyczny układ 1×N albo 2×N i w razie potrzeby przewija się poziomo.',
    scores: [['Readability','Very high'],['Physical fidelity','Very high'],['48-port width','Wide'],['Interaction','Direct']],
    tradeoffs: ['Najlepsza czytelność numerów i stanów bez dodatkowego kliknięcia.', 'Małe urządzenia pozostają kompaktowe, ponieważ porty nigdy się nie rozciągają.', '48 portów wymaga szerokiego obszaru lub lokalnego przewijania panelu.'],
    recommendation: 'Najbliżej obecnego kierunku Rakit. Rekomendowany jako wariant bazowy, jeśli poziome przewijanie 48-portowego panelu jest akceptowalne.',
  },
  banks: {
    title: 'Variant B · Logical port banks',
    name: 'B · Port banks',
    summary: 'Porty 30×30 px są dzielone na banki po osiem. Banki mogą zawijać się bez zmniejszania portów.',
    scores: [['Readability','Highest'],['Physical fidelity','Medium'],['48-port width','Flexible'],['Interaction','Direct']],
    tradeoffs: ['Największe porty i bardzo szybkie skanowanie numerów.', 'Banki dają naturalne punkty orientacyjne przy 24 i 48 portach.', 'Układ jest bardziej logiczny niż fotograficznie zgodny z konkretnym switchem.'],
    recommendation: 'Dobry dla pracy operatorskiej, gdy ważniejsze jest szybkie znalezienie portu niż dokładne odwzorowanie frontu urządzenia.',
  },
  focus: {
    title: 'Variant C · Compact overview + focus strip',
    name: 'C · Focus strip',
    summary: 'Wszystkie urządzenia są zwarte, a wybrany port i jego para pojawiają się dodatkowo w dużym pasku roboczym.',
    scores: [['Readability','High on focus'],['Physical fidelity','High'],['48-port width','Compact'],['Interaction','Two-level']],
    tradeoffs: ['Pozwala jednocześnie zmieścić wiele urządzeń na ekranie.', 'Duży port focus jest wygodny do edycji i potwierdzania pary.', 'Przegląd wszystkich numerów jest słabszy niż w wariantach A i B.'],
    recommendation: 'Najlepszy, jeśli Port Map ma często pokazywać 4–8 urządzeń naraz i szczegółowa praca zawsze zaczyna się od wyboru portu.',
  },
  legacy: {
    title: 'Variant D · Previous Rakit sizing',
    name: 'D · Previous Rakit',
    summary: 'Odtworzona skala sprzed przebudowy: port ma 42 px wysokości, minimum 34 px szerokości i duży numer. Nowy nagłówek dodaje IP, status, lokalizację i wykorzystanie portów.',
    scores: [['Readability','Highest'],['Physical fidelity','Medium'],['48-port width','Very wide'],['Interaction','Direct']],
    tradeoffs: ['To skala faktycznie używana wcześniej w Rakit, a nie przybliżenie przygotowane z pamięci.', 'Numery są bardzo czytelne i wygodne do klikania.', 'Przy wielu portach panel jest szeroki, a przy małej liczbie porty mogą wypełniać dostępną przestrzeń.'],
    recommendation: 'Najbezpieczniejszy punkt wyjścia. Można zachować tę skalę portów, ograniczyć ich rozciąganie maksymalną szerokością i zastosować nowy, operatorski nagłówek urządzenia.',
  },
};

const state = { variant: 'physical', count: 'all', selectedConnection: 1, selectedPort: ['core', 1] };
const stack = document.querySelector('#deviceStack');
const focusDock = document.querySelector('#focusDock');
const rows = document.querySelector('#connectionRows');

const deviceById = (id) => devices.find((device) => device.id === id);
const connectionFor = (deviceId, port) => connections.find((connection) => (connection.a[0] === deviceId && connection.a[1] === port) || (connection.b[0] === deviceId && connection.b[1] === port));
const endpointLabel = ([deviceId, port]) => `${deviceById(deviceId).asset} / ${String(port).padStart(2, '0')}`;

function portClass(deviceId, port) {
  const connection = connectionFor(deviceId, port);
  const selected = state.selectedPort?.[0] === deviceId && state.selectedPort?.[1] === port;
  let paired = false;
  if (connection && selected) paired = false;
  if (connection && state.selectedPort) {
    const other = connection.a[0] === state.selectedPort[0] && connection.a[1] === state.selectedPort[1] ? connection.b : connection.b[0] === state.selectedPort[0] && connection.b[1] === state.selectedPort[1] ? connection.a : null;
    paired = Boolean(other && other[0] === deviceId && other[1] === port);
  }
  return ['port', connection ? 'is-mapped' : '', selected ? 'is-selected' : '', paired ? 'is-paired' : ''].filter(Boolean).join(' ');
}

function portButton(device, number, style = '') {
  return `<button class="${portClass(device.id, number)}" data-port="${device.id}:${number}" title="${device.asset} · port ${number}" ${style ? `style="${style}"` : ''}>${number}</button>`;
}

function physicalPorts(device, compact = false) {
  const twoRows = device.perRow < device.ports;
  const buttons = Array.from({ length: device.ports }, (_, index) => {
    const port = index + 1;
    const style = twoRows ? `grid-column:${Math.ceil(port / 2)};grid-row:${port % 2 ? 1 : 2}` : '';
    return portButton(device, port, style);
  }).join('');
  return `<div class="${compact ? 'compact-grid' : 'port-grid'}" style="grid-template-columns:repeat(${device.perRow},${compact ? '22px' : '28px'})">${buttons}</div>`;
}

function bankPorts(device) {
  const bankCount = Math.ceil(device.ports / 8);
  return `<div class="bank-wrap">${Array.from({ length: bankCount }, (_, bankIndex) => {
    const start = bankIndex * 8 + 1;
    const end = Math.min(start + 7, device.ports);
    const buttons = Array.from({ length: end - start + 1 }, (_, index) => {
      const port = start + index;
      const local = index + 1;
      return portButton(device, port, `grid-column:${Math.ceil(local / 2)};grid-row:${local % 2 ? 1 : 2}`);
    }).join('');
    return `<div class="port-bank"><span>Bank ${bankIndex + 1} · ${String(start).padStart(2,'0')}–${String(end).padStart(2,'0')}</span><div class="bank-grid">${buttons}</div></div>`;
  }).join('')}</div>`;
}

function legacyPorts(device) {
  const twoRows = device.perRow < device.ports;
  const buttons = Array.from({ length: device.ports }, (_, index) => {
    const port = index + 1;
    const style = twoRows ? `grid-column:${Math.ceil(port / 2)};grid-row:${port % 2 ? 1 : 2}` : '';
    return portButton(device, port, style);
  }).join('');
  return `<div class="legacy-grid" style="grid-template-columns:repeat(${device.perRow},minmax(34px,1fr))">${buttons}</div>`;
}

function deviceCard(device) {
  const ports = state.variant === 'banks' ? bankPorts(device) : state.variant === 'legacy' ? legacyPorts(device) : physicalPorts(device, state.variant === 'focus');
  return `<article class="device-card status-${device.status}" data-device="${device.id}">
    <header class="device-meta">
      <div class="device-title"><strong>${device.name} · ${device.model}</strong><small>${device.cabinet} · ${device.asset}</small></div>
      <div class="device-network"><code>${device.ip}</code><small>${device.perRow < device.ports ? `${device.perRow} ports per row · 2 rows` : `${device.ports} ports · 1 row`}</small></div>
      <div class="device-state"><b>${device.status}</b><small>${device.mapped}/${device.ports} mapped</small></div>
    </header>
    <div class="device-face">${ports}</div>
  </article>`;
}

function selectedConnection() { return connections.find((connection) => connection.id === state.selectedConnection) || null; }

function renderFocusDock() {
  if (state.variant !== 'focus') { focusDock.hidden = true; return; }
  focusDock.hidden = false;
  const connection = selectedConnection();
  if (!connection) { focusDock.innerHTML = '<div class="empty">Select a mapped port to inspect its pair.</div>'; return; }
  const first = state.selectedPort && connection.b[0] === state.selectedPort[0] && connection.b[1] === state.selectedPort[1] ? connection.b : connection.a;
  const second = first === connection.a ? connection.b : connection.a;
  const endpoint = (value, paired) => { const device = deviceById(value[0]); return `<div class="focus-endpoint ${paired ? 'is-pair' : ''}"><div class="focus-port">${String(value[1]).padStart(2,'0')}</div><div><strong>${device.name} · ${device.model}</strong><small>${device.ip} · ${device.asset}</small></div></div>`; };
  focusDock.innerHTML = `<div class="focus-dock-head"><span>PORT FOCUS</span><strong>${connection.tag} · VLAN ${connection.vlan}</strong></div><div class="focus-path">${endpoint(first,false)}<div class="focus-arrow"><svg><use href="#i-link" /></svg></div>${endpoint(second,true)}</div>`;
}

function renderDevices() {
  const visible = state.count === 'all' ? devices : devices.filter((device) => device.ports === Number(state.count));
  stack.innerHTML = visible.length ? visible.map(deviceCard).join('') : '<div class="empty">No devices for this filter.</div>';
  stack.querySelectorAll('[data-port]').forEach((button) => button.addEventListener('click', () => selectPort(button.dataset.port)));
  renderFocusDock();
}

function selectPort(value) {
  const [deviceId, rawPort] = value.split(':');
  const port = Number(rawPort);
  state.selectedPort = [deviceId, port];
  state.selectedConnection = connectionFor(deviceId, port)?.id ?? null;
  renderDevices();
  renderConnections();
  updateReadout();
}

function renderConnections() {
  const query = document.querySelector('#connectionSearch').value.trim().toLowerCase();
  const visibleDeviceIds = new Set((state.count === 'all' ? devices : devices.filter((device) => device.ports === Number(state.count))).map((device) => device.id));
  const filtered = connections.filter((connection) => (visibleDeviceIds.has(connection.a[0]) || visibleDeviceIds.has(connection.b[0])) && `${endpointLabel(connection.a)} ${endpointLabel(connection.b)} ${connection.tag} ${connection.vlan}`.toLowerCase().includes(query));
  rows.innerHTML = filtered.map((connection) => `<tr data-connection="${connection.id}" class="${state.selectedConnection === connection.id ? 'is-selected' : ''}"><td><div class="endpoint-cell"><strong>${endpointLabel(connection.a)}</strong><small>${deviceById(connection.a[0]).ip}</small></div></td><td><div class="endpoint-cell"><strong>${endpointLabel(connection.b)}</strong><small>${deviceById(connection.b[0]).ip}</small></div></td><td>${connection.tag}</td><td>${connection.vlan}</td><td><span class="state">${connection.status}</span></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No matching connections.</td></tr>';
  rows.querySelectorAll('[data-connection]').forEach((row) => row.addEventListener('click', () => {
    const connection = connections.find((item) => item.id === Number(row.dataset.connection));
    state.selectedConnection = connection.id;
    state.selectedPort = connection.a;
    renderDevices(); renderConnections(); updateReadout();
  }));
}

function renderVariantNotes() {
  const variant = variants[state.variant];
  document.body.dataset.variant = state.variant;
  document.querySelector('#previewTitle').textContent = variant.title;
  document.querySelector('#variantName').textContent = variant.name;
  document.querySelector('#variantNotes').innerHTML = `<div class="variant-summary"><p>${variant.summary}</p></div><div class="score-grid">${variant.scores.map(([label,value]) => `<div class="score"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div><div class="tradeoffs"><h3>Trade-offs</h3><ul>${variant.tradeoffs.map((item) => `<li>${item}</li>`).join('')}</ul></div><div class="recommendation">${variant.recommendation}</div>`;
}

function updateReadout() {
  const connection = selectedConnection();
  document.querySelector('#selectedPath').textContent = connection ? `${endpointLabel(connection.a)} ↔ ${endpointLabel(connection.b)}` : state.selectedPort ? `${endpointLabel(state.selectedPort)} · free port` : 'No port selected';
}

document.querySelectorAll('[data-variant]').forEach((button) => button.addEventListener('click', () => {
  state.variant = button.dataset.variant;
  document.querySelectorAll('[data-variant]').forEach((item) => item.classList.toggle('is-active', item === button));
  renderVariantNotes(); renderDevices();
}));
document.querySelectorAll('[data-count]').forEach((button) => button.addEventListener('click', () => {
  state.count = button.dataset.count;
  document.querySelectorAll('[data-count]').forEach((item) => item.classList.toggle('is-active', item === button));
  renderDevices(); renderConnections();
}));
document.querySelector('#connectionSearch').addEventListener('input', renderConnections);

renderVariantNotes();
renderDevices();
renderConnections();
updateReadout();
