import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModuleVisibility, MODULES } from '../src/modules.ts';
import { selectReleaseForChannel } from '../src/versionInfo.ts';

async function freshStore(entries = {}) {
  const storage = new Map(Object.entries(entries));
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const { useAppStore } = await import(`../src/store.ts?case=${crypto.randomUUID()}`);
  return { store: useAppStore, storage };
}

test('partial and corrupt preferences keep defaults for unspecified modules', () => {
  for (const input of [null, [], 'invalid', 42]) {
    assert.ok(Object.values(normalizeModuleVisibility(input)).every(Boolean));
  }
  assert.deepEqual(normalizeModuleVisibility({ cabinet: false, servers: 'false', unknown: false }), {
    cabinet: false, servers: true, ipdash: true, porthub: true, wol: true,
  });
});

test('hiding the active module saves Overview and blocks later navigation; restore preserves the selection', async () => {
  const { store, storage } = await freshStore();
  assert.equal(store.getState().view, 'cabinet');
  store.getState().setModuleVisible('cabinet', false);
  assert.equal(store.getState().view, 'overview');
  assert.equal(JSON.parse(storage.get('view')), 'overview');
  store.getState().setView('cabinet');
  assert.equal(store.getState().view, 'overview');
  for (const { id } of MODULES) store.getState().setModuleVisible(id, false);
  store.getState().setView('audit');
  assert.equal(store.getState().view, 'audit');
  store.getState().resetModuleVisibility();
  assert.ok(Object.values(JSON.parse(storage.get('ops-module-visibility'))).every(Boolean));
  assert.equal(store.getState().view, 'audit');
});

test('startup honors stored visibility and rejects a stored hidden view', async () => {
  const { store } = await freshStore({ view: '"servers"', 'ops-module-visibility': '{"servers":false}' });
  assert.equal(store.getState().view, 'overview');
  assert.equal(store.getState().moduleVisibility.servers, false);
  const invalid = await freshStore({ 'ops-module-visibility': '{broken' });
  assert.equal(invalid.store.getState().view, 'cabinet');
  assert.ok(Object.values(invalid.store.getState().moduleVisibility).every(Boolean));
});

test('release selection excludes drafts, stable prereleases and the other channel', () => {
  const releases = [
    { tag_name: '1.5.0', target_commitish: 'main', draft: true },
    { tag_name: 'dev-1.4.3', target_commitish: 'dev', prerelease: true },
    { tag_name: '1.4.4-rc', target_commitish: 'main', prerelease: true },
    { tag_name: '1.4.2', target_commitish: 'main' },
    { tag_name: '1.4.10', target_commitish: 'main' },
    { tag_name: 'dev-1.4.2', target_commitish: 'dev' },
  ];
  assert.equal(selectReleaseForChannel(releases, 'main').tag_name, '1.4.10');
  assert.equal(selectReleaseForChannel(releases, 'dev').tag_name, 'dev-1.4.3');
  assert.equal(selectReleaseForChannel([{ tag_name: 'dev-1.4.2' }], 'main'), null);
  assert.equal(selectReleaseForChannel([{ tag_name: '1.4.2' }], 'dev'), null);
  assert.equal(selectReleaseForChannel([], 'main'), null);
});
