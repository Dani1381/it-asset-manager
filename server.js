// server.js - Zero-dependency IT Asset Management HTTP Server
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {
  queries,
  getNextPropertyId,
  DB_PATH,
  BACKUPS_DIR,
  checkpointDb,
  createAutomaticBackup,
  checkDbIntegrity
} = require('./database');
const { generateProductCard } = require('./svg_generator');
const { fetchMultiSourceProductImages } = require('./multi_store_scraper');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// ---------------------------------------------------------------------------
// AUTHENTICATION (server-side sessions + role checks)
// ---------------------------------------------------------------------------
// Every page and API call needs a logged-in session. Viewers may only read;
// anything that changes data, and sensitive reads (settings, users, backups,
// logs, scanner downloads), is admin-only. Network scanners authenticate with
// the scanner key (embedded automatically in the downloaded scanner) or with
// the optional SITE_PASSWORD environment variable.
const SITE_PASSWORD = process.env.SITE_PASSWORD || '';
const SESSION_COOKIE = 'iam_sess';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSecretSetting(key, bytes) {
  let value = queries.getSettings()[key];
  if (!value) {
    value = crypto.randomBytes(bytes).toString(key === 'scanner_key' ? 'base64url' : 'hex');
    queries.updateSettings({ [key]: value });
  }
  return value;
}
const SESSION_SECRET = getSecretSetting('session_secret', 32);
const getScannerKey = () => getSecretSetting('scanner_key', 18);

function signValue(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function buildSessionToken(userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${signValue(payload)}`;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
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

// Returns the logged-in user ({id, username, full_name, role, is_admin}) or null
function getSessionUser(req) {
  const token = getRequestCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  if (!safeEqual(token.slice(dot + 1), signValue(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;
    return queries.getUserById(data.uid); // re-read so role changes / deletions apply immediately
  } catch (e) {
    return null;
  }
}

function hasScannerKey(req) {
  const key = req.headers['x-iam-key'];
  if (!key) return false;
  if (SITE_PASSWORD && safeEqual(key, SITE_PASSWORD)) return true;
  return safeEqual(key, getScannerKey());
}

function sessionCookieHeader(token, req) {
  const secure = req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  if (!token) return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`;
}

// Reachable without logging in (login page and what it needs)
const PUBLIC_PATHS = new Set(['/login.html', '/login', '/style.css', '/i18n.js', '/favicon.ico', '/api/login', '/api/auth-status', '/api/logout']);
// Scanner ingestion: session OR scanner key
const SCANNER_PATHS = new Set(['/api/scan', '/api/assets/scan', '/api/scanner/log']);
// Sensitive GET endpoints that only admins may read
const ADMIN_READ_PREFIXES = ['/api/settings', '/api/users', '/api/backup', '/api/logs', '/api/download/', '/api/pending-scans', '/api/photo-jobs'];

// Simple in-memory brute-force protection for /api/login
const loginFailures = new Map(); // ip -> { count, first }
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
}
function isLoginBlocked(ip) {
  const rec = loginFailures.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > LOGIN_WINDOW_MS) { loginFailures.delete(ip); return false; }
  return rec.count >= LOGIN_MAX_FAILURES;
}
function noteLoginFailure(ip) {
  const rec = loginFailures.get(ip);
  if (!rec || Date.now() - rec.first > LOGIN_WINDOW_MS) loginFailures.set(ip, { count: 1, first: Date.now() });
  else rec.count++;
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

// 9Router Gateway Configuration (local OpenAI-compatible gateway)
// Priority: values saved in Settings (admin panel) > environment variables > defaults.
// The API key is never stored in the repository.
const NINE_ROUTER_DEFAULT_URL = 'http://127.0.0.1:20128/v1/chat/completions';

// Accepts a full endpoint or just the base address (http://host:port or http://host:port/v1)
function normalizeNineRouterUrl(url) {
  let u = String(url || '').trim();
  if (!u) return NINE_ROUTER_DEFAULT_URL;
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  u = u.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(u)) return u;
  if (/\/v1$/i.test(u)) return u + '/chat/completions';
  return u + '/v1/chat/completions';
}

function getNineRouterConfig(overrides = {}) {
  const s = queries.getSettings();
  return {
    url: normalizeNineRouterUrl(overrides.url || s.nine_router_url || process.env.NINE_ROUTER_URL || NINE_ROUTER_DEFAULT_URL),
    key: String(overrides.key || s.nine_router_key || process.env.DANI_API_KEY || process.env.NINE_ROUTER_KEY || '').trim(),
    model: String(overrides.model || s.nine_router_model || process.env.NINE_ROUTER_MODEL || 'opus').trim()
  };
}

// Low-level request: returns the assistant's text (handles JSON and SSE replies)
async function nineRouterChat(messages, cfg, { timeoutMs = 120000, maxTokens } = {}) {
  if (!cfg.key) {
    throw new Error('9Router API key is not set (Settings → AI / 9Router)');
  }
  const payload = { model: cfg.model, messages };
  if (maxTokens) payload.max_tokens = maxTokens;

  let res;
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`9Router did not answer within ${Math.round(timeoutMs / 1000)}s (${cfg.url})`);
    }
    const code = err && err.cause && err.cause.code ? ` [${err.cause.code}]` : '';
    throw new Error(`Cannot reach 9Router at ${cfg.url}${code} — is it running?`);
  }

  if (!res.ok) {
    const errText = await res.text();
    const hint = res.status === 401 || res.status === 403 ? ' (API key rejected)' : '';
    throw new Error(`9Router error ${res.status}${hint}: ${errText.slice(0, 150)}`);
  }

  const raw = await res.text();
  let fullText = '';

  // Handle SSE streaming or standard JSON response
  if (raw.includes('data:')) {
    for (const line of raw.split('\n')) {
      if (line.startsWith('data: ') && !line.includes('[DONE]')) {
        try {
          const chunk = JSON.parse(line.slice(6));
          fullText += chunk.choices?.[0]?.delta?.content || '';
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
  return fullText;
}

// Helper: Call 9Router AI Gateway and parse a JSON answer
// base64Image may be one image or an array of images (sent in order)
async function call9Router(promptText, base64Image = null, chatOptions = {}) {
  const content = [{ type: 'text', text: promptText }];

  for (const img of (Array.isArray(base64Image) ? base64Image : [base64Image]).filter(Boolean)) {
    const fullDataUrl = img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`;
    content.push({ type: 'image_url', image_url: { url: fullDataUrl } });
  }

  const fullText = await nineRouterChat([{ role: 'user', content }], getNineRouterConfig(), chatOptions);
  if (!String(fullText || '').trim()) throw new Error('9Router returned an empty answer');

  const cleanJson = fullText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const firstBrace = cleanJson.indexOf('{');
  const lastBrace = cleanJson.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(cleanJson.substring(firstBrace, lastBrace + 1));
  }
  return JSON.parse(cleanJson);
}

// Connection tests for the Settings panel
async function testNineRouter(overrides) {
  const cfg = getNineRouterConfig(overrides);
  const started = Date.now();
  const reply = await nineRouterChat(
    [{ role: 'user', content: 'Connection test. Reply with exactly: OK' }],
    cfg,
    { timeoutMs: 25000, maxTokens: 10 }
  );
  return {
    ok: true,
    provider: '9router',
    url: cfg.url,
    model: cfg.model,
    latency_ms: Date.now() - started,
    reply: String(reply || '').trim().slice(0, 60)
  };
}

async function testGeminiKey(key) {
  const k = String(key || queries.getSettings().gemini_api_key || '').trim();
  if (!k) throw new Error('Gemini API key is empty');
  const started = Date.now();
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(k)}`, {
      signal: AbortSignal.timeout(15000)
    });
  } catch (err) {
    throw new Error('Cannot reach Google (generativelanguage.googleapis.com) from this server');
  }
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error?.message || ''; } catch {}
    throw new Error(`Gemini rejected the key (${res.status})${msg ? ': ' + msg.slice(0, 120) : ''}`);
  }
  return { ok: true, provider: 'gemini', latency_ms: Date.now() - started };
}

// Map whatever category text the AI returns ("modem", "Wi-Fi router", "مودم", ...)
// onto one of the app's category values. Falls back to the model name.
const CATEGORY_VALUES = ['PC', 'Single PC', 'All-in-One', 'Laptop', 'Server', 'Monitor', 'Storage', 'Printer', 'Modem', 'Router',
  'Access Point', 'Network', 'UPS', 'VoIP Phone', 'Camera', 'Projector', 'Tablet', 'Peripheral',
  'Refrigerator', 'TV', 'Attendance Device', 'Water Cooler', 'Heater', 'Air Conditioner', 'Kitchen Appliance', 'Fan', 'Office Machine', 'Other'];
const CATEGORY_KEYWORDS = [
  // Appliances / office equipment first: "Smart TV display", "fingerprint terminal" must not land in Monitor / Peripheral
  ['Attendance Device', /attendance|time\s*clock|fingerprint|biometric|zkteco|\bzk\b|virdi|suprema|anviz|حضور\s*و\s*غیاب|انگشت/i],
  ['TV', /\btv\b|television|smart\s*tv|تلویزیون/i],
  ['Refrigerator', /refrigerator|fridge|freezer|یخچال|فریزر/i],
  ['Water Cooler', /water\s*(cooler|dispenser)|آب\s*سرد|آبسرد/i],
  ['Heater', /heater|radiator|بخاری|گرمایش|شوفاژ/i],
  ['Air Conditioner', /air\s*condition|\bsplit\b|\bac unit\b|کولر|اسپلیت/i],
  ['Kitchen Appliance', /microwave|kettle|samovar|tea\s*maker|coffee|toaster|مایکروویو|سماور|چای\s*ساز|قهوه\s*ساز/i],
  ['Fan', /\bfan\b|پنکه/i],
  ['All-in-One', /all.?in.?one|\baio\b|eliteone|proone|\bimac\b|ideacentre\s*a\d|thinkcentre\s*m\d{2,3}z|آل\s*این\s*وان/i],
  ['Office Machine', /shredder|laminat|binding|paper\s*cutter|کاغذ\s*خرد|پرس|لمینت/i],
  ['Modem', /modem|adsl|vdsl|dsl-|\blte\b|\b4g\b|\b5g\b|gpon|ont\b|archer\s*vr|\bvr\d{3}|\btl-mr\d|\bmr\d{4}|\bb3\d{2}\b|\be5\d{3}|مودم/i],
  ['Access Point', /access\s*point|\bap\b|unifi|\beap\d|cap\s*ac|mesh|اکسس/i],
  ['Router', /router|routerboard|mikrotik|\brb\d|\bccr\d|\bhap\b|\bisr\s*\d|روتر/i],
  ['Network', /switch|firewall|fortigate|patch\s*panel|catalyst|سوییچ|سوئیچ|فایروال/i],
  ['Storage', /\bssd\b|\bhdd\b|nvme|hard\s*(disk|drive)|\bnas\b|external\s*drive|barracuda|wd\s*(blue|black|red|purple)|هارد|حافظه/i],
  ['Server', /server|proliant|poweredge|thinksystem|سرور/i],
  ['UPS', /\bups\b|back-ups|smart-ups|یو\s*پی\s*اس/i],
  ['VoIP Phone', /voip|ip\s*phone|sip-|grandstream|yealink|\bphone\b|تلفن/i],
  ['Camera', /cctv|\bdvr\b|\bnvr\b|ip\s*camera|hikvision|dahua|دوربین/i],
  ['Projector', /projector|پروژکتور/i],
  ['Tablet', /tablet|ipad|galaxy\s*tab|تبلت/i],
  ['Peripheral', /keyboard|mouse|headset|webcam|speaker|کیبورد|ماوس|هدست/i],
  ['Printer', /printer|scanner|laserjet|copier|mfp|پرینتر|اسکنر/i],
  ['Monitor', /monitor|display|screen|مانیتور|نمایشگر/i],
  ['Laptop', /laptop|notebook|latitude|thinkpad|elitebook|probook|macbook|لپ\s*تاپ|لپ‌تاپ/i],
  ['PC', /desktop|\bpc\b|tower|optiplex|elitedesk|prodesk|thinkcentre|کیس|کامپیوتر/i]
];

function normalizeCategory(rawCategory, modelName = '') {
  const raw = String(rawCategory || '').trim();
  const exact = CATEGORY_VALUES.find(c => c.toLowerCase() === raw.toLowerCase());
  if (exact && exact !== 'Other') return exact;
  for (const text of [raw, String(modelName || '')]) {
    if (!text) continue;
    for (const [cat, re] of CATEGORY_KEYWORDS) if (re.test(text)) return cat;
  }
  return exact || (raw ? 'Other' : null);
}

// Call 9Router AI to extract specs from photo
async function extractSpecsWithGemini(base64Image, requestedModel) {
  const prompt = `
You are an expert IT Asset & Hardware Inventory Analyst.
Examine this image of an IT hardware device or its specification label/sticker very carefully.

EXTRACT the following information as strictly structured JSON:
CATEGORY GUIDE (pick the single best match, using the exact English value):
- Modem: ADSL/VDSL/fiber/4G/LTE/5G modems and modem-routers from an ISP (e.g. TP-Link VR300, D-Link DSL-2750U, Huawei B311)
- Router: routers without a DSL/LTE modem (e.g. MikroTik hAP / RB / CCR, Cisco ISR, TP-Link Archer router)
- Access Point: Wi-Fi access points and mesh units (e.g. UniFi, EAP225, cAP)
- Network: network switches, patch panels, firewalls
- Storage: a loose hard drive, SSD, NVMe, external disk or NAS
- Server: rack/tower servers (ProLiant, PowerEdge)
- UPS: uninterruptible power supplies; VoIP Phone: desk / IP phones; Camera: CCTV cameras, DVR/NVR
- Projector; Tablet: tablets and phones; Peripheral: keyboard, mouse, headset, webcam
- PC: desktop computers / cases; All-in-One: computer built into its screen (EliteOne, ProOne, OptiPlex AIO, iMac); Laptop; Monitor; Printer: printers, scanners, copiers
- Refrigerator; TV: televisions; Attendance Device: fingerprint / card time-attendance terminals; Water Cooler: water dispensers; Heater: electric heaters / radiators; Air Conditioner: split / AC units; Kitchen Appliance: microwave, kettle, samovar, coffee maker; Fan; Office Machine: shredder, laminator, binding machine

{
  "category": "PC" | "Single PC" | "All-in-One" | "Laptop" | "Server" | "Monitor" | "Storage" | "Printer" | "Modem" | "Router" | "Access Point" | "Network" | "UPS" | "VoIP Phone" | "Camera" | "Projector" | "Tablet" | "Peripheral" | "Refrigerator" | "TV" | "Attendance Device" | "Water Cooler" | "Heater" | "Air Conditioner" | "Kitchen Appliance" | "Fan" | "Office Machine" | "Other",
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
    if (parsed && typeof parsed === 'object') parsed.category = normalizeCategory(parsed.category, parsed.manufacturer_model);
    parsed._used_model = '9Router (opus)';
    queries.addLog('SUCCESS', '9ROUTER_VISION', 'عکس با موفقیت توسط گیت‌وی 9Router تحلیل شد', `مدل شناسایی شده: ${parsed.manufacturer_model || 'نامشخص'}`);
    return parsed;
  } catch (err) {
    queries.addLog('ERROR', '9ROUTER_VISION', 'خطا در گیت‌وی 9Router', err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Smart scan: stage 1 reads every photo on its own, stage 2 reconciles all
// findings (with database context) and decides which value belongs in which field.
// ---------------------------------------------------------------------------
const SMART_SCAN_MAX_IMAGES = 6;
const SCAN_FIELDS = ['property_id', 'category', 'manufacturer_model', 'serial_number', 'computer_name', 'ip_address',
  'user_name', 'location', 'department', 'purchase_date', 'cpu', 'ram', 'storage_drives', 'gpu', 'monitors'];

const SCAN_CATEGORY_LIST = '"PC" | "All-in-One" | "Laptop" | "Server" | "Monitor" | "Storage" | "Printer" | "Modem" | "Router" | "Access Point" | "Network" | "UPS" | "VoIP Phone" | "Camera" | "Projector" | "Tablet" | "Peripheral" | "Refrigerator" | "TV" | "Attendance Device" | "Water Cooler" | "Heater" | "Air Conditioner" | "Kitchen Appliance" | "Fan" | "Office Machine" | "Other"';

function toLatinDigits(s) {
  return String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function cleanScanValue(v) {
  if (v === null || v === undefined || typeof v === 'object') return null;
  const t = String(v).trim();
  if (!t || /^(null|none|n\/a|na|unknown|-|\.|نامشخص|ندارد)$/i.test(t)) return null;
  return t.slice(0, 200);
}

const PHOTO_READ_PROMPT = `
You are an IT asset inventory assistant. This is ONE of several photos of the SAME device (device body, labels, stickers, screen...).
Read everything you can see in THIS photo and return STRICT JSON only (no markdown). Use null for anything not visible. Never guess.

{
  "photo_kind": "property_tag" | "spec_label" | "device_front" | "device_back" | "screen" | "other",
  "full_view": true if the WHOLE device is visible from a distance (good as the device's cover photo), false for close-ups of labels / parts,
  "category": ${SCAN_CATEGORY_LIST},
  "manufacturer_model": "brand + model as printed (e.g. HP EliteDesk 800 G3 SFF, Samsung S24R350)",
  "serial_number": "S/N, Serial No, Service Tag",
  "property_id": "organisation property / asset tag number",
  "computer_name": "host name if shown (e.g. on a sticker or screen)",
  "ip_address": "IPv4 if written",
  "mac_address": "MAC if written",
  "user_name": "person's name written on a label, if any",
  "location": "room / floor written on a label, if any",
  "department": "department written on a label, if any",
  "purchase_date": "purchase / delivery / warranty start date as printed",
  "cpu": "processor", "ram": "memory size", "storage_drives": "disk / SSD",
  "gpu": "graphics", "monitors": "screen size / resolution (for monitors, laptops)",
  "damage": "visible physical damage (cracks, broken parts, burns), else null",
  "visible_text": "short list of the important printed texts and numbers, verbatim"
}

How to tell the numbers apart:
- property_id = the ORGANISATION's tag: a sticker / plate usually saying "اموال", "شماره اموال", "کد اموال", "Asset Tag", "Asset No", "Property of ..." or a company logo with a number / barcode. Copy the number exactly (convert Persian digits to 0-9).
- serial_number is from the MANUFACTURER (S/N, Serial, SN, Service Tag) — never put it in property_id.
- Do NOT use P/N, Product No, Model No, Regulatory model, MAC, IMEI, EAN/UPC barcodes as serial or property numbers.
`;

async function readOnePhoto(base64Image) {
  const parsed = await call9Router(PHOTO_READ_PROMPT, base64Image);
  if (!parsed || typeof parsed !== 'object') throw new Error('Empty AI answer');
  return parsed;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { results[i] = { ok: true, value: await fn(items[i], i) }; }
      catch (err) { results[i] = { ok: false, error: err.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Fallback when the reconcile call fails: per field, the value most photos agree on
// (labels / tags win ties, they are close-ups made for reading)
function mergeFindingsLocally(findings) {
  const fields = {}, sources = {}, confidence = {};
  const kindWeight = { property_tag: 3, spec_label: 3, screen: 2, device_back: 1, device_front: 1, other: 1 };
  for (const f of SCAN_FIELDS) {
    const votes = new Map();
    findings.forEach(p => {
      const v = cleanScanValue(p.data[f]);
      if (!v) return;
      const key = v.toLowerCase().replace(/\s+/g, ' ');
      const cur = votes.get(key) || { value: v, weight: 0, photos: [] };
      cur.weight += kindWeight[p.data.photo_kind] || 1;
      cur.photos.push(p.photo);
      votes.set(key, cur);
    });
    const best = [...votes.values()].sort((a, b) => b.weight - a.weight)[0];
    if (best) {
      fields[f] = best.value;
      sources[f] = best.photos;
      confidence[f] = votes.size === 1 ? 'high' : 'medium';
    }
  }
  return { fields, sources, confidence, notes: '', warnings: [] };
}

async function reconcileFindings(findings) {
  // Database context: how property numbers look here + similar models already registered
  const settings = queries.getSettings();
  const knownModels = new Set();
  for (const p of findings) {
    const m = cleanScanValue(p.data.manufacturer_model);
    if (m) queries.searchModels(m, null, 4).forEach(r => knownModels.add(`${r.model} [${r.category}]`));
  }

  const prompt = `
You are the final reviewer of an IT asset intake form. Several photos of ONE device were read separately.
Your job: decide the single best value for every form field and put each value in the RIGHT field.

PHOTO FINDINGS (photo numbers start at 1):
${JSON.stringify(findings.map(p => ({ photo: p.photo, ...p.data })), null, 1)}

DATABASE CONTEXT:
- Property-tag prefix used by the app for generated ids: "${settings.asset_tag_prefix || 'AST-'}"
- Recent property ids already in the database (format examples): ${JSON.stringify(queries.recentPropertyIds(8))}
- Similar models already registered (prefer these exact spellings when it is clearly the same model): ${JSON.stringify([...knownModels].slice(0, 12))}

RULES:
1. Use only information present in the findings (including "visible_text"). Never invent values.
2. Move values that ended up in the wrong field (e.g. an asset-tag number read as serial, a host name read as model).
3. property_id = the organisation's property / asset tag number. serial_number = the manufacturer's S/N. They are never the same number.
4. When photos disagree, prefer close-up labels (photo_kind property_tag / spec_label) and values seen in more photos.
5. Normalise: Latin digits; serial without spaces; ram like "8 GB"; purchase_date as YYYY-MM-DD (convert a Jalali date like 1402/05/10 to Gregorian).
6. category must be one of: ${SCAN_CATEGORY_LIST}.
7. "notes": a short PERSIAN summary of other useful facts (MAC address, damage, warranty, anything without a field). Empty string if nothing.
8. "warnings": PERSIAN strings for doubts the operator should check (conflicting numbers, unreadable digits...).

Return STRICT JSON only:
{
  "fields": { ${SCAN_FIELDS.map(f => `"${f}": "value or null"`).join(', ')} },
  "sources": { "<field>": [photo numbers the value came from] },
  "confidence": { "<field>": "high" | "medium" | "low" },
  "notes": "",
  "warnings": []
}
`;
  const parsed = await call9Router(prompt);
  if (!parsed || typeof parsed !== 'object' || typeof parsed.fields !== 'object') throw new Error('Reconcile answer has no fields');
  return parsed;
}

// ---------------------------------------------------------------------------
// Photo intake queue worker: one job at a time, in order. Results wait for review.
// ---------------------------------------------------------------------------
let photoQueueBusy = false;
async function runPhotoQueue() {
  if (photoQueueBusy) return;
  photoQueueBusy = true;
  try {
    let job;
    while ((job = queries.nextQueuedPhotoJob())) {
      queries.updatePhotoJob(job.id, { status: 'processing', error: null });
      try {
        const images = job.photo_files.map(f => {
          const buf = fs.readFileSync(path.join(UPLOADS_DIR, f));
          return `data:image/jpeg;base64,${buf.toString('base64')}`;
        });
        const result = await smartScanPhotos(images, images);
        queries.updatePhotoJob(job.id, { status: 'ready', result });
        queries.addLog('SUCCESS', 'PHOTO_QUEUE', `صف عکس #${job.id} پردازش شد`, `مدل: ${result.fields.manufacturer_model || '-'} | اموال: ${result.fields.property_id || '-'}`);
      } catch (err) {
        queries.updatePhotoJob(job.id, { status: 'failed', error: err.message });
        queries.addLog('ERROR', 'PHOTO_QUEUE', `پردازش صف عکس #${job.id} ناموفق بود`, err.message);
      }
    }
  } finally {
    photoQueueBusy = false;
  }
}

function savePhotoJobImage(dataUrl, jobKey, index) {
  const m = String(dataUrl).match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
  if (!m) throw new Error('Invalid image');
  const ext = m[1] === 'png' ? '.png' : m[1] === 'webp' ? '.webp' : '.jpg';
  const name = `queue_${jobKey}_${index}${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), Buffer.from(m[2], 'base64'));
  return name;
}

function removeQueueFiles(files) {
  for (const f of files || []) {
    if (!/^queue_[A-Za-z0-9_.-]+$/.test(f)) continue;
    try { fs.unlinkSync(path.join(UPLOADS_DIR, f)); } catch {}
  }
}

// Fill empty spec fields from the online model lookup. Computers: CPU / GPU only (RAM and disks vary per unit).
async function enrichFromInternet(fields) {
  const fam = ['PC', 'Single PC', 'All-in-One', 'Laptop', 'Server'].includes(fields.category) ? 'computer' : (fields.category || 'other');
  // A same-model record already in the database fills these when the asset is saved; no need to ask online
  if (queries.getModelSpecTemplate(fields.manufacturer_model, fam === 'computer' ? null : fields.category)) return [];

  const s = await lookupSpecsByModelOnline(fields.manufacturer_model);
  if (!s || s.recognized === false) return [];
  const clean = v => (typeof v === 'string' && v.trim() && !/^\s*n\/?a\b|^null$/i.test(v) ? v.trim().slice(0, 200) : null);
  const plan = fam === 'computer'
    ? { cpu: s.default_cpu, gpu: s.gpu }
    : fam === 'Monitor' ? { monitors: s.monitors }
    : fam === 'Storage' ? { storage_drives: s.default_storage }
    : {};
  if (!fields.category) {
    const c = normalizeCategory(s.category, fields.manufacturer_model);
    if (c) plan.category = c;
  }
  const filled = [];
  for (const [f, v] of Object.entries(plan)) {
    if (!fields[f] && clean(v)) { fields[f] = clean(v); filled.push(f); }
  }
  return filled;
}

// Fast path: every photo in ONE request that reads and reconciles at the same time
async function readAllPhotosAtOnce(images) {
  const settings = queries.getSettings();
  const prompt = `
You are an IT asset intake assistant. The ${images.length} attached photos (photo 1 = first image, in order) all show the SAME device:
its body, labels, stickers, screen... Read every photo, then fill the intake form with the single best value per field,
putting each value in the RIGHT field. Use null for anything not visible. Never guess or invent.

How to tell the numbers apart:
- property_id = the ORGANISATION's tag: a sticker / plate usually saying "اموال", "شماره اموال", "کد اموال", "Asset Tag", "Asset No",
  "Property of ..." or a company logo with a number / barcode. Copy the number exactly.
- serial_number is from the MANUFACTURER (S/N, Serial, SN, Service Tag) — never the same number as property_id.
- Do NOT use P/N, Product No, Model No, Regulatory model, MAC, IMEI, EAN/UPC barcodes as serial or property numbers.
- Property ids already in this database look like: ${JSON.stringify(queries.recentPropertyIds(8))}

When photos disagree, prefer close-up labels and values seen in more photos.
Normalise: Latin digits; serial without spaces; ram like "8 GB"; purchase_date as YYYY-MM-DD (convert a Jalali date like 1402/05/10 to Gregorian).

Return STRICT JSON only (no markdown):
{
  "photos": [ { "photo": 1, "photo_kind": "property_tag" | "spec_label" | "device_front" | "device_back" | "screen" | "other",
                "full_view": true if the WHOLE device is visible from a distance, "damage": "visible physical damage or null" } ],
  "fields": { ${SCAN_FIELDS.map(f => `"${f}": "value or null"`).join(', ')} },
  "sources": { "<field>": [photo numbers the value came from] },
  "confidence": { "<field>": "high" | "medium" | "low" },
  "notes": "short PERSIAN summary of other useful facts (MAC, warranty, damage...) or empty string",
  "warnings": ["PERSIAN strings for doubts the operator should check (conflicting or unreadable numbers...)"]
}
category must be one of: ${SCAN_CATEGORY_LIST}.
Asset-tag prefix the app uses for generated ids (not printed on stickers): "${settings.asset_tag_prefix || 'AST-'}".
`;
  // The free vision model sometimes answers empty or stalls: cap each try and retry once before the slow path
  let parsed = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
    try {
      const p = await call9Router(prompt, images, { timeoutMs: 75000 });
      if (p && typeof p === 'object' && typeof p.fields === 'object') parsed = p;
      else lastErr = new Error('Combined scan answer has no fields');
    } catch (err) {
      lastErr = err;
      console.warn(`Combined smart scan attempt ${attempt} failed: ${err.message}`);
      // A stall means the gateway is overloaded; waiting another 75s would only double the delay
      if (/did not answer within/i.test(err.message)) break;
    }
  }
  if (!parsed) throw lastErr || new Error('Combined scan failed');
  const perPhoto = Array.isArray(parsed.photos) ? parsed.photos : [];
  const findings = images.map((_, i) => {
    const p = perPhoto.find(x => Number(x.photo) === i + 1) || perPhoto[i] || {};
    return { photo: i + 1, data: { photo_kind: p.photo_kind || null, full_view: p.full_view === true, damage: p.damage || null } };
  });
  return { merged: parsed, findings };
}

// A key number (property tag / serial) is missing or uncertain: re-read only the label photos at full quality
async function refineKeyNumbers(merged, findings, fullImages) {
  const doubtful = ['property_id', 'serial_number'].filter(f => !cleanScanValue(merged.fields[f]) || (merged.confidence || {})[f] === 'low');
  const labelPhotos = findings.filter(p => ['property_tag', 'spec_label'].includes(p.data.photo_kind) && fullImages[p.photo - 1]);
  if (!doubtful.length || !labelPhotos.length) return [];

  const reads = await mapWithConcurrency(labelPhotos, 3, p => readOnePhoto(fullImages[p.photo - 1]));
  const refined = [];
  for (const f of doubtful) {
    // property tags come from the tag sticker first, serials from the spec label first
    const prefer = f === 'property_id' ? 'property_tag' : 'spec_label';
    const hits = reads.map((r, i) => (r.ok && cleanScanValue(r.value[f]) ? { photo: labelPhotos[i].photo, kind: r.value.photo_kind, value: cleanScanValue(r.value[f]) } : null)).filter(Boolean)
      .sort((a, b) => (b.kind === prefer) - (a.kind === prefer));
    if (!hits.length) continue;
    merged.fields[f] = hits[0].value;
    merged.sources = merged.sources || {};
    merged.confidence = merged.confidence || {};
    merged.sources[f] = [hits[0].photo];
    merged.confidence[f] = hits.every(h => h.value === hits[0].value) ? 'high' : 'medium';
    refined.push(f);
  }
  return refined;
}

// Slow path (fallback): read each photo on its own, then reconcile the findings
async function readPhotosSeparately(images) {
  const reads = await mapWithConcurrency(images, 3, img => readOnePhoto(img));
  const findings = reads.map((r, i) => (r.ok ? { photo: i + 1, data: r.value } : null)).filter(Boolean);
  if (!findings.length) throw new Error(`هیچ عکسی خوانده نشد: ${reads[0] && reads[0].error ? reads[0].error : 'خطای نامشخص'}`);
  let merged;
  let mode = 'two_step';
  try {
    merged = await reconcileFindings(findings);
  } catch (err) {
    mode = 'local';
    merged = mergeFindingsLocally(findings);
    merged.warnings.push('جمع‌بندی هوشمند انجام نشد؛ مقادیر بر اساس رأی اکثریت عکس‌ها انتخاب شدند.');
  }
  return { merged, findings, reads, mode };
}

async function smartScanPhotos(images, fullImages = []) {
  const started = Date.now();
  let merged, findings, photos, stage2;
  let refined = [];
  try {
    ({ merged, findings } = await readAllPhotosAtOnce(images));
    stage2 = 'single';
    photos = findings.map(p => ({ index: p.photo, ok: true, kind: p.data.photo_kind, error: null }));
    refined = await refineKeyNumbers(merged, findings, fullImages.length === images.length ? fullImages : images);
  } catch (err) {
    console.warn('Combined smart scan failed, falling back to per-photo reading:', err.message);
    const r = await readPhotosSeparately(fullImages.length === images.length ? fullImages : images);
    ({ merged, findings } = r);
    stage2 = r.mode;
    photos = r.reads.map((x, i) => ({ index: i + 1, ok: x.ok, kind: x.ok ? (x.value.photo_kind || null) : null, error: x.ok ? null : x.error }));
  }

  const fields = {};
  for (const f of SCAN_FIELDS) {
    let v = cleanScanValue(merged.fields[f]);
    if (!v) continue;
    if (['property_id', 'serial_number', 'ip_address', 'purchase_date'].includes(f)) v = toLatinDigits(v);
    if (f === 'serial_number') v = v.replace(/\s+/g, '');
    if (f === 'ip_address' && !/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) continue;
    if (f === 'purchase_date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
    fields[f] = v;
  }
  if (fields.category || fields.manufacturer_model) {
    fields.category = normalizeCategory(fields.category, fields.manufacturer_model) || fields.category;
  }
  if (fields.property_id && fields.serial_number && fields.property_id === fields.serial_number) {
    delete fields.property_id;
  }

  // Same model already in the database under a slightly different spelling? Use that spelling.
  let matchedModel = null;
  if (fields.manufacturer_model) {
    fields.manufacturer_model = queries.normalizeModelName(fields.manufacturer_model);
    const best = queries.searchModels(fields.manufacturer_model, fields.category || null, 1)[0];
    if (best && best.score >= 0.9) {
      matchedModel = best;
      fields.manufacturer_model = best.model;
      if (!fields.category && best.category) fields.category = best.category;
    }
  }

  const warnings = Array.isArray(merged.warnings) ? merged.warnings.filter(w => typeof w === 'string').slice(0, 6) : [];
  const duplicates = {};
  if (fields.property_id) {
    const dup = queries.getAssetByPropertyId(fields.property_id);
    if (dup) {
      duplicates.property_id = { id: dup.id, property_id: dup.property_id, model: dup.manufacturer_model };
      warnings.unshift(`شماره اموال ${fields.property_id} قبلاً برای «${dup.manufacturer_model || dup.property_id}» ثبت شده است.`);
    }
  }
  if (fields.serial_number) {
    const dup = queries.findAssetBySerial(fields.serial_number);
    if (dup) {
      duplicates.serial_number = { id: dup.id, property_id: dup.property_id, model: dup.manufacturer_model };
      warnings.unshift(`سریال ${fields.serial_number} قبلاً با اموال ${dup.property_id} ثبت شده است.`);
    }
  }

  // Damage seen in any photo goes into the notes (the condition itself stays the operator's call)
  const damage = findings.map(p => cleanScanValue(p.data.damage)).filter(Boolean);
  let notes = cleanScanValue(merged.notes) || '';
  if (damage.length && !notes.includes(damage[0])) notes = [notes, `آسیب دیده‌شده: ${damage.join('؛ ')}`].filter(Boolean).join('\n');

  // Model known: fetch its specs online right away (no second button press); only empty fields are filled
  let enriched = [];
  const sources = merged.sources && typeof merged.sources === 'object' ? merged.sources : {};
  const confidence = merged.confidence && typeof merged.confidence === 'object' ? merged.confidence : {};
  if (fields.manufacturer_model) {
    try {
      enriched = await enrichFromInternet(fields);
      for (const f of enriched) { sources[f] = 'internet'; confidence[f] = 'low'; }
    } catch (err) {
      console.warn('Online spec lookup after scan failed:', err.message);
    }
  }

  // Cover photo: the whole device seen from a distance beats label / sticker close-ups
  const kindRank = { device_front: 4, device_back: 2, other: 1, screen: 0, spec_label: -2, property_tag: -3 };
  let coverPhoto = null, coverScore = -Infinity;
  for (const p of findings) {
    const score = (p.data.full_view === true ? 10 : 0) + (kindRank[p.data.photo_kind] ?? 0);
    if (score > coverScore) { coverScore = score; coverPhoto = p.photo; }
  }

  return {
    fields,
    cover_photo: coverPhoto,
    sources,
    confidence,
    enriched,
    notes,
    warnings,
    duplicates,
    damage_seen: damage.length > 0,
    matched_model: matchedModel,
    photos,
    stage2,
    refined,
    elapsed_ms: Date.now() - started,
    model: '9Router'
  };
}

// Online Hardware Spec Search by Model name using 9Router AI
async function lookupSpecsByModelOnline(modelName) {
  const prompt = `
You are a master hardware database specialist.
The user entered this device model: "${modelName}".

Identify this computer, laptop, monitor, or hardware device and return its official standard technical specifications and common factory CPU/RAM/GPU configurations.

Return STRICT JSON ONLY:
CATEGORY GUIDE (pick the single best match, using the exact English value):
- Modem: ADSL/VDSL/fiber/4G/LTE/5G modems and modem-routers from an ISP (e.g. TP-Link VR300, D-Link DSL-2750U, Huawei B311)
- Router: routers without a DSL/LTE modem (e.g. MikroTik hAP / RB / CCR, Cisco ISR, TP-Link Archer router)
- Access Point: Wi-Fi access points and mesh units (e.g. UniFi, EAP225, cAP)
- Network: network switches, patch panels, firewalls
- Storage: a loose hard drive, SSD, NVMe, external disk or NAS
- Server: rack/tower servers (ProLiant, PowerEdge)
- UPS: uninterruptible power supplies; VoIP Phone: desk / IP phones; Camera: CCTV cameras, DVR/NVR
- Projector; Tablet: tablets and phones; Peripheral: keyboard, mouse, headset, webcam
- PC: desktop computers / cases; All-in-One: computer built into its screen (EliteOne, ProOne, OptiPlex AIO, iMac); Laptop; Monitor; Printer: printers, scanners, copiers
- Refrigerator; TV: televisions; Attendance Device: fingerprint / card time-attendance terminals; Water Cooler: water dispensers; Heater: electric heaters / radiators; Air Conditioner: split / AC units; Kitchen Appliance: microwave, kettle, samovar, coffee maker; Fan; Office Machine: shredder, laminator, binding machine

{
  "recognized": true,
  "canonical_name": "Full clean model name (e.g. HP EliteDesk 800 G3 Small Form Factor)",
  "category": "PC" | "Single PC" | "All-in-One" | "Laptop" | "Server" | "Monitor" | "Storage" | "Printer" | "Modem" | "Router" | "Access Point" | "Network" | "UPS" | "VoIP Phone" | "Camera" | "Projector" | "Tablet" | "Peripheral" | "Refrigerator" | "TV" | "Attendance Device" | "Water Cooler" | "Heater" | "Air Conditioner" | "Kitchen Appliance" | "Fan" | "Office Machine" | "Other",
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
    if (parsed && typeof parsed === 'object') parsed.category = normalizeCategory(parsed.category, parsed.manufacturer_model);
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
// Collects raw bytes and decodes once, so multi-byte UTF-8 (Persian text)
// split across network chunks is never corrupted.
function parseRequestBody(req, maxBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let aborted = false;
    req.on('data', chunk => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBytes) {
        aborted = true;
        const err = new Error('Payload Too Large');
        err.statusCode = 413;
        reject(err);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      const body = Buffer.concat(chunks, total).toString('utf8');
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

// ---------------------------------------------------------------------------
// Bulk summary report: counts by type / status / brand / model / disks / RAM / CPU
// ---------------------------------------------------------------------------
// Disk type from its model name when the scanner did not report it
function guessDiskType(model) {
  const m = String(model || '');
  if (/nvme|\bsn\d{3}\b|mzvl|pm9\d\d|\b9[78]0\b|\bnm\d{3}\b/i.test(m)) return 'NVMe';
  if (/ssd|\bsu\d{3}\b|a400|c800|evo|mx500|bx500|sandisk|lexar|green 2\.5|\bmz7/i.test(m)) return 'SSD';
  if (/^st\d|wdc|\bwd\d|\bwd(blue|black|red|purple)|hgst|hitachi|toshiba|seagate|barracuda|maxtor|samsung hd\d|hdd|\bdt01|\bhd7\d\d|hard (drive|disk)/i.test(m)) return 'HDD';
  return 'نامشخص';
}

function sizeBucket(gb) {
  if (!gb) return 'نامشخص';
  if (gb <= 140) return '128 گیگ و کمتر';
  if (gb <= 280) return '256 گیگ';
  if (gb <= 560) return '500 گیگ';
  if (gb <= 1100) return '1 ترابایت';
  return 'بیشتر از 1 ترابایت';
}

// Disks of one asset: drive-health data when the scanner sent it, otherwise parsed from the storage text
function assetDisks(a) {
  try {
    const d = a.disk_health ? JSON.parse(a.disk_health) : null;
    if (d && Array.isArray(d.disks) && d.disks.length) {
      // skip the USB stick and empty slots / card readers (model "0", size 0)
      return d.disks.filter(x => !/usb|flash/i.test(`${x.model} ${x.bus || ''}`) && !/^\s*\d?\s*$/.test(String(x.model || '')) && Number(x.size_gb) !== 0).map(x => ({
        model: String(x.model || '').trim() || 'نامشخص',
        gb: Number(x.size_gb) || null,
        type: ['SSD', 'HDD', 'NVMe'].includes(x.type) ? x.type : guessDiskType(x.model)
      }));
    }
  } catch (e) {}
  return String(a.storage_drives || '').split(' / ').map(s => s.trim()).filter(s => s && !/usb|flash/i.test(s) && !/^\d?$/.test(s)).map(s => {
    const m = s.match(/^(.*?)\s*\((\d+(?:\.\d+)?)\s*(GB|TB)\)\s*$/i);
    const model = (m ? m[1] : s).replace(/\s+ATA Device$/i, '').trim();
    const gb = m ? Math.round(Number(m[2]) * (m[3].toUpperCase() === 'TB' ? 1024 : 1)) : null;
    return { model: model || 'نامشخص', gb, type: guessDiskType(s) };
  });
}

function ramBucket(ram) {
  const m = String(ram || '').match(/(\d+(?:\.\d+)?)\s*GB/i);
  return m ? `${Math.round(Number(m[1]))} GB` : 'نامشخص';
}

function cpuShort(cpu) {
  const c = String(cpu || '');
  const m = c.match(/(i[3579]-\s?\d{3,5}[A-Z]{0,2})|(Xeon\S*\s+\S+)|(Pentium\S*\s+\S+)|(Celeron\S*\s+\S+)|(Ryzen \d \d{4}\S*)|(Core\(TM\)2 \S+ \S+)/i);
  return m ? m[0].replace(/\s+/g, ' ') : (c.trim() ? c.replace(/\(R\)|\(TM\)|CPU|@.*$/gi, '').replace(/\s+/g, ' ').trim() : 'نامشخص');
}

function buildSummaryReport(assets) {
  const count = (map, key, n = 1) => { const k = key || 'نامشخص'; map[k] = (map[k] || 0) + n; };
  const toList = map => Object.entries(map).map(([key, n]) => ({ key, count: n })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const byCategory = {}, byStatus = {}, byHealth = {}, byBrand = {}, byModel = {}, byRam = {}, byCpu = {}, byLocation = {};
  const diskType = {}, diskSize = {}, diskModel = {};
  const models = {};
  const computerCats = new Set(['PC', 'Single PC', 'All-in-One', 'Laptop', 'Server']);
  let diskCount = 0, noDisk = 0, noTag = 0, totalValue = 0, pricedCount = 0;

  for (const a of assets) {
    count(byCategory, a.category);
    if (Number(a.price) > 0) { totalValue += Number(a.price); pricedCount++; }
    count(byStatus, a.status);
    count(byHealth, a.health || 'healthy');
    count(byLocation, (a.location || '').trim() || 'ثبت نشده');
    if (a.no_tag) noTag++;
    const model = (a.manufacturer_model || '').trim() || 'نامشخص';
    count(byBrand, model === 'نامشخص' ? 'نامشخص' : model.split(' ')[0]);
    count(byModel, model);
    if (!models[model]) models[model] = { model, category: a.category, count: 0, property_ids: [] };
    models[model].count++;
    models[model].property_ids.push(a.property_id);

    if (computerCats.has(a.category)) {
      count(byRam, ramBucket(a.ram));
      count(byCpu, cpuShort(a.cpu));
      const disks = assetDisks(a);
      if (!disks.length) noDisk++;
      for (const d of disks) {
        diskCount++;
        count(diskType, d.type);
        count(diskSize, sizeBucket(d.gb));
        count(diskModel, d.model);
      }
    } else if (a.category === 'Storage') {
      // a loose drive is itself one disk
      diskCount++;
      count(diskType, guessDiskType(`${a.manufacturer_model} ${a.storage_drives || ''}`));
      const gbm = String(`${a.storage_drives || ''} ${a.manufacturer_model || ''}`).match(/(\d+(?:\.\d+)?)\s*(TB|GB)/i);
      count(diskSize, sizeBucket(gbm ? Math.round(Number(gbm[1]) * (gbm[2].toUpperCase() === 'TB' ? 1024 : 1)) : null));
      count(diskModel, a.manufacturer_model);
    }
  }

  return {
    generated_at: new Date().toISOString(),
    total: assets.length,
    no_tag: noTag,
    disk_count: diskCount,
    computers_without_disk: noDisk,
    total_value: totalValue,
    priced_count: pricedCount,
    by_category: toList(byCategory),
    by_status: toList(byStatus),
    by_health: toList(byHealth),
    by_brand: toList(byBrand),
    by_model: toList(byModel),
    by_location: toList(byLocation),
    disk_types: toList(diskType),
    disk_sizes: toList(diskSize),
    disk_models: toList(diskModel),
    ram: toList(byRam),
    cpu: toList(byCpu),
    models: Object.values(models).sort((a, b) => b.count - a.count)
  };
}

// ---------------------------------------------------------------------------
// Component moves: a part taken out of one device can be put into another
// ---------------------------------------------------------------------------
const COMPONENT_FIELDS = { ram: 'ram', storage: 'storage_drives', cpu: 'cpu', gpu: 'gpu' };
const COMPONENT_ACTIONS = ['correction', 'moved_to', 'spare', 'sold', 'broken', 'from_device', 'new_part', 'other'];

function ramGb(s) {
  const m = String(s || '').match(/(\d+(?:\.\d+)?)\s*GB/i);
  return m ? Number(m[1]) : 0;
}
function ramType(s) {
  return (String(s || '').match(/\bDDR\d\w*\b/i) || [''])[0].toUpperCase();
}
// "8 GB" + 4 GB -> "12 GB DDR4" (module details are no longer known after a change)
function ramPlus(current, deltaGb, typeHint) {
  const total = Math.max(0, Math.round((ramGb(current) + deltaGb) * 10) / 10);
  if (!total) return '';
  const type = ramType(current) || ramType(typeHint);
  return `${total} GB${type ? ' ' + type : ''}`;
}
function diskList(s) {
  return String(s || '').split(' / ').map(x => x.trim()).filter(Boolean);
}
const diskKey = d => d.toLowerCase().replace(/\s*\(\d+(?:\.\d+)?\s*(gb|tb)\)\s*$/i, '').replace(/\s+ata device$/i, '').trim();
function storagePlus(current, parts) {
  const list = diskList(current);
  for (const p of diskList(parts)) if (!list.some(d => diskKey(d) === diskKey(p))) list.push(p);
  return list.join(' / ');
}
function storageMinus(current, parts) {
  const drop = new Set(diskList(parts).map(diskKey));
  return diskList(current).filter(d => !drop.has(diskKey(d))).join(' / ');
}

// Apply the other side of a move: add the part to the target device, or take it from the source device
function applyComponentToOther(other, component, direction, part) {
  const field = COMPONENT_FIELDS[component];
  const patch = {};
  if (component === 'ram') {
    patch.ram = ramPlus(other.ram, direction === 'removed' ? ramGb(part) : -ramGb(part), part);
  } else if (component === 'storage') {
    patch.storage_drives = direction === 'removed' ? storagePlus(other.storage_drives, part) : storageMinus(other.storage_drives, part);
  } else {
    // a CPU / GPU is a single part: moving it in replaces the target's, taking it out leaves the source empty
    patch[field] = direction === 'removed' ? part : '';
  }
  queries.updateAsset(other.id, patch);
  return patch;
}

// Minimal ZIP writer (stored, no compression) — keeps the project dependency-free
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    // "made by Unix" so Linux keeps the execute bit of scripts (f.mode, e.g. 0o755)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(f.mode ? (3 << 8) | 20 : 20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10); central.writeUInt16LE(dosTime, 12); central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((((f.mode ? (0o100000 | f.mode) : 0) << 16) | (f.name.endsWith('/') ? 0x10 : 0)) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// The address other computers should use (a download made on the server itself would otherwise say "localhost")
function lanServerUrl(req) {
  const protocol = req.socket?.encrypted ? 'https' : 'http';
  const host = req.headers.host || `localhost:${PORT}`;
  if (/^(localhost|127\.|\[::1\])/i.test(host)) {
    const ip = getLocalIpAddresses().find(a => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./.test(a)) || getLocalIpAddresses()[0];
    if (ip) return `${protocol}://${ip}:${PORT}`;
  }
  return `${protocol}://${host}`;
}

// Every address a scanner should try, in order: LAN first, then the public address from Settings
function scannerServerUrls(req) {
  const list = [lanServerUrl(req)];
  let pub = String(queries.getSettings().public_server_url || '').trim().replace(/\/+$/, '');
  if (pub && !/^https?:\/\//i.test(pub)) pub = 'http://' + pub;
  if (pub) list.push(pub);
  const viaHost = `${req.socket?.encrypted ? 'https' : 'http'}://${req.headers.host || ''}`;
  if (req.headers.host && !/^(localhost|127\.|\[::1\])/i.test(req.headers.host)) list.push(viaHost);
  return [...new Set(list)].filter(u => /^https?:\/\/[A-Za-z0-9.\-\[\]:]+$/.test(u));
}

// "$SERVER_URLS = @(...)" line injected into the Windows scanners
function psUrlList(urls) {
  return `$SERVER_URLS = @(${urls.map(u => `"${u}"`).join(', ')})`;
}

const USB_KIT_README =`﻿کیت اسکن دارایی با فلش — مدیریت دارایی ارکا
=================================================

آماده‌سازی (یک بار):
  محتوای این فایل ZIP را مستقیم روی فلش کپی کنید (فایل Scan-Asset.bat و پوشه scans).

استفاده روی هر کامپیوتر:
  1) فلش را وصل کنید و:
     ویندوز: فایل Scan-Asset.bat را دوبار کلیک کنید.
        (برای اطلاعات کامل سلامت هارد: راست‌کلیک ← Run as administrator)
     لینوکس: فایل Scan-Asset-Linux.desktop را دوبار کلیک کنید.
        (بار اول ممکن است بپرسد: Trust / Allow Launching را بزنید؛
         یا راست‌کلیک روی Scan-Asset-Linux.sh ← Run as a Program)
  2) نام کاربر را وارد کنید و صبر کنید تا اسکن تمام شود (حدود ۳۰ ثانیه).
  3) اسکنر اول آدرس شبکه داخلی و بعد آدرس عمومی سرور را امتحان می‌کند؛
     اگر یکی جواب بدهد، اطلاعات همان لحظه ارسال می‌شود.
     اگر هیچ‌کدام جواب ندهد، اطلاعات در پوشه scans روی همین فلش ذخیره می‌شود.
     در اسکن‌های بدون شبکه (میز تست) مانیتور ثبت نمی‌شود، چون فقط مانیتور تست وصل است.

اسکن‌های ذخیره‌شده روی فلش:
  - دفعه بعد که اسکنر روی کامپیوتری که به سرور وصل است اجرا شود، همه را خودکار می‌فرستد.
  - یا در پنل: منوی ابزارها ← «وارد کردن اسکن‌های فلش» و فایل‌های پوشه scans را انتخاب کنید.
  - فایل‌های ارسال‌شده به پوشه scans\\sent منتقل می‌شوند.

بعد از ارسال، دستگاه‌ها در پنل در صف «تأیید اسکن‌ها» می‌آیند تا شماره اموال بدهید.

چرا اجرای خودکار با وصل کردن فلش نیست؟
  ویندوز از نسخه ۷ اجرای خودکار برنامه از فلش (AutoRun) را برای جلوگیری از ویروس‌ها بسته است؛
  برای همین یک دوبار کلیک لازم است.

امنیت: این فایل کلید اسکنر سرور را دارد. اگر فلش گم شد، از تنظیمات پنل کلید اسکنر را عوض کنید.
سرور: {{SERVER_URL}}
`;

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
    // AUTHENTICATION GATE
    // -------------------------------------------------------------
    const sessionUser = getSessionUser(req);

    if (pathname === '/api/auth-status') {
      return sendJson(res, 200, {
        authRequired: true,
        authenticated: !!sessionUser,
        user: sessionUser,
        default_password: sessionUser && sessionUser.is_admin ? queries.isUsingDefaultPassword() : false
      });
    }

    if (method === 'POST' && pathname === '/api/logout') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': sessionCookieHeader(null, req)
      });
      return res.end(JSON.stringify({ success: true }));
    }

    if (!PUBLIC_PATHS.has(pathname)) {
      const scannerAllowed = SCANNER_PATHS.has(pathname) && method === 'POST' && hasScannerKey(req);
      if (!sessionUser && !scannerAllowed) {
        if (pathname.startsWith('/api/')) {
          return sendJson(res, 401, { error: 'برای ادامه وارد حساب کاربری شوید.', code: 'AUTH_REQUIRED' });
        }
        const isPage = pathname === '/' || pathname.endsWith('.html') || !path.extname(pathname);
        if (isPage) {
          res.writeHead(302, { 'Location': `/login.html?next=${encodeURIComponent(pathname + (parsedUrl.search || ''))}` });
          return res.end();
        }
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Authentication required');
      }

      // Viewers are read-only
      if (sessionUser && !sessionUser.is_admin && pathname.startsWith('/api/')) {
        const isRead = method === 'GET' || method === 'HEAD';
        const adminRead = ADMIN_READ_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/') || (p.endsWith('/') && pathname.startsWith(p)));
        if (!isRead || adminRead) {
          return sendJson(res, 403, { error: 'این کار فقط برای مدیر سیستم مجاز است.', code: 'ADMIN_ONLY' });
        }
      }
    }

    // -------------------------------------------------------------
    // API ROUTES
    // -------------------------------------------------------------

    // GET /api/suggestions (Autocomplete memory for models, CPUs, RAMs, storage, etc.)
    if (method === 'GET' && pathname === '/api/suggestions') {
      const suggestions = queries.getSuggestions();
      return sendJson(res, 200, suggestions);
    }

    // GET /api/stats
    if (method === 'GET' && pathname === '/api/stats') {
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
        if (result && result.canonical_name) result.canonical_name = queries.normalizeModelName(result.canonical_name);
        // A spec the device does not have comes back as "N/A (...)"; leave those fields empty
        for (const k of ['default_cpu', 'default_ram', 'default_storage', 'gpu', 'monitors']) {
          if (result && typeof result[k] === 'string' && /^\s*n\/?a\b/i.test(result[k])) result[k] = null;
        }
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
          model: photo.manufacturer_model,
          category: photo.category,
          asset_id: photo.asset_id
        });
      }
      return sendJson(res, 200, { found: false });
    }

    // GET /api/models/normalize?name=... (the clean, database-consistent spelling of a model name)
    if (method === 'GET' && pathname === '/api/models/normalize') {
      const name = parsedUrl.searchParams.get('name') || '';
      return sendJson(res, 200, { input: name, name: queries.normalizeModelName(name) });
    }

    // GET /api/suggest?field=ram|cpu|gpu|storage|monitors|location|department|user&q=  (as-you-type, from stored values)
    if (method === 'GET' && pathname === '/api/suggest') {
      const field = parsedUrl.searchParams.get('field') || '';
      const q = parsedUrl.searchParams.get('q') || '';
      return sendJson(res, 200, { results: queries.suggestFieldValues(field, q, 8) });
    }

    // GET /api/models/merge-suggestions — names that look like the same product
    if (method === 'GET' && pathname === '/api/models/merge-suggestions') {
      return sendJson(res, 200, { groups: queries.modelMergeSuggestions() });
    }

    // POST /api/models/merge { from: [names], to: name } — one name for all of them
    if (method === 'POST' && pathname === '/api/models/merge') {
      const d = await parseRequestBody(req);
      const from = (Array.isArray(d.from) ? d.from : []).map(s => String(s || '').trim()).filter(Boolean);
      const to = String(d.to || '').trim();
      if (!from.length || !to) return sendJson(res, 400, { error: 'نام مدل‌ها مشخص نیست' });
      const changed = queries.mergeModels(from, to);
      queries.addLog('INFO', 'MODEL_MERGE', `${changed} دستگاه به مدل «${to}» یکی شد`, from.join(' | '), req.socket?.remoteAddress || '');
      return sendJson(res, 200, { success: true, changed });
    }

    // POST /api/photos/bulk { image: dataUrl, asset_ids: [..], set_primary } — one photo for many devices
    if (method === 'POST' && pathname === '/api/photos/bulk') {
      const d = await parseRequestBody(req);
      const ids = [...new Set((Array.isArray(d.asset_ids) ? d.asset_ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
      const m = String(d.image || '').match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
      if (!m) return sendJson(res, 400, { error: 'عکس نامعتبر است' });
      if (!ids.length) return sendJson(res, 400, { error: 'هیچ دستگاهی انتخاب نشده' });
      if (ids.length > 500) return sendJson(res, 400, { error: 'حداکثر ۵۰۰ دستگاه در هر بار' });
      const ext = m[1] === 'png' ? '.png' : m[1] === 'webp' ? '.webp' : '.jpg';
      const buf = Buffer.from(m[2], 'base64');
      let added = 0;
      const skipped = [];
      for (const id of ids) {
        const asset = queries.getAssetById(id);
        if (!asset) { skipped.push(id); continue; }
        const fileName = `asset_${id}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}_bulk${ext}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buf);
        const photoId = queries.addPhoto(id, fileName, String(d.original_name || 'bulk.jpg').slice(0, 120), String(d.caption || 'Device Photo (bulk)').slice(0, 120), { propagate: false });
        if (d.set_primary) queries.setPrimaryPhoto(photoId);
        added++;
      }
      queries.addLog('SUCCESS', 'PHOTO_BULK', `یک عکس برای ${added} دستگاه ثبت شد`, d.set_primary ? 'به‌عنوان کاور' : '', req.socket?.remoteAddress || '');
      return sendJson(res, 200, { success: true, added, skipped });
    }

    // GET /api/models/search?q=...&category=... (similar models already in the DB, as you type)
    if (method === 'GET' && pathname === '/api/models/search') {
      const q = parsedUrl.searchParams.get('q') || '';
      const category = parsedUrl.searchParams.get('category') || null;
      return sendJson(res, 200, { results: queries.searchModels(q, category, 8) });
    }

    // ---- Photo intake queue ----
    // POST /api/photo-jobs { images: [dataUrl], form: {...fields typed so far} }
    if (method === 'POST' && pathname === '/api/photo-jobs') {
      const data = await parseRequestBody(req);
      const images = (Array.isArray(data.images) ? data.images : []).filter(x => typeof x === 'string' && x.length > 100).slice(0, SMART_SCAN_MAX_IMAGES);
      if (!images.length) return sendJson(res, 400, { error: 'هیچ عکسی ارسال نشد' });
      const key = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      let files = [];
      try {
        files = images.map((img, i) => savePhotoJobImage(img, key, i + 1));
      } catch (err) {
        removeQueueFiles(files);
        return sendJson(res, 400, { error: 'فرمت عکس نامعتبر است' });
      }
      const form = data.form && typeof data.form === 'object' ? data.form : {};
      const id = queries.createPhotoJob(files, form, sessionUser ? sessionUser.username : null);
      queries.addLog('INFO', 'PHOTO_QUEUE', `دستگاه با ${files.length} عکس به صف پردازش اضافه شد (#${id})`, '', req.socket?.remoteAddress || '');
      runPhotoQueue();
      return sendJson(res, 201, { success: true, id });
    }

    // GET /api/photo-jobs (all jobs, oldest first)
    if (method === 'GET' && pathname === '/api/photo-jobs') {
      const jobs = queries.listPhotoJobs().map(j => ({
        id: j.id, status: j.status, error: j.error, created_at: j.created_at, created_by: j.created_by,
        photos: j.photo_files.map(f => `/uploads/${f}`),
        cover: j.result && j.result.cover_photo ? j.result.cover_photo : 1,
        model: j.result && j.result.fields ? j.result.fields.manufacturer_model || null : null,
        category: j.result && j.result.fields ? j.result.fields.category || j.form.category || null : j.form.category || null,
        property_id: (j.result && j.result.fields && j.result.fields.property_id) || j.form.property_id || null,
        warnings: j.result && Array.isArray(j.result.warnings) ? j.result.warnings.length : 0
      }));
      const counts = jobs.reduce((c, j) => (c[j.status] = (c[j.status] || 0) + 1, c), {});
      return sendJson(res, 200, { jobs, counts });
    }

    const photoJobMatch = pathname.match(/^\/api\/photo-jobs\/(\d+)(\/retry)?$/);
    if (photoJobMatch) {
      const jobId = parseInt(photoJobMatch[1], 10);
      const job = queries.getPhotoJob(jobId);
      if (!job) return sendJson(res, 404, { error: 'این مورد در صف پیدا نشد' });

      // GET /api/photo-jobs/:id (full result for the review form)
      if (method === 'GET' && !photoJobMatch[2]) {
        return sendJson(res, 200, { ...job, photos: job.photo_files.map(f => ({ file: f, url: `/uploads/${f}` })) });
      }
      // POST /api/photo-jobs/:id/retry
      if (method === 'POST' && photoJobMatch[2]) {
        queries.updatePhotoJob(jobId, { status: 'queued', error: null, result: null });
        runPhotoQueue();
        return sendJson(res, 200, { success: true });
      }
      // DELETE /api/photo-jobs/:id?keep_files=1 (keep_files: photos were moved to the new asset)
      if (method === 'DELETE' && !photoJobMatch[2]) {
        if (job.status === 'processing') return sendJson(res, 409, { error: 'این مورد در حال پردازش است؛ کمی صبر کنید.' });
        if (parsedUrl.searchParams.get('keep_files') !== '1') removeQueueFiles(job.photo_files);
        queries.deletePhotoJob(jobId);
        return sendJson(res, 200, { success: true });
      }
    }

    // POST /api/ai/smart-scan { images: [base64...] } — read every photo, then reconcile all findings
    if (method === 'POST' && pathname === '/api/ai/smart-scan') {
      const data = await parseRequestBody(req);
      const images = (Array.isArray(data.images) ? data.images : []).filter(x => typeof x === 'string' && x.length > 100);
      if (!images.length) return sendJson(res, 400, { error: 'هیچ عکسی برای اسکن ارسال نشد' });
      if (images.length > SMART_SCAN_MAX_IMAGES) {
        return sendJson(res, 400, { error: `حداکثر ${SMART_SCAN_MAX_IMAGES} عکس در هر اسکن` });
      }
      queries.addLog('INFO', 'SMART_SCAN', `اسکن هوشمند ${images.length} عکس شروع شد`, '', req.socket?.remoteAddress || '');
      try {
        const full = (Array.isArray(data.full_images) ? data.full_images : []).filter(x => typeof x === 'string' && x.length > 100);
        const result = await smartScanPhotos(images, full.length === images.length ? full : []);
        queries.addLog('SUCCESS', 'SMART_SCAN', `اسکن هوشمند تمام شد: ${Object.keys(result.fields).length} فیلد در ${Math.round(result.elapsed_ms / 1000)} ثانیه (${result.stage2})`,
          `مدل: ${result.fields.manufacturer_model || '-'} | اموال: ${result.fields.property_id || '-'}`, req.socket?.remoteAddress || '');
        return sendJson(res, 200, { success: true, ...result });
      } catch (err) {
        queries.addLog('ERROR', 'SMART_SCAN', 'اسکن هوشمند ناموفق بود', err.message, req.socket?.remoteAddress || '');
        return sendJson(res, 500, { error: err.message });
      }
    }

    // GET /api/backup/db or /api/backup/download (Download complete, flushed SQLite database file)
    if (method === 'GET' && (pathname === '/api/backup/db' || pathname === '/api/backup/download')) {
      // Flush WAL journal to guarantee complete snapshot
      checkpointDb();

      if (!fs.existsSync(DB_PATH)) {
        return sendJson(res, 404, { error: 'Database file not found' });
      }

      const stat = fs.statSync(DB_PATH);
      const today = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        'Content-Type': 'application/x-sqlite3',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="arka_inventory_backup_${today}.db"`
      });
      const readStream = fs.createReadStream(DB_PATH);
      readStream.pipe(res);
      return;
    }

    // GET /api/backup/status (Inspect database integrity, file sizes, and backup counts)
    if (method === 'GET' && pathname === '/api/backup/status') {
      checkpointDb();
      const dbStat = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH) : null;
      const walPath = `${DB_PATH}-wal`;
      const walStat = fs.existsSync(walPath) ? fs.statSync(walPath) : null;
      
      let backupCount = 0;
      let latestBackup = null;
      if (fs.existsSync(BACKUPS_DIR)) {
        const files = fs.readdirSync(BACKUPS_DIR)
          .filter(f => f.startsWith('inventory_') && f.endsWith('.db'))
          .map(f => ({ name: f, path: path.join(BACKUPS_DIR, f), mtime: fs.statSync(path.join(BACKUPS_DIR, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        backupCount = files.length;
        if (files[0]) {
          latestBackup = {
            filename: files[0].name,
            modified_at: new Date(files[0].mtime).toISOString()
          };
        }
      }

      const isHealthy = checkDbIntegrity();
      const stats = queries.getStats();

      return sendJson(res, 200, {
        healthy: isHealthy,
        integrity: isHealthy ? 'OK (Pristine)' : 'WARNING',
        database_size_bytes: dbStat ? dbStat.size : 0,
        wal_size_bytes: walStat ? walStat.size : 0,
        total_assets: stats ? stats.total : 0,
        backups_count: backupCount,
        latest_backup: latestBackup,
        auto_backup_enabled: true
      });
    }

    // POST /api/backup/create (Force create manual snapshot now)
    if (method === 'POST' && pathname === '/api/backup/create') {
      const snap = createAutomaticBackup('manual');
      if (snap) {
        queries.addLog('SUCCESS', 'BACKUP', `پشتیبان دستی با نام ${snap.filename} ایجاد شد.`);
        return sendJson(res, 200, { success: true, backup: snap });
      }
      return sendJson(res, 500, { error: 'Failed to create backup snapshot' });
    }

    // POST /api/backup/restore-db (Restore/Replace SQLite database)
    if (method === 'POST' && pathname === '/api/backup/restore-db') {
      const data = await parseRequestBody(req);
      if (!data.database_base64) {
        return sendJson(res, 400, { error: 'No database_base64 provided' });
      }

      try {
        // Backup current database first before overwriting
        createAutomaticBackup('pre_restore');

        const buffer = Buffer.from(data.database_base64, 'base64');
        fs.writeFileSync(DB_PATH, buffer);
        checkpointDb();

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
        // Server addresses to try (LAN, then public)
        batContent = batContent.replace(/\$SERVER_URLS = @\(.*?\)/, () => psUrlList(scannerServerUrls(req)));
        batContent = batContent.replace(/\$SERVER_KEY = ".*?"/, () => `$SERVER_KEY = "${getScannerKey()}"`);
      }

      res.writeHead(200, {
        'Content-Type': 'application/x-bat',
        'Content-Disposition': 'attachment; filename="AssetScanner.bat"'
      });
      res.end(batContent);
      return;
    }

    // GET /api/download/usb-kit (ZIP for a flash drive: double-click scanner that sends or saves to the USB)
    if (method === 'GET' && pathname === '/api/download/usb-kit') {
      const tplPath = path.join(__dirname, 'client-scripts', 'AssetScanner-USB.bat');
      if (!fs.existsSync(tplPath)) return sendJson(res, 500, { error: 'USB scanner template missing' });
      const urls = scannerServerUrls(req);
      const serverUrl = urls.join('  یا  ');
      const bat = fs.readFileSync(tplPath, 'utf8')
        .replace(/\$SERVER_URLS = @\(.*?\)/, () => psUrlList(urls))
        .replace(/\$SERVER_KEY = ".*?"/, () => `$SERVER_KEY = "${getScannerKey()}"`);
      const key = getScannerKey();
      const linuxDir = path.join(__dirname, 'client-scripts');
      const linuxWrapper = fs.readFileSync(path.join(linuxDir, 'usb-linux', 'Scan-Asset-Linux.sh'), 'utf8').replace(/\r\n/g, '\n')
        .replace(/^SERVER_URLS=\(.*\)$/m, () => `SERVER_URLS=(${urls.map(u => `"${u}"`).join(' ')})`)
        .replace(/^SERVER_KEY=".*"$/m, () => `SERVER_KEY="${key}"`);
      const linuxScanner = fs.readFileSync(path.join(linuxDir, 'asset-scanner.sh'), 'utf8').replace(/\r\n/g, '\n')
        .replace(/SERVER_URL="\$\{IAM_SERVER:-.*?\}"/, () => `SERVER_URL="\${IAM_SERVER:-${urls[0]}}"`)
        .replace(/SERVER_KEY="\$\{IAM_KEY:-.*?\}"/, () => `SERVER_KEY="\${IAM_KEY:-${key}}"`);
      const desktop = fs.readFileSync(path.join(linuxDir, 'usb-linux', 'Scan-Asset-Linux.desktop'), 'utf8').replace(/\r\n/g, '\n');
      const zip = makeZip([
        { name: 'Scan-Asset.bat', data: bat },
        { name: 'Scan-Asset-Linux.desktop', data: desktop, mode: 0o755 },
        { name: 'Scan-Asset-Linux.sh', data: linuxWrapper, mode: 0o755 },
        { name: 'linux/', data: Buffer.alloc(0) },
        { name: 'linux/asset-scanner.sh', data: linuxScanner, mode: 0o755 },
        { name: 'راهنما.txt', data: USB_KIT_README.replace('{{SERVER_URL}}', serverUrl) },
        { name: 'scans/', data: Buffer.alloc(0) },
        { name: 'scans/sent/', data: Buffer.alloc(0) }
      ]);
      queries.addLog('INFO', 'USB_KIT', 'کیت اسکن فلش دانلود شد', `سرور: ${serverUrl}`, req.socket?.remoteAddress || '');
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': zip.length,
        'Content-Disposition': 'attachment; filename="Arka-USB-Scanner.zip"'
      });
      return res.end(zip);
    }

    // POST /api/scanner-key/rotate (new scanner key; old scanners and USB kits stop working)
    if (method === 'POST' && pathname === '/api/scanner-key/rotate') {
      queries.updateSettings({ scanner_key: crypto.randomBytes(18).toString('base64url') });
      queries.addLog('WARN', 'SECURITY', 'کلید اسکنر توسط مدیر عوض شد', '', req.socket?.remoteAddress || '');
      return sendJson(res, 200, { success: true });
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
        shContent = shContent.replace(/SERVER_URL="\$\{IAM_SERVER:-.*?\}"/, () => `SERVER_URL="\${IAM_SERVER:-${serverUrl}}"`);
        shContent = shContent.replace(/SERVER_KEY="\$\{IAM_KEY:-.*?\}"/, () => `SERVER_KEY="\${IAM_KEY:-${getScannerKey()}}"`);
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

    // POST /api/assets/:id/component-change — what happened to a part changed in the edit form
    // { component: ram|storage|cpu|gpu, direction: removed|added, part, old_value, new_value, action, other_property_id, note }
    const compChangeMatch = pathname.match(/^\/api\/assets\/(\d+)\/component-change$/);
    if (method === 'POST' && compChangeMatch) {
      const id = parseInt(compChangeMatch[1], 10);
      const asset = queries.getAssetById(id);
      if (!asset) return sendJson(res, 404, { error: 'Asset not found' });
      const d = await parseRequestBody(req);
      const component = String(d.component || '');
      const direction = d.direction === 'added' ? 'added' : 'removed';
      const action = String(d.action || '');
      if (!COMPONENT_FIELDS[component]) return sendJson(res, 400, { error: 'قطعه نامعتبر است' });
      if (!COMPONENT_ACTIONS.includes(action)) return sendJson(res, 400, { error: 'نوع تغییر نامعتبر است' });
      const part = String(d.part || '').slice(0, 300);

      let other = null;
      let otherPatch = null;
      if (action === 'moved_to' || action === 'from_device') {
        const opid = String(d.other_property_id || '').trim();
        other = opid ? queries.getAssetByPropertyId(opid) : null;
        if (!other) return sendJson(res, 400, { error: `دستگاهی با شماره اموال «${opid}» پیدا نشد.` });
        if (other.id === id) return sendJson(res, 400, { error: 'دستگاه مقصد نمی‌تواند همین دستگاه باشد.' });
        otherPatch = applyComponentToOther(other, component, action === 'moved_to' ? 'removed' : 'added', part);
      }

      queries.addComponentMove({
        asset_id: id, property_id: asset.property_id, component, direction, part,
        old_value: String(d.old_value || '').slice(0, 300), new_value: String(d.new_value || '').slice(0, 300),
        action, other_asset_id: other ? other.id : null, other_property_id: other ? other.property_id : null,
        note: String(d.note || '').slice(0, 300), created_by: sessionUser ? sessionUser.username : null
      });
      const labels = { ram: 'رم', storage: 'هارد', cpu: 'پردازنده', gpu: 'گرافیک' };
      queries.addLog('INFO', 'COMPONENT', `${labels[component]} «${part}» ${direction === 'removed' ? 'از' : 'به'} ${asset.property_id}: ${action}` + (other ? ` (${other.property_id})` : ''), String(d.note || ''), req.socket?.remoteAddress || '');
      return sendJson(res, 200, { success: true, other: other ? { id: other.id, property_id: other.property_id, ...otherPatch } : null });
    }

    // GET /api/assets/:id/component-history
    const compHistMatch = pathname.match(/^\/api\/assets\/(\d+)\/component-history$/);
    if (method === 'GET' && compHistMatch) {
      return sendJson(res, 200, queries.getComponentMoves(parseInt(compHistMatch[1], 10)));
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
      const noTag = data.no_tag === true || data.no_tag === 1 || data.no_tag === '1';
      if (!noTag) {
        data.property_id = String(data.property_id || '').trim();
        if (!data.property_id) data.property_id = getNextPropertyId();

        // Check if property_id already exists
        const existing = queries.getAssetByPropertyId(data.property_id);
        if (existing) {
          return sendJson(res, 400, { error: `شماره اموال «${data.property_id}» از قبل ثبت شده است.` });
        }
      }

      const newId = queries.createAsset(data);
      const created = queries.getAssetById(newId);
      if (data._specs_copied) created.specs_copied = data._specs_copied;

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

    // GET /api/models/spec-template?model=...&category=...
    // Most complete existing record of the same model. `fixed` = same model always has the same specs.
    if (method === 'GET' && pathname === '/api/models/spec-template') {
      const model = parsedUrl.searchParams.get('model') || '';
      const category = parsedUrl.searchParams.get('category') || '';
      const fixed = queries.isFixedSpecCategory(category);
      const tpl = queries.getModelSpecTemplate(model, fixed ? category : null);
      if (!tpl) return sendJson(res, 200, { found: false, fixed });
      return sendJson(res, 200, { found: true, fixed, ...tpl });
    }

    // PUT /api/assets/:id (Update Asset)
    if (method === 'PUT' && assetIdMatch) {
      const id = parseInt(assetIdMatch[1], 10);
      const data = await parseRequestBody(req);

      const wantNoTag = data.no_tag === true || data.no_tag === 1 || data.no_tag === '1';
      if (wantNoTag) delete data.property_id; // an internal NT- code is assigned
      if (data.no_tag !== undefined && !wantNoTag) {
        const cur = queries.getAssetById(id);
        const pid = String(data.property_id || '').trim();
        if (cur && cur.no_tag && (!pid || pid.toUpperCase().startsWith('NT-'))) {
          return sendJson(res, 400, { error: 'برای این دستگاه شماره اموال واقعی وارد کنید.' });
        }
      }
      if (data.property_id !== undefined) {
        data.property_id = String(data.property_id || '').trim();
        if (!data.property_id) return sendJson(res, 400, { error: 'شناسه اموال نمی‌تواند خالی باشد.' });
        const dup = queries.getAssetByPropertyId(data.property_id);
        if (dup && dup.id !== id) {
          return sendJson(res, 400, { error: `شماره اموال «${data.property_id}» برای دستگاه دیگری ثبت شده است.` });
        }
      }

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
          data.status || null,
          data.no_tag === true || data.no_tag === 1 || data.no_tag === '1'
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

    // POST /api/scanner/log { stage, message, computer, os } — progress lines from USB scanners (remote troubleshooting)
    if (method === 'POST' && pathname === '/api/scanner/log') {
      const d = await parseRequestBody(req, 16 * 1024);
      const s = v => String(v || '').slice(0, 300);
      const level = s(d.stage) === 'error' ? 'ERROR' : 'INFO';
      queries.addLog(level, 'USB_SCANNER', `[${s(d.os) || '?'}] ${s(d.computer) || '?'}: ${s(d.stage)}`, s(d.message), clientIp(req));
      return sendJson(res, 200, { success: true });
    }

    // POST /api/assets/scan or /api/scan (Ingestion Endpoint for .bat / .sh scripts)
    if (method === 'POST' && (pathname === '/api/assets/scan' || pathname === '/api/scan')) {
      const data = await parseRequestBody(req);
      const compName = data.computer_name || data.computerName;
      const serialNum = data.serial_number || data.serialNumber;
      
      if (!compName && !serialNum) {
        return sendJson(res, 400, { error: 'Invalid scan data: computer_name or serial_number required' });
      }

      // Monitors with the property numbers typed for them (same order). Offline (bench) scans keep only
      // monitors that got a property number - an untagged screen there is just the test monitor.
      const scanMonitors = (() => {
        const ids = Array.isArray(data.monitorPropertyIds) ? data.monitorPropertyIds : (Array.isArray(data.monitor_property_ids) ? data.monitor_property_ids : []);
        const raw = String(data.monitors || '');
        if (data.offline !== true) return { names: data.monitors, ids };
        const parts = raw.split(' / ').map(s => s.trim());
        // a real tag looks like "1093" / "AST-1234"; free text ("dont count this, test monitor") = test screen
        const kept = parts.map((n, i) => ({ n, id: String(ids[i] ?? '').trim() })).filter(x => x.n && /^[A-Za-z]{0,6}[- ]?\d{2,8}$/.test(x.id));
        return { names: kept.map(x => x.n).join(' / '), ids: kept.map(x => x.id) };
      })();

      // All-in-one / laptop: its own built-in screen is reported like a monitor by older scanners.
      // Drop "monitors" that are that panel: named after the computer's model ("OptiPlex 7440" on an
      // "OptiPlex 7440 AIO") or a bare panel code ("LGD05A3", "AUO213E").
      const deviceModel = String(data.manufacturer_model || data.model || '');
      const chassis = String(data.chassis || '').toLowerCase();
      const builtInScreen = chassis === 'all-in-one' || chassis === 'laptop' ||
        /all.?in.?one|\baio\b|eliteone|proone|\bimac\b|laptop|notebook|latitude|thinkpad|elitebook|probook|ideapad|vostro|inspiron \d{4}\b/i.test(deviceModel);
      if (builtInScreen && scanMonitors.names) {
        const modelKey = deviceModel.toLowerCase().replace(/[^a-z0-9]/g, '');
        const modelNums = deviceModel.match(/\d{3,5}/g) || [];
        const parts = String(scanMonitors.names).split(' / ');
        const keep = parts.map((n, i) => ({ n: n.trim(), id: scanMonitors.ids[i] })).filter(x => {
          const k = x.n.toLowerCase().replace(/[^a-z0-9]/g, '');
          const isPanelCode = /^(lgd|auo|boe|cmn|sdc|shp|ivo|chm|ncp|sec|mei|hsd|inl|lpl|cpt|ltn|lp\d)[0-9a-z]{2,6}$/i.test(k);
          const namedLikeDevice = (k.length >= 4 && modelKey.includes(k)) || modelNums.some(num => x.n.includes(num)) || /built.?in|internal|all.?in.?one|\baio\b/i.test(x.n);
          return x.n && !isPanelCode && !namedLikeDevice;
        });
        if (keep.length !== parts.length) {
          queries.addLog('INFO', 'SCANNER', `نمایشگر داخلی دستگاه ${deviceModel || compName} مانیتور جدا حساب نشد`, parts.filter(p => !keep.some(k => k.n === p.trim())).join(' | '));
        }
        scanMonitors.names = keep.map(x => x.n).join(' / ');
        scanMonitors.ids = keep.map(x => x.id);
      }

      const result = queries.ingestScan({
        chassis: chassis || null,
        user_name: data.user_name || data.userName,
        computer_name: compName,
        manufacturer_model: data.manufacturer_model || data.model,
        serial_number: serialNum,
        os_version: data.os_version || data.os,
        ip_address: data.ip_address || data.ip,
        // "Core(TM)2 Duo CPU     E8400  @ 3.00GHz" -> single spaces
        cpu: typeof data.cpu === 'string' ? data.cpu.replace(/\s+/g, ' ').trim() : data.cpu,
        ram: data.ram,
        storage_drives: data.storage_drives || data.storage,
        c_space: data.c_space || data.cSpace,
        network_devices: data.network_devices || data.networkDevices,
        // Linux lspci lines: "00:02.0 VGA compatible controller: Intel ... (rev 09)" -> "Intel ..."
        gpu: typeof data.gpu === 'string'
          ? data.gpu.split(' / ').map(g => g.replace(/^[0-9a-f:.]+ [^:]*: /i, '').replace(/\s*\(rev [0-9a-fx]+\)\s*$/i, '')).join(' / ')
          : data.gpu,
        monitors: scanMonitors.names,
        disk_health: data.disk_health || data.diskHealth || null,
        source: data.source === 'usb-kit' ? 'usb-kit' : null,
        // Property numbers typed in the scanner popups (computer + one per monitor, same order as `monitors`)
        property_id: data.property_id || data.propertyId || null,
        monitor_property_ids: scanMonitors.ids,
        offline: data.offline === true
      });

      if (data.source === 'usb-kit') queries.markPendingSource(result.batch_id, 'usb-kit');

      queries.addLog('SUCCESS', 'SCANNER',
        `اسکن دریافت شد (${result.items_count} دارایی مجزا تفکیک شد): ${compName || serialNum}`,
        `کاربر: ${data.user_name || data.userName || 'ناشناخته'}, اقلام: ${result.items.map(i => i.category + ': ' + i.name).join(' | ')}`,
        req.headers['x-forwarded-for'] || req.socket?.remoteAddress || ''
      );

      // Disk health line for logs / notifications
      const diskStatus = result.disk_health_status;
      const diskLine = diskStatus === 'critical' ? '\n\n🔴 *هشدار جدی سلامت هارد:* یکی از درایوها در آستانه خرابی است! فوراً از اطلاعات بک‌آپ بگیرید.'
        : diskStatus === 'warning' ? '\n\n🟠 *هشدار سلامت هارد:* وضعیت یکی از درایوها نیاز به بررسی دارد.'
        : '';
      if (diskStatus === 'critical' || diskStatus === 'warning') {
        queries.addLog(diskStatus === 'critical' ? 'ERROR' : 'WARN', 'DISK_HEALTH',
          `وضعیت سلامت هارد «${compName || serialNum}»: ${diskStatus === 'critical' ? 'بحرانی' : 'نیاز به بررسی'}`, '',
          req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '');
      }

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
        notifyBale(text + diskLine).catch(() => {});
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

    // GET /api/photos/library (Get all unique photos stored in inventory)
    if (method === 'GET' && pathname === '/api/photos/library') {
      const search = parsedUrl.searchParams.get('search') || '';
      const library = queries.getPhotoLibrary(search);
      return sendJson(res, 200, { success: true, count: library.length, photos: library });
    }

    // POST /api/assets/:id/attach-existing-photo (Attach a photo from library to this asset)
    const attachExistingMatch = pathname.match(/^\/api\/assets\/(\d+)\/attach-existing-photo$/);
    if (method === 'POST' && attachExistingMatch) {
      const assetId = parseInt(attachExistingMatch[1], 10);
      const asset = queries.getAssetById(assetId);
      if (!asset) return sendJson(res, 404, { error: 'Asset not found' });

      const data = await parseRequestBody(req);
      const fileName = data.file_name || data.fileName;
      if (!fileName) {
        return sendJson(res, 400, { error: 'file_name is required' });
      }

      const filePath = path.join(UPLOADS_DIR, fileName);
      if (!fs.existsSync(filePath)) {
        return sendJson(res, 404, { error: 'Photo file not found on disk' });
      }

      const photoId = queries.attachExistingPhoto(assetId, fileName, data.caption || `انتخاب از گالری (${asset.manufacturer_model || asset.property_id})`);
      
      queries.addLog('SUCCESS', 'PHOTO_ATTACH', 
        `عکس «${fileName}» از آرشیو به دارایی ${asset.property_id} متصل شد.`,
        `مدل: ${asset.manufacturer_model || 'N/A'}`
      );

      return sendJson(res, 200, {
        success: true,
        photo_id: photoId,
        message: 'عکس با موفقیت به دارایی متصل شد.'
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
        // Base64 Photo Upload or Clone Existing Photo
        const data = await parseRequestBody(req);

        // Option A: Use existing photo from another asset of same model
        if (data.queue_file) {
          const photoId = queries.attachQueueFileToAsset(assetId, String(data.queue_file), data.caption || 'Device Photo');
          if (!photoId) return sendJson(res, 404, { error: 'Queued photo not found' });
          return sendJson(res, 201, { success: true, photo: { id: photoId, asset_id: assetId } });
        }

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

    // POST /api/photos/:id/primary (choose the cover photo of an asset)
    const photoPrimaryMatch = pathname.match(/^\/api\/photos\/(\d+)\/primary$/);
    if (method === 'POST' && photoPrimaryMatch) {
      const photoId = parseInt(photoPrimaryMatch[1], 10);
      const ok = queries.setPrimaryPhoto(photoId);
      if (!ok) return sendJson(res, 404, { error: 'Photo not found' });
      return sendJson(res, 200, { success: true });
    }

    // DELETE /api/photos/:id
    const photoDeleteMatch = pathname.match(/^\/api\/photos\/(\d+)$/);
    if (method === 'DELETE' && photoDeleteMatch) {
      const photoId = parseInt(photoDeleteMatch[1], 10);
      const success = queries.deletePhoto(photoId);
      if (!success) return sendJson(res, 404, { error: 'Photo not found' });
      return sendJson(res, 200, { success: true });
    }

    // GET /api/reports/summary?status=&category=  (bulk counts for the summary report page)
    if (method === 'GET' && pathname === '/api/reports/summary') {
      const status = parsedUrl.searchParams.get('status') || 'all';
      const category = parsedUrl.searchParams.get('category') || 'all';
      const computerCats = ['PC', 'Single PC', 'All-in-One', 'Laptop', 'Server'];
      const assets = queries.getAllAssets({ limit: 100000 }).filter(a =>
        (status === 'all' || a.status === status) &&
        (category === 'all' || (category === 'computers' ? computerCats.includes(a.category) : a.category === category)));
      return sendJson(res, 200, buildSummaryReport(assets));
    }

    // GET /api/export/csv
    if (method === 'GET' && pathname === '/api/export/csv') {
      const assets = queries.getAllAssets({ limit: 10000 });
      const headers = [
        'Property ID', 'Category', 'Status', 'User Name', 'Computer Name',
        'Manufacturer/Model', 'Serial Number', 'OS Version', 'IP Address',
        'CPU', 'RAM', 'Storage Drives', 'C: Drive Space', 'Network Devices',
        'GPU', 'Monitors', 'Location', 'Department', 'Notes', 'Created At', 'Last Scanned At',
        'Disk Health', 'Disk Details', 'Has Property Tag', 'Condition', 'Price (Toman)'
      ];

      // Short human-readable disk summary for the CSV
      const diskSummary = (raw) => {
        try {
          const d = JSON.parse(raw || 'null');
          if (!d || !Array.isArray(d.disks)) return '';
          return d.disks.map(x => `${x.model}${x.type ? ' [' + x.type + ']' : ''}: ${x.level}` +
            (x.health_percent !== null && x.health_percent !== undefined ? ` ${x.health_percent}%` : '') +
            (x.temperature_c ? ` ${x.temperature_c}C` : '')).join(' | ');
        } catch (e) { return ''; }
      };

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
          csvEscape(a.last_scanned_at),
          csvEscape(a.disk_health_status || ''),
          csvEscape(diskSummary(a.disk_health)),
          csvEscape(a.no_tag ? 'No' : 'Yes'),
          csvEscape(a.health || 'healthy'),
          csvEscape(a.price || '')
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
      // Never expose internal secrets
      const masked = { ...settings };
      delete masked.session_secret;
      delete masked.scanner_key;
      if (masked.bale_token && masked.bale_token.length > 8) {
        masked.bale_token_preview = masked.bale_token.slice(0, 4) + '...' + masked.bale_token.slice(-4);
      }
      return sendJson(res, 200, masked);
    }

    // POST /api/settings
    if (method === 'POST' && pathname === '/api/settings') {
      const raw = await parseRequestBody(req);
      const ALLOWED_SETTINGS = ['company_name', 'asset_tag_prefix', 'bale_token', 'bale_chat_id', 'gemini_api_key', 'gemini_model', 'photo_priority', 'nine_router_url', 'nine_router_key', 'nine_router_model', 'public_server_url'];
      const data = {};
      for (const k of ALLOWED_SETTINGS) if (raw[k] !== undefined && raw[k] !== null) data[k] = String(raw[k]).slice(0, 500);
      if (data.photo_priority && !['camera', 'newest', 'stock'].includes(data.photo_priority)) delete data.photo_priority;
      queries.updateSettings(data);
      const changedKeys = Object.keys(data).join(', ');
      queries.addLog('INFO', 'SETTINGS', 'تنظیمات سیستم بروزرسانی شد', `فیلدها: ${changedKeys}`, req.socket?.remoteAddress || '');
      const safe = { ...queries.getSettings() };
      delete safe.session_secret;
      delete safe.scanner_key;
      return sendJson(res, 200, { success: true, settings: safe });
    }

    // POST /api/login (User Authentication with Roles: admin / viewer)
    if (method === 'POST' && pathname === '/api/login') {
      const ip = clientIp(req);
      if (isLoginBlocked(ip)) {
        return sendJson(res, 429, { error: 'تعداد تلاش‌های ناموفق زیاد است. ۱۵ دقیقه دیگر دوباره امتحان کنید.' });
      }
      const data = await parseRequestBody(req);
      const username = String(data.username || '').trim();
      const password = String(data.password || '').trim();

      if (!username || !password) {
        return sendJson(res, 400, { error: 'نام کاربری و کلمه عبور الزامی است.' });
      }

      const user = queries.authenticateUser(username, password);
      if (!user) {
        noteLoginFailure(ip);
        queries.addLog('WARN', 'AUTH', `ورود ناموفق با نام کاربری: ${username}`, '', ip);
        return sendJson(res, 401, { error: 'نام کاربری یا کلمه عبور اشتباه است.' });
      }

      loginFailures.delete(ip);
      queries.addLog('SUCCESS', 'AUTH', `ورود موفق کاربر: ${user.full_name} (${user.role})`, '', ip);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': sessionCookieHeader(buildSessionToken(user.id), req)
      });
      return res.end(JSON.stringify({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name,
          role: user.role,
          is_admin: user.is_admin
        }
      }));
    }

    // GET /api/users (List all system users)
    if (method === 'GET' && pathname === '/api/users') {
      const users = queries.getAllUsers();
      return sendJson(res, 200, users);
    }

    // POST /api/users (Create a new user: Admin or Viewer)
    if (method === 'POST' && pathname === '/api/users') {
      const data = await parseRequestBody(req);
      if (!data.username || !data.password || !data.full_name) {
        return sendJson(res, 400, { error: 'نام کاربری، رمز عبور و نام کامل الزامی است.' });
      }
      if (String(data.password).length < 4) {
        return sendJson(res, 400, { error: 'رمز عبور باید حداقل ۴ کاراکتر باشد.' });
      }
      try {
        const id = queries.createUser(data.username, data.password, data.full_name, data.role === 'admin' ? 'admin' : 'viewer');
        queries.addLog('INFO', 'USERS', `کاربر جدید ایجاد شد: ${data.username} (${data.role || 'viewer'})`);
        return sendJson(res, 201, { success: true, id, message: 'کاربر با موفقیت ایجاد شد.' });
      } catch (err) {
        return sendJson(res, 400, { error: 'نام کاربری تکراری است یا خطایی رخ داده است.' });
      }
    }

    // PUT /api/users/:id
    const userUpdateMatch = pathname.match(/^\/api\/users\/(\d+)$/);
    if (method === 'PUT' && userUpdateMatch) {
      const userId = parseInt(userUpdateMatch[1], 10);
      const data = await parseRequestBody(req);
      const role = data.role === 'admin' ? 'admin' : 'viewer';
      if (sessionUser && userId === sessionUser.id && role !== 'admin') {
        return sendJson(res, 400, { error: 'نمی‌توانید نقش مدیر را از حساب خودتان بردارید.' });
      }
      if (data.password && String(data.password).length < 4) {
        return sendJson(res, 400, { error: 'رمز عبور باید حداقل ۴ کاراکتر باشد.' });
      }
      const existingUser = queries.getUserById(userId);
      if (!existingUser) return sendJson(res, 404, { error: 'کاربر پیدا نشد.' });
      const ok = queries.updateUser(userId, data.full_name || existingUser.full_name, role, data.password);
      return sendJson(res, 200, { success: ok, message: 'اطلاعات کاربر به‌روزرسانی شد.' });
    }

    // DELETE /api/users/:id
    const userDeleteMatch = pathname.match(/^\/api\/users\/(\d+)$/);
    if (method === 'DELETE' && userDeleteMatch) {
      const userId = parseInt(userDeleteMatch[1], 10);
      if (userId === 1) {
        return sendJson(res, 400, { error: 'کاربر مدیر اصلی سیستم قابل حذف نیست.' });
      }
      if (sessionUser && userId === sessionUser.id) {
        return sendJson(res, 400, { error: 'نمی‌توانید حساب کاربری خودتان را حذف کنید.' });
      }
      const ok = queries.deleteUser(userId);
      return sendJson(res, 200, { success: ok, message: 'کاربر حذف شد.' });
    }

    // POST /api/test-ai  { provider: '9router' | 'gemini', url?, key?, model? }
    // Tests the values typed in the Settings form (or the saved ones when empty)
    if (method === 'POST' && pathname === '/api/test-ai') {
      const data = await parseRequestBody(req);
      try {
        const result = data.provider === 'gemini'
          ? await testGeminiKey(data.key)
          : await testNineRouter({ url: data.url, key: data.key, model: data.model });
        queries.addLog('SUCCESS', 'AI_TEST', `تست اتصال ${result.provider} موفق بود (${result.latency_ms}ms)`);
        return sendJson(res, 200, result);
      } catch (err) {
        queries.addLog('WARN', 'AI_TEST', `تست اتصال ${data.provider === 'gemini' ? 'Gemini' : '9Router'} ناموفق بود`, err.message);
        return sendJson(res, 200, { ok: false, provider: data.provider || '9router', error: err.message });
      }
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
      let fileName;
      try { fileName = path.basename(decodeURIComponent(pathname)); } catch (e) { fileName = ''; }
      if (!fileName || fileName.startsWith('.')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Photo not found');
      }
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
      // Always revalidate app files so updates show up immediately on phones
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
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
    if (res.headersSent) return res.end();
    if (err && err.statusCode === 413) return sendJson(res, 413, { error: 'حجم فایل یا داده ارسالی بیش از حد مجاز است.' });
    sendJson(res, 500, { error: 'Internal Server Error', message: err.message });
  }
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  // Resume the photo queue (jobs interrupted by a restart start over)
  queries.requeueStalePhotoJobs();
  setTimeout(runPhotoQueue, 2000);
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
