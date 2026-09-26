// server.js - Zero-dependency IT Asset Management HTTP Server
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { queries, getNextPropertyId } = require('./database');

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

// Call Gemini Vision to extract specs from photo
async function extractSpecsWithGemini(base64Image, requestedModel) {
  const settings = queries.getSettings();
  const apiKey = settings.gemini_api_key || process.env.GEMINI_API_KEY || '';
  
  if (!apiKey) {
    throw new Error('Gemini API key is not configured. Please enter your new free Gemini API key in ⚙️ Settings.');
  }

  // Model cascade: try requested model first, then fallback to others if busy
  const candidateModels = [];
  if (requestedModel) candidateModels.push(requestedModel);
  // Default cascade order
  const fallbacks = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
  for (const m of fallbacks) {
    if (!candidateModels.includes(m)) candidateModels.push(m);
  }

  // Extract raw base64 and mime
  let mimeType = 'image/jpeg';
  let cleanB64 = base64Image;
  const match = base64Image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (match) {
    mimeType = match[1];
    cleanB64 = match[2];
  }

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
  "notes": "Any other helpful information observed (ports, condition, MAC address, power rating, asset numbers)"
}

Rules:
1. If the device is a desktop tower / all-in-one / mini PC for one user, classify as "Single PC" or "PC".
2. Read stickers and printed labels carefully for Serial Numbers and Models.
3. If a field cannot be determined from the image, return null for that field.
4. Output MUST be pure JSON with NO markdown code fences.
`;

  let lastError = null;

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: cleanB64 } }
          ]
        }],
        generationConfig: {
          response_mime_type: 'application/json',
          temperature: 0.1
        }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        lastError = `Model ${model} returned HTTP ${res.status}: ${errText.slice(0, 150)}`;
        console.warn(`Gemini ${model} failed, trying next candidate...`);
        continue;
      }

      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        lastError = `Model ${model} returned empty response`;
        continue;
      }

      // Parse JSON safely
      const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      parsed._used_model = model;
      return parsed;
    } catch (err) {
      lastError = `Model ${model} error: ${err.message}`;
      console.warn(lastError);
    }
  }

  throw new Error(`All Gemini models failed. Last error: ${lastError}`);
}

// Online Hardware Spec Search by Model name using AI Knowledge Base
async function lookupSpecsByModelOnline(modelName) {
  const settings = queries.getSettings();
  const apiKey = settings.gemini_api_key || process.env.GEMINI_API_KEY || '';

  if (!apiKey) {
    throw new Error('برای استعلام آنلاین مشخصات، لطفاً کلید رایگان جمینای را در ⚙️ تنظیمات وارد نمایید.');
  }

  const fallbacks = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-flash-latest'];
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

Rules:
1. If the model is recognized, provide accurate, clean hardware names.
2. If it is unknown, set "recognized": false.
3. Output MUST be valid JSON with NO markdown formatting.
`;

  let lastError = null;
  for (const model of fallbacks) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          response_mime_type: 'application/json',
          temperature: 0.1
        }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }

      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) continue;

      const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      parsed._used_model = model;
      return parsed;
    } catch (err) {
      lastError = err.message;
    }
  }

  throw new Error(`خطا در ارتباط با سرور هوش مصنوعی: ${lastError}`);
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
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `iam_sess=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`
        });
        return res.end(JSON.stringify({ success: true }));
      }
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
        return sendJson(res, 400, { error: 'No image provided for AI analysis' });
      }

      try {
        const result = await extractSpecsWithGemini(data.image, data.model);
        return sendJson(res, 200, {
          success: true,
          model: result._used_model,
          specs: result
        });
      } catch (err) {
        console.error('Gemini extraction failed:', err);
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
        return sendJson(res, 200, {
          success: true,
          model: result._used_model,
          specs: result
        });
      } catch (err) {
        console.error('Model lookup failed:', err);
        return sendJson(res, 500, { error: err.message });
      }
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

      const asset = queries.getAssetById(result.id);

      // Bale notification for scans
      const settings = queries.getSettings();
      if (settings.bale_token && settings.bale_chat_id) {
        const text = `🖥️ *${result.is_new ? 'New Device Discovered' : 'Device Specs Updated'}*\n\n` +
          `*Property ID:* ${asset.property_id}\n` +
          `*Computer Name:* ${asset.computer_name || 'N/A'}\n` +
          `*User:* ${asset.user_name || 'N/A'}\n` +
          `*Model:* ${asset.manufacturer_model || 'N/A'}\n` +
          `*Serial:* ${asset.serial_number || 'N/A'}\n` +
          `*OS:* ${asset.os_version || 'N/A'}\n` +
          `*IP:* ${asset.ip_address || 'N/A'}\n` +
          `*CPU:* ${asset.cpu || 'N/A'}\n` +
          `*RAM:* ${asset.ram || 'N/A'}\n` +
          `*Monitors:* ${asset.monitors || 'N/A'}`;
        notifyBale(text).catch(() => {});
      }

      return sendJson(res, 200, {
        success: true,
        is_new: result.is_new,
        asset_id: result.id,
        property_id: result.property_id,
        message: result.is_new ? 'Asset created successfully' : 'Asset updated successfully'
      });
    }

    // POST /api/assets/:id/photos (Photo Upload - JSON Base64 or Multipart)
    const photoUploadMatch = pathname.match(/^\/api\/assets\/(\d+)\/photos$/);
    if (method === 'POST' && photoUploadMatch) {
      const assetId = parseInt(photoUploadMatch[1], 10);
      const asset = queries.getAssetById(assetId);
      if (!asset) return sendJson(res, 404, { error: 'Asset not found' });

      const contentType = req.headers['content-type'] || '';

      if (contentType.includes('application/json')) {
        // Base64 Photo Upload (most reliable across mobile browsers!)
        const data = await parseRequestBody(req);
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
