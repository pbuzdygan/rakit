import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskLaunchPayload, templateAllowsHostLimit } from '../semaphoreClient.js';
import { parseRakitOperationResult, parseRakitTaskResult } from '../semaphoreResults.js';

test('task launch payload carries the selected host in current and legacy Semaphore fields', () => {
  assert.deepEqual(buildTaskLaunchPayload(12, 'buzhulk-dev'), {
    template_id: 12,
    limit: 'buzhulk-dev',
    params: { limit: ['buzhulk-dev'] },
  });
});

test('server task launch refuses to run without a host limit', () => {
  assert.throws(() => buildTaskLaunchPayload(12, '  '), /target host limit is required/i);
});

test('only an explicitly enabled Semaphore limit override is accepted', () => {
  assert.equal(templateAllowsHostLimit({ task_params: { allow_override_limit: true } }), true);
  assert.equal(templateAllowsHostLimit({ task_params: { allow_override_limit: false } }), false);
  assert.equal(templateAllowsHostLimit({ task_params: { params: { limit: [] } } }), false);
  assert.equal(templateAllowsHostLimit({}), false);
});

test('extracts every host result from a failed multi-host log with wrapped timestamps', () => {
  const output = `
12:07:37 PM
ok: [buzhulk] =>
12:07:37 PM
    msg: 'RAKIT_RESULT_V1={"host": "buzhulk", "updates": 4, "security": 0, "rebootRequired":
12:07:37 PM
        false, "kernel": "7.0.0-31-generic", "uptimeSeconds": 761052}'
12:07:37 PM
ok: [buzhulk-dev] =>
12:07:37 PM
    msg: 'RAKIT_RESULT_V1={"host": "buzhulk-dev", "updates": 1, "security": 1, "rebootRequired":
12:07:37 PM
        false, "kernel": "7.0.0-31-generic", "uptimeSeconds": 368866}'
12:07:37 PM
Failed to run task: exit status 4`;

  assert.deepEqual(parseRakitTaskResult(output, 'buzhulk'), {
    host: 'buzhulk', updates: 4, security: 0, rebootRequired: false,
    kernel: '7.0.0-31-generic', uptimeSeconds: 761052,
  });
  assert.deepEqual(parseRakitTaskResult(output, 'buzhulk-dev'), {
    host: 'buzhulk-dev', updates: 1, security: 1, rebootRequired: false,
    kernel: '7.0.0-31-generic', uptimeSeconds: 368866,
  });
  assert.equal(parseRakitTaskResult(output, 'patonas'), null);
});

test('parses the structured output endpoint representation', () => {
  const output = [{ output: 'RAKIT_RESULT_V1={"host":"host1","updates":2,"security":1,"rebootRequired":true}' }];
  assert.deepEqual(parseRakitTaskResult(output, 'host1'), {
    host: 'host1', updates: 2, security: 1, rebootRequired: true,
    kernel: '', uptimeSeconds: null,
  });
});

test('extracts a successful package update from a globally failed task log', () => {
  const output = `
1:34:07 PM
ok: [buzhulk-dev] =>
1:34:07 PM
    msg: 'RAKIT_OPERATION_V1={"host": "buzhulk-dev", "action": "update_packages", "changed":
1:34:07 PM
        true, "rebootRequired": false}'
1:34:08 PM
fatal: [buzpi01]: UNREACHABLE!
1:34:09 PM
Failed to run task: exit status 4`;

  assert.deepEqual(parseRakitOperationResult(output, 'buzhulk-dev', 'update_packages'), {
    host: 'buzhulk-dev', action: 'update_packages', changed: true, rebootRequired: false,
  });
  assert.equal(parseRakitOperationResult(output, 'buzpi01', 'update_packages'), null);
});
