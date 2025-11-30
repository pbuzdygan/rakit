import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbFile = process.env.DB_FILE || '/data/rakit_db.sqlite';
const resolvedDbFile = path.resolve(dbFile);
fs.mkdirSync(path.dirname(resolvedDbFile), { recursive: true });

const db = new Database(resolvedDbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
db.exec(schema);

const profileColumns = db.prepare("PRAGMA table_info('ipdash_profiles')").all();
if (!profileColumns.some((col) => col.name === 'site_id')) {
  db.exec('ALTER TABLE ipdash_profiles ADD COLUMN site_id TEXT');
}

function seedTable(table, rows, insertSql) {
  const count = db.prepare(`SELECT COUNT(1) AS c FROM ${table}`).get().c;
  if (count > 0) return;
  const stmt = db.prepare(insertSql);
  const tx = db.transaction((data) => {
    for (const row of data) stmt.run(row);
  });
  tx(rows);
}

seedTable(
  'cabinets',
  [
    { name: 'Edge Rack A', symbol: 'EDGE-A', location: 'Core room', size_u: 42 },
    { name: 'Lab Rack', symbol: 'LAB-1', location: 'R&D loft', size_u: 24 },
  ],
  `INSERT INTO cabinets(name, symbol, location, size_u) VALUES (@name, @symbol, @location, @size_u)`
);

// Seed cabinet devices if table empty
const deviceCount = db.prepare('SELECT COUNT(1) AS c FROM cabinet_devices').get().c;
if (deviceCount === 0) {
  const cabinets = db.prepare('SELECT id, symbol FROM cabinets').all();
  const findBySymbol = (symbol) => cabinets.find((c) => c.symbol === symbol);
  const seedDevices = [
    { cabinet: 'EDGE-A', device_type: 'Firewall', model: 'FortiGate 600E', height_u: 2, position: 1, comment: 'Inline with ISP' },
    { cabinet: 'EDGE-A', device_type: 'Compute Node', model: 'DL360 Gen11', height_u: 1, position: 3, comment: null },
    { cabinet: 'EDGE-A', device_type: 'Storage Shelf', model: 'SynCore 12B', height_u: 4, position: 6, comment: 'RAIDZ2' },
    { cabinet: 'LAB-1', device_type: 'Mini Cluster', model: 'NUC swarm', height_u: 3, position: 2, comment: null },
  ].map((device) => ({
    ...device,
    cabinet_id: findBySymbol(device.cabinet)?.id ?? null,
  })).filter((d) => d.cabinet_id);

  if (seedDevices.length) {
    const stmt = db.prepare(
      `INSERT INTO cabinet_devices(cabinet_id, device_type, model, height_u, position, comment)
       VALUES (@cabinet_id, @device_type, @model, @height_u, @position, @comment)`
    );
    const tx = db.transaction((rows) => {
      for (const row of rows) stmt.run(row);
    });
    tx(seedDevices);
  }
}

export default db;
