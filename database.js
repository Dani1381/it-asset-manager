// database.js - SQLite persistence layer using Node.js built-in node:sqlite
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

// Password hashing (scrypt, no dependencies). Stored as "scrypt$<salt>$<hash>".
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(plain, stored) {
  if (!stored) return false;
  if (!String(stored).startsWith('scrypt$')) {
    // legacy plain-text password (upgraded to a hash on next successful login)
    const a = Buffer.from(String(plain));
    const b = Buffer.from(String(stored));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const [, salt, hash] = String(stored).split('$');
  const test = crypto.scryptSync(String(plain), salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === test.length && crypto.timingSafeEqual(known, test);
}

const DB_PATH = path.join(__dirname, 'inventory.db');
const BACKUPS_DIR = path.join(__dirname, 'backups');

// Auto-recovery: if main database is missing or empty, restore from the newest snapshot
function autoRecoverIfMissing() {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }
    const dbMissingOrEmpty = !fs.existsSync(DB_PATH) || fs.statSync(DB_PATH).size === 0;
    if (dbMissingOrEmpty) {
      const backupFiles = fs.readdirSync(BACKUPS_DIR)
        .filter(f => f.startsWith('inventory_') && f.endsWith('.db'))
        .map(f => ({ name: f, path: path.join(BACKUPS_DIR, f), mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

      if (backupFiles.length > 0) {
        console.warn(`[DATA RECOVERY] Main database missing or empty! Restoring from snapshot: ${backupFiles[0].name}`);
        fs.copyFileSync(backupFiles[0].path, DB_PATH);
      }
    }
  } catch (err) {
    console.error('[DATA RECOVERY] Check failed:', err.message);
  }
}

autoRecoverIfMissing();

// Ensure database connection
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode, NORMAL synchronous, and foreign keys for high durability and crash-safety
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA foreign_keys = ON;');

// WAL checkpoint helper - flushes unwritten WAL blocks into main .db file
function checkpointDb() {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (e) {
    console.warn('[DB] WAL checkpoint warning:', e.message);
  }
}

// Automatic Snapshot Backup
function createAutomaticBackup(tag = 'auto') {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }
    // Flush WAL first so the snapshot has all recent data
    checkpointDb();

    if (!fs.existsSync(DB_PATH) || fs.statSync(DB_PATH).size === 0) return null;

    const d = new Date();
    const dateStr = d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFile = path.join(BACKUPS_DIR, `inventory_${tag}_${dateStr}.db`);
    fs.copyFileSync(DB_PATH, backupFile);

    // Keep the latest 50 backups, clean older ones
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith('inventory_') && f.endsWith('.db'))
      .map(f => ({ name: f, path: path.join(BACKUPS_DIR, f), mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > 50) {
      files.slice(50).forEach(f => {
        try { fs.unlinkSync(f.path); } catch (e) {}
      });
    }

    return { file: backupFile, filename: path.basename(backupFile), total: files.length };
  } catch (err) {
    console.error('[DB] Automatic backup failed:', err.message);
    return null;
  }
}

// Debounced backup on data changes
let backupDebounceTimer = null;
function scheduleBackup() {
  if (backupDebounceTimer) clearTimeout(backupDebounceTimer);
  backupDebounceTimer = setTimeout(() => {
    createAutomaticBackup('change');
  }, 2000);
}

// Database integrity check
function checkDbIntegrity() {
  try {
    const res = db.prepare('PRAGMA integrity_check;').get();
    return res && (res.integrity_check === 'ok' || Object.values(res)[0] === 'ok');
  } catch (e) {
    return false;
  }
}

// Initialize tables
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL DEFAULT 'PC',
      status TEXT NOT NULL DEFAULT 'active',
      user_name TEXT,
      computer_name TEXT,
      manufacturer_model TEXT,
      serial_number TEXT,
      os_version TEXT,
      ip_address TEXT,
      cpu TEXT,
      ram TEXT,
      storage_drives TEXT,
      c_space TEXT,
      network_devices TEXT,
      gpu TEXT,
      monitors TEXT,
      location TEXT,
      department TEXT,
      purchase_date TEXT,
      notes TEXT,
      is_automated INTEGER DEFAULT 0,
      last_scanned_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_assets_prop_id ON assets(property_id);
    CREATE INDEX IF NOT EXISTS idx_assets_serial ON assets(serial_number);
    CREATE INDEX IF NOT EXISTS idx_assets_comp_name ON assets(computer_name);
    CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
    CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category);

    CREATE TABLE IF NOT EXISTS asset_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      original_name TEXT,
      caption TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_photos_asset_id ON asset_photos(asset_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL DEFAULT 'INFO',
      source TEXT NOT NULL DEFAULT 'SYSTEM',
      message TEXT NOT NULL,
      details TEXT,
      ip TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      category TEXT NOT NULL,
      user_name TEXT,
      computer_name TEXT,
      manufacturer_model TEXT,
      serial_number TEXT,
      os_version TEXT,
      ip_address TEXT,
      cpu TEXT,
      ram TEXT,
      storage_drives TEXT,
      c_space TEXT,
      gpu TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pending_scans_status ON pending_scans(status);

    -- Photo intake queue: photos taken now, AI-processed in the background, reviewed and approved later
    CREATE TABLE IF NOT EXISTS photo_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'queued',
      photo_files TEXT NOT NULL,
      form TEXT,
      result TEXT,
      error TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_at TEXT NOT NULL
    );
  `);

  // Default settings
  const checkSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  
  insertSetting.run('company_name', 'مدیریت دارایی ارکا (Arka Asset Management)');
  insertSetting.run('asset_tag_prefix', 'AST-');
  insertSetting.run('bale_token', '');
  insertSetting.run('bale_chat_id', '');
  insertSetting.run('gemini_api_key', '');
  insertSetting.run('gemini_model', 'gemini-3.6-flash');
  // Which photo is shown first on the dashboard / detail page:
  // camera = phone photos first, newest = most recent upload first, stock = catalog images first
  insertSetting.run('photo_priority', 'camera');

  // Migration: disk health reported by the network scanners
  const assetCols = db.prepare('PRAGMA table_info(assets)').all().map(c => c.name);
  if (!assetCols.includes('disk_health')) db.exec('ALTER TABLE assets ADD COLUMN disk_health TEXT');
  if (!assetCols.includes('disk_health_status')) db.exec('ALTER TABLE assets ADD COLUMN disk_health_status TEXT');
  // Items that have no physical property tag get an internal code (NT-0001...) and no_tag = 1
  if (!assetCols.includes('no_tag')) db.exec('ALTER TABLE assets ADD COLUMN no_tag INTEGER NOT NULL DEFAULT 0');
  // Physical condition set by the operator (default healthy) — values in HEALTH_VALUES
  if (!assetCols.includes('health')) db.exec("ALTER TABLE assets ADD COLUMN health TEXT NOT NULL DEFAULT 'healthy'");
  migrateModelNames();
  // Placeholder specs like "N/A (monitor, no CPU)" were saved by older AI lookups; they are not data
  for (const col of SPEC_PLACEHOLDER_FIELDS) {
    db.exec(`UPDATE assets SET ${col} = NULL WHERE UPPER(TRIM(${col})) IN ('N/A', 'NA') OR UPPER(TRIM(${col})) LIKE 'N/A (%'`);
  }
  const pendingCols = db.prepare('PRAGMA table_info(pending_scans)').all().map(c => c.name);
  if (!pendingCols.includes('disk_health')) db.exec('ALTER TABLE pending_scans ADD COLUMN disk_health TEXT');
  // Where a scan came from ('usb-kit' = flash-drive kit, those devices go to storage on approval)
  if (!pendingCols.includes('source')) db.exec('ALTER TABLE pending_scans ADD COLUMN source TEXT');
  // Property number typed in the scanner popups (computer and each monitor); prefilled on approval
  if (!pendingCols.includes('property_id')) db.exec('ALTER TABLE pending_scans ADD COLUMN property_id TEXT');

  // Migration: manual "cover photo" flag per asset
  const photoCols = db.prepare('PRAGMA table_info(asset_photos)').all().map(c => c.name);
  if (!photoCols.includes('is_primary')) {
    db.exec('ALTER TABLE asset_photos ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0');
  }

  // Default Users (Admin & Viewer)
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const now = new Date().toISOString();
    const insertUser = db.prepare('INSERT INTO users (username, password, full_name, role, created_at) VALUES (?, ?, ?, ?, ?)');
    insertUser.run('admin', hashPassword('admin'), 'مدیر سیستم ارکا', 'admin', now);
    insertUser.run('viewer', hashPassword('123'), 'کاربر بیننده (میهمان)', 'viewer', now);
  }

  // Migration: hash any passwords still stored as plain text
  const plainUsers = db.prepare("SELECT id, password FROM users WHERE password NOT LIKE 'scrypt$%'").all();
  for (const u of plainUsers) {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(u.password), u.id);
  }
}

// Internal code for items without a physical property tag: NT-0001, NT-0002 ...
const NO_TAG_PREFIX = 'NT-';
function getNextNoTagId() {
  const rows = db.prepare('SELECT property_id FROM assets WHERE property_id LIKE ?').all(`${NO_TAG_PREFIX}%`);
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.property_id).slice(NO_TAG_PREFIX.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${NO_TAG_PREFIX}${String(max + 1).padStart(4, '0')}`;
}

function isTruthyFlag(v) {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
}

// ---------------------------------------------------------------------------
// Model name normalisation: one spelling per model, so the same device always
// matches (photos, specs, suggestions). "Dell Inc. Precision Tower 3420" ->
// "Dell Precision Tower 3420", "HP HP EliteDesk" -> "HP EliteDesk",
// "c24f390" -> "Samsung C24F390", "Samsung LS22F355HN (Model Code: ...)" -> "Samsung S22F355HN".
// ---------------------------------------------------------------------------
const BRAND_CANON = [
  [/^hewlett[\s-]*packard(\s+enterprise)?$/i, 'HP'], [/^hpe?$/i, m => m.toUpperCase()],
  [/^dell(\s+inc\.?)?$/i, 'Dell'], [/^lenovo$/i, 'Lenovo'], [/^samsung(\s+electronics)?$/i, 'Samsung'],
  [/^lg(\s+electronics)?$/i, 'LG'], [/^asus(tek)?$/i, 'ASUS'], [/^acer$/i, 'Acer'], [/^benq$/i, 'BenQ'],
  [/^philips$/i, 'Philips'], [/^viewsonic$/i, 'ViewSonic'], [/^aoc$/i, 'AOC'], [/^msi$/i, 'MSI'],
  [/^gigabyte$/i, 'Gigabyte'], [/^apple$/i, 'Apple'], [/^canon$/i, 'Canon'], [/^epson$/i, 'Epson'],
  [/^tp-?link$/i, 'TP-Link'], [/^d-?link$/i, 'D-Link'], [/^mikrotik$/i, 'MikroTik'], [/^cisco$/i, 'Cisco'],
  [/^huawei$/i, 'Huawei'], [/^apc$/i, 'APC'], [/^western\s+digital|^wd$/i, 'WD'], [/^seagate$/i, 'Seagate'],
  [/^kingston$/i, 'Kingston'], [/^adata$/i, 'ADATA'], [/^toshiba$/i, 'Toshiba'], [/^fujitsu$/i, 'Fujitsu'],
  [/^microsoft$/i, 'Microsoft'], [/^logitech$/i, 'Logitech'], [/^hikvision$/i, 'Hikvision'], [/^dahua$/i, 'Dahua'],
  [/^ubiquiti$/i, 'Ubiquiti'], [/^grandstream$/i, 'Grandstream'], [/^yealink$/i, 'Yealink'], [/^panasonic$/i, 'Panasonic'],
  [/^xerox$/i, 'Xerox'], [/^brother$/i, 'Brother'], [/^kyocera$/i, 'Kyocera'], [/^ricoh$/i, 'Ricoh'], [/^sony$/i, 'Sony']
];
const BRAND_WORDS = /^(hewlett[\s-]*packard(\s+enterprise)?|hpe?|dell|lenovo|samsung|lg|asus|acer|benq|philips|viewsonic|aoc|msi|gigabyte|apple|canon|epson|tp-?link|d-?link|mikrotik|cisco|huawei|apc|wd|western\s+digital|seagate|kingston|adata|toshiba|fujitsu|microsoft|logitech|hikvision|dahua|ubiquiti|grandstream|yealink|panasonic|xerox|brother|kyocera|ricoh|sony)\b/i;
const COMPANY_SUFFIX = /\b(inc\.?|corp\.?|corporation|co\.,?\s*ltd\.?|ltd\.?|limited|gmbh|electronics)(?=\s|$)/gi;

function canonBrand(word) {
  for (const [re, out] of BRAND_CANON) if (re.test(word)) return typeof out === 'function' ? out(word) : out;
  return word;
}

function canonicalModelName(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  // Bracketed extras: "(Model Code: LS22F355HNMCHD)", "(Part No ...)", "(1TB)" stays only if it is not a code note
  s = s.replace(/\s*[\(\[]\s*(model\s*(code|no\.?|number)?|part\s*(no\.?|number)|p\/n|sku|type)\s*[:#]?[^\)\]]*[\)\]]/gi, '').trim();
  s = s.replace(COMPANY_SUFFIX, '').replace(/\s+/g, ' ').trim();

  // Brand at the start: canonical spelling, and drop a repeated brand ("HP HP ...", "Hewlett-Packard HP ...")
  const m = s.match(BRAND_WORDS);
  if (m) {
    const brand = canonBrand(m[1]);
    let rest = s.slice(m[0].length).trim();
    const again = rest.match(BRAND_WORDS);
    if (again && canonBrand(again[1]) === brand) rest = rest.slice(again[0].length).trim();
    s = rest ? `${brand} ${rest}` : brand;
  }

  // Samsung monitor codes: brand is often missing, sales codes carry an "L" prefix ("LS22F355HN" = "S22F355HN")
  const samsungCode = /^L?([SCU]\d{2}[A-Z]\d{2,3}[A-Za-z]{0,3})(?:[A-Z]{4})?$/;
  const parts = s.split(' ');
  const brandless = !BRAND_WORDS.test(s);
  const codeIdx = parts.findIndex(p => samsungCode.test(p.toUpperCase().replace(/X$/, 'x')));
  if (codeIdx >= 0 && (brandless ? parts.length === 1 : /^samsung$/i.test(parts[0]))) {
    const code = parts[codeIdx];
    const upper = code.replace(/[a-wyz]/g, c => c.toUpperCase()); // keep a trailing wildcard "x"
    parts[codeIdx] = upper.replace(samsungCode, '$1');
    s = (brandless ? ['Samsung', ...parts] : parts).join(' ');
  }

  // Model codes typed in lower case ("c24f390") -> upper case; mixed case is left alone
  s = s.split(' ').map(w => (/\d/.test(w) && /[a-z]/.test(w) && w === w.toLowerCase() && w.length > 3) ? w.toUpperCase() : w).join(' ');
  return s.slice(0, 120);
}

// Same model already stored under another spelling? Use the stored one.
function matchExistingModelName(name) {
  const key = compactText(name);
  if (key.length < 3) return name;
  const rows = db.prepare(`SELECT manufacturer_model AS m, COUNT(*) AS n FROM assets
    WHERE manufacturer_model IS NOT NULL AND TRIM(manufacturer_model) != '' GROUP BY manufacturer_model ORDER BY n DESC`).all();
  const hit = rows.find(r => compactText(r.m) === key);
  return hit ? hit.m : name;
}

function normalizeModelName(raw) {
  const c = canonicalModelName(raw);
  return c ? matchExistingModelName(c) : c;
}

// One-time clean-up of names stored before the normaliser existed (backup taken first)
function migrateModelNames() {
  const done = db.prepare("SELECT value FROM settings WHERE key = 'model_names_normalized_v1'").get();
  if (done) return;
  const rows = db.prepare("SELECT DISTINCT manufacturer_model AS m FROM assets WHERE manufacturer_model IS NOT NULL AND TRIM(manufacturer_model) != ''").all();
  const changes = rows.map(r => [r.m, canonicalModelName(r.m)]).filter(([a, b]) => b && a !== b);
  if (changes.length) {
    try {
      const dir = path.join(__dirname, 'backups');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `inventory_before_model_names_${Date.now()}.db`).replace(/'/g, "''");
      db.exec(`VACUUM INTO '${file}'`);
    } catch (e) {
      console.error('Model name migration skipped: backup failed', e.message);
      return;
    }
    const upd = db.prepare('UPDATE assets SET manufacturer_model = ? WHERE manufacturer_model = ?');
    for (const [from, to] of changes) {
      upd.run(to, from);
      console.log(`[model names] "${from}" -> "${to}"`);
    }
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('model_names_normalized_v1', ?)").run(String(changes.length));
}

// Property number typed in a scanner popup: Latin digits, no spaces; empty / "none" = no tag
function cleanPropertyId(v) {
  const s = String(v ?? '').replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();
  if (!s || /^(-|none|no|nadaare|nadare|ندارد|0)$/i.test(s)) return null;
  return s.replace(/\s+/g, '').slice(0, 40);
}

const SPEC_PLACEHOLDER_FIELDS = ['cpu', 'ram', 'storage_drives', 'gpu', 'monitors', 'network_devices'];
function stripSpecPlaceholders(data) {
  for (const f of SPEC_PLACEHOLDER_FIELDS) {
    if (typeof data[f] === 'string' && /^\s*n\/?a\b/i.test(data[f])) data[f] = '';
  }
}

const HEALTH_VALUES = ['healthy', 'initial_ok', 'minor_issue', 'needs_check', 'untested', 'broken'];
function normalizeHealth(v, fallback = 'healthy') {
  const t = String(v || '').trim().toLowerCase();
  return HEALTH_VALUES.includes(t) ? t : fallback;
}

// ---------------------------------------------------------------------------
// Fuzzy model search ("as you type" suggestions from models already in the DB)
// ---------------------------------------------------------------------------
function compactText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');
}

function wordTokens(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9؀-ۿ]+/).filter(Boolean);
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

function diceSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) if (B.has(g)) inter += Math.min(n, B.get(g));
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

// 0..1 — how well a stored model name matches what the user is typing
function modelMatchScore(query, model) {
  const q = compactText(query);
  const m = compactText(model);
  if (!q || !m) return 0;
  if (q === m) return 1;

  let score = 0;
  if (m.startsWith(q)) score = Math.max(score, 0.9);
  else if (m.includes(q)) score = Math.max(score, 0.8);

  // Every typed word found in the model (prefix match per word, order free)
  const qTok = wordTokens(query);
  const mTok = wordTokens(model);
  if (qTok.length) {
    let hit = 0;
    for (const t of qTok) {
      if (mTok.some(w => w.startsWith(t) || (t.length >= 3 && w.includes(t)))) hit += 1;
      else if (t.length >= 3 && mTok.some(w => diceSimilarity(t, w) >= 0.6)) hit += 0.6;
    }
    score = Math.max(score, 0.75 * (hit / qTok.length));
  }

  // Typos / missing letters ("s27c31" vs "s27c310")
  score = Math.max(score, 0.85 * diceSimilarity(q, m));
  return Math.min(1, score);
}

function searchModels(query, category = null, limit = 8) {
  const q = String(query || '').trim();
  if (compactText(q).length < 2) return [];

  const rows = db.prepare(`
    SELECT a.manufacturer_model AS model, a.category,
           COUNT(*) AS count, MAX(a.updated_at) AS last_used,
           MIN(a.property_id) AS sample_property_id,
           (SELECT p.file_name FROM asset_photos p JOIN assets b ON b.id = p.asset_id
             WHERE LOWER(TRIM(b.manufacturer_model)) = LOWER(TRIM(a.manufacturer_model))
             ORDER BY CASE WHEN p.file_name LIKE 'asset\\_%' ESCAPE '\\' OR p.file_name LIKE 'photo\\_%' ESCAPE '\\' THEN 0 ELSE 1 END, p.id DESC
             LIMIT 1) AS photo
    FROM assets a
    WHERE a.manufacturer_model IS NOT NULL AND TRIM(a.manufacturer_model) != ''
    GROUP BY LOWER(TRIM(a.manufacturer_model)), a.category
  `).all();

  const scored = [];
  for (const r of rows) {
    let s = modelMatchScore(q, r.model);
    if (s < 0.4) continue;
    if (category && r.category === category) s += 0.05;
    scored.push({ ...r, score: Math.round(Math.min(1, s) * 100) / 100 });
  }
  scored.sort((a, b) => b.score - a.score || b.count - a.count || String(b.last_used).localeCompare(String(a.last_used)));
  return scored.slice(0, limit).map(r => ({
    model: r.model,
    category: r.category,
    count: r.count,
    sample_property_id: r.sample_property_id,
    photo_url: r.photo ? `/uploads/${r.photo}` : null,
    score: r.score
  }));
}

// ---------------------------------------------------------------------------
// Same-model spec reuse
// Monitors, drives, printers, network gear ... are identical for the same model,
// so a new item of an already-known model inherits the most complete spec set.
// Computers (PC / Laptop / Server) differ per unit, so they are only suggested.
// ---------------------------------------------------------------------------
const FIXED_SPEC_CATEGORIES = new Set(['Monitor', 'Storage', 'Printer', 'Modem', 'Router', 'Access Point', 'Network',
  'UPS', 'VoIP Phone', 'Camera', 'Projector', 'Tablet', 'Peripheral']);
const MODEL_SPEC_FIELDS = ['cpu', 'ram', 'storage_drives', 'gpu', 'monitors', 'network_devices'];

function isFixedSpecCategory(category) {
  return FIXED_SPEC_CATEGORIES.has(String(category || '').trim());
}

function normModelKey(model) {
  return String(model || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isMeaningful(v) {
  if (v === null || v === undefined) return false;
  const t = String(v).trim().toLowerCase();
  return t !== '' && !['-', '.', 'unknown', 'n/a', 'na', 'null', 'default display', 'standard graphics', 'internal storage'].includes(t);
}

// A spec value that only repeats the model name (e.g. monitors = "Samsung S24R350") carries no information
function hasSpecValue(record, field) {
  const v = record[field];
  if (!isMeaningful(v)) return false;
  return normModelKey(v) !== normModelKey(record.manufacturer_model);
}

// The most complete record of this exact model (optionally excluding one asset)
function getModelSpecTemplate(model, category = null, excludeId = null) {
  const key = normModelKey(model);
  if (key.length < 3) return null;
  const rows = db.prepare(`
    SELECT * FROM assets
    WHERE manufacturer_model IS NOT NULL AND LOWER(TRIM(manufacturer_model)) LIKE ?
  `).all(`%${key.split(' ')[0]}%`);

  let best = null;
  let bestScore = 0;
  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue;
    if (normModelKey(r.manufacturer_model) !== key) continue;
    if (category && r.category && r.category !== category) continue;
    const score = MODEL_SPEC_FIELDS.filter(f => hasSpecValue(r, f)).length;
    if (score > bestScore || (score === bestScore && best && score > 0 && String(r.updated_at) > String(best.updated_at))) {
      best = r;
      bestScore = score;
    }
  }
  if (!best || bestScore === 0) return null;

  const fields = {};
  for (const f of MODEL_SPEC_FIELDS) if (hasSpecValue(best, f)) fields[f] = best[f];
  return {
    source_id: best.id,
    property_id: best.property_id,
    model: best.manufacturer_model,
    category: best.category,
    fields,
    filled_count: bestScore
  };
}

// Fill only the empty spec fields of `data` from the template (fixed-spec categories)
// Computers of the same model share CPU and GPU; RAM / disks differ per unit and are never copied
const SAME_MODEL_COMPUTER_FIELDS = ['cpu', 'gpu'];

function fillFromModelTemplate(data) {
  if (!data || !data.manufacturer_model) return null;
  const fixed = isFixedSpecCategory(data.category);
  const tpl = getModelSpecTemplate(data.manufacturer_model, fixed ? data.category : null);
  if (!tpl) return null;
  const copied = [];
  for (const [f, v] of Object.entries(tpl.fields)) {
    if (!fixed && !SAME_MODEL_COMPUTER_FIELDS.includes(f)) continue;
    if (!hasSpecValue(data, f)) {
      data[f] = v;
      copied.push(f);
    }
  }
  return copied.length ? { property_id: tpl.property_id, fields: copied } : null;
}

// Generate the next property ID (e.g. AST-0001, AST-0002)
function getNextPropertyId() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('asset_tag_prefix');
  const prefix = (row && row.value) ? row.value : 'AST-';

  const lastAsset = db.prepare(`
    SELECT property_id FROM assets 
    WHERE property_id LIKE ? 
    ORDER BY id DESC LIMIT 1
  `).get(`${prefix}%`);

  if (!lastAsset || !lastAsset.property_id) {
    return `${prefix}0001`;
  }

  const numPart = lastAsset.property_id.replace(prefix, '');
  const parsed = parseInt(numPart, 10);
  if (isNaN(parsed)) {
    return `${prefix}${Date.now().toString().slice(-4)}`;
  }
  const nextNum = (parsed + 1).toString().padStart(4, '0');
  return `${prefix}${nextNum}`;
}

// Photo ordering — decides which photo becomes the cover image.
// 1) a photo manually marked as cover always wins
// 2) then the global "photo_priority" setting
const CAMERA_PHOTO_SQL = (a) => `(${a}file_name LIKE 'asset\\_%' ESCAPE '\\' OR ${a}file_name LIKE 'photo\\_%' ESCAPE '\\')`;
const PHOTO_PRIORITIES = ['camera', 'newest', 'stock'];

function getPhotoPriority() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'photo_priority'").get();
    return row && PHOTO_PRIORITIES.includes(row.value) ? row.value : 'camera';
  } catch (e) {
    return 'camera';
  }
}

function photoOrderSql(alias = '') {
  const a = alias ? `${alias}.` : '';
  const isCamera = CAMERA_PHOTO_SQL(a);
  const base = `COALESCE(${a}is_primary, 0) DESC`;
  switch (getPhotoPriority()) {
    case 'newest':
      return `${base}, ${a}id DESC`;
    case 'stock':
      return `${base}, CASE WHEN ${isCamera} THEN 1 ELSE 0 END, ${a}id ASC`;
    case 'camera':
    default:
      // phone photos first; among them the most recent shot is shown
      return `${base}, CASE WHEN ${isCamera} THEN 0 ELSE 1 END, ${a}id DESC`;
  }
}

// ---------------------------------------------------------------------------
// Disk health (SMART) normalisation
// Scanners send an array of drives; we clean every field, rate each drive
// (ok / warning / critical / unknown) and keep the worst as the asset status.
// ---------------------------------------------------------------------------
const HEALTH_RANK = { unknown: 0, ok: 1, warning: 2, critical: 3 };

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toBool(v) {
  if (v === true || v === false) return v;
  if (v === null || v === undefined || v === '') return null;
  const t = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'passed', 'pass', 'ok'].includes(t)) return true;
  if (['false', '0', 'no', 'failed', 'fail'].includes(t)) return false;
  return null;
}

function cleanText(v, max = 80) {
  if (v === null || v === undefined) return null;
  const t = String(v).replace(/[\u0000-\u001f]/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

function rateDisk(d) {
  const reasons = [];
  const status = (d.health_status || '').toLowerCase();
  let level = 'unknown';
  const hasData = d.health_percent !== null || d.smart_passed !== null || d.predict_failure !== null ||
    (status && status !== 'unknown') || d.reallocated_sectors !== null || d.temperature_c !== null;
  if (hasData) level = 'ok';

  const bump = (lvl, why) => {
    if (HEALTH_RANK[lvl] > HEALTH_RANK[level]) level = lvl;
    reasons.push(why);
  };

  if (d.predict_failure === true) bump('critical', 'SMART predicts imminent failure');
  if (d.smart_passed === false) bump('critical', 'SMART self-assessment failed');
  if (['unhealthy', 'failed', 'pred fail', 'bad'].includes(status)) bump('critical', `Health status: ${d.health_status}`);
  else if (['warning', 'degraded', 'caution'].includes(status)) bump('warning', `Health status: ${d.health_status}`);

  if (d.health_percent !== null) {
    if (d.health_percent <= 30) bump('critical', `Remaining life ${d.health_percent}%`);
    else if (d.health_percent <= 70) bump('warning', `Remaining life ${d.health_percent}%`);
  }
  if (d.pending_sectors > 0) bump('warning', `${d.pending_sectors} pending sectors`);
  if (d.reallocated_sectors > 0) bump(d.reallocated_sectors > 100 ? 'critical' : 'warning', `${d.reallocated_sectors} reallocated sectors`);
  if (d.uncorrectable_errors > 0) bump('warning', `${d.uncorrectable_errors} uncorrectable errors`);
  if (d.media_errors > 0) bump('warning', `${d.media_errors} media errors`);
  if (d.temperature_c !== null && d.temperature_c >= 60) bump('warning', `High temperature ${d.temperature_c}°C`);

  return { level, reasons };
}

function normalizeDiskHealth(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch (e) { return null; }
  }
  if (list && !Array.isArray(list) && Array.isArray(list.disks)) list = list.disks; // already normalised
  if (list && !Array.isArray(list)) list = [list];
  if (!Array.isArray(list) || list.length === 0) return null;

  const disks = list.slice(0, 16).filter(d => d && typeof d === 'object').map(d => {
    let pct = toNum(d.health_percent ?? d.healthPercent);
    if (pct === null) {
      const wear = toNum(d.wear_percent ?? d.wear ?? d.percentage_used);
      if (wear !== null) pct = 100 - wear;
    }
    if (pct !== null) pct = Math.max(0, Math.min(100, Math.round(pct)));
    const disk = {
      model: cleanText(d.model || d.name, 80) || 'Disk',
      serial: cleanText(d.serial, 40),
      type: cleanText(d.type || d.media_type || d.mediaType, 12),
      bus: cleanText(d.bus || d.bus_type || d.busType, 12),
      size_gb: toNum(d.size_gb ?? d.sizeGB),
      health_status: cleanText(d.health_status ?? d.healthStatus ?? d.status, 20),
      health_percent: pct,
      smart_passed: toBool(d.smart_passed ?? d.smartPassed),
      predict_failure: toBool(d.predict_failure ?? d.predictFailure),
      temperature_c: toNum(d.temperature_c ?? d.temperature),
      power_on_hours: toNum(d.power_on_hours ?? d.powerOnHours),
      reallocated_sectors: toNum(d.reallocated_sectors ?? d.reallocated),
      pending_sectors: toNum(d.pending_sectors ?? d.pending),
      uncorrectable_errors: toNum(d.uncorrectable_errors ?? d.readErrors ?? d.uncorrectable),
      media_errors: toNum(d.media_errors ?? d.mediaErrors),
      note: cleanText(d.note, 120)
    };
    const r = rateDisk(disk);
    disk.level = r.level;
    disk.reasons = r.reasons;
    return disk;
  });
  if (disks.length === 0) return null;

  let overall = 'unknown';
  for (const d of disks) if (HEALTH_RANK[d.level] > HEALTH_RANK[overall]) overall = d.level;
  return {
    json: JSON.stringify({ checked_at: new Date().toISOString(), disks }),
    status: overall
  };
}

// Asset queries
const queries = {
  // Get all assets with optional search & filter
  getModelSpecTemplate(model, category = null, excludeId = null) {
    return getModelSpecTemplate(model, category, excludeId);
  },

  isFixedSpecCategory(category) {
    return isFixedSpecCategory(category);
  },

  searchModels(query, category = null, limit = 8) {
    return searchModels(query, category, limit);
  },

  normalizeModelName(name) {
    return normalizeModelName(name);
  },

  // ---- Photo intake queue ----
  createPhotoJob(photoFiles, form, createdBy) {
    const now = new Date().toISOString();
    const r = db.prepare('INSERT INTO photo_jobs (status, photo_files, form, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('queued', JSON.stringify(photoFiles), JSON.stringify(form || {}), createdBy || null, now, now);
    return Number(r.lastInsertRowid);
  },

  getPhotoJob(id) {
    const j = db.prepare('SELECT * FROM photo_jobs WHERE id = ?').get(id);
    if (!j) return null;
    const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
    return { ...j, photo_files: parse(j.photo_files, []), form: parse(j.form, {}), result: parse(j.result, null) };
  },

  listPhotoJobs() {
    return db.prepare('SELECT id FROM photo_jobs ORDER BY id ASC').all().map(r => queries.getPhotoJob(r.id));
  },

  updatePhotoJob(id, { status, result, error, photo_files }) {
    const cur = db.prepare('SELECT * FROM photo_jobs WHERE id = ?').get(id);
    if (!cur) return false;
    db.prepare('UPDATE photo_jobs SET status = ?, result = ?, error = ?, photo_files = ?, updated_at = ? WHERE id = ?').run(
      status ?? cur.status,
      result !== undefined ? (result === null ? null : JSON.stringify(result)) : cur.result,
      error !== undefined ? error : cur.error,
      photo_files !== undefined ? JSON.stringify(photo_files) : cur.photo_files,
      new Date().toISOString(), id);
    return true;
  },

  deletePhotoJob(id) {
    return db.prepare('DELETE FROM photo_jobs WHERE id = ?').run(id).changes > 0;
  },

  nextQueuedPhotoJob() {
    const r = db.prepare("SELECT id FROM photo_jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1").get();
    return r ? queries.getPhotoJob(r.id) : null;
  },

  // Jobs that were mid-processing when the server stopped go back in the queue
  requeueStalePhotoJobs() {
    db.prepare("UPDATE photo_jobs SET status = 'queued' WHERE status = 'processing'").run();
  },

  // A queued photo becomes a regular camera photo of the new asset
  attachQueueFileToAsset(assetId, queueFile, caption = 'Device Photo') {
    if (!/^queue_[A-Za-z0-9_.-]+$/.test(queueFile)) return null;
    const src = path.join(__dirname, 'uploads', queueFile);
    if (!fs.existsSync(src)) return null;
    const newName = `asset_${assetId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${path.extname(queueFile) || '.jpg'}`;
    fs.renameSync(src, path.join(__dirname, 'uploads', newName));
    return queries.addPhoto(assetId, newName, queueFile, caption);
  },

  findAssetBySerial(serial) {
    const s = String(serial || '').trim();
    if (s.length < 4) return null;
    return db.prepare('SELECT id, property_id, manufacturer_model FROM assets WHERE LOWER(serial_number) = LOWER(?) LIMIT 1').get(s) || null;
  },

  recentPropertyIds(limit = 8) {
    return db.prepare('SELECT property_id FROM assets WHERE no_tag = 0 ORDER BY id DESC LIMIT ?').all(limit).map(r => r.property_id);
  },

  getAllAssets({ search, category, status, limit = 200, offset = 0 } = {}) {
    let sql = `
      SELECT a.*, 
             (SELECT COUNT(*) FROM asset_photos p WHERE p.asset_id = a.id) as photo_count,
             (SELECT p.file_name FROM asset_photos p WHERE p.asset_id = a.id ORDER BY ${photoOrderSql('p')} LIMIT 1) as primary_photo
      FROM assets a
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      sql += ` AND (
        a.property_id LIKE ? OR 
        a.computer_name LIKE ? OR 
        a.serial_number LIKE ? OR 
        a.user_name LIKE ? OR 
        a.manufacturer_model LIKE ? OR 
        a.ip_address LIKE ? OR
        a.cpu LIKE ? OR
        a.monitors LIKE ?
      )`;
      const q = `%${search}%`;
      params.push(q, q, q, q, q, q, q, q);
    }

    if (category && category !== 'all') {
      sql += ` AND a.category = ?`;
      params.push(category);
    }

    if (status && status !== 'all') {
      sql += ` AND a.status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY a.updated_at DESC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    return db.prepare(sql).all(...params);
  },

  // Get asset by ID (with photos)
  getAssetById(id) {
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
    if (!asset) return null;
    const photos = db.prepare(`SELECT * FROM asset_photos WHERE asset_id = ? ORDER BY ${photoOrderSql()}`).all(id);
    return { ...asset, photos };
  },

  // Get asset by property_id
  getAssetByPropertyId(propertyId) {
    return db.prepare('SELECT * FROM assets WHERE property_id = ?').get(propertyId);
  },

  // Find asset by serial number or computer name
  findBySerialOrComputerName(serial, computerName) {
    if (serial && serial !== 'Unknown' && serial.trim() !== '') {
      const match = db.prepare('SELECT * FROM assets WHERE serial_number = ? LIMIT 1').get(serial.trim());
      if (match) return match;
    }
    if (computerName && computerName.trim() !== '') {
      const match = db.prepare('SELECT * FROM assets WHERE computer_name = ? LIMIT 1').get(computerName.trim());
      if (match) return match;
    }
    return null;
  },

  // Create new asset
  createAsset(data) {
    const now = new Date().toISOString();
    stripSpecPlaceholders(data);
    if (data.manufacturer_model) data.manufacturer_model = normalizeModelName(data.manufacturer_model);
    // Same model already registered? Reuse its specs (monitors, drives, network gear...)
    data._specs_copied = fillFromModelTemplate(data);
    const noTag = isTruthyFlag(data.no_tag);
    const propertyId = noTag ? getNextNoTagId() : (data.property_id || getNextPropertyId());

    const stmt = db.prepare(`
      INSERT INTO assets (
        property_id, category, status, user_name, computer_name,
        manufacturer_model, serial_number, os_version, ip_address,
        cpu, ram, storage_drives, c_space, network_devices,
        gpu, monitors, location, department, purchase_date, notes,
        is_automated, last_scanned_at, created_at, updated_at, no_tag, health
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
    `);

    db.exec('BEGIN IMMEDIATE');
    try {
      const result = stmt.run(
        propertyId,
        data.category || 'PC',
        data.status || 'active',
        data.user_name || null,
        data.computer_name || null,
        data.manufacturer_model || null,
        data.serial_number || null,
        data.os_version || null,
        data.ip_address || null,
        data.cpu || null,
        data.ram || null,
        data.storage_drives || null,
        data.c_space || null,
        data.network_devices || null,
        data.gpu || null,
        data.monitors || null,
        data.location || null,
        data.department || null,
        data.purchase_date || null,
        data.notes || null,
        data.is_automated ? 1 : 0,
        data.last_scanned_at || null,
        now,
        now,
        noTag ? 1 : 0,
        normalizeHealth(data.health, 'initial_ok')
      );

      const newId = Number(result.lastInsertRowid);

      // Auto-attach existing photo if available for same model
      if (data.manufacturer_model) {
        queries.autoAttachPhotoIfAvailable(newId, data.manufacturer_model);
      }

      db.exec('COMMIT');
      scheduleBackup();
      return newId;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },

  // Update existing asset
  updateAsset(id, data) {
    const now = new Date().toISOString();
    const current = db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
    if (!current) return false;
    stripSpecPlaceholders(data);
    if (data.manufacturer_model) data.manufacturer_model = normalizeModelName(data.manufacturer_model);

    // "No property tag" switch: tagging an untagged item or removing its tag
    let noTag = current.no_tag ? 1 : 0;
    if (data.no_tag !== undefined) {
      const wantNoTag = isTruthyFlag(data.no_tag);
      if (wantNoTag && !current.no_tag) {
        data.property_id = getNextNoTagId();
      } else if (wantNoTag && current.no_tag) {
        data.property_id = current.property_id; // keep its internal code
      }
      noTag = wantNoTag ? 1 : 0;
    }

    const stmt = db.prepare(`
      UPDATE assets SET
        property_id = ?,
        category = ?,
        status = ?,
        user_name = ?,
        computer_name = ?,
        manufacturer_model = ?,
        serial_number = ?,
        os_version = ?,
        ip_address = ?,
        cpu = ?,
        ram = ?,
        storage_drives = ?,
        c_space = ?,
        network_devices = ?,
        gpu = ?,
        monitors = ?,
        location = ?,
        department = ?,
        purchase_date = ?,
        notes = ?,
        is_automated = ?,
        last_scanned_at = COALESCE(?, last_scanned_at),
        updated_at = ?,
        no_tag = ?,
        health = ?
      WHERE id = ?
    `);

    stmt.run(
      data.property_id !== undefined ? data.property_id : current.property_id,
      data.category !== undefined ? data.category : current.category,
      data.status !== undefined ? data.status : current.status,
      data.user_name !== undefined ? data.user_name : current.user_name,
      data.computer_name !== undefined ? data.computer_name : current.computer_name,
      data.manufacturer_model !== undefined ? data.manufacturer_model : current.manufacturer_model,
      data.serial_number !== undefined ? data.serial_number : current.serial_number,
      data.os_version !== undefined ? data.os_version : current.os_version,
      data.ip_address !== undefined ? data.ip_address : current.ip_address,
      data.cpu !== undefined ? data.cpu : current.cpu,
      data.ram !== undefined ? data.ram : current.ram,
      data.storage_drives !== undefined ? data.storage_drives : current.storage_drives,
      data.c_space !== undefined ? data.c_space : current.c_space,
      data.network_devices !== undefined ? data.network_devices : current.network_devices,
      data.gpu !== undefined ? data.gpu : current.gpu,
      data.monitors !== undefined ? data.monitors : current.monitors,
      data.location !== undefined ? data.location : current.location,
      data.department !== undefined ? data.department : current.department,
      data.purchase_date !== undefined ? data.purchase_date : current.purchase_date,
      data.notes !== undefined ? data.notes : current.notes,
      data.is_automated !== undefined ? (data.is_automated ? 1 : 0) : current.is_automated,
      data.last_scanned_at || null,
      now,
      noTag,
      data.health !== undefined ? normalizeHealth(data.health, current.health || 'healthy') : (current.health || 'healthy'),
      id
    );

    scheduleBackup();
    return true;
  },

  // Ingestion from network scanner (.bat / .sh) with Intelligent Duplicate Detection & Re-scan Auto-Update
  ingestScan(scanData) {
    const now = new Date().toISOString();
    if (scanData.manufacturer_model) scanData.manufacturer_model = normalizeModelName(scanData.manufacturer_model);
    const compName = (scanData.computer_name || '').trim();
    const serialNum = (scanData.serial_number || '').trim();
    const diskHealth = normalizeDiskHealth(scanData.disk_health);
    const isSerialValid = serialNum && serialNum.toLowerCase() !== 'unknown' && serialNum.toLowerCase() !== 'to be filled by o.e.m.' && serialNum.length > 3;
    // The host name only identifies a machine on its own installed OS. USB-kit scans often come from live
    // sessions ("mint") or a bench disk moved between machines, so those match by serial number only.
    const GENERIC_HOSTS = new Set(['linux-host', 'mint', 'ubuntu', 'localhost', 'live', 'debian', 'kali', 'fedora', 'user-pc']);
    const nameMatchAllowed = compName && !GENERIC_HOSTS.has(compName.toLowerCase()) && scanData.source !== 'usb-kit';

    // 1. Check if this machine is ALREADY registered as an approved asset in `assets` table!
    let existingAsset = null;
    if (isSerialValid) {
      existingAsset = db.prepare('SELECT * FROM assets WHERE LOWER(serial_number) = LOWER(?)').get(serialNum);
    }
    if (!existingAsset && nameMatchAllowed) {
      existingAsset = db.prepare('SELECT * FROM assets WHERE LOWER(computer_name) = LOWER(?)').get(compName);
    }

    if (existingAsset) {
      // SMART RE-SCAN UPDATE: Update the existing registered asset's specs without creating duplicate pending items!
      db.prepare(`
        UPDATE assets SET
          user_name = COALESCE(?, user_name),
          os_version = COALESCE(?, os_version),
          ip_address = COALESCE(?, ip_address),
          cpu = COALESCE(?, cpu),
          ram = COALESCE(?, ram),
          storage_drives = COALESCE(?, storage_drives),
          c_space = COALESCE(?, c_space),
          gpu = COALESCE(?, gpu),
          monitors = COALESCE(?, monitors),
          disk_health = COALESCE(?, disk_health),
          disk_health_status = COALESCE(?, disk_health_status),
          last_scanned_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        scanData.user_name || null,
        scanData.os_version || null,
        scanData.ip_address || null,
        scanData.cpu || null,
        scanData.ram || null,
        scanData.storage_drives || null,
        scanData.c_space || null,
        scanData.gpu || null,
        scanData.monitors || null,
        diskHealth ? diskHealth.json : null,
        diskHealth ? diskHealth.status : null,
        now,
        now,
        existingAsset.id
      );

      queries.addLog('SUCCESS', 'RESCAN_UPDATE', 
        `مشخصات سیستم «${existingAsset.computer_name || compName}» با کد اموال «${existingAsset.property_id}» به‌روزرسانی شد.`,
        `کاربر: ${scanData.user_name || existingAsset.user_name || 'ناشناخته'} | IP: ${scanData.ip_address || existingAsset.ip_address}`
      );

      scheduleBackup();

      return {
        is_update: true,
        disk_health_status: diskHealth ? diskHealth.status : null,
        asset_id: existingAsset.id,
        property_id: existingAsset.property_id,
        items_count: 1,
        items: [{ id: existingAsset.id, category: existingAsset.category, name: existingAsset.manufacturer_model || existingAsset.computer_name, property_id: existingAsset.property_id }],
        message: `سیستم قبلاً با شماره اموال «${existingAsset.property_id}» در انبار ثبت شده بود؛ تمام مشخصات سخت‌افزاری آن با موفقیت به‌روزرسانی شد.`
      };
    }

    // 2. Check if this machine is already sitting in the `pending_scans` queue waiting for approval
    let existingPending = null;
    if (isSerialValid) {
      existingPending = db.prepare("SELECT * FROM pending_scans WHERE LOWER(serial_number) = LOWER(?) AND status = 'pending'").get(serialNum);
    }
    if (!existingPending && nameMatchAllowed) {
      existingPending = db.prepare("SELECT * FROM pending_scans WHERE LOWER(computer_name) = LOWER(?) AND category != 'Monitor' AND status = 'pending'").get(compName);
    }

    if (existingPending) {
      // Update the pending item specs
      db.prepare(`
        UPDATE pending_scans SET
          user_name = COALESCE(?, user_name),
          manufacturer_model = COALESCE(?, manufacturer_model),
          os_version = COALESCE(?, os_version),
          ip_address = COALESCE(?, ip_address),
          cpu = COALESCE(?, cpu),
          ram = COALESCE(?, ram),
          storage_drives = COALESCE(?, storage_drives),
          c_space = COALESCE(?, c_space),
          gpu = COALESCE(?, gpu),
          disk_health = COALESCE(?, disk_health),
          property_id = COALESCE(?, property_id),
          created_at = ?
        WHERE id = ?
      `).run(
        scanData.user_name || null,
        scanData.manufacturer_model || null,
        scanData.os_version || null,
        scanData.ip_address || null,
        scanData.cpu || null,
        scanData.ram || null,
        scanData.storage_drives || null,
        scanData.c_space || null,
        scanData.gpu || null,
        diskHealth ? diskHealth.json : null,
        cleanPropertyId(scanData.property_id),
        now,
        existingPending.id
      );

      return {
        is_pending_update: true,
        disk_health_status: diskHealth ? diskHealth.status : null,
        batch_id: existingPending.batch_id,
        items_count: 1,
        items: [{ id: existingPending.id, category: existingPending.category, name: existingPending.manufacturer_model || existingPending.computer_name }],
        message: 'اسکن این سیستم از قبل در صف تایید اموال موجود بود؛ مشخصات در انتظار آن به‌روزرسانی شد.'
      };
    }

    // 3. BRAND NEW SCAN: Ingest main device + split monitors into pending queue
    const batchId = `BATCH_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const createdItems = [];

    db.exec('BEGIN IMMEDIATE');
    try {

    // Determine PC / Laptop Category
    let mainCategory = 'PC';
    const m = (scanData.manufacturer_model || '').toLowerCase();
    if (m.includes('laptop') || m.includes('notebook') || m.includes('latitude') || m.includes('thinkpad') || m.includes('elitebook') || m.includes('probook')) {
      mainCategory = 'Laptop';
    }

    const insertPending = db.prepare(`
      INSERT INTO pending_scans (
        batch_id, category, user_name, computer_name, manufacturer_model, serial_number,
        os_version, ip_address, cpu, ram, storage_drives, c_space, gpu, notes, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `);

    const pcRes = insertPending.run(
      batchId,
      mainCategory,
      scanData.user_name || null,
      scanData.computer_name || null,
      scanData.manufacturer_model || null,
      scanData.serial_number || null,
      scanData.os_version || null,
      scanData.ip_address || null,
      scanData.cpu || null,
      scanData.ram || null,
      scanData.storage_drives || null,
      scanData.c_space || null,
      scanData.gpu || null,
      `سیستم اسکن شده از طریق شبکه (${scanData.computer_name || ''})`,
      now
    );

    if (diskHealth) {
      db.prepare('UPDATE pending_scans SET disk_health = ? WHERE id = ?').run(diskHealth.json, Number(pcRes.lastInsertRowid));
    }
    const pcPropertyId = cleanPropertyId(scanData.property_id);
    if (pcPropertyId) db.prepare('UPDATE pending_scans SET property_id = ? WHERE id = ?').run(pcPropertyId, Number(pcRes.lastInsertRowid));
    createdItems.push({ id: Number(pcRes.lastInsertRowid), category: mainCategory, name: scanData.manufacturer_model || scanData.computer_name, property_id: pcPropertyId });

    // Auto-Split Connected Monitors as separate individual assets
    const rawMonitors = scanData.monitors || '';
    const monitorIds = Array.isArray(scanData.monitor_property_ids) ? scanData.monitor_property_ids : [];
    if (rawMonitors && rawMonitors.trim() && rawMonitors.toLowerCase() !== 'default display') {
      // Split on " / " only, so model names containing "/" or "," stay whole and stay aligned with their property numbers
      const parts = rawMonitors.includes(' / ') ? rawMonitors.split(' / ') : rawMonitors.split(/[\/,;]+/);
      const monList = parts.map((s, idx) => ({ name: s.trim(), pid: cleanPropertyId(monitorIds[idx]) }))
        .filter(x => x.name && x.name.length > 2 && x.name.toLowerCase() !== 'default display');

      for (let i = 0; i < monList.length; i++) {
        // Offline (bench) scans: only monitors given a property number are real; the rest is the test screen
        if (scanData.offline && !monList[i].pid) continue;
        const monModel = monList[i].name;
        const monNotes = `نمایشگر شماره ${i + 1} متصل به سیستم ${scanData.computer_name || 'کاربر'} (${scanData.user_name || ''})`;

        const monRes = insertPending.run(
          batchId,
          'Monitor',
          scanData.user_name || null,
          scanData.computer_name ? `${scanData.computer_name}-MON${i + 1}` : null,
          monModel,
          null,
          null,
          scanData.ip_address || null,
          null,
          null,
          null,
          null,
          null,
          monNotes,
          now
        );

        if (monList[i].pid) db.prepare('UPDATE pending_scans SET property_id = ? WHERE id = ?').run(monList[i].pid, Number(monRes.lastInsertRowid));
        createdItems.push({ id: Number(monRes.lastInsertRowid), category: 'Monitor', name: monModel, property_id: monList[i].pid });
      }
    }

    db.exec('COMMIT');
    scheduleBackup();

    return {
      batch_id: batchId,
      items_count: createdItems.length,
      items: createdItems,
      is_new: true,
      disk_health_status: diskHealth ? diskHealth.status : null,
      message: `اسکن دریافت شد؛ ${createdItems.length} قلم دارایی تفکیک و در صف تایید اموال قرار گرفت.`
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
},

  // Get all pending scan items waiting for admin review & property ID assignment
  getPendingScans() {
    return db.prepare(`
      SELECT * FROM pending_scans
      WHERE status = 'pending'
      ORDER BY id DESC
    `).all();
  },

  // Approve a pending scan item and assign its official physical Property ID
  markPendingSource(batchId, source) {
    if (!batchId || !source) return;
    db.prepare('UPDATE pending_scans SET source = ? WHERE batch_id = ?').run(String(source).slice(0, 30), batchId);
  },

  approvePendingScan(pendingId, customPropertyId, customCategory, customStatus = null, noTag = false) {
    const item = db.prepare('SELECT * FROM pending_scans WHERE id = ?').get(pendingId);
    if (!item) return null;
    // Devices scanned with the USB kit are bench / storage machines
    if (!customStatus) customStatus = item.source === 'usb-kit' ? 'in_storage' : 'active';
    // With the USB kit the operator types the property number in the "name" prompt; it is not a person
    if (item.source === 'usb-kit' && /^\d{3,6}$/.test(String(item.user_name || '').trim())) item.user_name = null;

    const propertyId = noTag ? getNextNoTagId()
      : (customPropertyId && customPropertyId.trim()) ? customPropertyId.trim() : getNextPropertyId();
    const category = customCategory || item.category || 'PC';
    const now = new Date().toISOString();

    // Check if property_id already exists in assets
    const existing = queries.getAssetByPropertyId(propertyId);
    if (existing) {
      throw new Error(`شماره اموال «${propertyId}» از قبل در سیستم ثبت شده است! لطفاً شماره دیگری انتخاب کنید.`);
    }

    const newId = queries.createAsset({
      property_id: propertyId,
      category: category,
      status: customStatus,
      user_name: item.user_name,
      computer_name: item.computer_name,
      manufacturer_model: item.manufacturer_model,
      serial_number: item.serial_number,
      os_version: item.os_version,
      ip_address: item.ip_address,
      cpu: item.cpu,
      ram: item.ram,
      storage_drives: item.storage_drives,
      c_space: item.c_space,
      gpu: item.gpu,
      monitors: item.category === 'Monitor' ? item.manufacturer_model : null,
      notes: item.notes,
      is_automated: 1,
      last_scanned_at: item.created_at,
      no_tag: noTag ? 1 : 0
    });

    // Carry the scanner's disk health over to the new asset
    if (item.disk_health) {
      const dh = normalizeDiskHealth(item.disk_health);
      if (dh) {
        // keep the original check time from the scan
        let json = dh.json;
        try { const orig = JSON.parse(item.disk_health); const fresh = JSON.parse(dh.json); fresh.checked_at = orig.checked_at || fresh.checked_at; json = JSON.stringify(fresh); } catch (e) {}
        db.prepare('UPDATE assets SET disk_health = ?, disk_health_status = ? WHERE id = ?').run(json, dh.status, newId);
      }
    }

    // Mark as approved in pending table
    db.prepare("UPDATE pending_scans SET status = 'approved' WHERE id = ?").run(pendingId);

    // Auto-attach existing photo of the same model if available
    queries.autoAttachPhotoIfAvailable(newId, item.manufacturer_model);

    scheduleBackup();
    return { id: newId, property_id: propertyId };
  },

  // Reject / Delete a pending scan item
  rejectPendingScan(pendingId) {
    const res = db.prepare('DELETE FROM pending_scans WHERE id = ?').run(pendingId);
    if (res.changes > 0) scheduleBackup();
    return true;
  },

  // Delete asset
  deleteAsset(id) {
    // Also remove photos from disk
    const photos = db.prepare('SELECT file_name FROM asset_photos WHERE asset_id = ?').all(id);
    for (const p of photos) {
      const pPath = path.join(__dirname, 'uploads', p.file_name);
      if (fs.existsSync(pPath)) {
        try { fs.unlinkSync(pPath); } catch (e) { /* ignore */ }
      }
    }
    const result = db.prepare('DELETE FROM assets WHERE id = ?').run(id);
    if (result.changes > 0) {
      scheduleBackup();
      return true;
    }
    return false;
  },

  // Photos
  addPhoto(assetId, fileName, originalName = '', caption = '') {
    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO asset_photos (asset_id, file_name, original_name, caption, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(assetId, fileName, originalName, caption, now);
    const photoId = Number(result.lastInsertRowid);

    // Propagate this new photo to all other assets of the same model that have no photo
    try {
      const asset = db.prepare('SELECT manufacturer_model FROM assets WHERE id = ?').get(assetId);
      if (asset && asset.manufacturer_model) {
        queries.propagatePhotoToSameModel(photoId, asset.manufacturer_model);
      }
    } catch (e) {}

    scheduleBackup();
    return photoId;
  },

  // Mark one photo as the cover image of its asset (clears the flag on the others)
  setPrimaryPhoto(photoId) {
    const photo = db.prepare('SELECT id, asset_id FROM asset_photos WHERE id = ?').get(photoId);
    if (!photo) return false;
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE asset_photos SET is_primary = 0 WHERE asset_id = ?').run(photo.asset_id);
      db.prepare('UPDATE asset_photos SET is_primary = 1 WHERE id = ?').run(photoId);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    scheduleBackup();
    return true;
  },

  deletePhoto(photoId) {
    const photo = db.prepare('SELECT * FROM asset_photos WHERE id = ?').get(photoId);
    if (!photo) return false;

    const pPath = path.join(__dirname, 'uploads', photo.file_name);
    if (fs.existsSync(pPath)) {
      try { fs.unlinkSync(pPath); } catch (e) { /* ignore */ }
    }

    db.prepare('DELETE FROM asset_photos WHERE id = ?').run(photoId);
    scheduleBackup();
    return true;
  },

  // Get all unique photos in the library across the entire inventory
  getPhotoLibrary(search = '') {
    const s = `%${(search || '').trim()}%`;
    const rows = db.prepare(`
      SELECT 
        p.id,
        p.file_name,
        p.original_name,
        p.caption,
        p.created_at,
        a.id as asset_id,
        a.property_id,
        a.manufacturer_model,
        a.category,
        a.user_name,
        CASE WHEN p.file_name LIKE 'asset_%' OR p.file_name LIKE 'photo_%' THEN 1 ELSE 0 END as is_camera_photo
      FROM asset_photos p
      LEFT JOIN assets a ON p.asset_id = a.id
      WHERE (a.manufacturer_model LIKE ? OR a.property_id LIKE ? OR p.caption LIKE ? OR a.category LIKE ? OR ? = '%%')
      GROUP BY p.file_name
      ORDER BY is_camera_photo DESC, p.id DESC
      LIMIT 100
    `).all(s, s, s, s, s);

    // Verify file actually exists on disk
    return rows.filter(r => {
      const p = path.join(__dirname, 'uploads', r.file_name);
      return fs.existsSync(p);
    });
  },

  // Attach an existing photo file to a target asset
  attachExistingPhoto(targetAssetId, fileName, caption = '') {
    // Check if target asset already has this exact photo attached
    const existing = db.prepare('SELECT id FROM asset_photos WHERE asset_id = ? AND file_name = ?').get(targetAssetId, fileName);
    if (existing) return existing.id;

    const now = new Date().toISOString();
    const res = db.prepare(`
      INSERT INTO asset_photos (asset_id, file_name, original_name, caption, created_at)
      VALUES (?, ?, 'Attached from Library', ?, ?)
    `).run(targetAssetId, fileName, caption || 'Attached from Photo Library', now);

    scheduleBackup();
    return Number(res.lastInsertRowid);
  },

  // Find existing photo of the same or similar model (PRIORITIZES REAL USER CAMERA PHOTOS)
  getExistingPhotoForModel(modelName) {
    if (!modelName || !modelName.trim()) return null;
    const clean = modelName.trim();
    
    // First try exact match prioritizing real user camera photos (file_name starting with asset_ or photo_)
    let photo = db.prepare(`
      SELECT p.id, p.file_name, p.original_name, a.manufacturer_model, a.property_id, a.category, a.id AS asset_id
      FROM asset_photos p
      JOIN assets a ON p.asset_id = a.id
      WHERE LOWER(a.manufacturer_model) = LOWER(?)
      ORDER BY 
        CASE WHEN p.file_name LIKE 'asset_%' OR p.file_name LIKE 'photo_%' THEN 0 ELSE 1 END,
        p.id DESC
      LIMIT 1
    `).get(clean);

    // If not found, try partial LIKE match
    if (!photo && clean.length >= 4) {
      photo = db.prepare(`
        SELECT p.id, p.file_name, p.original_name, a.manufacturer_model, a.property_id, a.category, a.id AS asset_id
        FROM asset_photos p
        JOIN assets a ON p.asset_id = a.id
        WHERE LOWER(a.manufacturer_model) LIKE LOWER(?)
        ORDER BY 
          CASE WHEN p.file_name LIKE 'asset_%' OR p.file_name LIKE 'photo_%' THEN 0 ELSE 1 END,
          p.id DESC
        LIMIT 1
      `).get(`%${clean}%`);
    }

    return photo || null;
  },

  // Automatically attach existing photo of the same model if available
  autoAttachPhotoIfAvailable(assetId, modelName) {
    if (!assetId || !modelName || !modelName.trim()) return false;

    // Check if asset already has photos
    const currentPhotos = db.prepare('SELECT COUNT(*) as count FROM asset_photos WHERE asset_id = ?').get(assetId);
    if (currentPhotos && currentPhotos.count > 0) return false;

    // Find existing photo for same model
    const existingPhoto = queries.getExistingPhotoForModel(modelName);
    if (existingPhoto) {
      const clonedId = queries.attachExistingPhotoToAsset(assetId, existingPhoto.id, `کپی خودکار از عکس مدل (${modelName})`);
      if (clonedId) {
        queries.addLog('SUCCESS', 'PHOTO_AUTO', `عکس مدل «${modelName}» به‌صورت خودکار برای دستگاه کد اموال جدید کپی شد`);
        return true;
      }
    }
    return false;
  },

  // Propagate a newly uploaded photo to all other assets of the same model that lack photos
  propagatePhotoToSameModel(sourcePhotoId, modelName) {
    if (!sourcePhotoId || !modelName || !modelName.trim()) return 0;
    const cleanModel = modelName.trim();

    // Find all assets of same model (even if they have stock photos, real user camera photos take priority!)
    const targetAssets = db.prepare(`
      SELECT a.id, a.property_id
      FROM assets a
      WHERE LOWER(a.manufacturer_model) = LOWER(?)
    `).all(cleanModel);

    let attachedCount = 0;
    for (const target of targetAssets) {
      // Check if this asset already has a REAL user camera photo
      const hasRealPhoto = db.prepare(`
        SELECT COUNT(*) as count FROM asset_photos 
        WHERE asset_id = ? AND (file_name LIKE 'asset_%' OR file_name LIKE 'photo_%')
      `).get(target.id);

      if (hasRealPhoto && hasRealPhoto.count > 0) {
        continue; // Skip if real photo already exists
      }

      const res = queries.attachExistingPhotoToAsset(target.id, sourcePhotoId, `همگام‌سازی خودکار عکس مدل (${cleanModel})`);
      if (res) attachedCount++;
    }

    if (attachedCount > 0) {
      queries.addLog('SUCCESS', 'PHOTO_SYNC', `عکس جدید مدل «${cleanModel}» برای ${attachedCount} دستگاه هم‌مدل کپی شد`);
    }
    return attachedCount;
  },
  attachExistingPhotoToAsset(assetId, existingPhotoId, caption = 'Device Photo') {
    const existing = db.prepare('SELECT * FROM asset_photos WHERE id = ?').get(existingPhotoId);
    if (!existing) return null;

    const ext = path.extname(existing.file_name);
    const newFileName = `photo_${assetId}_${Date.now()}_copy${ext}`;
    const srcPath = path.join(__dirname, 'uploads', existing.file_name);
    const destPath = path.join(__dirname, 'uploads', newFileName);

    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      const now = new Date().toISOString();
      const res = db.prepare(`
        INSERT INTO asset_photos (asset_id, file_name, original_name, caption, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(assetId, newFileName, existing.original_name, caption, now);
      scheduleBackup();
      return Number(res.lastInsertRowid);
    }
    return null;
  },

  // Suggestions for autocomplete / learning memory
  getSuggestions() {
    const getDistinct = (column) => {
      const rows = db.prepare(`
        SELECT DISTINCT ${column} as val 
        FROM assets 
        WHERE ${column} IS NOT NULL AND TRIM(${column}) != '' 
        ORDER BY updated_at DESC LIMIT 50
      `).all();
      return rows.map(r => r.val).filter(Boolean);
    };

    // Recent models grouped by category so the add/edit forms can suggest
    // only monitors when "Monitor" is selected, only PCs for a case, etc.
    const modelRows = db.prepare(`
      SELECT category, manufacturer_model as val, MAX(updated_at) as last_used
      FROM assets
      WHERE manufacturer_model IS NOT NULL AND TRIM(manufacturer_model) != ''
      GROUP BY category, manufacturer_model
      ORDER BY last_used DESC
    `).all();
    const modelsByCategory = {};
    for (const r of modelRows) {
      const cat = r.category || 'Other';
      if (!modelsByCategory[cat]) modelsByCategory[cat] = [];
      if (modelsByCategory[cat].length < 20) modelsByCategory[cat].push(r.val);
    }

    return {
      models_by_category: modelsByCategory,
      models: getDistinct('manufacturer_model'),
      cpus: getDistinct('cpu'),
      rams: getDistinct('ram'),
      storages: getDistinct('storage_drives'),
      gpus: getDistinct('gpu'),
      monitors: getDistinct('monitors'),
      locations: getDistinct('location'),
      departments: getDistinct('department'),
      users: getDistinct('user_name')
    };
  },

  // Dashboard Stats
  getStats() {
    const total = db.prepare('SELECT COUNT(*) as count FROM assets').get().count;
    const active = db.prepare("SELECT COUNT(*) as count FROM assets WHERE status = 'active'").get().count;
    const inStorage = db.prepare("SELECT COUNT(*) as count FROM assets WHERE status = 'in_storage'").get().count;
    const repair = db.prepare("SELECT COUNT(*) as count FROM assets WHERE status = 'repair'").get().count;
    const retired = db.prepare("SELECT COUNT(*) as count FROM assets WHERE status = 'retired'").get().count;

    const pcs = db.prepare("SELECT COUNT(*) as count FROM assets WHERE category IN ('PC', 'Single PC', 'Laptop')").get().count;
    const diskAlerts = db.prepare("SELECT COUNT(*) as count FROM assets WHERE disk_health_status IN ('warning', 'critical')").get().count;
    const noTag = db.prepare('SELECT COUNT(*) as count FROM assets WHERE no_tag = 1').get().count;
    const monitors = db.prepare("SELECT COUNT(*) as count FROM assets WHERE category = 'Monitor'").get().count;
    const others = db.prepare("SELECT COUNT(*) as count FROM assets WHERE category NOT IN ('PC', 'Single PC', 'Laptop', 'Monitor')").get().count;

    const withPhotos = db.prepare('SELECT COUNT(DISTINCT asset_id) as count FROM asset_photos').get().count;
    const pendingPhotos = total - withPhotos;
    const broken = db.prepare("SELECT COUNT(*) as count FROM assets WHERE health = 'broken'").get().count;
    const needsCheck = db.prepare("SELECT COUNT(*) as count FROM assets WHERE health IN ('needs_check', 'minor_issue', 'untested')").get().count;

    return {
      total,
      broken,
      needsCheck,
      diskAlerts,
      noTag,
      active,
      inStorage,
      repair,
      retired,
      pcs,
      monitors,
      others,
      withPhotos,
      pendingPhotos
    };
  },

  // Settings
  getSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const map = {};
    for (const r of rows) map[r.key] = r.value;
    return map;
  },

  updateSettings(settingsMap) {
    const stmt = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    for (const [key, value] of Object.entries(settingsMap)) {
      stmt.run(key, String(value));
    }
    return true;
  },

  // System Logs
  addLog(level, source, message, details = '', ip = '') {
    try {
      const now = new Date().toISOString();
      const stmt = db.prepare(`
        INSERT INTO system_logs (level, source, message, details, ip, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(level, source, message, String(details || ''), String(ip || ''), now);
    } catch (e) {
      console.error('Failed to write log:', e);
    }
  },

  getLogs(limit = 100) {
    return db.prepare('SELECT * FROM system_logs ORDER BY id DESC LIMIT ?').all(limit);
  },

  clearLogs() {
    db.prepare('DELETE FROM system_logs').run();
    return true;
  },

  // User Authentication & Roles (Admin / Viewer)
  authenticateUser(username, password) {
    const user = db.prepare('SELECT id, username, password, full_name, role FROM users WHERE LOWER(username) = LOWER(?)').get(username);
    if (!user) {
      verifyPassword(password, hashPassword('timing-equaliser')); // keep timing similar for unknown users
      return null;
    }
    if (!verifyPassword(password, user.password)) return null;
    if (!String(user.password).startsWith('scrypt$')) {
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(password), user.id);
    }
    return {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      is_admin: user.role === 'admin'
    };
  },

  getUserById(id) {
    const user = db.prepare('SELECT id, username, full_name, role FROM users WHERE id = ?').get(Number(id));
    if (!user) return null;
    return { ...user, is_admin: user.role === 'admin' };
  },

  // True while the built-in admin account still uses the factory password
  isUsingDefaultPassword() {
    const admin = db.prepare("SELECT password FROM users WHERE LOWER(username) = 'admin'").get();
    return !!(admin && verifyPassword('admin', admin.password));
  },

  getAllUsers() {
    return db.prepare('SELECT id, username, full_name, role, created_at FROM users ORDER BY id ASC').all();
  },

  createUser(username, password, fullName, role = 'viewer') {
    const now = new Date().toISOString();
    const res = db.prepare(`
      INSERT INTO users (username, password, full_name, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(username).trim(), hashPassword(String(password).trim()), String(fullName).trim(), role, now);
    scheduleBackup();
    return Number(res.lastInsertRowid);
  },

  updateUser(id, fullName, role, password = null) {
    let changed = false;
    if (password && password.trim()) {
      changed = db.prepare('UPDATE users SET full_name = ?, role = ?, password = ? WHERE id = ?').run(String(fullName).trim(), role, hashPassword(String(password).trim()), id).changes > 0;
    } else {
      changed = db.prepare('UPDATE users SET full_name = ?, role = ? WHERE id = ?').run(String(fullName).trim(), role, id).changes > 0;
    }
    if (changed) scheduleBackup();
    return changed;
  },

  deleteUser(id) {
    if (id === 1) return false; // Never delete root admin
    const changed = db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
    if (changed) scheduleBackup();
    return changed;
  }
};

// Initialize on require
initDb();

module.exports = {
  normalizeDiskHealth,
  db,
  DB_PATH,
  BACKUPS_DIR,
  initDb,
  getNextPropertyId,
  checkpointDb,
  createAutomaticBackup,
  scheduleBackup,
  checkDbIntegrity,
  queries
};
