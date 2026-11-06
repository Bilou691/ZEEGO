// Trotti – prototype GPS trottinette (France)
const MAX_KMH = 25; // limite légale EDPM en France
const REPORT_TYPES = {
  pothole: ['🕳️', 'Nid-de-poule'], works: ['🚧', 'Travaux'], police: ['👮', 'Contrôle'],
  danger: ['⚠️', 'Danger'], blocked: ['⛔', 'Piste bloquée'], cobble: ['🧱', 'Pavés']
};
const REPORT_TTL_H = 48;
const $ = id => document.getElementById(id);

const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: { osm: { type: 'raster', tileSize: 256, maxzoom: 19,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      attribution: '© OpenStreetMap' } },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
  },
  center: [2.35, 48.85], zoom: 12
});
map.addControl(new maplibregl.AttributionControl({ compact: true }));

let me = null, meMarker = null, dest = null, destMarker = null;
let route = null, watchId = null, navigating = false;
const reportMarkers = [];

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2500);
}

// ---------- Géolocalisation ----------
function updateMe(pos) {
  me = [pos.coords.longitude, pos.coords.latitude];
  if (!meMarker) {
    const el = document.createElement('div');
    el.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 4px #2563eb44';
    meMarker = new maplibregl.Marker({ element: el }).setLngLat(me).addTo(map);
  } else meMarker.setLngLat(me);
  if (navigating) {
    const kmh = pos.coords.speed != null ? pos.coords.speed * 3.6 : 0;
    $('spd').textContent = Math.round(kmh);
    $('speedo').classList.toggle('over', kmh > MAX_KMH);
    map.easeTo({ center: me, zoom: 17, duration: 800 });
  }
}
function startWatch(centerOnce) {
  if (!navigator.geolocation) return toast('Géolocalisation indisponible');
  if (watchId == null)
    watchId = navigator.geolocation.watchPosition(updateMe, e => toast('GPS : ' + e.message),
      { enableHighAccuracy: true, maximumAge: 1000 });
  if (centerOnce) navigator.geolocation.getCurrentPosition(p => {
    updateMe(p); map.flyTo({ center: me, zoom: 15 });
  }, () => {}, { enableHighAccuracy: true });
}
$('locate').onclick = () => me ? map.flyTo({ center: me, zoom: 16 }) : startWatch(true);
startWatch(true);

// ---------- Recherche (Nominatim, France) ----------
async function search(q) {
  const u = 'https://nominatim.openstreetmap.org/search?format=json&countrycodes=fr&limit=5&accept-language=fr&q=' + encodeURIComponent(q);
  const r = await fetch(u); return r.json();
}
async function doSearch() {
  const q = $('q').value.trim(); if (!q) return;
  try {
    const res = await search(q);
    const ul = $('results'); ul.innerHTML = '';
    if (!res.length) { toast('Aucun résultat'); return; }
    res.forEach(p => {
      const li = document.createElement('li'); li.textContent = p.display_name;
      li.onclick = () => { ul.hidden = true; $('q').value = p.display_name.split(',')[0]; setDest([+p.lon, +p.lat]); };
      ul.appendChild(li);
    });
    ul.hidden = false;
  } catch { toast('Recherche impossible (réseau)'); }
}
$('go').onclick = doSearch;
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
map.on('click', e => { if (!$('menu').hidden) return; $('results').hidden = true; });
map.on('contextmenu', e => setDest([e.lngLat.lng, e.lngLat.lat]));
let press;
map.on('touchstart', e => { if (e.points.length === 1) press = setTimeout(() => setDest([e.lngLat.lng, e.lngLat.lat]), 700); });
['touchend', 'touchmove', 'touchcancel'].forEach(ev => map.on(ev, () => clearTimeout(press)));

// ---------- Itinéraire ----------
// Moteur vélo OSM (pistes cyclables, évite voies rapides). L'ETA est recalculé
// avec la vitesse réelle de trottinette (≤ 25 km/h), pas la vitesse vélo.
async function setDest(ll) {
  dest = ll;
  if (destMarker) destMarker.remove();
  destMarker = new maplibregl.Marker({ color: '#dc2626' }).setLngLat(dest).addTo(map);
  if (!me) { toast('Position GPS en attente…'); startWatch(true); await new Promise(r => setTimeout(r, 1500)); }
  if (!me) { map.flyTo({ center: dest, zoom: 14 }); return; }
  const u = `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${me.join(',')};${dest.join(',')}?overview=full&geometries=geojson`;
  try {
    const r = await (await fetch(u)).json();
    if (r.code !== 'Ok') throw 0;
    route = r.routes[0];
    drawRoute(); showSheet();
  } catch { toast('Itinéraire introuvable'); }
}
function drawRoute() {
  const data = { type: 'Feature', geometry: route.geometry };
  if (map.getSource('route')) map.getSource('route').setData(data);
  else {
    map.addSource('route', { type: 'geojson', data });
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#064e3b', 'line-width': 9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#10b981', 'line-width': 6 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  }
  const b = route.geometry.coordinates.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(route.geometry.coordinates[0], route.geometry.coordinates[0]));
  map.fitBounds(b, { padding: { top: 90, bottom: 260, left: 40, right: 40 }, duration: 800 });
}
function reportsNearRoute() {
  if (!route) return 0;
  const pts = route.geometry.coordinates;
  return loadReports().filter(r => pts.some((c, i) => i % 3 === 0 && dist(c, [r.lng, r.lat]) < 30)).length;
}
function showSheet() {
  const km = route.distance / 1000;
  const avg = +$('avg').value;
  const min = Math.round(km / avg * 60 * 1.08); // +8% arrêts / feux
  const n = reportsNearRoute();
  $('routeInfo').innerHTML = `<b>${min} min</b> · ${km.toFixed(1)} km` +
    (n ? `<span class="warn">⚠️ ${n} signalement(s) sur le trajet</span>` : '');
  $('sheet').hidden = false;
}
$('avg').oninput = () => { $('avgOut').textContent = $('avg').value; try { localStorage.avg = $('avg').value; } catch {} if (route) showSheet(); };
try { if (localStorage.avg) { $('avg').value = localStorage.avg; $('avgOut').textContent = localStorage.avg; } } catch {}

$('start').onclick = () => {
  navigating = true; $('speedo').hidden = false; $('start').hidden = true; $('cancel').textContent = 'Arrêter';
  startWatch(); if (me) map.easeTo({ center: me, zoom: 17 });
  toast('Navigation démarrée – max ' + MAX_KMH + ' km/h');
};
$('cancel').onclick = () => {
  navigating = false; $('speedo').hidden = true; $('start').hidden = false; $('cancel').textContent = 'Annuler';
  $('sheet').hidden = true; route = null;
  if (map.getSource('route')) map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
  if (destMarker) destMarker.remove();
};

// ---------- Signalements (local pour l'instant ; backend partagé à venir) ----------
// URL de l'API partagée (HTTPS obligatoire dans l'APK). Vide = mode local seul.
const SERVER_URL = 'https://zeego.onrender.com';
let cache = [];
function loadReports() {
  try {
    const local = JSON.parse(localStorage.reports || '[]');
    return [...cache, ...local].filter(r => Date.now() - r.t < REPORT_TTL_H * 3600e3);
  } catch { return cache; }
}
function saveReports(a) { try { localStorage.reports = JSON.stringify(a); } catch {} }
async function fetchReports() {
  if (!SERVER_URL) return;
  const b = map.getBounds();
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
  try { cache = await (await fetch(`${SERVER_URL}/api/reports?bbox=${bbox}`)).json(); renderReports(); } catch {}
}
async function postReport(type, lng, lat) {
  if (SERVER_URL) {
    try {
      const r = await fetch(`${SERVER_URL}/api/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, lng, lat }) });
      if (r.ok) { fetchReports(); return 'shared'; }
      if (r.status === 429) return 'limit';
    } catch {}
  }
  const a = JSON.parse(localStorage.reports || '[]'); a.push({ type, lng, lat, t: Date.now() });
  saveReports(a); renderReports(); return 'local';
}
function renderReports() {
  reportMarkers.forEach(m => m.remove()); reportMarkers.length = 0;
  loadReports().forEach(r => {
    const el = document.createElement('div'); el.className = 'pin'; el.textContent = REPORT_TYPES[r.type][0];
    el.title = REPORT_TYPES[r.type][1];
    reportMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([r.lng, r.lat]).addTo(map));
  });
}
$('report').onclick = () => $('menu').hidden = false;
$('closeMenu').onclick = () => $('menu').hidden = true;
document.querySelectorAll('#menu [data-t]').forEach(b => b.onclick = async () => {
  const pos = me || [map.getCenter().lng, map.getCenter().lat];
  $('menu').hidden = true;
  const s = await postReport(b.dataset.t, pos[0], pos[1]);
  toast(s === 'limit' ? 'Trop de signalements, réessaie plus tard'
    : 'Merci ! ' + REPORT_TYPES[b.dataset.t][1] + (s === 'shared' ? ' partagé' : ' (enregistré hors ligne)'));
});
map.on('load', () => { renderReports(); fetchReports(); });
map.on('moveend', fetchReports);
setInterval(fetchReports, 30000);

function dist(a, b) { // mètres (haversine)
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
