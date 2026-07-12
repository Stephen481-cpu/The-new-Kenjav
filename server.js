/**
 * KENJAV backend — plain Node.js, zero external dependencies.
 *
 * Why no Express/SQLite: this keeps deployment to "install Node, run node server.js" —
 * nothing to `npm install`, nothing to compile. Good fit for a small shop's order volume.
 * If you outgrow the JSON-file storage later, the routes below are a natural place to
 * swap in a real database without changing the API shape the frontend expects.
 *
 * Run locally:   node server.js
 * Health check:  curl http://localhost:4000/api/health
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---- tiny .env loader (so you don't need the `dotenv` package) ----
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx === -1) return;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!(key in process.env)) process.env[key] = val;
    });
  }
}
loadEnv();

const PORT = process.env.PORT || 4000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-admin-key';
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

if (ADMIN_KEY === 'change-me-admin-key') {
  console.warn('[KENJAV] WARNING: using the default ADMIN_KEY. Set a real one in .env before going live.');
}

// ---- tiny JSON-file datastore ----
function readJSON(file, fallback) {
  const p = path.join(DATA_DIR, file);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return fallback; }
}
function writeJSON(file, data) {
  const p = path.join(DATA_DIR, file);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function send(res, status, body) {
  const isString = typeof body === 'string';
  const payload = isString ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isString ? 'text/plain' : 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,OPTIONS'
  });
  res.end(payload);
}

function isAdmin(req) {
  return req.headers['x-admin-key'] === ADMIN_KEY;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  const safePath = path.normalize(urlPath === '/' ? '/admin.html' : urlPath);
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
  fs.readFile(filePath, (err, content) => {
    if (err) return send(res, 404, 'Not found');
    const ext = path.extname(filePath);
    const type = ext === '.html' ? 'text/html'
      : ext === '.css' ? 'text/css'
      : ext === '.js' ? 'application/javascript'
      : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method;

  if (method === 'OPTIONS') return send(res, 204, '');

  try {
    // ---- MENU ----
    if (pathname === '/api/menu' && method === 'GET') {
      return send(res, 200, readJSON('menu.json', []));
    }
    if (pathname === '/api/menu' && method === 'PUT') {
      if (!isAdmin(req)) return send(res, 401, { error: 'Unauthorized' });
      const body = await readBody(req);
      if (!Array.isArray(body)) return send(res, 400, { error: 'Expected an array of menu items.' });
      writeJSON('menu.json', body);
      return send(res, 200, body);
    }

    // ---- OFFERS ----
    if (pathname === '/api/offers' && method === 'GET') {
      return send(res, 200, readJSON('offers.json', []));
    }
    if (pathname === '/api/offers' && method === 'PUT') {
      if (!isAdmin(req)) return send(res, 401, { error: 'Unauthorized' });
      const body = await readBody(req);
      if (!Array.isArray(body)) return send(res, 400, { error: 'Expected an array of offers.' });
      writeJSON('offers.json', body);
      return send(res, 200, body);
    }

    // ---- ORDERS ----
    if (pathname === '/api/orders' && method === 'POST') {
      const body = await readBody(req);
      if (!Array.isArray(body.items) || body.items.length === 0) {
        return send(res, 400, { error: 'Order must include at least one item.' });
      }
      if (!body.name || !body.phone) {
        return send(res, 400, { error: 'Name and phone are required.' });
      }
      if (body.fulfillment === 'delivery' && !body.address) {
        return send(res, 400, { error: 'Delivery address is required for delivery orders.' });
      }
      const orders = readJSON('orders.json', []);
      const order = {
        id: crypto.randomUUID(),
        items: body.items,
        total: Number(body.total) || 0,
        fulfillment: body.fulfillment === 'delivery' ? 'delivery' : 'pickup',
        address: body.address || '',
        name: String(body.name).slice(0, 120),
        phone: String(body.phone).slice(0, 40),
        notes: String(body.notes || '').slice(0, 400),
        status: 'new',
        createdAt: new Date().toISOString()
      };
      orders.push(order);
      writeJSON('orders.json', orders);
      return send(res, 201, order);
    }
    if (pathname === '/api/orders' && method === 'GET') {
      if (!isAdmin(req)) return send(res, 401, { error: 'Unauthorized' });
      return send(res, 200, readJSON('orders.json', []));
    }
    const orderMatch = pathname.match(/^\/api\/orders\/([a-zA-Z0-9-]+)$/);
    if (orderMatch && method === 'PATCH') {
      if (!isAdmin(req)) return send(res, 401, { error: 'Unauthorized' });
      const body = await readBody(req);
      const orders = readJSON('orders.json', []);
      const idx = orders.findIndex(o => o.id === orderMatch[1]);
      if (idx === -1) return send(res, 404, { error: 'Order not found' });
      if (body.status) orders[idx].status = body.status;
      writeJSON('orders.json', orders);
      return send(res, 200, orders[idx]);
    }

    // ---- HEALTH ----
    if (pathname === '/api/health' && method === 'GET') {
      return send(res, 200, { ok: true, time: new Date().toISOString() });
    }

    // ---- ADMIN STATIC PAGE ----
    if (method === 'GET' && !pathname.startsWith('/api/')) {
      return serveStatic(req, res, pathname);
    }

    send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'Server error', detail: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`KENJAV backend running on http://localhost:${PORT}`);
  console.log(`Admin page:  http://localhost:${PORT}/admin.html`);
});
