const clampText = (value, max = 120) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const stripTerminalFormatting = (value) => String(value ?? '')
  .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');

const semaphoreOutputText = (output) => {
  if (typeof output === 'string') return stripTerminalFormatting(output);
  const entries = Array.isArray(output) ? output : output?.output ?? [];
  const text = Array.isArray(entries)
    ? entries.map((entry) => typeof entry === 'string' ? entry : entry?.output ?? '').join('\n')
    : String(entries ?? '');
  return stripTerminalFormatting(text);
};

const extractMarkerJsonRecords = (text, marker) => {
  const records = [];
  let offset = 0;
  while (offset < text.length) {
    const markerIndex = text.indexOf(marker, offset);
    if (markerIndex < 0) break;
    const start = text.indexOf('{', markerIndex + marker.length);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}' && --depth === 0) { end = index + 1; break; }
    }
    if (end < 0) break;
    records.push(text.slice(start, end));
    offset = end;
  }
  return records;
};

const recordCandidates = (record) => {
  // Copying a wrapped log from Semaphore can place its visual timestamp on
  // every continuation line. Those labels are not part of Ansible's JSON.
  const withoutTimestamps = record.replace(
    /^[ \t]*\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\s+(?:AM|PM)[ \t]*/gmi,
    '',
  );
  return [
    record,
    withoutTimestamps,
    record.replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
    withoutTimestamps.replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
  ];
};

const parsedMarkerRecords = (output, marker) => {
  const parsed = [];
  for (const record of extractMarkerJsonRecords(semaphoreOutputText(output), marker)) {
    for (const candidate of recordCandidates(record)) {
      try {
        parsed.push(JSON.parse(candidate));
        break;
      } catch { /* Try the next supported log representation. */ }
    }
  }
  return parsed;
};

export const parseRakitTaskResult = (output, expectedAlias) => {
  const records = parsedMarkerRecords(output, 'RAKIT_RESULT_V1=');
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const result = records[index];
    if (result.host !== expectedAlias) continue;
    const updates = Number(result.updates);
    const security = Number(result.security);
    if (!Number.isInteger(updates) || updates < 0 || !Number.isInteger(security) || security < 0) continue;
    return {
      host: result.host,
      updates,
      security,
      rebootRequired: Boolean(result.rebootRequired),
      kernel: clampText(result.kernel, 120),
      uptimeSeconds: Number.isFinite(Number(result.uptimeSeconds)) ? Math.max(0, Math.floor(Number(result.uptimeSeconds))) : null,
    };
  }
  return null;
};

export const parseRakitHealthResult = (output, expectedAlias) => {
  const records = parsedMarkerRecords(output, 'RAKIT_HEALTH_V1=');
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const result = records[index];
    if (result.host !== expectedAlias) continue;
    const numeric = (value, maximum) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.min(maximum, Math.max(0, Math.floor(parsed))) : null;
    };
    return {
      host: result.host,
      kernel: clampText(result.kernel, 120),
      uptimeSeconds: numeric(result.uptimeSeconds, Number.MAX_SAFE_INTEGER),
      memoryMb: numeric(result.memoryMb, 100_000_000),
      processorVcpus: numeric(result.processorVcpus, 1_000_000),
      rootDiskPercent: numeric(result.rootDiskPercent, 100),
    };
  }
  return null;
};

export const parseRakitOperationResult = (output, expectedAlias, expectedAction) => {
  const records = parsedMarkerRecords(output, 'RAKIT_OPERATION_V1=');
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const result = records[index];
    if (result.host !== expectedAlias || result.action !== expectedAction) continue;
    return {
      host: result.host,
      action: result.action,
      changed: Boolean(result.changed),
      rebootRequired: result.rebootRequired == null ? null : Boolean(result.rebootRequired),
    };
  }
  return null;
};
