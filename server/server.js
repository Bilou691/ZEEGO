// Serveur de signalements Trotti – aucune dépendance (Node 18+).
// Lancer : node server.js   (PORT=3000 par défaut, DATA_DIR pour le stockage)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const FILE = path.join(process.env.DATA_DIR || __dirname, 'reports.json');
const TYPES = ['pothole', 'works', 'police', 'danger', 'blocked', 'cobble'];
const TTL = t => (t === 'works' || t === 'police' ? 48 : 30 * 24) * 3600e3; // travaux/contrôles : 48 h ; le reste (nids-de-poule, pavés…) : 30 jours
const FR = { minLat: 41, maxLat: 51.5, minLng: -5.5, maxLng: 10 }; // France + Corse

let reports = [];
try { reports = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
const save = () => fs.writeFile(FILE + '.tmp', JSON.stringify(reports), () => fs.rename(FILE + '.tmp', FILE, () => {})); // atomique : un crash en pleine écriture ne peut plus corrompre reports.json
const purge = () => { const n = Date.now(); reports = reports.filter(r => n - r.t < TTL(r.type)); };

const hits = new Map(); // limite : 20 signalements / heure / IP
function limited(ip) {
  const n = Date.now(), a = (hits.get(ip) || []).filter(t => n - t < 3600e3);
  if (a.length >= 20) return true;
  a.push(n); hits.set(ip, a); return false;
}
setInterval(() => { // purge : les IPs vues une fois ne restaient pas dans la Map pour toujours
  const n = Date.now();
  hits.forEach((a, ip) => { const f = a.filter(t => n - t < 3600e3); f.length ? hits.set(ip, f) : hits.delete(ip); });
}, 300000);
const dist = (a, b, c, d) => Math.hypot((a - c) * 111000, (b - d) * 75000);

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(JSON.stringify(body));
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/reports' && req.method === 'GET') {
    purge();
    const [w, s, e, n] = (u.searchParams.get('bbox') || '-180,-90,180,90').split(',').map(Number);
    return send(res, 200, reports.filter(r => r.lng >= w && r.lng <= e && r.lat >= s && r.lat <= n).slice(0, 500));
  }
  if (u.pathname === '/api/reports' && req.method === 'POST') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    if (limited(ip)) return send(res, 429, { error: 'trop de signalements' });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2000) req.destroy(); });
    req.on('end', () => {
      let d; try { d = JSON.parse(body); } catch { return send(res, 400, { error: 'json' }); }
      const { type, lat, lng } = d;
      if (!TYPES.includes(type) || typeof lat !== 'number' || typeof lng !== 'number' ||
          lat < FR.minLat || lat > FR.maxLat || lng < FR.minLng || lng > FR.maxLng)
        return send(res, 400, { error: 'invalide' });
      purge();
      // même type à < 25 m : on rafraîchit et on compte une confirmation
      const dup = reports.find(r => r.type === type && dist(r.lat, r.lng, lat, lng) < 25);
      if (dup) { dup.t = Date.now(); dup.confirms++; save(); return send(res, 200, dup); }
      const r = { id: crypto.randomUUID(), type, lat, lng, t: Date.now(), confirms: 1 };
      reports.push(r); save(); send(res, 201, r);
    });
    return;
  }
  if (u.pathname === '/health') return send(res, 200, { ok: true });
  send(res, 404, { error: 'not found' });
}).listen(PORT, () => console.log('Trotti API sur le port ' + PORT));
