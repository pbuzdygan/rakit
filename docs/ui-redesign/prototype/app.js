const viewRoot = document.querySelector('#viewRoot');
const appShell = document.querySelector('#appShell');
const breadcrumbs = document.querySelector('#breadcrumbs');
const integrationLabel = document.querySelector('#integrationLabel');
const modalBackdrop = document.querySelector('#modalBackdrop');
const toastRegion = document.querySelector('#toastRegion');

const icon = (name, className = '') => `<svg class="${className}" aria-hidden="true"><use href="#i-${name}" /></svg>`;

const viewMeta = {
  overview: { label: 'Overview', crumb: 'Overview' },
  racks: { label: 'Racks', crumb: 'EDGE-A' },
  ip: { label: 'IP Addressing', crumb: 'IP Addressing' },
  ports: { label: 'Port Map', crumb: 'Port Map' },
  wol: { label: 'Wake on LAN', crumb: 'Wake on LAN' },
  audit: { label: 'Audit Log', crumb: 'Audit Log' },
};

const state = {
  view: 'racks',
  sidebarCollapsed: localStorage.getItem('rakit-prototype-sidebar') === 'collapsed',
  selectedRackDevice: 'sw-core',
  rackTab: 'details',
  selectedConnection: 4,
  linkMode: false,
  selectedNetwork: 'servers',
  selectedIp: '10.20.0.42',
  selectedMachine: 'build-agent-02',
  selectedMachines: new Set(['build-agent-02']),
};

const rackDevices = [
  { id: 'fw-01', name: 'EDGE-A-FW-01', model: 'FortiGate 100F', u: 38, height: 2, type: 'firewall', ip: '10.10.0.1', vlan: '10', status: 'Online', links: ['ISP-01 · WAN1', 'SW-CORE-01 · Port 1'] },
  { id: 'pp-01', name: 'PP-01', model: 'Patch Panel 24p Cat6', u: 34, height: 1, type: 'patch', ip: '—', vlan: 'Mixed', status: 'Passive', links: ['SW-CORE-01 · 18 links', 'SW-ACCESS-02 · 6 links'] },
  { id: 'nvr-01', name: 'NVR-01', model: 'Network Video Recorder', u: 25, height: 2, type: 'server', ip: '10.20.0.21', vlan: '20', status: 'Online', links: ['SW-CORE-01 · Port 7'] },
  { id: 'sw-agg', name: 'USW-AGG-24', model: 'Aggregation Switch', u: 21, height: 1, type: 'switch', ip: '10.20.0.1', vlan: '10', status: 'Online', links: ['SW-CORE-01 · SFP+ 1', 'SRV-EDGE-01 · NIC 2'] },
  { id: 'sw-core', name: 'USW-Pro-48-PoE', model: 'Core Access Switch', u: 18, height: 2, type: 'switch', ip: '10.20.0.2', vlan: '10', status: 'Online', links: ['USW-AGG-24 · SFP+ 1', 'SRV-EDGE-01 · NIC 1', 'SRV-EDGE-02 · NIC 1', 'NVR-01 · LAN 1'] },
  { id: 'srv-01', name: 'SRV-EDGE-01', model: 'Dell PowerEdge R640', u: 14, height: 2, type: 'server', ip: '10.20.0.10', vlan: '20', status: 'Online', links: ['USW-Pro-48-PoE · Port 10', 'USW-AGG-24 · Port 2'] },
  { id: 'srv-02', name: 'SRV-EDGE-02', model: 'Dell PowerEdge R640', u: 12, height: 2, type: 'server', ip: '10.20.0.11', vlan: '20', status: 'Online', links: ['USW-Pro-48-PoE · Port 11'] },
  { id: 'ups-01', name: 'UPS-01', model: 'Smart-UPS 3000VA', u: 6, height: 3, type: 'ups', ip: '10.10.0.8', vlan: '10', status: 'Online', links: ['SW-CORE-01 · Port 47'] },
];

let connections = [
  { id: 1, srcPort: 1, dstPort: 1, source: 'PP-01 / Port 01', destination: 'SW-CORE-01 / Port 01', vlan: '10', device: 'SRV-DC-01', ip: '10.20.0.10', status: 'Connected', tag: 'Server-01' },
  { id: 2, srcPort: 2, dstPort: 2, source: 'PP-01 / Port 02', destination: 'SW-CORE-01 / Port 02', vlan: '10', device: 'SRV-DC-02', ip: '10.20.0.11', status: 'Connected', tag: 'Server-02' },
  { id: 3, srcPort: 3, dstPort: 3, source: 'PP-01 / Port 03', destination: 'SW-CORE-01 / Port 03', vlan: '20', device: 'PRN-01', ip: '10.20.0.50', status: 'Connected', tag: 'Print-room' },
  { id: 4, srcPort: 12, dstPort: 17, source: 'PP-01 / Port 12', destination: 'SW-CORE-01 / Port 17', vlan: '120', device: 'AP-3F-WEST', ip: '10.120.3.17', status: 'Connected', tag: 'Office-12' },
  { id: 5, srcPort: 4, dstPort: 4, source: 'PP-01 / Port 04', destination: 'SW-CORE-01 / Port 04', vlan: '30', device: 'IP-PHONE-01', ip: '10.30.0.21', status: 'Disconnected', tag: 'Reception' },
  { id: 6, srcPort: 5, dstPort: 5, source: 'PP-01 / Port 05', destination: 'SW-CORE-01 / Port 05', vlan: '120', device: 'AP-3F-EAST', ip: '10.120.3.18', status: 'Connected', tag: 'Office-05' },
  { id: 7, srcPort: 8, dstPort: 12, source: 'PP-01 / Port 08', destination: 'SW-CORE-01 / Port 12', vlan: '40', device: 'CAM-ENTRY-01', ip: '10.40.0.31', status: 'Connected', tag: 'Entry camera' },
  { id: 8, srcPort: 18, dstPort: 24, source: 'PP-01 / Port 18', destination: 'SW-CORE-01 / Port 24', vlan: '20', device: 'NVR-01', ip: '10.20.0.21', status: 'Connected', tag: 'Recorder' },
];

const networks = [
  { id: 'management', name: 'Management', cidr: '10.10.0.0/24', usage: 68 },
  { id: 'servers', name: 'Servers', cidr: '10.20.0.0/24', usage: 26 },
  { id: 'users', name: 'Users', cidr: '10.30.0.0/23', usage: 41 },
  { id: 'iot', name: 'IoT', cidr: '10.40.0.0/24', usage: 12 },
];

let ipRecords = [
  { network: 'management', ip: '10.10.0.1', name: 'GW-MGMT', hostname: 'gw-mgmt', mac: '08:9A:DD:11:22:01', source: 'UniFi', status: 'Online', updated: '2 min ago', linked: 'EDGE-A / U38' },
  { network: 'management', ip: '10.10.0.8', name: 'UPS-01', hostname: 'ups-edge-a', mac: '00:C0:B7:88:00:08', source: 'Manual', status: 'Online', updated: '4 min ago', linked: 'EDGE-A / U6' },
  { network: 'servers', ip: '10.20.0.1', name: 'GW-SRV', hostname: 'gw-srv', mac: '08:9A:DD:11:22:01', source: 'UniFi', status: 'Online', updated: '12 min ago', linked: 'EDGE-A / U38' },
  { network: 'servers', ip: '10.20.0.10', name: 'SRV-DC-01', hostname: 'srv-dc-01', mac: '00:50:56:8F:11:0A', source: 'UniFi', status: 'Online', updated: '2 min ago', linked: 'EDGE-A / U14' },
  { network: 'servers', ip: '10.20.0.11', name: 'SRV-DC-02', hostname: 'srv-dc-02', mac: '00:50:56:8F:11:0B', source: 'UniFi', status: 'Online', updated: '2 min ago', linked: 'EDGE-A / U12' },
  { network: 'servers', ip: '10.20.0.20', name: 'SRV-FS-01', hostname: 'srv-fs-01', mac: '00:50:56:8F:22:14', source: 'Manual', status: 'Reserved', updated: '3 days ago', linked: 'LAB-1 / U9' },
  { network: 'servers', ip: '10.20.0.21', name: 'NVR-01', hostname: 'nvr-01', mac: '3C:52:82:01:21:01', source: 'UniFi', status: 'Online', updated: '5 min ago', linked: 'EDGE-A / U25' },
  { network: 'servers', ip: '10.20.0.30', name: 'APP-SRV-01', hostname: 'app-srv-01', mac: '00:50:56:8F:33:01', source: 'Manual', status: 'Online', updated: '1 min ago', linked: 'EDGE-A / U14' },
  { network: 'servers', ip: '10.20.0.42', name: 'BUILD-AGENT-02', hostname: 'build-agent-02', mac: '3C:52:82:AF:10:42', source: 'Manual', status: 'Reserved', updated: 'just now', linked: 'EDGE-A / U14' },
  { network: 'servers', ip: '10.20.0.43', name: 'BUILD-AGENT-03', hostname: 'build-agent-03', mac: '3C:52:82:AF:10:43', source: 'Manual', status: 'Reserved', updated: '1 day ago', linked: 'EDGE-A / U12' },
  { network: 'servers', ip: '10.20.0.50', name: 'DB-PRIMARY', hostname: 'db-primary', mac: '00:50:56:8F:44:50', source: 'Manual', status: 'Online', updated: '6 min ago', linked: 'EDGE-A / U14' },
  { network: 'servers', ip: '10.20.0.70', name: 'BACKUP-SRV', hostname: 'backup-srv', mac: '3C:52:82:02:70:01', source: 'Manual', status: 'Conflict', updated: '10 min ago', linked: 'EDGE-A / U12' },
  { network: 'users', ip: '10.30.0.21', name: 'WS-ADMIN-01', hostname: 'ws-admin-01', mac: '00:11:22:33:44:55', source: 'UniFi', status: 'Online', updated: '1 min ago', linked: 'Office / 3F' },
  { network: 'iot', ip: '10.40.0.31', name: 'CAM-ENTRY-01', hostname: 'cam-entry-01', mac: 'A4:5E:60:31:31:01', source: 'UniFi', status: 'Online', updated: '3 min ago', linked: 'PP-01 / Port 08' },
];

let machines = [
  { id: 'srv-backup-01', name: 'SRV-BACKUP-01', ip: '10.20.0.10', mac: '00:1A:2B:3C:4D:5E', broadcast: '10.20.0.255:9', status: 'Online', lastSeen: '09:41:52', schedule: 'Daily · 01:00', linked: 'EDGE-A / U14' },
  { id: 'build-agent-02', name: 'BUILD-AGENT-02', ip: '10.20.0.42', mac: '3C:52:82:AF:10:42', broadcast: '10.20.0.255:9', status: 'Offline', lastSeen: '—', schedule: 'Weekdays · 07:30', linked: 'EDGE-A / U14' },
  { id: 'nas-archive', name: 'NAS-ARCHIVE', ip: '10.20.0.50', mac: '00:25:90:AA:BB:CC', broadcast: '10.20.0.255:9', status: 'Offline', lastSeen: '—', schedule: '—', linked: 'EDGE-A / U25' },
  { id: 'ws-admin-01', name: 'WS-ADMIN-01', ip: '10.20.0.60', mac: '00:11:22:33:44:55', broadcast: '10.20.0.255:9', status: 'Online', lastSeen: '09:42:05', schedule: 'Weekdays · 08:00', linked: 'Office / 3F' },
  { id: 'lab-hv-02', name: 'LAB-HV-02', ip: '10.20.0.70', mac: 'F0:9F:C2:1D:2E:3F', broadcast: '10.20.0.255:9', status: 'Unknown', lastSeen: '—', schedule: '—', linked: 'LAB-1 / U8' },
];

const audits = [
  ['09:42:18', 'admin', 'IP reservation updated', '10.20.0.42 · BUILD-AGENT-02', 'Success'],
  ['09:39:04', 'system', 'UniFi synchronization completed', 'Warsaw HQ · 182 records', 'Success'],
  ['09:31:26', 'admin', 'Port connection created', 'PP-01/12 → SW-CORE-01/17', 'Success'],
  ['09:28:11', 'operator', 'Wake packet sent', 'NAS-ARCHIVE · 00:25:90:AA:BB:CC', 'Success'],
  ['09:18:54', 'system', 'IP conflict detected', '10.20.0.70 · BACKUP-SRV', 'Warning'],
  ['08:56:03', 'admin', 'Device moved', 'SRV-EDGE-02 · U10 → U12', 'Success'],
];

function statusClass(value) {
  const normalized = String(value).toLowerCase();
  if (normalized === 'online' || normalized === 'connected' || normalized === 'success') return 'online';
  if (normalized === 'conflict' || normalized === 'warning' || normalized === 'disconnected') return 'warning';
  if (normalized.includes('waking') || normalized === 'pending' || normalized === 'unknown') return 'pending';
  return '';
}

function toast(message, tone = '') {
  const node = document.createElement('div');
  node.className = `toast ${tone}`;
  node.innerHTML = `${icon(tone === 'success' ? 'check' : tone === 'warning' ? 'audit' : 'overview')}<span>${message}</span>`;
  toastRegion.appendChild(node);
  window.setTimeout(() => node.remove(), 2800);
}

function setView(view) {
  if (!viewMeta[view]) return;
  state.view = view;
  render();
  viewRoot.focus({ preventScroll: true });
}

function render() {
  document.querySelectorAll('.nav-item[data-view]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === state.view);
  });
  appShell.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  const meta = viewMeta[state.view];
  breadcrumbs.innerHTML = `<span>Infrastructure</span><b>/</b><span>Warsaw HQ</span><b>/</b><strong>${meta.crumb}</strong>`;
  integrationLabel.textContent = state.view === 'wol'
    ? `${machines.filter((machine) => machine.status === 'Online').length} of ${machines.length} online`
    : 'UniFi Connected';

  const templates = {
    overview: renderOverview,
    racks: renderRacks,
    ip: renderIp,
    ports: renderPorts,
    wol: renderWol,
    audit: renderAudit,
  };
  viewRoot.innerHTML = templates[state.view]();
  bindViewEvents();
}

function moduleHead({ eyebrow, title, subtitle, metrics = [], actions = '' }) {
  return `<header class="module-head">
    <div class="title-block"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div>
    ${metrics.length ? `<div class="head-metrics">${metrics.map(([value, label]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join('')}</div>` : ''}
    <div class="head-actions">${actions}</div>
  </header>`;
}

function rackFace(device) {
  if (device.type === 'server') return Array.from({ length: 8 }, () => '<i class="drive-bay"></i>').join('');
  if (device.type === 'ups') return `<i class="device-screen">LOAD 28% · BATT 100%</i>${Array.from({ length: 4 }, () => '<i class="face-port online"></i>').join('')}`;
  if (device.type === 'patch') return Array.from({ length: 24 }, (_, index) => `<i class="face-port ${[0,1,2,4,7,11,17].includes(index) ? 'online' : ''}"></i>`).join('');
  const count = device.type === 'firewall' ? 14 : 24;
  return Array.from({ length: count }, (_, index) => `<i class="face-port ${index % 4 !== 3 ? 'online' : index === 7 ? 'warn' : ''}"></i>`).join('');
}

function renderRacks() {
  const selected = rackDevices.find((device) => device.id === state.selectedRackDevice) || rackDevices[0];
  const used = rackDevices.reduce((sum, device) => sum + device.height, 0);
  const rows = Array.from({ length: 42 }, (_, index) => {
    const unit = 42 - index;
    return `<div class="rack-label left" style="grid-row:${index + 1}">${String(unit).padStart(2,'0')}</div>
      <div class="rack-row" style="grid-row:${index + 1}"></div>
      <div class="rack-label right" style="grid-row:${index + 1}">${String(unit).padStart(2,'0')}</div>`;
  }).join('');
  const devices = rackDevices.map((device) => {
    const topRow = 43 - (device.u + device.height - 1);
    return `<button class="rack-device ${device.id === selected.id ? 'is-selected' : ''}" data-rack-device="${device.id}" style="grid-row:${topRow} / span ${device.height}" title="${device.name} · U${device.u}">
      <span class="device-nameplate"><b>${device.name}</b><span>${device.model}</span></span>
      <span class="device-face">${rackFace(device)}</span>
    </button>`;
  }).join('');

  let tabBody = '';
  if (state.rackTab === 'details') {
    tabBody = `<section class="inspector-section"><h3>Asset</h3><div class="kv-list">
      <div class="kv-row"><span>Position</span><b>U${selected.u}${selected.height > 1 ? `–U${selected.u + selected.height - 1}` : ''}</b></div>
      <div class="kv-row"><span>Height</span><b>${selected.height}U</b></div>
      <div class="kv-row"><span>Management IP</span><b class="mono">${selected.ip}</b></div>
      <div class="kv-row"><span>VLAN</span><b>${selected.vlan}</b></div>
      <div class="kv-row"><span>Status</span><b class="status ${statusClass(selected.status)}">${selected.status}</b></div>
    </div></section>`;
  } else if (state.rackTab === 'ports') {
    tabBody = `<section class="inspector-section"><h3>Port summary</h3><div class="kv-list">
      <div class="kv-row"><span>Configured</span><b>48</b></div><div class="kv-row"><span>Connected</span><b>31</b></div><div class="kv-row"><span>PoE active</span><b>8</b></div><div class="kv-row"><span>Available</span><b>17</b></div>
    </div></section><div class="inspector-actions"><button class="button primary" data-go-view="ports">Open in Port Map</button></div>`;
  } else {
    tabBody = `<section class="inspector-section"><h3>Linked endpoints (${selected.links.length})</h3><div class="linked-list">${selected.links.map((link, index) => `<div class="linked-item"><i></i><b>${link}</b><span>${index ? '1G' : '10G'}</span></div>`).join('')}</div></section>`;
  }

  return `<section class="module">
    ${moduleHead({ eyebrow: 'Racks / Warsaw HQ', title: 'EDGE-A · Core room', subtitle: 'Front elevation · last edited today at 09:36', metrics: [['42U','Capacity'], [rackDevices.length,'Devices'], [`${42-used}U`,'Free']], actions: `<button class="button ghost" id="editRack">${icon('edit')}Edit rack</button><button class="button primary" id="addRackDevice">${icon('plus')}Add device</button>` })}
    <div class="module-body two-pane">
      <div class="canvas-area">
        <div class="canvas-toolbar"><button class="button small">EDGE-A ${icon('chevron')}</button><button class="button small ghost">Front</button><button class="button small ghost">Rear</button><span class="spacer"></span><span class="toolbar-copy">Click a device to inspect · Dragging will be enabled in production</span><button class="button small ghost">Fit rack</button></div>
        <div class="rack-workbench"><div class="rack-frame"><div class="rack-titlebar"><span>EDGE-A · 19-inch rack</span><span>42U · Front</span></div><div class="rack-grid">${rows}${devices}</div></div></div>
      </div>
      <aside class="inspector">
        <div class="pane-head"><div>${icon('server')}</div><div><h2>${selected.name}</h2><span class="status ${statusClass(selected.status)}" style="font-size:9px;color:var(--text-3)">${selected.status}</span></div><button class="icon-button" id="closeInspector" aria-label="Zamknij inspektor">${icon('close')}</button></div>
        <div class="inspector-scroll"><div class="inspector-tabs">${['details','ports','links'].map((tab) => `<button class="inspector-tab ${state.rackTab === tab ? 'is-active' : ''}" data-rack-tab="${tab}">${tab[0].toUpperCase()+tab.slice(1)}</button>`).join('')}</div>${tabBody}
          <section class="inspector-section"><h3>Identity</h3><div class="kv-list"><div class="kv-row"><span>Type</span><b>${selected.model}</b></div><div class="kv-row"><span>Asset ID</span><b class="mono">AST-${selected.id.toUpperCase()}</b></div></div></section>
          <div class="inspector-actions"><button class="button primary" id="editDevice">${icon('edit')}Edit device</button><button class="button ghost" data-go-view="ports">${icon('ports')}Show port map</button></div>
        </div>
      </aside>
    </div>
  </section>`;
}

function networkPorts(count, side, selected) {
  return Array.from({ length: count }, (_, index) => {
    const port = index + 1;
    const connection = connections.find((item) => side === 'source' ? item.srcPort === port : item.dstPort === port);
    const classes = [connection ? 'is-connected' : '', connection?.status === 'Disconnected' ? 'is-warning' : '', connection?.id === selected?.id ? 'is-selected' : ''].filter(Boolean).join(' ');
    return `<button class="network-port ${classes}" data-port-side="${side}" data-port="${port}" title="${side === 'source' ? 'PP-01' : 'SW-CORE-01'} / Port ${port}">${port}</button>`;
  }).join('');
}

function renderPorts() {
  const selected = connections.find((item) => item.id === state.selectedConnection) || connections[0];
  const cables = connections.map((connection) => {
    const sourceX = 190 + (connection.srcPort - 1) * 29.4;
    const destX = 190 + (Math.min(connection.dstPort, 24) - 1) * 29.4;
    const destY = connection.dstPort > 24 ? 335 : 300;
    const bend = 160 + connection.id * 11;
    return `<path class="${connection.id === selected.id ? 'active' : ''}" data-cable="${connection.id}" d="M ${sourceX} 116 C ${sourceX} ${bend}, ${destX} ${bend}, ${destX} ${destY}" />`;
  }).join('');
  const rows = connections.map((connection) => `<tr data-connection="${connection.id}" class="${connection.id === selected.id ? 'is-selected' : ''}">
    <td class="mono">${connection.source}</td><td class="mono">${connection.destination}</td><td>${connection.vlan}</td><td>${connection.device} <span style="color:var(--text-3)">(${connection.ip})</span></td><td><span class="status ${statusClass(connection.status)}">${connection.status}</span></td><td class="row-actions">•••</td>
  </tr>`).join('');

  return `<section class="module">
    ${moduleHead({ eyebrow: 'Port Map / EDGE-A', title: 'Patch panel to switch', subtitle: 'Physical and logical connection workspace', metrics: [[connections.length,'Connections'], ['3','Devices'], ['1','Warning']], actions: `<button class="button ${state.linkMode ? 'primary' : 'ghost'}" id="linkMode">${icon('link')}${state.linkMode ? 'Exit link mode' : 'Link ports'}</button><button class="button ghost">Auto-route</button><button class="button ghost">${icon('export')}Export</button>` })}
    <div class="module-body three-pane">
      <aside class="context-pane"><div class="pane-head"><h2>DEVICES</h2><button class="icon-button">${icon('plus')}</button></div><div class="context-list">
        <button class="context-item is-active"><div><strong>PP-01</strong><small>Patch Panel 24p</small></div><i class="item-dot"></i></button>
        <button class="context-item is-active"><div><strong>SW-CORE-01</strong><small>48 ports · EDGE-A</small></div><i class="item-dot"></i></button>
        <button class="context-item"><div><strong>SW-ACCESS-02</strong><small>24 ports · EDGE-A</small></div><i class="item-dot" style="background:var(--warning)"></i></button>
      </div><div class="section-label">LEGEND</div><div style="padding:0 14px;display:grid;gap:9px;font-size:9px;color:var(--text-3)"><span class="status online">Connected</span><span class="status warning">Warning</span><span class="status">Free port</span></div></aside>
      <div class="canvas-area"><div class="canvas-toolbar"><span class="toolbar-copy">Select a port or connection to inspect the entire path</span><span class="spacer"></span><button class="button small ghost">Show labels</button><button class="button small ghost">All links</button></div>
        <div class="port-canvas-wrap"><div class="port-canvas">
          <svg class="cable-layer" viewBox="0 0 1000 420" preserveAspectRatio="none">${cables}</svg>
          <div class="equipment patch"><div class="equipment-label"><strong>PP-01</strong><span>Patch Panel 24p</span></div><div class="equipment-face"><div class="port-grid">${networkPorts(24,'source',selected)}</div></div></div>
          <div class="equipment switch"><div class="equipment-label"><strong>SW-CORE-01</strong><span>48 ports</span></div><div class="equipment-face"><div class="port-grid">${networkPorts(48,'destination',selected)}</div></div></div>
        </div><section class="connections-panel"><div class="subhead"><h2>Connections</h2><label class="table-search">${icon('search')}<input id="connectionFilter" placeholder="Filter connections…" /></label><button class="icon-button">${icon('filter')}</button><span style="font-size:9px;color:var(--text-3)">${connections.length} total</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Source</th><th>Destination</th><th>VLAN</th><th>IP / Device</th><th>Status</th><th></th></tr></thead><tbody id="connectionRows">${rows}</tbody></table></div></section></div>
      </div>
      <aside class="inspector"><div class="pane-head"><h2>Connection details</h2><button class="icon-button" id="closeInspector">${icon('close')}</button></div><div class="inspector-scroll">
        <section class="inspector-section"><h3>Endpoints</h3><div class="endpoint-flow"><div class="endpoint-rail"><i></i><i></i></div><div class="endpoint-cards"><div class="endpoint-card"><b>${selected.source}</b><span>Patch Panel 24p</span></div><div class="endpoint-card"><b>${selected.destination}</b><span>48-port managed switch</span></div></div></div></section>
        <section class="inspector-section"><h3>Connection</h3><div class="form-stack"><div class="field"><span>Tag</span><input class="input" value="${selected.tag}" /></div><div class="field"><span>VLAN</span><input class="input mono" value="${selected.vlan}" /></div><div class="field"><span>Device</span><input class="input" value="${selected.device}" /></div><div class="field"><span>IP address</span><input class="input mono" value="${selected.ip}" /></div></div></section>
        <div class="inspector-actions"><button class="button primary" id="saveConnection">${icon('check')}Save changes</button><button class="button danger" id="unlinkConnection">${icon('trash')}Unlink</button></div>
      </div></aside>
    </div>
  </section>`;
}

function renderIp() {
  const network = networks.find((item) => item.id === state.selectedNetwork) || networks[1];
  const records = ipRecords.filter((record) => record.network === network.id);
  const selected = records.find((record) => record.ip === state.selectedIp) || records[0] || null;
  if (selected && selected.ip !== state.selectedIp) state.selectedIp = selected.ip;
  const networkList = networks.map((item) => `<button class="context-item ${item.id === network.id ? 'is-active' : ''}" data-network="${item.id}"><div><strong>${item.name}</strong><small class="mono">${item.cidr}</small><div class="network-meter"><i style="width:${item.usage}%"></i></div></div><span class="item-meta">${item.usage}%</span></button>`).join('');
  const rows = records.map((record) => `<tr data-ip="${record.ip}" class="${selected?.ip === record.ip ? 'is-selected' : ''}"><td class="mono">${record.ip}</td><td><b>${record.name}</b></td><td>${record.hostname}</td><td class="mono">${record.mac}</td><td>${record.source}</td><td><span class="status ${statusClass(record.status)}">${record.status}</span></td><td>${record.updated}</td></tr>`).join('');

  return `<section class="module">
    ${moduleHead({ eyebrow: 'IP Addressing / Warsaw HQ', title: `${network.name} · ${network.cidr}`, subtitle: 'UniFi synchronization and manual reservations', metrics: [[String(records.length),'Visible'], [String(records.filter((r) => r.status === 'Online').length),'Online'], [`${100-network.usage}%`,'Available']], actions: `<button class="button ghost" id="syncIp">${icon('refresh')}Sync now</button><button class="button primary" id="reserveIp">${icon('plus')}Reserve address</button>` })}
    <div class="module-body ip-layout">
      <aside class="context-pane"><div class="pane-head"><h2>NETWORKS</h2><button class="icon-button">${icon('plus')}</button></div><div class="context-list">${networkList}</div><div class="section-label">PROFILE</div><div style="padding:0 14px"><div class="linked-item"><i></i><b>Warsaw UniFi</b><span>active</span></div></div></aside>
      <section class="table-workspace"><div class="table-toolbar"><label class="table-search">${icon('search')}<input id="ipFilter" placeholder="Filter IP, name, hostname, MAC…" /></label><button class="button small ghost">${icon('filter')}Filter</button><button class="button small ghost">Group</button><span class="spacer"></span><span class="toolbar-copy">Source: UniFi + Manual</span></div>
        <div class="table-scroll"><table class="data-table"><thead><tr><th>IP address</th><th>Name</th><th>Hostname</th><th>MAC address</th><th>Source</th><th>Status</th><th>Updated</th></tr></thead><tbody id="ipRows">${rows || `<tr><td colspan="7"><div class="empty-state">No addresses in this prototype network.</div></td></tr>`}</tbody></table></div>
        <div class="pagination"><span>Showing ${records.length} records in ${network.cidr}</span><div class="page-buttons"><button class="page-button is-active">1</button><button class="page-button">2</button><button class="page-button">3</button></div></div>
      </section>
      <aside class="inspector"><div class="pane-head"><h2>IP reservation</h2><button class="icon-button" id="closeInspector">${icon('close')}</button></div><div class="inspector-scroll">${selected ? `<section class="inspector-section"><div class="form-stack"><div class="field"><span>IP address</span><input class="input mono" value="${selected.ip}" /></div><div class="field"><span>Name</span><input class="input" value="${selected.name}" /></div><div class="field"><span>Hostname</span><input class="input" value="${selected.hostname}" /></div><div class="field"><span>MAC address</span><input class="input mono" value="${selected.mac}" /></div><div class="field"><span>Source</span><input class="input" value="${selected.source}" disabled /></div><div class="field"><span>Linked device</span><input class="input" value="${selected.linked}" /></div></div></section><div class="inspector-actions"><button class="button primary" id="saveIp">${icon('check')}Save changes</button><button class="button danger" id="releaseIp">${icon('trash')}Release reservation</button></div>` : `<div class="empty-state">Select an IP address.</div>`}</div></aside>
    </div>
  </section>`;
}

function renderWol() {
  const selected = machines.find((machine) => machine.id === state.selectedMachine) || machines[0];
  const rows = machines.map((machine) => `<tr data-machine="${machine.id}" class="${machine.id === selected.id ? 'is-selected' : ''}">
    <td><input class="checkbox machine-check" type="checkbox" data-machine-check="${machine.id}" ${state.selectedMachines.has(machine.id) ? 'checked' : ''} aria-label="Select ${machine.name}" /></td>
    <td><span class="machine-name">${icon('server')}<b>${machine.name}</b></span></td><td class="mono">${machine.ip}</td><td class="mono">${machine.mac}</td><td class="mono">${machine.broadcast}</td><td><span class="status ${statusClass(machine.status)}">${machine.status}</span></td><td>${machine.lastSeen}</td><td>${machine.schedule}</td><td class="row-actions"><button class="button small wake-machine" data-wake="${machine.id}" ${machine.status === 'Online' ? 'disabled' : ''}>Wake</button></td>
  </tr>`).join('');
  const online = machines.filter((machine) => machine.status === 'Online').length;
  const scheduled = machines.filter((machine) => machine.schedule !== '—').length;
  return `<section class="module">
    ${moduleHead({ eyebrow: 'Automation / Warsaw HQ', title: 'Wake on LAN', subtitle: 'Machines and schedules', metrics: [], actions: `<button class="button ghost" id="wakeSelected">${icon('power')}Wake selected</button><button class="button primary" id="addMachine">${icon('plus')}Add machine</button>` })}
    <div class="module-body wol-body">
      <section class="wol-workspace"><div class="summary-strip"><div class="summary-item">${icon('server')}<strong>${machines.length}</strong> machines</div><div class="summary-item"><span class="status online"><strong>${online}</strong> online</span></div><div class="summary-item">${icon('clock')}<strong>${scheduled}</strong> scheduled</div><div class="summary-item">${icon('refresh')}Last check <strong>09:42:18</strong></div></div>
        <div class="wol-table-wrap"><div class="subhead"><h2>Machines</h2><label class="table-search">${icon('search')}<input id="wolFilter" placeholder="Filter machines…" /></label><button class="icon-button">${icon('filter')}</button></div><div class="table-scroll"><table class="data-table"><thead><tr><th></th><th>Machine</th><th>IP address</th><th>MAC address</th><th>Broadcast</th><th>Status</th><th>Last seen</th><th>Schedule</th><th>Action</th></tr></thead><tbody id="wolRows">${rows}</tbody></table></div></div>
      </section>
      <aside class="inspector"><div class="pane-head"><h2>Machine details</h2><button class="icon-button" id="closeInspector">${icon('close')}</button></div><div class="inspector-scroll"><section class="inspector-section"><div class="form-stack"><div class="field"><span>Name</span><input id="machineName" class="input" value="${selected.name}" /></div><div class="field"><span>IP address</span><input id="machineIp" class="input mono" value="${selected.ip}" /></div><div class="field"><span>MAC address</span><input id="machineMac" class="input mono" value="${selected.mac}" /></div><div class="field"><span>Broadcast</span><input id="machineBroadcast" class="input mono" value="${selected.broadcast}" /></div><div class="field"><span>Linked device</span><input id="machineLinked" class="input" value="${selected.linked}" /></div><div class="field"><span>Schedule</span><input id="machineSchedule" class="input" value="${selected.schedule}" /></div></div></section>
        <div class="inspector-actions"><button class="button primary wake-machine" data-wake="${selected.id}" ${selected.status === 'Online' ? 'disabled' : ''}>${icon('power')}Wake now</button><button class="button" id="saveMachine">${icon('check')}Save changes</button><button class="button danger" id="deleteMachine">${icon('trash')}Delete machine</button></div>
        <section class="inspector-section"><h3>Upcoming schedules</h3><div class="upcoming"><div class="schedule-item">${icon('clock')}<div><b>Tomorrow, 07:30</b><span>BUILD-AGENT-02</span></div><span>Weekdays</span></div><div class="schedule-item">${icon('clock')}<div><b>Tomorrow, 08:00</b><span>WS-ADMIN-01</span></div><span>Weekdays</span></div><div class="schedule-item">${icon('clock')}<div><b>Sat, 01:00</b><span>SRV-BACKUP-01</span></div><span>Daily</span></div></div></section>
      </div></aside>
    </div>
  </section>`;
}

function renderOverview() {
  return `<section class="module">${moduleHead({ eyebrow: 'Infrastructure / Warsaw HQ', title: 'Operations overview', subtitle: 'Current state across racks, addressing and connectivity', metrics: [['2','Racks'], ['182','IP records'], ['80','Port links']], actions: `<button class="button ghost">${icon('refresh')}Refresh</button><button class="button primary" data-go-view="audit">Open activity</button>` })}
    <div class="overview-body"><div class="overview-main"><section class="ops-panel"><div class="ops-panel-head"><h2>Infrastructure health</h2><span class="status online">Operational</span></div><div class="health-grid"><div class="health-cell"><span>Rack utilization</span><strong>45%</strong><span>19U used of 42U</span><div class="mini-bar"><i style="width:45%"></i></div></div><div class="health-cell"><span>IP utilization</span><strong>26%</strong><span>62 reserved in Servers</span><div class="mini-bar"><i style="width:26%"></i></div></div><div class="health-cell"><span>Active port links</span><strong>79</strong><span>1 connection warning</span><div class="mini-bar"><i style="width:74%;background:var(--success)"></i></div></div></div></section>
      <section class="ops-panel"><div class="ops-panel-head"><h2>Recent activity</h2><button class="button small ghost" data-go-view="audit">View audit log</button></div><table class="data-table"><tbody>${audits.slice(0,5).map((row) => `<tr><td class="mono">${row[0]}</td><td>${row[1]}</td><td><b>${row[2]}</b></td><td>${row[3]}</td><td><span class="status ${statusClass(row[4])}">${row[4]}</span></td></tr>`).join('')}</tbody></table></section></div>
      <div class="overview-side"><section class="ops-panel"><div class="ops-panel-head"><h2>Attention required</h2><span style="color:var(--warning)">2</span></div><div class="alert-list"><div class="alert-item"><i></i><div><strong>IP conflict detected</strong><span>10.20.0.70 · BACKUP-SRV</span></div><button class="button small ghost" data-go-view="ip">Inspect</button></div><div class="alert-item"><i></i><div><strong>Port link disconnected</strong><span>PP-01/04 → SW-CORE-01/04</span></div><button class="button small ghost" data-go-view="ports">Inspect</button></div></div></section><section class="ops-panel"><div class="ops-panel-head"><h2>Integrations</h2></div><div class="inspector-section"><div class="linked-list"><div class="linked-item"><i></i><b>Warsaw UniFi</b><span>connected</span></div><div class="linked-item"><i></i><b>Local database</b><span>healthy</span></div></div></div></section></div></div>
  </section>`;
}

function renderAudit() {
  return `<section class="module">${moduleHead({ eyebrow: 'Operations / Governance', title: 'Audit Log', subtitle: 'Immutable operational activity and configuration changes', metrics: [['1,284','Events'], ['6','Today'], ['1','Warning']], actions: `<button class="button ghost">${icon('export')}Export CSV</button>` })}
    <div class="audit-layout"><div class="table-toolbar"><label class="table-search">${icon('search')}<input id="auditFilter" placeholder="Filter events, assets or users…" /></label><button class="button small ghost">${icon('filter')}Event type</button><button class="button small ghost">User</button><span class="spacer"></span><span class="toolbar-copy">Retention: 365 days</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Time</th><th>Actor</th><th>Event</th><th>Target / Details</th><th>Result</th></tr></thead><tbody id="auditRows">${audits.map((row) => `<tr><td class="mono">${row[0]}</td><td>${row[1]}</td><td><b>${row[2]}</b></td><td>${row[3]}</td><td><span class="status ${statusClass(row[4])}">${row[4]}</span></td></tr>`).join('')}</tbody></table></div></div>
  </section>`;
}

function filterRows(inputId, rowsId) {
  const input = document.querySelector(`#${inputId}`);
  const rows = document.querySelector(`#${rowsId}`);
  if (!input || !rows) return;
  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    rows.querySelectorAll('tr').forEach((row) => {
      row.hidden = Boolean(query) && !row.textContent.toLowerCase().includes(query);
    });
  });
}

function bindViewEvents() {
  document.querySelectorAll('[data-go-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.goView)));
  document.querySelector('#closeInspector')?.addEventListener('click', (event) => {
    event.currentTarget.closest('.inspector')?.classList.add('is-closed');
    toast('Inspektor zamknięty. Wybierz obiekt, aby otworzyć go ponownie.');
  });

  if (state.view === 'racks') {
    document.querySelectorAll('[data-rack-device]').forEach((button) => button.addEventListener('click', () => { state.selectedRackDevice = button.dataset.rackDevice; state.rackTab = 'details'; render(); }));
    document.querySelectorAll('[data-rack-tab]').forEach((button) => button.addEventListener('click', () => { state.rackTab = button.dataset.rackTab; render(); }));
    document.querySelector('#addRackDevice')?.addEventListener('click', openAddDeviceModal);
    document.querySelector('#editRack')?.addEventListener('click', () => toast('Tryb edycji szafy został włączony.'));
    document.querySelector('#editDevice')?.addEventListener('click', () => toast('Inspektor urządzenia jest gotowy do edycji.'));
  }

  if (state.view === 'ports') {
    document.querySelectorAll('[data-connection]').forEach((row) => row.addEventListener('click', () => { state.selectedConnection = Number(row.dataset.connection); render(); }));
    document.querySelectorAll('[data-port]').forEach((port) => port.addEventListener('click', () => {
      const number = Number(port.dataset.port);
      const connection = connections.find((item) => port.dataset.portSide === 'source' ? item.srcPort === number : item.dstPort === number);
      if (connection) { state.selectedConnection = connection.id; render(); }
      else toast(`${port.dataset.portSide === 'source' ? 'PP-01' : 'SW-CORE-01'} / Port ${number} jest wolny.`, 'warning');
    }));
    document.querySelector('#linkMode')?.addEventListener('click', () => { state.linkMode = !state.linkMode; render(); toast(state.linkMode ? 'Wybierz dwa wolne porty, aby utworzyć połączenie.' : 'Tryb łączenia wyłączony.'); });
    document.querySelector('#saveConnection')?.addEventListener('click', () => toast('Połączenie zapisane w prototypie.', 'success'));
    document.querySelector('#unlinkConnection')?.addEventListener('click', () => toast('Prototyp: rozłączenie wymagałoby potwierdzenia.', 'warning'));
    filterRows('connectionFilter', 'connectionRows');
  }

  if (state.view === 'ip') {
    document.querySelectorAll('[data-network]').forEach((button) => button.addEventListener('click', () => { state.selectedNetwork = button.dataset.network; const first = ipRecords.find((record) => record.network === state.selectedNetwork); state.selectedIp = first?.ip || ''; render(); }));
    document.querySelectorAll('[data-ip]').forEach((row) => row.addEventListener('click', () => { state.selectedIp = row.dataset.ip; render(); }));
    document.querySelector('#reserveIp')?.addEventListener('click', openReserveIpModal);
    document.querySelector('#saveIp')?.addEventListener('click', () => toast('Rezerwacja IP zapisana w prototypie.', 'success'));
    document.querySelector('#releaseIp')?.addEventListener('click', () => toast('Prototyp: zwolnienie adresu wymagałoby potwierdzenia.', 'warning'));
    document.querySelector('#syncIp')?.addEventListener('click', () => {
      integrationLabel.textContent = 'Syncing UniFi…';
      window.setTimeout(() => { integrationLabel.textContent = 'UniFi Connected'; toast('Synchronizacja UniFi zakończona.', 'success'); }, 900);
    });
    filterRows('ipFilter', 'ipRows');
  }

  if (state.view === 'wol') {
    document.querySelectorAll('[data-machine]').forEach((row) => row.addEventListener('click', (event) => {
      if (event.target.closest('button') || event.target.closest('input')) return;
      state.selectedMachine = row.dataset.machine;
      render();
    }));
    document.querySelectorAll('[data-machine-check]').forEach((checkbox) => checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selectedMachines.add(checkbox.dataset.machineCheck);
      else state.selectedMachines.delete(checkbox.dataset.machineCheck);
    }));
    document.querySelectorAll('[data-wake]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); wakeMachine(button.dataset.wake); }));
    document.querySelector('#wakeSelected')?.addEventListener('click', () => {
      if (!state.selectedMachines.size) return toast('Najpierw zaznacz przynajmniej jedną maszynę.', 'warning');
      [...state.selectedMachines].forEach((id) => wakeMachine(id, false));
      toast(`Wysłano pakiety Wake do ${state.selectedMachines.size} maszyn.`, 'success');
    });
    document.querySelector('#addMachine')?.addEventListener('click', openAddMachineModal);
    document.querySelector('#saveMachine')?.addEventListener('click', saveSelectedMachine);
    document.querySelector('#deleteMachine')?.addEventListener('click', () => toast('Prototyp: usunięcie maszyny wymagałoby potwierdzenia.', 'warning'));
    filterRows('wolFilter', 'wolRows');
  }

  if (state.view === 'audit') filterRows('auditFilter', 'auditRows');
}

function wakeMachine(id, announce = true) {
  const machine = machines.find((item) => item.id === id);
  if (!machine || machine.status === 'Online') return;
  machine.status = 'Waking…';
  state.selectedMachine = id;
  render();
  if (announce) toast(`Magic packet wysłany do ${machine.name}.`, 'success');
  window.setTimeout(() => {
    machine.status = 'Online';
    machine.lastSeen = new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (state.view === 'wol') render();
    toast(`${machine.name} odpowiada w sieci.`, 'success');
  }, 1700);
}

function saveSelectedMachine() {
  const machine = machines.find((item) => item.id === state.selectedMachine);
  if (!machine) return;
  machine.name = document.querySelector('#machineName')?.value.trim() || machine.name;
  machine.ip = document.querySelector('#machineIp')?.value.trim() || machine.ip;
  machine.mac = document.querySelector('#machineMac')?.value.trim() || machine.mac;
  machine.broadcast = document.querySelector('#machineBroadcast')?.value.trim() || machine.broadcast;
  machine.linked = document.querySelector('#machineLinked')?.value.trim() || machine.linked;
  machine.schedule = document.querySelector('#machineSchedule')?.value.trim() || machine.schedule;
  render();
  toast('Dane maszyny zostały zapisane.', 'success');
}

function openModal({ title, body, submitLabel = 'Save', onSubmit }) {
  modalBackdrop.hidden = false;
  modalBackdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><h2 id="modalTitle">${title}</h2><button class="icon-button" data-close-modal aria-label="Zamknij">${icon('close')}</button></div><form id="prototypeModalForm"><div class="modal-body">${body}</div><div class="modal-footer"><button class="button ghost" type="button" data-close-modal>Cancel</button><button class="button primary" type="submit">${submitLabel}</button></div></form></section>`;
  modalBackdrop.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
  modalBackdrop.querySelector('form').addEventListener('submit', (event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); });
}

function closeModal() { modalBackdrop.hidden = true; modalBackdrop.innerHTML = ''; }

function openAddMachineModal() {
  openModal({ title: 'Add Wake-on-LAN machine', submitLabel: 'Add machine', body: `<div class="form-grid"><div class="field full"><span>Name</span><input class="input" name="name" value="NEW-MACHINE" required /></div><div class="field"><span>IP address</span><input class="input mono" name="ip" value="10.20.0.80" required /></div><div class="field"><span>MAC address</span><input class="input mono" name="mac" value="00:11:22:33:44:80" required /></div><div class="field"><span>Broadcast</span><input class="input mono" name="broadcast" value="10.20.0.255:9" /></div><div class="field"><span>Schedule</span><input class="input" name="schedule" value="—" /></div><div class="field full"><span>Linked device</span><input class="input" name="linked" placeholder="EDGE-A / U14" /></div></div>`, onSubmit: (form) => {
    const name = String(form.get('name'));
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${Date.now()}`;
    machines.push({ id, name, ip: String(form.get('ip')), mac: String(form.get('mac')), broadcast: String(form.get('broadcast')), status: 'Unknown', lastSeen: '—', schedule: String(form.get('schedule')), linked: String(form.get('linked')) || 'Unlinked' });
    state.selectedMachine = id; closeModal(); render(); toast(`${name} dodano do Wake on LAN.`, 'success');
  }});
}

function openReserveIpModal() {
  const network = networks.find((item) => item.id === state.selectedNetwork) || networks[1];
  openModal({ title: 'Reserve IP address', submitLabel: 'Create reservation', body: `<div class="form-grid"><div class="field"><span>IP address</span><input class="input mono" name="ip" value="${network.cidr.replace('0/24','80').replace('0/23','80')}" required /></div><div class="field"><span>Name</span><input class="input" name="name" value="NEW-ASSET" required /></div><div class="field"><span>Hostname</span><input class="input" name="hostname" value="new-asset" /></div><div class="field"><span>MAC address</span><input class="input mono" name="mac" value="00:11:22:33:44:80" /></div><div class="field full"><span>Linked device</span><input class="input" name="linked" placeholder="EDGE-A / U14" /></div></div>`, onSubmit: (form) => {
    const record = { network: network.id, ip: String(form.get('ip')), name: String(form.get('name')), hostname: String(form.get('hostname')), mac: String(form.get('mac')), source: 'Manual', status: 'Reserved', updated: 'just now', linked: String(form.get('linked')) || 'Unlinked' };
    ipRecords.push(record); state.selectedIp = record.ip; closeModal(); render(); toast(`Adres ${record.ip} został zarezerwowany.`, 'success');
  }});
}

function openAddDeviceModal() {
  openModal({ title: 'Add rack device', submitLabel: 'Add device', body: `<div class="form-grid"><div class="field"><span>Asset name</span><input class="input" name="name" value="NEW-DEVICE-01" required /></div><div class="field"><span>Model</span><input class="input" name="model" value="Generic 1U appliance" /></div><div class="field"><span>Position</span><input class="input mono" name="u" type="number" min="1" max="42" value="30" /></div><div class="field"><span>Height</span><input class="input mono" name="height" type="number" min="1" max="8" value="1" /></div><div class="field"><span>Management IP</span><input class="input mono" name="ip" placeholder="10.20.0.80" /></div><div class="field"><span>VLAN</span><input class="input" name="vlan" value="20" /></div></div>`, onSubmit: (form) => {
    const name = String(form.get('name')); const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${Date.now()}`;
    rackDevices.push({ id, name, model: String(form.get('model')), u: Number(form.get('u')), height: Number(form.get('height')), type: 'server', ip: String(form.get('ip')) || '—', vlan: String(form.get('vlan')), status: 'Unknown', links: [] });
    state.selectedRackDevice = id; closeModal(); render(); toast(`${name} dodano do szafy.`, 'success');
  }});
}

document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelector('#collapseSidebar').addEventListener('click', () => {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  localStorage.setItem('rakit-prototype-sidebar', state.sidebarCollapsed ? 'collapsed' : 'expanded');
  appShell.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
});
document.querySelector('#settingsButton').addEventListener('click', () => openModal({ title: 'Prototype settings', submitLabel: 'Apply', body: `<div class="form-stack"><div class="field"><span>Interface density</span><select class="input" name="density"><option>Compact</option><option>Comfortable</option></select></div><div class="field"><span>Default rack face</span><select class="input" name="face"><option>Front</option><option>Rear</option></select></div><div class="field"><span>Theme</span><select class="input" name="theme"><option>Operations Dark</option></select></div></div>`, onSubmit: () => { closeModal(); toast('Ustawienia prototypu zapisane.', 'success'); } }));
document.querySelector('#lockButton').addEventListener('click', () => toast('Sesja zostałaby teraz zablokowana.', 'warning'));
modalBackdrop.addEventListener('click', (event) => { if (event.target === modalBackdrop) closeModal(); });

const globalSearch = document.querySelector('#globalSearch');
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') { event.preventDefault(); globalSearch.focus(); }
  if (event.key === 'Escape' && !modalBackdrop.hidden) closeModal();
});
globalSearch.addEventListener('keydown', (event) => { if (event.key === 'Enter' && globalSearch.value.trim()) toast(`Wyniki globalne dla: ${globalSearch.value.trim()}`); });

if (state.sidebarCollapsed) appShell.classList.add('sidebar-collapsed');
render();
