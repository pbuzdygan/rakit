import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeRakitCatalog, parseSemaphoreInventory } from '../inventory.js';

const catalog = {
  version: 1,
  groups: [{ ansibleName: 'd', name: 'Dev', description: 'Development', color: 'blue' }],
  servers: [
    {
      alias: 'host1', name: 'HOST ONE', hostname: 'host1.local', primaryIp: '192.0.2.1',
      sshUser: 'deploy', sshPort: 22, osFamily: 'linux', osName: 'Ubuntu', osVersion: '24.04',
      environment: 'Dev', role: 'Docker', location: 'Lab', cockpitUrl: '', notes: 'Portable metadata',
      ansibleEnabled: true, groups: ['d'],
    },
    {
      alias: 'storage', name: 'STORAGE', hostname: '', primaryIp: '192.0.2.2',
      sshUser: '', sshPort: 22, osFamily: 'linux', osName: '', osVersion: '', environment: '',
      role: 'NAS', location: '', cockpitUrl: '', notes: '', ansibleEnabled: false, groups: [],
    },
  ],
};

const inventoryFor = (metadata = catalog) => `# Managed by Rakit
${encodeRakitCatalog(metadata)}

[rakit_managed]
host1 ansible_host=192.0.2.1 ansible_port=22

[d]
host1
`;

test('portable catalog preserves display metadata and unmanaged servers', () => {
  const parsed = parseSemaphoreInventory(inventoryFor());
  assert.equal(parsed.catalog.groups[0].name, 'Dev');
  assert.equal(parsed.catalog.servers[0].name, 'HOST ONE');
  assert.equal(parsed.catalog.servers[0].sshUser, 'deploy');
  assert.equal(parsed.catalog.servers[1].name, 'STORAGE');
  assert.equal(parsed.catalog.servers[1].ansibleEnabled, false);
});

test('catalog cannot disagree with the Ansible host projection', () => {
  const changed = structuredClone(catalog);
  changed.servers[0].primaryIp = '192.0.2.99';
  assert.throws(() => parseSemaphoreInventory(inventoryFor(changed)), /does not match the technical inventory/);
});

test('legacy Rakit-compatible inventory remains importable', () => {
  const parsed = parseSemaphoreInventory('[rakit_managed]\nhost1 ansible_host=192.0.2.1 ansible_port=22\n\n[d]\nhost1\n');
  assert.equal(parsed.catalog, null);
  assert.deepEqual(parsed.groups, [{ name: 'd', members: ['host1'] }]);
});

test('catalog with only unmanaged servers remains portable', () => {
  const unmanagedCatalog = structuredClone(catalog);
  unmanagedCatalog.servers = [unmanagedCatalog.servers[1]];
  const parsed = parseSemaphoreInventory(`# Managed by Rakit\n${encodeRakitCatalog(unmanagedCatalog)}\n\n[rakit_managed]\n\n[d]\n`);
  assert.equal(parsed.hosts.length, 0);
  assert.equal(parsed.catalog.servers[0].name, 'STORAGE');
});
