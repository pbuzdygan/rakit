import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskLaunchPayload } from '../semaphoreClient.js';
import { parseRakitTaskResult } from '../semaphoreResults.js';

test('task launch payload carries the selected host in current and legacy Semaphore fields', () => {
  assert.deepEqual(buildTaskLaunchPayload(12, 'buzhulk-dev'), {
    template_id: 12,
    limit: 'buzhulk-dev',
    params: { limit: ['buzhulk-dev'] },
  });
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
