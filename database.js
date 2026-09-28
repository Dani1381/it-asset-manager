// database.js - SQLite persistence layer using Node.js built-in node:sqlite
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, 'inventory.db');

// Ensure database connection
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and foreign keys
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

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
  `);

  // Default settings
  const checkSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  
  insertSetting.run('company_name', 'Company IT Asset Management');
  insertSetting.run('asset_tag_prefix', 'AST-');
  insertSetting.run('bale_token', '');
  insertSetting.run('bale_chat_id', '');
  insertSetting.run('gemini_api_key', '');
  insertSetting.run('gemini_model', 'gemini-3.6-flash');
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

// Asset queries
const queries = {
  // Get all assets with optional search & filter
  getAllAssets({ search, category, status, limit = 200, offset = 0 } = {}) {
    let sql = `
      SELECT a.*, 
             (SELECT COUNT(*) FROM asset_photos p WHERE p.asset_id = a.id) as photo_count,
             (SELECT p.file_name FROM asset_photos p WHERE p.asset_id = a.id ORDER BY CASE WHEN p.file_name LIKE 'asset_%' OR p.file_name LIKE 'photo_%' THEN 0 ELSE 1 END, p.id ASC LIMIT 1) as primary_photo
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
    const photos = db.prepare(`SELECT * FROM asset_photos WHERE asset_id = ? ORDER BY CASE WHEN file_name LIKE 'asset_%' OR file_name LIKE 'photo_%' THEN 0 ELSE 1 END, id ASC`).all(id);
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
    const propertyId = data.property_id || getNextPropertyId();

    const stmt = db.prepare(`
      INSERT INTO assets (
        property_id, category, status, user_name, computer_name,
        manufacturer_model, serial_number, os_version, ip_address,
        cpu, ram, storage_drives, c_space, network_devices,
        gpu, monitors, location, department, purchase_date, notes,
        is_automated, last_scanned_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `);

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
      now
    );

    const newId = Number(result.lastInsertRowid);

    // Auto-attach existing photo if available for same model
    if (data.manufacturer_model) {
      queries.autoAttachPhotoIfAvailable(newId, data.manufacturer_model);
    }

    return newId;
  },

  // Update existing asset
  updateAsset(id, data) {
    const now = new Date().toISOString();
    const current = db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
    if (!current) return false;

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
        updated_at = ?
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
      id
    );

    return true;
  },

  // Ingest scan from .bat script into the PENDING APPROVAL QUEUE (and auto-split PC & Monitors!)
  ingestScan(scanData) {
    const now = new Date().toISOString();
    const batchId = `BATCH_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const createdItems = [];

    // 1. Determine PC/Laptop Category
    let mainCategory = 'PC';
    const m = (scanData.manufacturer_model || '').toLowerCase();
    if (m.includes('laptop') || m.includes('notebook') || m.includes('latitude 54') || m.includes('thinkpad') || m.includes('elitebook') || m.includes('probook')) {
      mainCategory = 'Laptop';
    }

    // Insert Main Device (Case / PC / Laptop) into pending queue
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

    createdItems.push({ id: Number(pcRes.lastInsertRowid), category: mainCategory, name: scanData.manufacturer_model || scanData.computer_name });

    // 2. Auto-Split Connected Monitors as separate individual assets!
    const rawMonitors = scanData.monitors || '';
    if (rawMonitors && rawMonitors.trim() && rawMonitors.toLowerCase() !== 'default display') {
      const monList = rawMonitors.split(/[\/,;]+/)
        .map(s => s.trim())
        .filter(s => s && s.length > 2 && s.toLowerCase() !== 'default display');

      for (let i = 0; i < monList.length; i++) {
        const monModel = monList[i];
        const monNotes = `نمایشگر شماره ${i + 1} متصل به سیستم ${scanData.computer_name || 'کاربر'} (${scanData.user_name || ''})`;

        const monRes = insertPending.run(
          batchId,
          'Monitor',
          scanData.user_name || null,
          scanData.computer_name ? `${scanData.computer_name}-MON${i + 1}` : null,
          monModel,
          null, // Serial to be inspected/filled or scanned
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

        createdItems.push({ id: Number(monRes.lastInsertRowid), category: 'Monitor', name: monModel });
      }
    }

    return {
      batch_id: batchId,
      items_count: createdItems.length,
      items: createdItems,
      is_new: true
    };
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
  approvePendingScan(pendingId, customPropertyId, customCategory, customStatus = 'active') {
    const item = db.prepare('SELECT * FROM pending_scans WHERE id = ?').get(pendingId);
    if (!item) return null;

    const propertyId = (customPropertyId && customPropertyId.trim()) ? customPropertyId.trim() : getNextPropertyId();
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
      last_scanned_at: item.created_at
    });

    // Mark as approved in pending table
    db.prepare("UPDATE pending_scans SET status = 'approved' WHERE id = ?").run(pendingId);

    // Auto-attach existing photo of the same model if available
    queries.autoAttachPhotoIfAvailable(newId, item.manufacturer_model);

    return { id: newId, property_id: propertyId };
  },

  // Reject / Delete a pending scan item
  rejectPendingScan(pendingId) {
    db.prepare('DELETE FROM pending_scans WHERE id = ?').run(pendingId);
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
    return result.changes > 0;
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

    return photoId;
  },

  deletePhoto(photoId) {
    const photo = db.prepare('SELECT * FROM asset_photos WHERE id = ?').get(photoId);
    if (!photo) return false;

    const pPath = path.join(__dirname, 'uploads', photo.file_name);
    if (fs.existsSync(pPath)) {
      try { fs.unlinkSync(pPath); } catch (e) { /* ignore */ }
    }

    db.prepare('DELETE FROM asset_photos WHERE id = ?').run(photoId);
    return true;
  },

  // Find existing photo of the same or similar model (PRIORITIZES REAL USER CAMERA PHOTOS)
  getExistingPhotoForModel(modelName) {
    if (!modelName || !modelName.trim()) return null;
    const clean = modelName.trim();
    
    // First try exact match prioritizing real user camera photos (file_name starting with asset_ or photo_)
    let photo = db.prepare(`
      SELECT p.id, p.file_name, p.original_name, a.manufacturer_model, a.property_id
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
        SELECT p.id, p.file_name, p.original_name, a.manufacturer_model, a.property_id
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

    return {
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

    const pcs = db.prepare("SELECT COUNT(*) as count FROM assets WHERE category IN ('PC', 'Laptop')").get().count;
    const monitors = db.prepare("SELECT COUNT(*) as count FROM assets WHERE category = 'Monitor'").get().count;
    const others = db.prepare("SELECT COUNT(*) as count FROM assets WHERE category NOT IN ('PC', 'Laptop', 'Monitor')").get().count;

    const withPhotos = db.prepare('SELECT COUNT(DISTINCT asset_id) as count FROM asset_photos').get().count;
    const pendingPhotos = total - withPhotos;

    return {
      total,
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
  }
};

// Initialize on require
initDb();

module.exports = {
  db,
  initDb,
  getNextPropertyId,
  queries
};
