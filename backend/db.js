import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

process.umask(0o077);
const dbFile = process.env.DB_FILE || '/data/rakit_db.sqlite';
const resolvedDbFile = path.resolve(dbFile);
fs.mkdirSync(path.dirname(resolvedDbFile), { recursive: true, mode: 0o700 });

const db = new Database(resolvedDbFile);
const restrictDatabasePermissions = (file, required = false) => {
  try {
    fs.chmodSync(file, 0o600);
  } catch (error) {
    if (required || error?.code !== 'ENOENT') {
      console.warn(`[Database] Could not restrict permissions on ${file}: ${error?.message || error}`);
    }
  }
};
restrictDatabasePermissions(resolvedDbFile, true);
db.pragma('journal_mode = WAL');
restrictDatabasePermissions(`${resolvedDbFile}-wal`);
restrictDatabasePermissions(`${resolvedDbFile}-shm`);
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
db.exec(schema);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info('${table}')`).all();
  if (!columns.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const profileColumns = db.prepare("PRAGMA table_info('ipdash_profiles')").all();
if (!profileColumns.some((col) => col.name === 'site_id')) {
  db.exec('ALTER TABLE ipdash_profiles ADD COLUMN site_id TEXT');
}
ensureColumn('ipdash_profiles', 'allow_self_signed', 'INTEGER NOT NULL DEFAULT 0');

ensureColumn('cabinet_devices', 'port_aware', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('cabinet_devices', 'number_of_ports', 'INTEGER');
ensureColumn('cabinet_devices', 'ports_per_row', 'INTEGER');
ensureColumn('cabinet_devices', 'management_ip', 'TEXT');
ensureColumn('cabinet_devices', 'asset_tag', 'TEXT');
ensureColumn('cabinet_devices', 'status', "TEXT NOT NULL DEFAULT 'unknown'");
ensureColumn('cabinet_devices', 'face', "TEXT NOT NULL DEFAULT 'front'");
ensureColumn('cabinet_devices', 'rack_lane', "TEXT NOT NULL DEFAULT 'full'");
ensureColumn('cabinets', 'numbering_direction', "TEXT NOT NULL DEFAULT 'bottom-up'");
ensureColumn('wol_machines', 'probe_port', 'INTEGER');
ensureColumn('ipdash_scope_hosts', 'linked_device_id', 'INTEGER REFERENCES cabinet_devices(id) ON DELETE SET NULL');

const hasDevicePorts = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='device_ports'")
  .get();
if (!hasDevicePorts) {
  db.exec(`
    CREATE TABLE device_ports (
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
  `);
}

// Production databases intentionally start empty. Example data belongs only in UI mockups.
export default db;
