CREATE TABLE IF NOT EXISTS it_cabinet_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  location TEXT,
  zone TEXT,
  owner TEXT,
  status TEXT DEFAULT 'active',
  racks TEXT,
  rack_u INTEGER,
  ip_address TEXT,
  criticality TEXT DEFAULT 'standard',
  tags TEXT,
  last_service TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS trg_it_cabinet_assets_updated_at
AFTER UPDATE ON it_cabinet_assets
BEGIN
  UPDATE it_cabinet_assets SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS cabinets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  symbol TEXT,
  location TEXT,
  size_u INTEGER NOT NULL DEFAULT 42,
  numbering_direction TEXT NOT NULL DEFAULT 'bottom-up',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS trg_cabinets_updated_at
AFTER UPDATE ON cabinets
BEGIN
  UPDATE cabinets SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS cabinet_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL,
  device_type TEXT NOT NULL,
  model TEXT,
  height_u INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 1,
  port_aware INTEGER NOT NULL DEFAULT 0,
  number_of_ports INTEGER,
  ports_per_row INTEGER,
  management_ip TEXT,
  asset_tag TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  face TEXT NOT NULL DEFAULT 'front',
  rack_lane TEXT NOT NULL DEFAULT 'full',
  comment TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(cabinet_id) REFERENCES cabinets(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS trg_cabinet_devices_updated_at
AFTER UPDATE ON cabinet_devices
BEGIN
  UPDATE cabinet_devices SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS device_ports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL,
  port_number INTEGER NOT NULL,
  patch_panel TEXT,
  vlan TEXT,
  comment TEXT,
  ip_address TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(device_id) REFERENCES cabinet_devices(id) ON DELETE CASCADE,
  UNIQUE(device_id, port_number)
);

CREATE TRIGGER IF NOT EXISTS trg_device_ports_updated_at
AFTER UPDATE ON device_ports
BEGIN
  UPDATE device_ports SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS port_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_port_id INTEGER NOT NULL,
  destination_port_id INTEGER NOT NULL,
  tag TEXT,
  vlan TEXT,
  ip_address TEXT,
  linked_asset_id INTEGER,
  status TEXT NOT NULL DEFAULT 'connected',
  comment TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(source_port_id) REFERENCES device_ports(id) ON DELETE CASCADE,
  FOREIGN KEY(destination_port_id) REFERENCES device_ports(id) ON DELETE CASCADE,
  FOREIGN KEY(linked_asset_id) REFERENCES cabinet_devices(id) ON DELETE SET NULL,
  CHECK(source_port_id <> destination_port_id),
  UNIQUE(source_port_id),
  UNIQUE(destination_port_id)
);

CREATE TRIGGER IF NOT EXISTS trg_port_connections_updated_at
AFTER UPDATE ON port_connections
BEGIN
  UPDATE port_connections SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_port_connections_no_cross_reuse
BEFORE INSERT ON port_connections
WHEN EXISTS (
  SELECT 1 FROM port_connections
  WHERE source_port_id IN (NEW.source_port_id, NEW.destination_port_id)
     OR destination_port_id IN (NEW.source_port_id, NEW.destination_port_id)
)
BEGIN
  SELECT RAISE(ABORT, 'port already connected');
END;

CREATE TABLE IF NOT EXISTS wol_machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ip_address TEXT,
  mac_address TEXT NOT NULL UNIQUE,
  broadcast_address TEXT NOT NULL DEFAULT '255.255.255.255',
  port INTEGER NOT NULL DEFAULT 9,
  probe_port INTEGER,
  linked_device_id INTEGER,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_seen TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_device_id) REFERENCES cabinet_devices(id) ON DELETE SET NULL
);

CREATE TRIGGER IF NOT EXISTS trg_wol_machines_updated_at
AFTER UPDATE ON wol_machines
BEGIN
  UPDATE wol_machines SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS wol_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL,
  name TEXT,
  cron TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(machine_id) REFERENCES wol_machines(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS trg_wol_schedules_updated_at
AFTER UPDATE ON wol_schedules
BEGIN
  UPDATE wol_schedules SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL DEFAULT 'admin',
  action TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  details TEXT,
  result TEXT NOT NULL DEFAULT 'success',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at DESC);

CREATE TABLE IF NOT EXISTS ipdash_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,
  host TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'proxy',
  site_id TEXT,
  allow_self_signed INTEGER NOT NULL DEFAULT 0,
  api_key_encrypted TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS trg_ipdash_profiles_updated_at
AFTER UPDATE ON ipdash_profiles
BEGIN
  UPDATE ipdash_profiles SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS ipdash_scopes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  cidr TEXT NOT NULL,
  label TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(profile_id) REFERENCES ipdash_profiles(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS trg_ipdash_scopes_updated_at
AFTER UPDATE ON ipdash_scopes
BEGIN
  UPDATE ipdash_scopes SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS ipdash_scope_hosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  scope_id INTEGER NOT NULL,
  ip TEXT NOT NULL,
  name TEXT,
  hostname TEXT,
  mac TEXT,
  linked_device_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(profile_id) REFERENCES ipdash_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(scope_id) REFERENCES ipdash_scopes(id) ON DELETE CASCADE,
  FOREIGN KEY(linked_device_id) REFERENCES cabinet_devices(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scope_hosts_unique_ip ON ipdash_scope_hosts(scope_id, ip);

CREATE TRIGGER IF NOT EXISTS trg_ipdash_scope_hosts_updated_at
AFTER UPDATE ON ipdash_scope_hosts
BEGIN
  UPDATE ipdash_scope_hosts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS semaphore_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  api_url TEXT NOT NULL,
  ui_url TEXT NOT NULL,
  api_token_encrypted TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  inventory_id INTEGER NOT NULL,
  check_template_id INTEGER,
  update_template_id INTEGER,
  reboot_template_id INTEGER,
  health_template_id INTEGER,
  allow_self_signed INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  inventory_last_hash TEXT,
  inventory_last_synced_at TEXT,
  inventory_sync_state TEXT NOT NULL DEFAULT 'uninitialized',
  inventory_sync_error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  CHECK(inventory_sync_state IN ('uninitialized', 'synced', 'pending', 'conflict', 'failed'))
);

CREATE TRIGGER IF NOT EXISTS trg_semaphore_profiles_updated_at
AFTER UPDATE ON semaphore_profiles
BEGIN
  UPDATE semaphore_profiles SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE UNIQUE INDEX IF NOT EXISTS idx_semaphore_one_active_profile
ON semaphore_profiles(enabled) WHERE enabled = 1;

CREATE TABLE IF NOT EXISTS servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ansible_alias TEXT NOT NULL UNIQUE COLLATE NOCASE,
  hostname TEXT,
  primary_ip TEXT NOT NULL,
  ssh_port INTEGER NOT NULL DEFAULT 22,
  os_family TEXT NOT NULL DEFAULT 'linux',
  os_name TEXT,
  os_version TEXT,
  environment TEXT,
  role TEXT,
  location TEXT,
  cockpit_url TEXT,
  notes TEXT,
  linked_device_id INTEGER,
  ansible_enabled INTEGER NOT NULL DEFAULT 1,
  inventory_published_signature TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  health_checked_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(linked_device_id) REFERENCES cabinet_devices(id) ON DELETE SET NULL,
  CHECK(ssh_port BETWEEN 1 AND 65535),
  CHECK(status IN ('unknown', 'online', 'offline', 'error', 'maintenance'))
);

CREATE TRIGGER IF NOT EXISTS trg_servers_updated_at
AFTER UPDATE ON servers
BEGIN
  UPDATE servers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS server_network_status (
  server_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'unknown',
  checked_at TEXT,
  latency_ms INTEGER,
  detail TEXT,
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE,
  CHECK(status IN ('unknown', 'reachable', 'unreachable'))
);

CREATE TABLE IF NOT EXISTS server_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ansible_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT,
  color TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS trg_server_groups_updated_at
AFTER UPDATE ON server_groups
BEGIN
  UPDATE server_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS server_group_members (
  server_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(server_id, group_id),
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE,
  FOREIGN KEY(group_id) REFERENCES server_groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS server_update_status (
  server_id INTEGER PRIMARY KEY,
  updates_available INTEGER,
  security_updates INTEGER,
  reboot_required INTEGER,
  packages_json TEXT,
  kernel TEXT,
  uptime_seconds INTEGER,
  checked_at TEXT,
  check_result TEXT NOT NULL DEFAULT 'never',
  source_task_id INTEGER,
  last_update_at TEXT,
  last_update_result TEXT,
  last_update_task_id INTEGER,
  raw_result_json TEXT,
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE,
  CHECK(check_result IN ('never', 'ok', 'partial', 'failed', 'stale'))
);

CREATE TABLE IF NOT EXISTS server_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER,
  group_id INTEGER,
  action TEXT NOT NULL,
  semaphore_profile_id INTEGER NOT NULL,
  semaphore_template_id INTEGER NOT NULL,
  semaphore_task_id INTEGER,
  target_limit TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitting',
  requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT,
  result_summary TEXT,
  error_message TEXT,
  source TEXT NOT NULL DEFAULT 'rakit',
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE SET NULL,
  FOREIGN KEY(group_id) REFERENCES server_groups(id) ON DELETE SET NULL,
  FOREIGN KEY(semaphore_profile_id) REFERENCES semaphore_profiles(id) ON DELETE RESTRICT,
  CHECK(action IN ('check_updates', 'update_packages', 'reboot', 'health_check')),
  CHECK(status IN ('submitting', 'queued', 'running', 'success', 'failed', 'stopped', 'unknown'))
);

CREATE INDEX IF NOT EXISTS idx_server_actions_server_requested
ON server_actions(server_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS semaphore_task_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semaphore_profile_id INTEGER NOT NULL,
  semaphore_task_id INTEGER NOT NULL,
  schedule_id INTEGER NOT NULL,
  semaphore_template_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(semaphore_profile_id) REFERENCES semaphore_profiles(id) ON DELETE CASCADE,
  UNIQUE(semaphore_profile_id, semaphore_task_id)
);
