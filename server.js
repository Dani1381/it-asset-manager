// server.js - Zero-dependency IT Asset Management HTTP Server
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { queries, getNextPropertyId } = require('./database');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

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
    // API ROUTES
    // -------------------------------------------------------------

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
