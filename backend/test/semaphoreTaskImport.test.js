import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createSemaphoreTaskImporter, describeSemaphoreTaskImport } from '../semaphoreTaskImport.js';

const profile = { id: 1, project_id: 1, check_template_id: 10, health_template_id: 11, update_template_id: 12, reboot_template_id: 13 };
const task = { id: 84, template_id: 10, status: 'success', end: '2026-10-09T10:00:00Z' };

const fixture = (t, output) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  sqlite.prepare(`INSERT INTO semaphore_profiles(id, name, api_url, ui_url, api_token_encrypted, project_id, inventory_id)
    VALUES (1, 'test', 'https://example.test', 'https://example.test', 'fixture', 1, 1)`).run();
  for (const [id, alias, enabled] of [[1, 'buzhulk', 1], [2, 'buzhulk-dev', 1], [3, 'buzpc00-dev', 1], [4, 'unmanaged', 0]]) {
    sqlite.prepare('INSERT INTO servers(id, name, ansible_alias, primary_ip, ansible_enabled) VALUES (?, ?, ?, ?, ?)')
      .run(id, alias, alias, '192.0.2.1', enabled);
  }
  const db = {
    prepare: (sql) => sqlite.prepare(sql),
    transaction: (callback) => () => {
      sqlite.exec('BEGIN');
      try { const result = callback(); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const saved = { checks: [], health: [], updates: [], checkFailures: [], healthFailures: [], updateFailures: [], audit: [] };
  let reads = 0;
  const importer = createSemaphoreTaskImporter({
    db, getTaskOutput: async () => { reads++; return output; },
    saveUpdateCheckResult: (...args) => saved.checks.push(args),
    saveHealthResult: (...args) => saved.health.push(args),
    saveUpdateOperationResult: (...args) => saved.updates.push(args),
    saveUpdateCheckFailure: (...args) => saved.checkFailures.push(args),
    saveHealthFailure: (...args) => saved.healthFailures.push(args),
    saveFailedUpdateOperation: (...args) => saved.updateFailures.push(args),
    recordAudit: (event) => saved.audit.push(event),
  });
  return { sqlite, saved, importer, reads: () => reads };
};

const checkLog = [
  ['buzhulk', 22, 4], ['buzhulk-dev', 24, 17], ['buzpc00-dev', 5, 1], ['unmanaged', 9, 9],
].map(([host, updates, security]) => `RAKIT_RESULT_V1=${JSON.stringify({ host, updates, security, rebootRequired: host === 'buzhulk' })}`).join('\n');

test('imports manual multi-host update checks once, using task completion time', async (t) => {
  const f = fixture(t, checkLog);
  await f.importer(profile, {}, task);
  assert.deepEqual(f.saved.checks.map(([id, result, taskId, time]) => [id, result.updates, result.security, taskId, time]), [
    [1, 22, 4, 84, task.end], [2, 24, 17, 84, task.end], [3, 5, 1, 84, task.end],
  ]);
  assert.equal(f.saved.health.length, 0);
  assert.deepEqual(f.sqlite.prepare('SELECT source FROM server_actions').all().map((row) => row.source), ['semaphore', 'semaphore', 'semaphore']);
  assert.equal(f.sqlite.prepare('SELECT schedule_id FROM semaphore_task_imports').get().schedule_id, 0);
  await f.importer(profile, {}, task);
  assert.equal(f.reads(), 1);
  assert.equal(f.saved.checks.length, 3);
});

test('imports manual health for matching hosts without changing package counts', async (t) => {
  const f = fixture(t, 'RAKIT_HEALTH_V1={"host":"buzpc00-dev","kernel":"7.0.0-38-generic","uptimeSeconds":37478,"rootDiskPercent":14}');
  await f.importer(profile, {}, { ...task, template_id: 11 });
  assert.equal(f.saved.health.length, 1);
  assert.equal(f.saved.health[0][0], 3);
  assert.equal(f.saved.health[0][2], task.end);
  assert.equal(f.saved.checks.length, 0);
});

test('keeps schedule attribution and skips tasks already tracked by Rakit', async (t) => {
  const f = fixture(t, checkLog);
  await f.importer(profile, {}, { ...task, schedule_id: 7 });
  assert.equal(f.sqlite.prepare('SELECT source FROM server_actions LIMIT 1').get().source, 'schedule');
  assert.equal(f.sqlite.prepare('SELECT schedule_id FROM semaphore_task_imports').get().schedule_id, 7);
  f.sqlite.prepare(`INSERT INTO server_actions(server_id, action, semaphore_profile_id, semaphore_template_id, semaphore_task_id, target_limit)
    VALUES (3, 'check_updates', 1, 10, 85, 'buzpc00-dev')`).run();
  await f.importer(profile, {}, { ...task, id: 85 });
  assert.equal(f.reads(), 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM server_actions').get().n, 4);
});

test('ignores running tasks, unmapped templates and invalid task IDs', async (t) => {
  const f = fixture(t, checkLog);
  for (const variant of [{ status: 'running' }, { template_id: 99 }, { id: 0 }]) {
    await f.importer(profile, {}, { ...task, ...variant });
  }
  assert.equal(f.reads(), 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM semaphore_task_imports').get().n, 0);
  assert.equal(describeSemaphoreTaskImport({}, { id: 1, template_id: 0, status: 'success' }), null);
});

test('preserves successful hosts in a failed manual task and respects the failed target limit', async (t) => {
  const f = fixture(t, 'RAKIT_RESULT_V1={"host":"buzhulk","updates":22,"security":4}');
  await f.importer(profile, {}, { ...task, status: 'error', params: { limit: ['buzhulk', 'buzpc00-dev'] } });
  assert.equal(f.saved.checks.length, 1);
  assert.deepEqual(f.saved.checkFailures, [[3, 84, task.end]]);
  assert.deepEqual(f.sqlite.prepare('SELECT server_id, status FROM server_actions ORDER BY server_id').all().map((r) => [r.server_id, r.status]), [[1, 'success'], [3, 'failed']]);
});

test('imports package operations and does not let an older reboot invalidate a newer check', async (t) => {
  const f = fixture(t, 'RAKIT_OPERATION_V1={"host":"buzpc00-dev","action":"update_packages","changed":true,"rebootRequired":false}');
  await f.importer(profile, {}, { ...task, template_id: 12 });
  assert.equal(f.saved.updates.length, 1);
  assert.equal(f.saved.updates[0][0], 3);
  f.sqlite.prepare("INSERT INTO server_update_status(server_id, checked_at, check_result, reboot_required) VALUES (3, '2026-10-09 11:00:00', 'ok', 1)").run();
  const reboot = createSemaphoreTaskImporter({
    db: { prepare: (sql) => f.sqlite.prepare(sql), transaction: (callback) => callback },
    getTaskOutput: async () => 'RAKIT_OPERATION_V1={"host":"buzpc00-dev","action":"reboot","changed":true}',
    recordAudit: () => {},
  });
  await reboot(profile, {}, { ...task, id: 85, template_id: 13 });
  const row = f.sqlite.prepare('SELECT check_result, reboot_required FROM server_update_status WHERE server_id=3').get();
  assert.equal(row.check_result, 'ok');
  assert.equal(row.reboot_required, 1);
});
