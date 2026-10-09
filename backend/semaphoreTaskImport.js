import { parseRakitHealthResult, parseRakitOperationResult, parseRakitTaskResult } from './semaphoreResults.js';

// Only the four explicitly mapped templates may update Rakit server state.
export const describeSemaphoreTaskImport = (profile, task) => {
  const taskId = Number(task?.id);
  const templateId = Number(task?.template_id ?? task?.templateId);
  if (!Number.isInteger(taskId) || taskId < 1 || !Number.isInteger(templateId) || templateId < 1) return null;
  const mappings = [
    ['check_template_id', 'check_updates'],
    ['update_template_id', 'update_packages'],
    ['reboot_template_id', 'reboot'],
    ['health_template_id', 'health_check'],
  ];
  const action = mappings.find(([column]) => Number(profile[column]) === templateId)?.[1];
  if (!action) return null;
  const rawStatus = String(task?.status || '').toLowerCase();
  const status = ['success', 'successful'].includes(rawStatus) ? 'success'
    : ['error', 'failed'].includes(rawStatus) ? 'failed'
      : ['stopped', 'canceled', 'cancelled'].includes(rawStatus) ? 'stopped' : null;
  if (!status) return null;
  const rawScheduleId = Number(task?.schedule_id ?? task?.scheduleId);
  // Zero represents a manual task in the existing NOT NULL schedule_id column.
  const scheduleId = Number.isInteger(rawScheduleId) && rawScheduleId > 0 ? rawScheduleId : 0;
  return { taskId, templateId, action, status, scheduleId, source: scheduleId ? 'schedule' : 'semaphore' };
};

export const shouldImportSemaphoreTask = (candidate, { imported = false, trackedByRakit = false } = {}) =>
  Boolean(candidate) && !imported && !trackedByRakit;

const clampText = (value, max) => String(value ?? '').trim().slice(0, max);

export const createSemaphoreTaskImporter = ({
  db, getTaskOutput, saveUpdateCheckResult, saveHealthResult,
  saveUpdateOperationResult, saveUpdateCheckFailure, saveHealthFailure,
  saveFailedUpdateOperation, recordAudit,
}) => {
  const insertExternalServerAction = (profile, task, server, action, summary, status = 'success') => {
    db.prepare(`
      INSERT INTO server_actions(
        server_id, action, semaphore_profile_id, semaphore_template_id, semaphore_task_id,
        target_limit, status, requested_at, started_at, finished_at, result_summary, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(datetime(?), CURRENT_TIMESTAMP), datetime(?), datetime(?), ?, ?)
    `).run(
      server.id, action, profile.id, Number(task.template_id ?? task.templateId), Number(task.id),
      server.ansible_alias, status, task.created || null, task.start || task.started || null,
      task.end || task.finished || null, summary,
      describeSemaphoreTaskImport(profile, task).source,
    );
  };

  const externalTaskTargetsServer = (task, server) => {
    const rawLimit = task?.params?.limit ?? task?.limit;
    const limits = (Array.isArray(rawLimit) ? rawLimit : String(rawLimit || '').split(','))
      .map((value) => String(value).trim()).filter(Boolean);
    return !limits.length || limits.includes('all') || limits.includes(server.ansible_alias);
  };

  return async (profile, client, task) => {
    const candidate = describeSemaphoreTaskImport(profile, task);
    if (!candidate) return;
    const { taskId, scheduleId, action, status, source } = candidate;
    const alreadyImported = Boolean(db.prepare('SELECT 1 FROM semaphore_task_imports WHERE semaphore_profile_id=? AND semaphore_task_id=?').get(profile.id, taskId));
    const trackedByRakit = Boolean(db.prepare("SELECT 1 FROM server_actions WHERE semaphore_profile_id=? AND semaphore_task_id=? AND source='rakit'").get(profile.id, taskId));
    if (!shouldImportSemaphoreTask(candidate, { imported: alreadyImported, trackedByRakit })) return;

    const output = await getTaskOutput(client, profile.project_id, taskId);
    const finishedAt = task?.end || task?.finished || task?.start || task?.created || new Date().toISOString();
    const servers = db.prepare('SELECT * FROM servers WHERE ansible_enabled=1').all();
    const imported = db.transaction(() => {
      let importedHosts = 0;
      for (const server of servers) {
        let hostResultImported = false;
        if (action === 'check_updates') {
          const result = parseRakitTaskResult(output, server.ansible_alias);
          if (result) {
            saveUpdateCheckResult(server.id, result, taskId, finishedAt);
            insertExternalServerAction(profile, task, server, action, `${result.updates} updates · ${result.security} security`);
            hostResultImported = true;
          }
        } else if (action === 'health_check') {
          const result = parseRakitHealthResult(output, server.ansible_alias);
          if (result) {
            saveHealthResult(server.id, result, finishedAt);
            insertExternalServerAction(profile, task, server, action, `Online · disk ${result.rootDiskPercent ?? '?'}% · ${result.processorVcpus ?? '?'} vCPU · ${result.memoryMb ?? '?'} MB RAM`);
            hostResultImported = true;
          }
        } else if (action === 'update_packages') {
          const result = parseRakitOperationResult(output, server.ansible_alias, action);
          if (result) {
            saveUpdateOperationResult(server.id, result, taskId, finishedAt);
            insertExternalServerAction(profile, task, server, action, `${result.changed ? 'Packages updated' : 'No package changes'} · ${result.rebootRequired ? 'reboot required' : 'no reboot required'}`);
            hostResultImported = true;
          }
        } else if (action === 'reboot') {
          const result = parseRakitOperationResult(output, server.ansible_alias, action);
          if (result) {
            db.prepare(`
              UPDATE server_update_status SET reboot_required=0, check_result='stale'
              WHERE server_id=? AND (checked_at IS NULL OR datetime(checked_at) <= COALESCE(datetime(?), CURRENT_TIMESTAMP))
            `).run(server.id, finishedAt);
            insertExternalServerAction(profile, task, server, action, 'Server reboot completed; health data is stale');
            hostResultImported = true;
          }
        }
        if (hostResultImported) {
          importedHosts += 1;
        } else if (status !== 'success' && externalTaskTargetsServer(task, server)) {
          if (action === 'check_updates') saveUpdateCheckFailure(server.id, taskId, finishedAt);
          if (action === 'health_check') saveHealthFailure(server.id, finishedAt);
          if (action === 'update_packages' && status === 'failed') saveFailedUpdateOperation(server.id, taskId, finishedAt);
          insertExternalServerAction(profile, task, server, action, clampText(task?.message || 'Semaphore task failed', 500), status);
          importedHosts += 1;
        }
      }
      db.prepare(`
        INSERT INTO semaphore_task_imports(semaphore_profile_id, semaphore_task_id, schedule_id, semaphore_template_id, status)
        VALUES (?, ?, ?, ?, ?)
      `).run(profile.id, taskId, scheduleId, Number(task.template_id ?? task.templateId), status);
      if (importedHosts) recordAudit({
        action: `${source === 'schedule' ? 'Scheduled' : 'Semaphore'} server action imported: ${action}`,
        objectType: 'semaphore_task', objectId: taskId,
        details: `${importedHosts} host${importedHosts === 1 ? '' : 's'} · ${scheduleId ? `schedule ${scheduleId}` : 'manual Semaphore task'}`,
        actor: 'system',
      });
    });
    imported();
  };
};
