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

CREATE TABLE IF NOT EXISTS ipdash_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,
  host TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'proxy',
  site_id TEXT,
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(profile_id) REFERENCES ipdash_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY(scope_id) REFERENCES ipdash_scopes(id) ON DELETE CASCADE
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
