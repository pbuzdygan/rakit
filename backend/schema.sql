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
