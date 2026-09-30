// server.js - Zero-dependency IT Asset Management HTTP Server
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { queries, getNextPropertyId } = require('./database');
const { generateProductCard } = require('./svg_generator');
const { fetchMultiSourceProductImages } = require('./multi_store_scraper');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Optional password protection (set SITE_PASSWORD env var to enable)
const SITE_PASSWORD = process.env.SITE_PASSWORD || '';
const AUTH_ENABLED = SITE_PASSWORD.length > 0;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const HMAC_KEY = crypto.createHash('sha256').update('iam:' + SITE_PASSWORD).digest();

function signSession(expiresAt) {
  return crypto.createHmac('sha256', HMAC_KEY).update(String(expiresAt)).digest('hex');
}

function buildSessionCookie() {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  return `${expiresAt}.${signSession(expiresAt)}`;
}

function isValidSession(cookieValue) {
  if (!cookieValue) return false;
  const dotIdx = cookieValue.indexOf('.');
  if (dotIdx < 0) return false;
  const expiresAt = cookieValue.slice(0, dotIdx);
  const sig = cookieValue.slice(dotIdx + 1);
  if (!/^\d+$/.test(expiresAt)) return false;
  if (Date.now() > Number(expiresAt)) return false;
  const expected = signSession(expiresAt);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function getRequestCookie(req, name) {
  const header = req.headers['cookie'];
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// Paths that are always reachable (login page + its assets + API key auth)
const AUTH_WHITELIST = new Set(['/login.html', '/api/login', '/api/auth-status', '/style.css']);

function isAuthorized(req) {
  if (!AUTH_ENABLED) return true;
  // API clients (scanner .bat) may pass the password as a header instead of a cookie
  const apiKey = req.headers['x-iam-key'];
  if (apiKey && apiKey === SITE_PASSWORD) return true;
  return isValidSession(getRequestCookie(req, 'iam_sess'));
}

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8'
};

// 9Router Gateway Configuration
const NINE_ROUTER_URL = process.env.NINE_ROUTER_URL || 'http://127.0.0.1:20128/v1/chat/completions';
const NINE_ROUTER_KEY = process.env.DANI_API_KEY || 'sk-5b20d0102616fe63-rd4yvl-c8b097b3';
const NINE_ROUTER_MODEL = process.env.NINE_ROUTER_MODEL || 'opus';

// Helper: Call 9Router AI Gateway (OpenAI Compatible)
async function call9Router(promptText, base64Image = null) {
  const content = [];
  content.push({ type: 'text', text: promptText });

  if (base64Image) {
    let fullDataUrl = base64Image;
    if (!base64Image.startsWith('data:')) {
      fullDataUrl = `data:image/jpeg;base64,${base64Image}`;
    }
    content.push({
      type: 'image_url',
      image_url: { url: fullDataUrl }
    });
  }

  const payload = {
    model: NINE_ROUTER_MODEL,
    messages: [
      {
        role: 'user',
        content: content
      }
    ]
  };

  const res = await fetch(NINE_ROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NINE_ROUTER_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`9Router error ${res.status}: ${errText.slice(0, 150)}`);
  }

  const raw = await res.text();
  let fullText = '';

  // Handle SSE streaming or standard JSON response
  if (raw.includes('data:')) {
    const lines = raw.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ') && !line.includes('[DONE]')) {
        try {
          const chunk = JSON.parse(line.slice(6));
          const delta = chunk.choices?.[0]?.delta?.content || '';
          fullText += delta;
        } catch {}
      }
    }
  } else {
    try {
      const json = JSON.parse(raw);
      fullText = json.choices?.[0]?.message?.content || '';
    } catch {
      fullText = raw;
    }
  }

  const cleanJson = fullText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const firstBrace = cleanJson.indexOf('{');
  const lastBrace = cleanJson.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(cleanJson.substring(firstBrace, lastBrace + 1));
  }
  return JSON.parse(cleanJson);
}

// Call 9Router AI to extract specs from photo
async function extractSpecsWithGemini(base64Image, requestedModel) {
  const prompt = `
You are an expert IT Asset & Hardware Inventory Analyst.
Examine this image of an IT hardware device or its specification label/sticker very carefully.

EXTRACT the following information as strictly structured JSON:
{
  "category": "PC" | "Single PC" | "Laptop" | "Monitor" | "Printer" | "Network" | "Other",
  "manufacturer_model": "Full brand and model name, e.g. HP EliteDesk 800 G3 SFF or Samsung S27C31x",
  "serial_number": "Serial number (S/N, Serial No, Service Tag) if visible, else null",
  "cpu": "CPU / Processor details if mentioned, else null",
  "ram": "RAM / Memory capacity if mentioned, else null",
  "storage_drives": "Storage drive / SSD / HDD details if mentioned, else null",
  "gpu": "Graphics card details if mentioned, else null",
  "monitors": "Display size, resolution, or model if this is a monitor or connected display, else null",
  "notes": "Any other helpful information observed"
}

Rules:
1. If the device is a desktop tower / all-in-one / mini PC for one user, classify as "Single PC" or "PC".
2. Read stickers and printed labels carefully for Serial Numbers and Models.
3. Return STRICT JSON ONLY with NO markdown formatting.
`;

  try {
    const parsed = await call9Router(prompt, base64Image);
    parsed._used_model = '9Router (opus)';
    queries.addLog('SUCCESS', '9ROUTER_VISION', 'عکس با موفقیت توسط گیت‌وی 9Router تحلیل شد', `مدل شناسایی شده: ${parsed.manufacturer_model || 'نامشخص'}`);
    return parsed;
  } catch (err) {
    queries.addLog('ERROR', '9ROUTER_VISION', 'خطا در گیت‌وی 9Router', err.message);
    throw err;
  }
}

// Online Hardware Spec Search by Model name using 9Router AI
async function lookupSpecsByModelOnline(modelName) {
  const prompt = `
You are a master hardware database specialist.
The user entered this device model: "${modelName}".

Identify this computer, laptop, monitor, or hardware device and return its official standard technical specifications and common factory CPU/RAM/GPU configurations.

Return STRICT JSON ONLY:
{
  "recognized": true,
  "canonical_name": "Full clean model name (e.g. HP EliteDesk 800 G3 Small Form Factor)",
  "category": "PC" | "Single PC" | "Laptop" | "Monitor" | "Printer" | "Network" | "Other",
  "default_cpu": "Most common standard CPU for this model (e.g. Intel Core i5-6500 CPU @ 3.20GHz)",
  "cpu_options": ["Intel Core i5-6500 @ 3.20GHz", "Intel Core i7-6700 @ 3.40GHz", "Intel Core i3-6100 @ 3.70GHz"],
  "default_ram": "Standard factory RAM (e.g. 8 GB DDR4 or 16 GB)",
  "ram_options": ["8 GB", "16 GB", "32 GB", "4 GB"],
  "default_storage": "Standard storage (e.g. 256GB NVMe SSD or 500GB HDD)",
  "storage_options": ["256GB NVMe SSD", "512GB NVMe SSD", "500GB HDD", "1TB HDD"],
  "gpu": "Standard GPU / Graphics (e.g. Intel HD Graphics 530)",
  "monitors": "Display specs if this is a monitor or laptop screen (e.g. 27\\" IPS Full HD 75Hz), else null",
  "notes": "Brief 1-line note about form factor, ports, or chipset"
}

Return STRICT JSON ONLY with NO markdown code fences.
`;

  try {
    const parsed = await call9Router(prompt);
    parsed._used_model = '9Router (opus)';
    queries.addLog('SUCCESS', '9ROUTER_LOOKUP', `استعلام مدل «${modelName}» با 9Router با موفقیت انجام شد`);
    return parsed;
  } catch (err) {
    queries.addLog('ERROR', '9ROUTER_LOOKUP', `خطا در استعلام 9Router برای «${modelName}»`, err.message);
    throw err;
  }
}

// Send JSON response helper
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

// Send Bale Bot Notification helper
async function notifyBale(text) {
  try {
    const settings = queries.getSettings();
    const token = settings.bale_token;
    const chatId = settings.bale_chat_id;

    if (!token || !chatId || token === 'YOUR_BALE_BOT_TOKEN_HERE') {
      return { success: false, reason: 'Bale token or chat ID not set' };
    }

    const url = `https://tapi.bale.ai/bot${token}/sendMessage`;
    const body = JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    });

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    });

    const data = await resp.json();
    return { success: true, data };
  } catch (err) {
    console.error('Failed to notify Bale:', err.message);
    return { success: false, error: err.message };
  }
}

// Parse request body (JSON or URL-encoded)
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      // Cap at 20MB for photo uploads
      if (body.length > 20 * 1024 * 1024) {
        reject(new Error('Payload Too Large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        // Try form-url-encoded
        try {
          const params = new URLSearchParams(body);
          const obj = {};
          for (const [k, v] of params.entries()) obj[k] = v;
          resolve(obj);
        } catch {
          resolve({ raw: body });
        }
      }
    });
    req.on('error', reject);
  });
}

// Parse multipart/form-data for raw file upload
function parseMultipartBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;

    req.on('data', chunk => {
      chunks.push(chunk);
      totalLength += chunk.length;
      if (totalLength > 25 * 1024 * 1024) {
        reject(new Error('File upload too large (max 25MB)'));
      }
    });

    req.on('end', () => {
      const buffer = Buffer.concat(chunks, totalLength);
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
      if (!boundaryMatch) {
        return reject(new Error('Missing multipart boundary'));
      }
      const boundary = boundaryMatch[1] || boundaryMatch[2];
      resolve({ buffer, boundary });
    });

    req.on('error', reject);
  });
}

// Get Local LAN IP addresses for easy mobile access
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  try {
    // -------------------------------------------------------------
    // AUTHENTICATION GATE (when SITE_PASSWORD is set)
    // -------------------------------------------------------------
    if (pathname === '/api/auth-status') {
      return sendJson(res, 200, {
        authRequired: AUTH_ENABLED,
        authenticated: isAuthorized(req)
      });
    }

    if (method === 'POST' && pathname === '/api/login') {
      const body = await parseRequestBody(req);
      const pass = body.password || '';
      if (!AUTH_ENABLED || pass === SITE_PASSWORD) {
        const cookie = buildSessionCookie();
        queries.addLog('SUCCESS', 'AUTH', 'ورود موفق به سیستم', '', req.socket?.remoteAddress || '');
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `iam_sess=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`
        });
        return res.end(JSON.stringify({ success: true }));
      }
      queries.addLog('ERROR', 'AUTH', 'تلاش ناموفق برای ورود (رمز اشتباه)', '', req.socket?.remoteAddress || '');
      return sendJson(res, 401, { success: false, error: 'Incorrect password' });
    }

    if (method === 'POST' && pathname === '/api/logout') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'iam_sess=; Path=/; HttpOnly; Max-Age=0'
      });
      return res.end(JSON.stringify({ success: true }));
    }

    // Enforce auth if enabled and path isn't whitelisted
    if (AUTH_ENABLED && !AUTH_WHITELIST.has(pathname) && !isAuthorized(req)) {
      if (pathname.startsWith('/api/')) {
        return sendJson(res, 401, { error: 'Authentication required' });
      }
      // Redirect browsers to /login.html
      res.writeHead(302, { 'Location': `/login.html?next=${encodeURIComponent(pathname)}` });
      return res.end();
    }
    // -------------------------------------------------------------
    // API ROUTES
    // -------------------------------------------------------------

    // GET /api/suggestions (Autocomplete memory for models, CPUs, RAMs, storage, etc.)
    if (method === 'GET' && (pathname === '/api/suggestions' || pathname === 'api/suggestions')) {
      const suggestions = queries.getSuggestions();
      return sendJson(res, 200, suggestions);
    }

    // GET /api/stats
    if (method === 'GET' && pathname === 'api/stats' || pathname === '/api/stats') {
      const stats = queries.getStats();
      return sendJson(res, 200, stats);
    }

    // GET /api/logs (System Live Logs for debugging)
    if (method === 'GET' && pathname === '/api/logs') {
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '200', 10);
      return sendJson(res, 200, queries.getLogs(limit));
    }

    // DELETE /api/logs (Clear all logs)
    if (method === 'DELETE' && pathname === '/api/logs') {
      queries.clearLogs();
      queries.addLog('INFO', 'SYSTEM', 'لاگ‌های سیستم توسط مدیر پاک‌سازی شد');
      return sendJson(res, 200, { success: true });
    }

    // GET /api/network-info (shows IP for phone connection)
    if (method === 'GET' && pathname === '/api/network-info') {
      return sendJson(res, 200, {
        port: PORT,
        localIps: getLocalIpAddresses()
      });
    }

    // POST /api/gemini/analyze (Vision Spec Extraction from Photo)
    if (method === 'POST' && pathname === '/api/gemini/analyze') {
      const data = await parseRequestBody(req);
      if (!data.image) {
        queries.addLog('ERROR', 'GEMINI_VISION', 'درخواست اسکن عکس بدون تصویر ارسال شد', '', req.socket?.remoteAddress || '');
        return sendJson(res, 400, { error: 'No image provided for AI analysis' });
      }

      const imgSizeKB = Math.round((data.image.length * 0.75) / 1024);
      queries.addLog('INFO', 'GEMINI_VISION', 'درخواست اسکن عکس با هوش مصنوعی دریافت شد', `حجم تقریبی عکس: ${imgSizeKB} KB`, req.socket?.remoteAddress || '');

      try {
        const result = await extractSpecsWithGemini(data.image, data.model);
        return sendJson(res, 200, {
          success: true,
          model: result._used_model,
          specs: result
        });
      } catch (err) {
        console.error('Gemini extraction failed:', err);
        queries.addLog('ERROR', 'GEMINI_VISION', 'اسکن عکس ناموفق بود', err.message, req.socket?.remoteAddress || '');
        return sendJson(res, 500, { error: err.message });
      }
    }

    // POST /api/gemini/lookup-model (Online hardware specs lookup from model name)
    if (method === 'POST' && pathname === '/api/gemini/lookup-model') {
      const data = await parseRequestBody(req);
      if (!data.model) {
        return sendJson(res, 400, { error: 'Model name is required' });
      }

      try {
        const result = await lookupSpecsByModelOnline(data.model);
        queries.addLog('SUCCESS', 'GEMINI_LOOKUP', `مشخصات آنلاین مدل «${data.model}» استخراج شد`, `کانفیگ‌های CPU: ${Array.isArray(result.cpu_options) ? result.cpu_options.length : 0} عدد`, req.socket?.remoteAddress || '');
        return sendJson(res, 200, {
          success: true,
          model: result._used_model,
          specs: result
        });
      } catch (err) {
        console.error('Model lookup failed:', err);
        queries.addLog('ERROR', 'GEMINI_LOOKUP', `استعلام مدل «${data.model}» ناموفق بود`, err.message, req.socket?.remoteAddress || '');
        return sendJson(res, 500, { error: err.message });
      }
    }

    // GET /api/models/photo-preview (Find existing photo of same model)
    if (method === 'GET' && pathname === '/api/models/photo-preview') {
      const model = parsedUrl.searchParams.get('model');
      if (!model) return sendJson(res, 200, { found: false });

      const photo = queries.getExistingPhotoForModel(model);
      if (photo) {
        return sendJson(res, 200, {
          found: true,
          photo_id: photo.id,
          file_name: photo.file_name,
          url: `/uploads/${photo.file_name}`,
          original_name: photo.original_name,
          property_id: photo.property_id,
          model: photo.manufacturer_model
        });
      }
      return sendJson(res, 200, { found: false });
    }

    // GET /api/backup/db (Download complete SQLite database file)
    if (method === 'GET' && pathname === '/api/backup/db') {
      const dbPath = path.join(__dirname, 'asset_database.sqlite');
      if (!fs.existsSync(dbPath)) {
        return sendJson(res, 404, { error: 'Database file not found' });
      }

      const stat = fs.statSync(dbPath);
      res.writeHead(200, {
        'Content-Type': 'application/x-sqlite3',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="asset_database_backup_${Date.now()}.sqlite"`
      });
      const readStream = fs.createReadStream(dbPath);
      readStream.pipe(res);
      return;
    }

    // POST /api/backup/restore-db (Restore/Replace SQLite database)
    if (method === 'POST' && pathname === '/api/backup/restore-db') {
      const data = await parseRequestBody(req);
      if (!data.database_base64) {
        return sendJson(res, 400, { error: 'No database_base64 provided' });
      }

      try {
        const dbPath = path.join(__dirname, 'asset_database.sqlite');
        const backupPath = path.join(__dirname, `asset_database_bak_${Date.now()}.sqlite`);
        
        // Backup current database first
        if (fs.existsSync(dbPath)) {
          fs.copyFileSync(dbPath, backupPath);
        }

        const buffer = Buffer.from(data.database_base64, 'base64');
        fs.writeFileSync(dbPath, buffer);

        queries.addLog('SUCCESS', 'SYSTEM', 'دیتابیس با موفقیت بازنشانی/مهاجرت داده شد');
        return sendJson(res, 200, { success: true, message: 'Database restored successfully! Reload page.' });
      } catch (err) {
        return sendJson(res, 500, { error: `Restore failed: ${err.message}` });
      }
    }

    // GET /api/download/scanner (Download dynamic AssetScanner.bat tailored to current host)
    if (method === 'GET' && pathname === '/api/download/scanner') {
      const host = req.headers.host || '192.168.10.194:3000';
      const protocol = req.socket?.encrypted ? 'https' : 'http';
      const serverUrl = `${protocol}://${host}`;

      const scannerTemplatePath = path.join(__dirname, 'client-scripts', 'AssetScanner.bat');
      let batContent = '';
      if (fs.existsSync(scannerTemplatePath)) {
        batContent = fs.readFileSync(scannerTemplatePath, 'utf8');
        // Replace server URL dynamically
        batContent = batContent.replace(/\$SERVER_URL = ".*?"/, `$SERVER_URL = "${serverUrl}"`);
      }

      res.writeHead(200, {
        'Content-Type': 'application/x-bat',
        'Content-Disposition': 'attachment; filename="AssetScanner.bat"'
      });
      res.end(batContent);
      return;
    }

    // GET /api/download/scanner-linux (Download dynamic asset-scanner.sh for Linux clients)
    if (method === 'GET' && pathname === '/api/download/scanner-linux') {
      const host = req.headers.host || '192.168.10.194:3000';
      const protocol = req.socket?.encrypted ? 'https' : 'http';
      const serverUrl = `${protocol}://${host}`;

      const scannerTemplatePath = path.join(__dirname, 'client-scripts', 'asset-scanner.sh');
      let shContent = '';
      if (fs.existsSync(scannerTemplatePath)) {
        shContent = fs.readFileSync(scannerTemplatePath, 'utf8');
        // Replace server URL dynamically
        shContent = shContent.replace(/SERVER_URL="\$\{IAM_SERVER:-.*?\}"/, `SERVER_URL="\${IAM_SERVER:-${serverUrl}}"`);
      }

      res.writeHead(200, {
        'Content-Type': 'application/x-sh',
        'Content-Disposition': 'attachment; filename="asset-scanner.sh"'
      });
      res.end(shContent);
      return;
    }

    // GET /api/assets/next-id
    if (method === 'GET' && pathname === '/api/assets/next-id') {
      return sendJson(res, 200, { nextPropertyId: getNextPropertyId() });
    }

    // GET /api/assets
    if (method === 'GET' && pathname === '/api/assets') {
      const search = parsedUrl.searchParams.get('search') || '';
      const category = parsedUrl.searchParams.get('category') || 'all';
      const status = parsedUrl.searchParams.get('status') || 'all';
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '500', 10);
      const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);

      const assets = queries.getAllAssets({ search, category, status, limit, offset });
      return sendJson(res, 200, assets);
    }

    // GET /api/assets/:id
    const assetIdMatch = pathname.match(/^\/api\/assets\/(\d+)$/);
    if (method === 'GET' && assetIdMatch) {
      const id = parseInt(assetIdMatch[1], 10);
      const asset = queries.getAssetById(id);
      if (!asset) return sendJson(res, 404, { error: 'Asset not found' });
      return sendJson(res, 200, asset);
    }

    // POST /api/assets (Manual Asset Creation)
    if (method === 'POST' && pathname === '/api/assets') {
      const data = await parseRequestBody(req);
      if (!data.property_id) {
        data.property_id = getNextPropertyId();
      }

      // Check if property_id already exists
      const existing = queries.getAssetByPropertyId(data.property_id);
      if (existing) {
        return sendJson(res, 400, { error: `Property ID "${data.property_id}" already exists!` });
      }

      const newId = queries.createAsset(data);
      const created = queries.getAssetById(newId);

      // Optional Bale notification
      const settings = queries.getSettings();
      if (settings.bale_token && settings.bale_chat_id) {
        const text = `📦 *New Asset Registered (Manual)*\n\n` +
          `*Property ID:* ${created.property_id}\n` +
          `*Category:* ${created.category}\n` +
          `*Model:* ${created.manufacturer_model || 'N/A'}\n` +
          `*Serial:* ${created.serial_number || 'N/A'}\n` +
          `*Status:* ${created.status}\n` +
          `*Assigned User:* ${created.user_name || 'Unassigned'}\n` +
          `*Location:* ${created.location || 'N/A'}`;
        notifyBale(text).catch(() => {});
      }

      return sendJson(res, 201, created);
    }

    // PUT /api/assets/:id (Update Asset)
    if (method === 'PUT' && assetIdMatch) {
      const id = parseInt(assetIdMatch[1], 10);
      const data = await parseRequestBody(req);

      const success = queries.updateAsset(id, data);
      if (!success) return sendJson(res, 404, { error: 'Asset not found' });

      const updated = queries.getAssetById(id);
      return sendJson(res, 200, updated);
    }

    // DELETE /api/assets/:id
    if (method === 'DELETE' && assetIdMatch) {
      const id = parseInt(assetIdMatch[1], 10);
      const success = queries.deleteAsset(id);
      if (!success) return sendJson(res, 404, { error: 'Asset not found' });
      return sendJson(res, 200, { success: true });
    }

    // GET /api/pending-scans (List all items waiting for approval)
    if (method === 'GET' && pathname === '/api/pending-scans') {
      const items = queries.getPendingScans();
      return sendJson(res, 200, items);
    }

    // POST /api/pending-scans/:id/approve (Approve pending item and assign Property ID)
    const approveMatch = pathname.match(/^\/api\/pending-scans\/(\d+)\/approve$/);
    if (method === 'POST' && approveMatch) {
      const pendingId = parseInt(approveMatch[1], 10);
      const data = await parseRequestBody(req);

      try {
        const approved = queries.approvePendingScan(
          pendingId,
          data.property_id,
          data.category,
          data.status || 'active'
        );

        if (!approved) return sendJson(res, 404, { error: 'Pending item not found' });

        queries.addLog('SUCCESS', 'APPROVAL', `دستگاه از صف انتظار تایید شد: ${approved.property_id}`);
        return sendJson(res, 200, { success: true, asset_id: approved.id, property_id: approved.property_id });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // DELETE /api/pending-scans/:id (Reject / Remove pending item)
    const rejectMatch = pathname.match(/^\/api\/pending-scans\/(\d+)$/);
    if (method === 'DELETE' && rejectMatch) {
      const pendingId = parseInt(rejectMatch[1], 10);
      queries.rejectPendingScan(pendingId);
      return sendJson(res, 200, { success: true });
    }

    // POST /api/assets/scan (Ingestion Endpoint for .bat / PowerShell scripts)
    if (method === 'POST' && pathname === '/api/assets/scan') {
      const data = await parseRequestBody(req);
      const compName = data.computer_name || data.computerName;
      const serialNum = data.serial_number || data.serialNumber;
      
      if (!compName && !serialNum) {
        return sendJson(res, 400, { error: 'Invalid scan data: computer_name or serial_number required' });
      }

      const result = queries.ingestScan({
        user_name: data.user_name || data.userName,
        computer_name: compName,
        manufacturer_model: data.manufacturer_model || data.model,
        serial_number: serialNum,
        os_version: data.os_version || data.os,
        ip_address: data.ip_address || data.ip,
        cpu: data.cpu,
        ram: data.ram,
        storage_drives: data.storage_drives || data.storage,
        c_space: data.c_space || data.cSpace,
        network_devices: data.network_devices || data.networkDevices,
        gpu: data.gpu,
        monitors: data.monitors
      });

      queries.addLog('SUCCESS', 'SCANNER', 
        `اسکن دریافت شد (${result.items_count} دارایی مجزا تفکیک شد): ${compName || serialNum}`,
        `کاربر: ${data.user_name || data.userName || 'ناشناخته'}, اقلام: ${result.items.map(i => i.category + ': ' + i.name).join(' | ')}`,
        req.headers['x-forwarded-for'] || req.socket?.remoteAddress || ''
      );

      // Bale notification
      const settings = queries.getSettings();
      if (settings.bale_token && settings.bale_chat_id) {
        const host = req.headers.host || '192.168.10.194:3000';
        const protocol = req.socket?.encrypted ? 'https' : 'http';
        const queueLink = `${protocol}://${host}`;

        let text = '';
        if (result.is_update) {
          text = `🔄 *به‌روزرسانی خودکار مشخصات سیستم (اسکن مجدد)*\n\n` +
            `💻 *نام سیستم:* ${compName || 'N/A'}\n` +
            `🏷️ *کد اموال:* ${result.property_id || 'N/A'}\n` +
            `👤 *کاربر:* ${data.user_name || data.userName || 'N/A'}\n` +
            `🌐 *آدرس IP:* ${data.ip_address || data.ip || 'N/A'}\n\n` +
            `✅ مشخصات سخت‌افزاری دستگاه در انبار خودکار به‌روزرسانی شد.`;
        } else if (result.is_pending_update) {
          text = `ℹ️ *به‌روزرسانی اسکن در انتظار تایید*\n\n` +
            `💻 *نام سیستم:* ${compName || 'N/A'}\n` +
            `👤 *کاربر:* ${data.user_name || data.userName || 'N/A'}\n\n` +
            `🔔 مشخصات دستگاه در صف انتظار به‌روز شد.`;
        } else {
          const itemsSummary = result.items.map((it, idx) => `  ${idx + 1}. [${it.category}] ${it.name}`).join('\n');
          text = `📥 *دریافت اسکن جدید (در انتظار تخصیص شماره اموال)*\n\n` +
            `💻 *نام سیستم:* ${compName || 'N/A'}\n` +
            `👤 *کاربر:* ${data.user_name || data.userName || 'N/A'}\n` +
            `🌐 *آدرس IP:* ${data.ip_address || data.ip || 'N/A'}\n\n` +
            `📦 *دارایی‌های تفکیک‌شده (${result.items_count} مورد):*\n${itemsSummary}\n\n` +
            `🔔 *توجه:* برای تخصیص شماره اموال فیزیکی و تایید نهایی، وارد پنل شوید:\n` +
            `🔗 [ورود به پنل و تایید اموال](${queueLink})`;
        }
        notifyBale(text).catch(() => {});
      }

      return sendJson(res, 200, {
        success: true,
        is_update: !!result.is_update,
        is_pending_update: !!result.is_pending_update,
        property_id: result.property_id,
        message: result.message,
        batch_id: result.batch_id,
        items_count: result.items_count,
        items: result.items
      });
    }

    // POST /api/assets/:id/fetch-stock-photo (Fetch studio stock photo from Digikala / Torob / 9Router)
    const fetchStockMatch = pathname.match(/^\/api\/assets\/(\d+)\/fetch-stock-photo$/);
    if (method === 'POST' && fetchStockMatch) {
      const assetId = parseInt(fetchStockMatch[1], 10);
      const asset = queries.getAssetById(assetId);
      if (!asset) return sendJson(res, 404, { error: 'Asset not found' });

      const model = asset.manufacturer_model || asset.computer_name || 'Standard Device';
      const cat = (asset.category || '').toLowerCase();

      async function downloadImage(url) {
        if (!url || !url.startsWith('http')) return null;
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 6000);
          const resp = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: ctrl.signal
          });
          clearTimeout(timer);
          if (!resp.ok) return null;
          const ct = resp.headers.get('content-type') || '';
          if (!ct.includes('image') && !ct.includes('octet-stream')) return null;
          const buf = Buffer.from(await resp.arrayBuffer());
          if (buf.length < 2000) return null;
          return buf;
        } catch (e) {
          return null;
        }
      }

      // Helper: Verify image with 9Router Vision to ensure it matches the expected hardware
      async function verifyPhotoWithAI(targetModel, targetCategory, imgBuffer) {
        if (!imgBuffer || imgBuffer.length < 5000) return { matches: false, reason: 'حجم تصویر نامعتبر است' };
        try {
          const base64 = imgBuffer.toString('base64');
          const prompt = `You are a strict brand and hardware image verifier.
Check if this image shows the EXACT IT product or exact same brand:
- Expected Model: "${targetModel}"
- Expected Category: "${targetCategory}"

CRITICAL RULES:
1. If the expected product brand is HP, and the image shows an LG or Samsung logo/monitor, return matches: false!
2. If the expected product is Dell, and the image shows HP or Lenovo, return matches: false!
3. If the device type is wrong (e.g. cable/box/adapter instead of monitor/PC), return matches: false!

Respond ONLY in JSON format:
{
  "matches": true or false,
  "detected_device": "brand and device detected",
  "reason": "short explanation in Persian"
}`;

          const aiPromise = call9Router(prompt, base64);
          const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000));
          const aiRes = await Promise.race([aiPromise, timeoutPromise]);

          if (aiRes && typeof aiRes === 'object' && typeof aiRes.matches === 'boolean') {
            return aiRes;
          }
          if (typeof aiRes === 'string') {
            const m = aiRes.match(/\{[\s\S]*\}/);
            if (m) return JSON.parse(m[0]);
          }
        } catch (e) {
          // In case of timeout or failure, do NOT blindly accept! Reject to be safe.
          return { matches: false, reason: 'عدم تایید هوش مصنوعی (خطا یا اتمام زمان)' };
        }
        return { matches: false, reason: 'عدم دریافت تاییدیه قطعی' };
      }

      try {
        let buffer = null;
        let usedUrl = null;
        let sourceName = '';
        let aiVerification = null;

        // LAYER 1: Multi-candidate Search from Digikala & Torob with AI Vision Guard (Top 3 candidates)
        try {
          const candidateList = await fetchMultiSourceProductImages(model, cat);
          for (const item of candidateList.slice(0, 3)) {
            const candidateBuffer = await downloadImage(item.url);
            if (candidateBuffer) {
              const check = await verifyPhotoWithAI(model, cat, candidateBuffer);
              if (check.matches !== false) {
                buffer = candidateBuffer;
                usedUrl = item.url;
                sourceName = item.source;
                aiVerification = check;
                queries.addLog('SUCCESS', 'AI_VISION_MATCH', `تایید هوش مصنوعی برای عکس «${model}» از ${item.source}: ${check.reason || 'تطابق کامل'}`);
                break; // Found perfect match!
              } else {
                queries.addLog('WARNING', 'AI_VISION_REJECT', `رد عکس نامربوط از ${item.source} برای «${model}»: ${check.reason || 'عدم تطابق'}`);
              }
            }
          }
        } catch (e) {}

        // LAYER 2: Try 9Router AI Search (4s hard timeout) if Iranian stores didn't match
        if (!buffer) {
          try {
            const prompt = `Give 2 direct high-res official product image URLs (JPG/PNG) on white background for: "${model}". JSON format: {"image_urls": ["url1", "url2"]}`;
            const aiPromise = call9Router(prompt);
            const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('AI timeout')), 4000));
            const aiResponse = await Promise.race([aiPromise, timeoutPromise]);

            let candidates = [];
            if (aiResponse && typeof aiResponse === 'object') {
              const arr = aiResponse.image_urls || (aiResponse.image_url ? [aiResponse.image_url] : []);
              if (Array.isArray(arr)) candidates = arr.filter(u => typeof u === 'string' && u.startsWith('http'));
            }

            for (const url of candidates) {
              buffer = await downloadImage(url);
              if (buffer) {
                usedUrl = url;
                sourceName = 'هوش مصنوعی (9Router)';
                break;
              }
            }
          } catch (e) {}
        }

        // LAYER 3: Generate local professional product card (guaranteed instant success)
        if (!buffer) {
          const svg = generateProductCard(model, cat, assetId);
          buffer = Buffer.from(svg, 'utf-8');
          usedUrl = 'local-generated';
          sourceName = 'کارت استوک اختصاصی';
        }

        const ext = usedUrl === 'local-generated' ? '.svg' : (path.extname(new URL(usedUrl).pathname) || '.jpg').toLowerCase();
        const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(ext) ? ext : '.jpg';
        const fileName = `stock_${assetId}_${Date.now()}${safeExt}`;
        const filePath = path.join(UPLOADS_DIR, fileName);
        fs.writeFileSync(filePath, buffer);

        const photoId = queries.addPhoto(assetId, fileName, `Official_${model}${safeExt}`, `عکس استودیوئی استوک (${sourceName})`);

        queries.addLog('SUCCESS', 'STOCK_PHOTO', `عکس رسمی استوک برای مدل «${model}» از ${sourceName} ثبت شد`);

        const msg = aiVerification && aiVerification.reason
          ? `عکس استودیوئی مدل «${model}» با تایید هوش مصنوعی (${aiVerification.reason}) ثبت شد!`
          : `عکس استودیوئی مدل «${model}» با موفقیت از ${sourceName} دریافت و ست شد!`;

        return sendJson(res, 200, { success: true, message: msg, photo_id: photoId, source: sourceName, ai_verified: !!aiVerification });
      } catch (err) {
        return sendJson(res, 500, { error: 'خطا در پردازش تصویر: ' + err.message });
      }
    }

    // POST /api/models/sync-all-stock-photos (Batch sync clean stock photos for all active assets)
    if (method === 'POST' && pathname === '/api/models/sync-all-stock-photos') {
      try {
        const allAssets = queries.getAllAssets().filter(a => a.status === 'active' && a.manufacturer_model);
        let updatedCount = 0;

        for (const a of allAssets) {
          const success = queries.autoAttachPhotoIfAvailable(a.id, a.manufacturer_model);
          if (success) updatedCount++;
        }

        queries.addLog('SUCCESS', 'STOCK_SYNC', `همگام‌سازی دسته‌ای عکس‌ها انجام شد: ${updatedCount} دستگاه به‌روزرسانی شدند`);
        return sendJson(res, 200, {
          success: true,
          message: `همگام‌سازی با موفقیت انجام شد. عکس ${updatedCount} دستگاه فعال به‌روزرسانی گردید.`,
          updated_count: updatedCount
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }

    // POST /api/assets/:id/photos (Photo Upload - JSON Base64 or Multipart)
    const photoUploadMatch = pathname.match(/^\/api\/assets\/(\d+)\/photos$/);
    if (method === 'POST' && photoUploadMatch) {
      const assetId = parseInt(photoUploadMatch[1], 10);
      const asset = queries.getAssetById(assetId);
      if (!asset) return sendJson(res, 404, { error: 'Asset not found' });

      const contentType = req.headers['content-type'] || '';

      if (contentType.includes('application/json')) {
        // Base64 Photo Upload or Clone Existing Photo
        const data = await parseRequestBody(req);

        // Option A: Use existing photo from another asset of same model
        if (data.existing_photo_id) {
          const photoId = queries.attachExistingPhotoToAsset(assetId, data.existing_photo_id, data.caption || 'Device Photo');
          if (photoId) {
            return sendJson(res, 201, { success: true, photo: { id: photoId, asset_id: assetId } });
          }
        }

        if (!data.image) {
          return sendJson(res, 400, { error: 'No image data provided' });
        }

        // Expected format: data:image/jpeg;base64,.... or raw base64
        const matches = data.image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        let ext = '.jpg';
        let buffer;

        if (matches) {
          const mime = matches[1];
          if (mime === 'image/png') ext = '.png';
          else if (mime === 'image/webp') ext = '.webp';
          buffer = Buffer.from(matches[2], 'base64');
        } else {
          buffer = Buffer.from(data.image, 'base64');
        }

        const fileName = `asset_${assetId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
        const savePath = path.join(UPLOADS_DIR, fileName);

        fs.writeFileSync(savePath, buffer);

        const photoId = queries.addPhoto(assetId, fileName, data.original_name || 'photo.jpg', data.caption || 'Device Photo');
        return sendJson(res, 201, {
          success: true,
          photo: {
            id: photoId,
            asset_id: assetId,
            file_name: fileName,
            url: `/uploads/${fileName}`,
            caption: data.caption || 'Device Photo'
          }
        });
      } else {
        // Fallback for multipart
        const { buffer, boundary } = await parseMultipartBuffer(req);
        // Find file boundary
        const boundaryBuffer = Buffer.from(`--${boundary}`);
        const endBoundaryBuffer = Buffer.from(`--${boundary}--`);
        
        // Simple multipart binary extraction
        const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'));
        if (headerEnd === -1) {
          return sendJson(res, 400, { error: 'Malformed multipart data' });
        }

        const headers = buffer.subarray(0, headerEnd).toString('utf8');
        const filenameMatch = headers.match(/filename="([^"]+)"/i);
        const origName = filenameMatch ? filenameMatch[1] : 'device_photo.jpg';
        const ext = path.extname(origName).toLowerCase() || '.jpg';

        const fileStart = headerEnd + 4;
        const fileEnd = buffer.lastIndexOf(boundaryBuffer);
        const fileData = buffer.subarray(fileStart, fileEnd > fileStart ? fileEnd - 2 : buffer.length);

        const fileName = `asset_${assetId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}${ext}`;
        const savePath = path.join(UPLOADS_DIR, fileName);
        fs.writeFileSync(savePath, fileData);

        const photoId = queries.addPhoto(assetId, fileName, origName, 'Uploaded Photo');
        return sendJson(res, 201, {
          success: true,
          photo: {
            id: photoId,
            asset_id: assetId,
            file_name: fileName,
            url: `/uploads/${fileName}`,
            caption: 'Uploaded Photo'
          }
        });
      }
    }

    // DELETE /api/photos/:id
    const photoDeleteMatch = pathname.match(/^\/api\/photos\/(\d+)$/);
    if (method === 'DELETE' && photoDeleteMatch) {
      const photoId = parseInt(photoDeleteMatch[1], 10);
      const success = queries.deletePhoto(photoId);
      if (!success) return sendJson(res, 404, { error: 'Photo not found' });
      return sendJson(res, 200, { success: true });
    }

    // GET /api/export/csv
    if (method === 'GET' && pathname === '/api/export/csv') {
      const assets = queries.getAllAssets({ limit: 10000 });
      const headers = [
        'Property ID', 'Category', 'Status', 'User Name', 'Computer Name',
        'Manufacturer/Model', 'Serial Number', 'OS Version', 'IP Address',
        'CPU', 'RAM', 'Storage Drives', 'C: Drive Space', 'Network Devices',
        'GPU', 'Monitors', 'Location', 'Department', 'Notes', 'Created At', 'Last Scanned At'
      ];

      const csvEscape = (val) => {
        if (val === null || val === undefined) return '""';
        return `"${String(val).replace(/"/g, '""')}"`;
      };

      const rows = [
        headers.join(','),
        ...assets.map(a => [
          csvEscape(a.property_id),
          csvEscape(a.category),
          csvEscape(a.status),
          csvEscape(a.user_name),
          csvEscape(a.computer_name),
          csvEscape(a.manufacturer_model),
          csvEscape(a.serial_number),
          csvEscape(a.os_version),
          csvEscape(a.ip_address),
          csvEscape(a.cpu),
          csvEscape(a.ram),
          csvEscape(a.storage_drives),
          csvEscape(a.c_space),
          csvEscape(a.network_devices),
          csvEscape(a.gpu),
          csvEscape(a.monitors),
          csvEscape(a.location),
          csvEscape(a.department),
          csvEscape(a.notes),
          csvEscape(a.created_at),
          csvEscape(a.last_scanned_at)
        ].join(','))
      ].join('\r\n');

      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="it_assets_${new Date().toISOString().slice(0, 10)}.csv"`
      });
      return res.end('\uFEFF' + rows); // Include BOM for Excel UTF-8
    }

    // GET /api/settings
    if (method === 'GET' && pathname === '/api/settings') {
      const settings = queries.getSettings();
      // Mask token slightly for security
      const masked = { ...settings };
      if (masked.bale_token && masked.bale_token.length > 8) {
        masked.bale_token_preview = masked.bale_token.slice(0, 4) + '...' + masked.bale_token.slice(-4);
      }
      return sendJson(res, 200, masked);
    }

    // POST /api/settings
    if (method === 'POST' && pathname === '/api/settings') {
      const data = await parseRequestBody(req);
      queries.updateSettings(data);
      const changedKeys = Object.keys(data).join(', ');
      queries.addLog('INFO', 'SETTINGS', 'تنظیمات سیستم بروزرسانی شد', `فیلدها: ${changedKeys}`, req.socket?.remoteAddress || '');
      return sendJson(res, 200, { success: true, settings: queries.getSettings() });
    }

    // POST /api/test-bale
    if (method === 'POST' && pathname === '/api/test-bale') {
      const result = await notifyBale('🔔 *Test Notification* from IT Asset Master!\n\nYour Bale Bot connection is working perfectly.');
      return sendJson(res, 200, result);
    }

    // -------------------------------------------------------------
    // STATIC FILES (Uploads & Public UI)
    // -------------------------------------------------------------

    // Serve /uploads/*
    if (pathname.startsWith('/uploads/')) {
      const fileName = path.basename(pathname);
      const filePath = path.join(UPLOADS_DIR, fileName);

      if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Photo not found');
      }

      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' });
      return fs.createReadStream(filePath).pipe(res);
    }

    // Serve Public frontend files
    let safePath = pathname === '/' ? '/index.html' : pathname;
    let filePath = path.join(PUBLIC_DIR, safePath);

    // If file doesn't exist directly, try adding .html
    if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
      filePath = filePath + '.html';
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'text/plain';
      res.writeHead(200, { 'Content-Type': mime });
      return fs.createReadStream(filePath).pipe(res);
    }

    // Fallback to index.html for SPA-like routes
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(indexPath).pipe(res);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');

  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: 'Internal Server Error', message: err.message });
  }
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  console.log(`=======================================================`);
  console.log(`🚀 IT Asset Manager Server is running!`);
  console.log(`💻 Local Workstation: http://localhost:${PORT}`);
  if (ips.length > 0) {
    console.log(`📱 Mobile / LAN Access:`);
    ips.forEach(ip => {
      console.log(`   👉 http://${ip}:${PORT}`);
    });
  }
  console.log(`📷 Camera ready: Open on your phone to snap photos`);
  console.log(`=======================================================`);
});

module.exports = server;
