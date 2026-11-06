// Trotti – GPS trottinette (France). Toute l'interface est construite ici pour pouvoir
// être mise à jour à distance (voir boot.js).
(() => {
'use strict';
const CFG = {
  server: 'https://zeego.onrender.com',                     // API des signalements
  valhalla: 'https://valhalla1.openstreetmap.de/route',     // moteur d'itinéraire (profil vélo)
  osrm: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving/', // secours
  photon: 'https://photon.komoot.io/api/',                  // recherche d'adresses (autocomplétion)
  overpass: ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'], // POI OSM
  styleLight: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  styleDark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  maxKmh: 25,                                               // limite légale EDPM en France
  reportTtlH: 48
};
const REPORT_TYPES = {
  pothole: ['🕳️', 'Nid-de-poule', '#a16207'], works: ['🚧', 'Travaux', '#f59e0b'], police: ['👮', 'Contrôle', '#3b82f6'],
  danger: ['⚠️', 'Danger', '#ef4444'], blocked: ['⛔', 'Piste bloquée', '#dc2626'], cobble: ['🧱', 'Pavés', '#a8a29e']
};
const V = (window.TrottiBoot && TrottiBoot.version) || '1.4.7';
const $ = id => document.getElementById(id);
const store = {
  get: (k, d) => { try { const v = localStorage.getItem('trotti.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('trotti.' + k, JSON.stringify(v)); } catch {} },
  del: k => { try { localStorage.removeItem('trotti.' + k); } catch {} }
};

// ---------- icônes ----------
const ic = (p, x = '') => `<svg class="i" viewBox="0 0 24 24" ${x}>${p}</svg>`;
const I = {
  search: ic('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  close: ic('<path d="M18 6 6 18M6 6l12 12"/>'),
  go: ic('<path d="M5 12h14M13 6l6 6-6 6"/>', 'style="stroke-width:2.6"'),
  locate: ic('<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  alert: ic('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
  layers: ic('<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 13 9 5 9-5"/><path d="m3 17.5 9 5 9-5" opacity=".5"/>'),
  stats: ic('<path d="M5 21V11M12 21V4M19 21v-7"/>', 'style="stroke-width:2.6"'),
  scooter: ic('<circle cx="5.5" cy="18" r="2.5"/><circle cx="18.5" cy="18" r="2.5"/><path d="M8 18h8M18.5 18 15.5 4.5H13M11 4.5h5"/>'),
  pin: ic('<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  arrow: ic('<path d="M12 20V5M5.5 11.5 12 5l6.5 6.5"/>', 'style="stroke-width:3"'),
  flag: ic('<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>', 'style="stroke-width:2.4"')
};
const DEST_SVG = '<svg viewBox="0 0 36 44"><path d="M18 0C8 0 0 8 0 18c0 13 18 26 18 26s18-13 18-26C36 8 28 0 18 0z" fill="#ef4444"/><circle cx="18" cy="18" r="7" fill="#fff"/></svg>';

// ---------- interface ----------
$('app').innerHTML = `
<div id="map"></div>
<div id="top">
  <div class="searchbox glass">${I.search}<input id="q" type="search" placeholder="Où va-t-on en trottinette ?" autocomplete="off" autocapitalize="off" enterkeyhint="search">
    <button id="clear" aria-label="Effacer" hidden>${I.close}</button><button id="go" aria-label="Chercher">${I.go}</button></div>
  <ul id="results" class="glass" hidden></ul>
</div>
<div id="nav" hidden><div class="arrow" id="navIcon"></div><div><div class="d" id="navDist"></div><div class="t" id="navText"></div></div></div>
<div id="fabs">
  <button id="report" class="fab" aria-label="Signaler">${I.alert}</button>
  <button id="statsBtn" class="fab glass" aria-label="Mes kilomètres">${I.stats}</button>
  <button id="layersBtn" class="fab glass" aria-label="Sur ma route">${I.layers}</button>
  <button id="locate" class="fab glass" aria-label="Me localiser">${I.locate}</button>
</div>
<button id="ridebtn">${I.scooter}Rouler</button>
<div id="sheet" class="panel glass" hidden>
  <div id="routeInfo"></div>
  <div class="chips" id="chips"></div><div class="chips" id="poiChips"></div>
  <div class="speedrow">Vitesse de croisière<input id="avg" type="range" min="12" max="25" step="1"><output id="avgOut"></output></div>
  <div class="btns"><button id="cancel" class="btn sec">Annuler</button><button id="start" class="btn main">${I.go}Démarrer</button></div>
</div>
<div id="hud" class="panel glass" hidden>
  <div class="top">
    <div class="odo"><div class="lbl">Compteur du trajet</div><div class="val"><span id="odo">0,00</span><small>km</small></div></div>
    <div class="gauge" id="gauge"><svg viewBox="0 0 96 96"><defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#059669"/></linearGradient></defs>
      <circle class="bg" cx="48" cy="48" r="34"/><circle class="fg" id="gfg" cx="48" cy="48" r="34"/></svg>
      <div class="n"><b id="spd">0</b><small>km/h</small></div></div>
  </div>
  <div class="stats3"><div><b id="tm">0:00</b><small>Durée</small></div><div><b id="avgs">–</b><small>Moy. km/h</small></div><div><b id="mx">0</b><small>Max km/h</small></div></div>
  <div class="remain" id="remain" hidden></div>
  <div class="btns"><button id="end" class="btn stop">Terminer le trajet</button></div>
</div>
<div id="banner" class="glass" hidden></div>
<div id="modal" class="modal" hidden></div>
<div id="toast" class="glass" hidden></div>`;

// ---------- carte ----------
const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;
const styleUrl = () => dark() ? CFG.styleDark : CFG.styleLight;
const lastPos = store.get('pos', null);
const map = new maplibregl.Map({
  container: 'map', style: styleUrl(), center: lastPos || [2.35, 48.85], zoom: lastPos ? 15 : 11,
  attributionControl: false, pitchWithRotate: false, maxPitch: 70, fadeDuration: 150, localIdeographFontFamily: false
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
const lineFeat = c => c && c.length > 1 ? { type: 'Feature', geometry: { type: 'LineString', coordinates: c } } : emptyFC();

function ensureLayers() {
  if (!map.getSource('route')) {
    map.addSource('route', { type: 'geojson', data: emptyFC() });
    map.addSource('done', { type: 'geojson', data: emptyFC() });
    const layout = { 'line-cap': 'round', 'line-join': 'round' };
    const w = (a, b) => ['interpolate', ['linear'], ['zoom'], 10, a, 17, b];
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout, paint: { 'line-color': dark() ? '#022c22' : '#ffffff', 'line-width': w(7, 16) } });
    map.addLayer({ id: 'route', type: 'line', source: 'route', layout, paint: { 'line-color': '#10b981', 'line-width': w(4, 10) } });
    map.addLayer({ id: 'done', type: 'line', source: 'done', layout, paint: { 'line-color': '#94a3b8', 'line-width': w(4, 10), 'line-opacity': .9 } });
  }
  syncRoute();
}
map.on('style.load', ensureLayers);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => map.setStyle(styleUrl()));
function syncRoute(doneIdx) {
  if (!map.getSource('route')) return;
  map.getSource('route').setData(route ? lineFeat(route.coords) : emptyFC());
  map.getSource('done').setData(route && doneIdx > 0 ? lineFeat(route.coords.slice(0, doneIdx + 1)) : emptyFC());
}

// ---------- état ----------
let me = null, hdg = null, meMarker = null, meEl = null, dest = null, destName = '', destMarker = null;
let route = null, watchId = null, follow = true, seq = 0;
const ride = { active: false, mode: 'free', dist: 0, t0: 0, moving: 0, max: 0, last: null, speed: 0, off: 0, idx: 0, lastReroute: 0 };
let hudTimer = null, wl = null, pendingApply = false;

function toast(msg, ms = 2800) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms);
}
const pad = n => String(n).padStart(2, '0');
const fmtKm = m => (m / 1000).toFixed(2).replace('.', ',');
const fmtDist = m => m < 1000 ? Math.max(10, Math.round(m / 10) * 10) + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km';
const fmtTime = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}:${pad(m)}` : `${m}:${pad(s % 60)}`; };
const fmtClock = t => { const d = new Date(t); return `${d.getHours()}h${pad(d.getMinutes())}`; };
const avgSpeed = () => +store.get('avg', 20);

function setState(s) {
  document.body.dataset.s = s;
  $('sheet').hidden = s !== 'route';
  $('hud').hidden = s !== 'ride';
  $('ridebtn').hidden = s !== 'idle';
  $('nav').hidden = !(s === 'ride' && ride.mode === 'nav');
  updatePanel();
  if (s === 'idle' && pendingApply) applyUpdate();
}
function updatePanel() {
  const p = [$('sheet'), $('hud')].find(x => !x.hidden);
  document.documentElement.style.setProperty('--panel', (p ? p.offsetHeight : 92) + 'px');
}
const ro = new ResizeObserver(updatePanel); ro.observe($('sheet')); ro.observe($('hud'));

// ---------- géolocalisation ----------
function makeMe() {
  meEl = document.createElement('div'); meEl.className = 'me'; meEl.innerHTML = '<b></b><i></i>';
  meMarker = new maplibregl.Marker({ element: meEl, rotationAlignment: 'map', pitchAlignment: 'viewport' }).setLngLat(me).addTo(map);
}
function angDiff(a, b) { return ((b - a + 540) % 360) - 180; }
function onFix(pos) {
  const c = pos.coords, first = !me;
  me = [c.longitude, c.latitude];
  if (c.heading != null && !isNaN(c.heading) && (c.speed || 0) > 1.2) hdg = hdg == null ? c.heading : (hdg + angDiff(hdg, c.heading) * .6 + 360) % 360;
  if (!meMarker) makeMe(); else meMarker.setLngLat(me);
  meEl.classList.toggle('hd', hdg != null && ride.active);
  if (hdg != null) meMarker.setRotation(hdg);
  store.set('pos', me);
  if (first && !ride.active) map.flyTo({ center: me, zoom: 15.5, duration: 1200 });
  if (ride.active) trackRide(c, pos.timestamp || Date.now());
}
function startWatch() {
  if (!navigator.geolocation) return toast('Géolocalisation indisponible');
  if (watchId == null) watchId = navigator.geolocation.watchPosition(onFix,
    e => { if (e.code === 1) toast('Autorise la localisation pour utiliser Trotti'); else if (Date.now() - (startWatch.w || 0) > 30000) { startWatch.w = Date.now(); toast('GPS : signal faible'); } },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}
const waitFix = ms => new Promise(r => { const t0 = Date.now(), i = setInterval(() => { if (me || Date.now() - t0 > ms) { clearInterval(i); r(); } }, 150); });
function setFollow(v) { follow = v; $('locate').classList.toggle('on', v); }
$('locate').onclick = () => {
  if (!me) { startWatch(); return toast('Recherche du GPS…'); }
  setFollow(true);
  map.easeTo({ center: me, zoom: ride.active ? 17 : 16, bearing: ride.active && hdg != null ? hdg : 0, pitch: ride.active ? 55 : 0, duration: 700 });
};
map.on('dragstart', e => { if (e.originalEvent) setFollow(false); });
startWatch();

// ---------- recherche (Photon : autocomplétion OSM) ----------
let sugTimer, sugCtl;
function placeLabel(p) {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const title = p.name || street || p.city || 'Lieu';
  const sub = [p.name && street ? street : '', [p.postcode, p.city || p.county].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  return { title, sub };
}
async function suggest(q) {
  if (sugCtl) sugCtl.abort(); sugCtl = new AbortController();
  const near = me ? `&lat=${me[1]}&lon=${me[0]}` : '';
  const r = await fetch(`${CFG.photon}?q=${encodeURIComponent(q)}&lang=fr&limit=6&bbox=-5.6,41.2,10,51.2${near}`, { signal: sugCtl.signal });
  return (await r.json()).features || [];
}
function showResults(list) {
  const ul = $('results'); ul.innerHTML = '';
  if (!list.length) ul.innerHTML = '<li class="empty">Aucun résultat</li>';
  list.forEach(f => {
    const { title, sub } = placeLabel(f.properties), li = document.createElement('li');
    li.innerHTML = `<div class="pi">${I.pin}</div><div><b></b><small></small></div>`;
    li.querySelector('b').textContent = title; li.querySelector('small').textContent = sub;
    li.onclick = () => pick(f);
    ul.appendChild(li);
  });
  ul.hidden = false;
}
function pick(f) {
  const { title } = placeLabel(f.properties);
  $('results').hidden = true; $('q').value = title; $('q').blur(); $('clear').hidden = false;
  setDest(f.geometry.coordinates, title);
}
async function runSearch(immediate) {
  const q = $('q').value.trim();
  if (q.length < 3) { $('results').hidden = true; return; }
  try {
    const list = await suggest(q);
    if (immediate && list.length) return pick(list[0]);
    showResults(list);
  } catch (e) { if (e.name !== 'AbortError') toast('Recherche impossible (réseau)'); }
}
$('q').addEventListener('input', () => {
  $('clear').hidden = !$('q').value; clearTimeout(sugTimer); sugTimer = setTimeout(() => runSearch(false), 300);
});
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(sugTimer); runSearch(true); } });
$('go').onclick = () => runSearch(true);
$('clear').onclick = () => { $('q').value = ''; $('clear').hidden = true; $('results').hidden = true; $('q').focus(); };
map.on('click', () => { $('results').hidden = true; $('q').blur(); });
map.on('contextmenu', e => setDest([e.lngLat.lng, e.lngLat.lat], 'Point sur la carte'));
let press;
map.on('touchstart', e => { if (e.points.length === 1) press = setTimeout(() => { navigator.vibrate?.(30); setDest([e.lngLat.lng, e.lngLat.lat], 'Point sur la carte'); }, 650); });
['touchend', 'touchmove', 'touchcancel', 'dragstart', 'zoomstart'].forEach(ev => map.on(ev, () => clearTimeout(press)));

// ---------- itinéraire trottinette ----------
// Profil « vélo » de Valhalla réglé pour une trottinette : on cherche le trajet le plus RAPIDE.
//  - use_roads 0,85 : le trafic ne gêne pas (on se faufile sur le côté), on ne détourne pas pour une piste
//  - use_hills 1 : trottinette électrique, les côtes ne comptent pas
//  - avoid_bad_surfaces 0,5 : petites roues, on évite pavés et chemins défoncés
//  - jamais d'autoroute, ni de trottoir/escalier ; sens interdits respectés (comme la loi)
const decode6 = s => {
  let i = 0, lat = 0, lng = 0; const out = [];
  while (i < s.length) {
    for (const k of [0, 1]) {
      let b, sh = 0, r = 0;
      do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
      const d = r & 1 ? ~(r >> 1) : r >> 1; if (k) lng += d; else lat += d;
    }
    out.push([lng / 1e6, lat / 1e6]);
  }
  return out;
};
const clean = t => String(t || '').replace(/P[ée]dalez/g, 'Roulez').replace(/p[ée]dalez/g, 'roulez').replace(/cycliste/g, 'trottinette').replace(/\.$/, '');
function excludePoints(a, b) {
  const x0 = Math.min(a[0], b[0]) - .02, x1 = Math.max(a[0], b[0]) + .02, y0 = Math.min(a[1], b[1]) - .02, y1 = Math.max(a[1], b[1]) + .02;
  return loadReports().filter(r => (r.type === 'blocked' || r.type === 'works') && r.lng > x0 && r.lng < x1 && r.lat > y0 && r.lat < y1).slice(0, 20).map(r => [r.lng, r.lat]);
}
async function valhalla(from, to, avg, excl) {
  const body = {
    locations: [{ lat: from[1], lon: from[0] }, { lat: to[1], lon: to[0] }], costing: 'bicycle',
    costing_options: { bicycle: { bicycle_type: 'Hybrid', cycling_speed: avg, use_roads: .85, use_hills: 1, avoid_bad_surfaces: .5, use_living_streets: .6 } },
    directions_options: { language: 'fr-FR', units: 'kilometers' }
  };
  if (excl.length) body.exclude_locations = excl.map(p => ({ lat: p[1], lon: p[0] }));
  const r = await fetch(CFG.valhalla, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.trip || j.trip.status) throw new Error('valhalla');
  const leg = j.trip.legs[0];
  return { coords: decode6(leg.shape), duration: j.trip.summary.time, avg,
    maneuvers: leg.maneuvers.map(m => ({ type: m.type, text: clean(m.instruction), begin: m.begin_shape_index })) };
}
async function osrm(from, to, avg) {
  const j = await (await fetch(`${CFG.osrm}${from.join(',')};${to.join(',')}?overview=full&geometries=geojson`)).json();
  if (j.code !== 'Ok') throw new Error('osrm');
  const rt = j.routes[0];
  return { coords: rt.geometry.coordinates, duration: rt.distance / 1000 / avg * 3600 * 1.08, avg, maneuvers: [] };
}
async function fetchRoute(from, to, avg) {
  const ex = excludePoints(from, to); let r;
  try { r = await valhalla(from, to, avg, ex); }
  catch { try { r = await valhalla(from, to, avg, []); } catch { r = await osrm(from, to, avg); } }
  r.cum = [0]; for (let i = 1; i < r.coords.length; i++) r.cum[i] = r.cum[i - 1] + dist(r.coords[i - 1], r.coords[i]);
  r.distance = r.cum[r.cum.length - 1];
  return r;
}
function placeDest() {
  if (destMarker) destMarker.remove();
  const el = document.createElement('div'); el.className = 'dest'; el.innerHTML = DEST_SVG;
  destMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(dest).addTo(map);
}
async function setDest(ll, name) {
  if (ride.active) return toast('Termine d’abord ton trajet en cours');
  dest = ll; destName = name || 'Destination'; placeDest();
  if (!me) { toast('Recherche de ta position GPS…'); startWatch(); await waitFix(8000); }
  if (!me) { map.flyTo({ center: dest, zoom: 14 }); return toast('Position GPS indisponible'); }
  await computeRoute(true);
}
async function computeRoute(fit) {
  const my = ++seq; $('go').style.opacity = .6;
  try {
    const r = await fetchRoute(me, dest, avgSpeed());
    if (my !== seq) return;
    route = r; syncRoute(); if (fit) fitRoute(); showSheet(); setState('route'); refreshPois();
  } catch { if (my === seq) toast('Itinéraire introuvable'); }
  finally { $('go').style.opacity = 1; }
}
function fitRoute() {
  const c = route.coords, b = c.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(c[0], c[0]));
  map.fitBounds(b, { padding: { top: 100, bottom: 330, left: 50, right: 100 }, duration: 900, pitch: 0, bearing: 0, maxZoom: 17 });
}
function reportsNearRoute() {
  if (!route) return 0;
  const reps = loadReports(); if (!reps.length) return 0;
  return reps.filter(r => route.coords.some((c, i) => i % 3 === 0 && dist(c, [r.lng, r.lat]) < 30)).length;
}
function showSheet() {
  const avg = avgSpeed(), min = Math.max(1, Math.round(route.duration * route.avg / avg / 60)), n = reportsNearRoute();
  $('avg').value = avg; $('avgOut').textContent = avg + ' km/h';
  $('routeInfo').innerHTML = `<div class="big">${min}<small>min</small></div><div class="km"><b>${fmtDist(route.distance)}</b><br>arrivée ${fmtClock(Date.now() + min * 60e3)}</div>`;
  $('chips').innerHTML = `<span class="chip ok">${I.scooter}Trottinette · le plus rapide</span><span class="chip">${I.pin}${esc(destName)}</span>` +
    (n ? `<span class="chip warn">${I.alert}${n} signalement${n > 1 ? 's' : ''}</span>` : '');
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let avgTimer;
$('avg').oninput = () => { store.set('avg', +$('avg').value); if (route) showSheet(); clearTimeout(avgTimer); avgTimer = setTimeout(() => dest && me && computeRoute(false), 700); };
$('cancel').onclick = clearRoute;
function clearRoute() {
  seq++; route = null; dest = null; syncRoute();
  if (destMarker) destMarker.remove(); destMarker = null; $('q').value = ''; $('clear').hidden = true;
  setState('idle'); refreshPois();
}

// ---------- trajet + compteur de kilomètres ----------
function dist(a, b) { // mètres (haversine)
  const R = 6371000, rad = Math.PI / 180, dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
async function wake(on) {
  try {
    if (on && 'wakeLock' in navigator) wl = await navigator.wakeLock.request('screen');
    else if (wl) { wl.release(); wl = null; }
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ride.active) wake(true); });

function startRide(mode) {
  if (ride.active) return;
  Object.assign(ride, { active: true, mode, dist: 0, t0: Date.now(), moving: 0, max: 0, last: null, speed: 0, off: 0, idx: 0, lastReroute: 0 });
  setState('ride'); wake(true); startWatch(); setFollow(true);
  $('results').hidden = true; $('q').blur();
  meEl && meEl.classList.toggle('hd', hdg != null);
  $('remain').hidden = mode !== 'nav';
  hudTick(); hudTimer = setInterval(hudTick, 1000);
  map.easeTo({ center: me || map.getCenter(), zoom: 17, pitch: 55, bearing: hdg || 0, duration: 1000 });
  if (mode === 'nav') navUpdate();
  toast(mode === 'nav' ? 'C’est parti ! Max ' + CFG.maxKmh + ' km/h' : 'Compteur lancé – bonne route !');
}
$('ridebtn').onclick = () => startRide('free');
$('start').onclick = () => route && startRide('nav');
$('end').onclick = () => endRide(false);

function trackRide(c, now) {
  if (c.accuracy > 35) return;                                   // fix trop imprécis
  let kmh = c.speed != null && !isNaN(c.speed) ? c.speed * 3.6 : null;
  const prev = ride.last;
  if (!prev) ride.last = { ll: me, t: now };
  else {
    const dt = (now - prev.t) / 1000; if (dt <= 0) return;
    const d = dist(prev.ll, me), v = d / dt * 3.6;
    if (v > 45) ride.last = { ll: me, t: now };                  // saut GPS : on ignore
    else if (d < Math.max(2.5, c.accuracy * .25) && (kmh == null || kmh < 2)) kmh = 0; // à l'arrêt : pas de dérive
    else { ride.dist += d; if (dt < 15) ride.moving += dt; ride.last = { ll: me, t: now }; if (kmh == null) kmh = v; }
  }
  kmh = kmh == null ? 0 : kmh;
  ride.speed = ride.speed ? ride.speed * .4 + kmh * .6 : kmh;
  if (kmh < 60) ride.max = Math.max(ride.max, kmh);
  if (follow) map.easeTo({ center: me, zoom: 17, pitch: 55, bearing: hdg != null ? hdg : map.getBearing(), duration: 1000, easing: t => t, offset: [0, Math.round((innerHeight - $('hud').offsetHeight - 170) - innerHeight / 2)] });
  if (ride.mode === 'nav') navUpdate();
}
function hudTick() {
  const el = (Date.now() - ride.t0) / 1000, sp = ride.speed < .8 ? 0 : ride.speed;
  $('odo').textContent = fmtKm(ride.dist);
  $('spd').textContent = Math.round(sp);
  $('gfg').style.strokeDasharray = `${Math.min(sp / 30, 1) * 160} 214`;
  $('gauge').classList.toggle('over', sp > CFG.maxKmh);
  $('tm').textContent = fmtTime(el);
  $('avgs').textContent = ride.moving > 5 ? (ride.dist / ride.moving * 3.6).toFixed(1).replace('.', ',') : '–';
  $('mx').textContent = Math.round(ride.max);
  if (Math.round(el) % 5 === 0) store.set('ride', { t0: ride.t0, dist: ride.dist, moving: ride.moving, max: ride.max, saved: Date.now() });
}

// ---------- guidage ----------
function projectOnRoute(p, full) {
  const c = route.coords, n = c.length - 1, k = Math.cos(p[1] * Math.PI / 180), R = 111320;
  const all = full || ride.off, from = all ? 0 : Math.max(0, ride.idx - 5), to = all ? n : Math.min(n, ride.idx + 80);
  let best = { d: Infinity, i: ride.idx, t: 0 };
  for (let i = from; i < to; i++) {
    const ax = (c[i][0] - p[0]) * k * R, ay = (c[i][1] - p[1]) * R, bx = (c[i + 1][0] - p[0]) * k * R, by = (c[i + 1][1] - p[1]) * R;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.d) best = { d, i, t };
  }
  best.along = route.cum[best.i] + best.t * (route.cum[best.i + 1] - route.cum[best.i]);
  return best;
}
const turnAngle = t => ({ 9: 45, 10: 90, 11: 135, 12: 180, 13: -180, 14: -135, 15: -90, 16: -45, 18: 60, 19: -60, 20: 60, 21: -60, 23: 30, 24: -30, 36: -30, 37: 30 }[t] || 0);
function navUpdate() {
  if (!route || !me) return;
  const p = projectOnRoute(me); ride.idx = p.i;
  ride.off = p.d > 45 ? ride.off + 1 : 0;
  syncRoute(p.i);
  const rem = Math.max(0, route.distance - p.along), remMin = route.duration * (rem / route.distance) / 60;
  $('remain').innerHTML = `Reste <b>${fmtDist(rem)}</b> · arrivée <b>${fmtClock(Date.now() + remMin * 60e3)}</b>`;
  const ms = route.maneuvers, next = ms.find(m => m.begin > p.i);
  if (next && next.type !== 4 && next.type !== 5 && next.type !== 6) {
    $('navIcon').innerHTML = I.arrow; $('navIcon').firstChild.style.transform = `rotate(${turnAngle(next.type)}deg)`;
    $('navDist').textContent = fmtDist(route.cum[next.begin] - p.along); $('navText').textContent = next.text;
  } else {
    $('navIcon').innerHTML = I.flag; $('navDist').textContent = fmtDist(rem); $('navText').textContent = 'Arrivée : ' + destName;
  }
  if (rem < 20 && Date.now() - ride.t0 > 8000) return endRide(true);
  if (ride.off >= 3 && Date.now() - ride.lastReroute > 12000) reroute();
}
async function reroute() {
  ride.lastReroute = Date.now(); toast('Recalcul de l’itinéraire…');
  try {
    const r = await fetchRoute(me, dest, avgSpeed());
    if (!ride.active) return;
    route = r; ride.idx = 0; ride.off = 0; syncRoute(); navUpdate(); refreshPois();
  } catch { toast('Recalcul impossible'); }
}

function endRide(arrived) {
  if (!ride.active) return;
  ride.active = false; clearInterval(hudTimer); wake(false); store.del('ride');
  const s = { km: ride.dist / 1000, secs: (Date.now() - ride.t0) / 1000, avg: ride.moving > 5 ? ride.dist / ride.moving * 3.6 : 0, max: ride.max };
  if (s.km >= .02) addTotals(s);
  const wasNav = ride.mode === 'nav';
  meEl && meEl.classList.remove('hd');
  if (wasNav) clearRoute(); else setState('idle');
  map.easeTo({ pitch: 0, bearing: 0, zoom: 15.5, center: me || map.getCenter(), duration: 900 });
  showSummary(s, arrived);
}
function addTotals(s) {
  const t = store.get('totals', { km: 0, rides: 0, secs: 0 });
  t.km += s.km; t.rides++; t.secs += s.secs; store.set('totals', t);
}

// ---------- fenêtres ----------
function openModal(html, onClose) {
  const m = $('modal'); m.innerHTML = `<div class="card">${html}</div>`; m.hidden = false;
  const close = () => { m.hidden = true; m.innerHTML = ''; onClose && onClose(); };
  m.onclick = e => { if (e.target === m) close(); };
  m.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  return m;
}
function showSummary(s, arrived) {
  openModal(`<h3>${arrived ? '🏁 Vous êtes arrivé !' : 'Trajet terminé'}</h3>
    <div class="bigstat"><div class="hero"><b>${fmtKm(s.km * 1000)} km</b><small>Distance parcourue</small></div>
    <div><b>${fmtTime(s.secs)}</b><small>Durée</small></div><div><b>${s.avg ? s.avg.toFixed(1).replace('.', ',') : '–'}</b><small>Vitesse moy. km/h</small></div>
    <div><b>${Math.round(s.max)}</b><small>Vitesse max km/h</small></div><div><b>${fmtKm((store.get('totals', { km: 0 }).km) * 1000)}</b><small>Total km</small></div></div>
    <button class="btn main" data-close>Super !</button>`);
}
$('statsBtn').onclick = () => {
  const t = store.get('totals', { km: 0, rides: 0, secs: 0 });
  const m = openModal(`<h3>Mes kilomètres</h3>
    <div class="bigstat"><div class="hero"><b>${fmtKm(t.km * 1000)} km</b><small>Total en trottinette</small></div>
    <div><b>${t.rides}</b><small>Trajets</small></div><div><b>${t.secs >= 3600 ? Math.floor(t.secs / 3600) + ' h ' + pad(Math.floor(t.secs % 3600 / 60)) : Math.floor(t.secs / 60) + ' min'}</b><small>Sur la route</small></div></div>
    <button class="btn sec" id="bleBtn" style="margin-bottom:10px">🔵 Connecter ma trottinette (Bluetooth)</button>
    <button class="btn sec" id="linkBtn" style="margin-bottom:10px">🔐 Tester la liaison chiffrée</button>
    <button class="btn sec" id="pairBtn" style="margin-bottom:10px">🔑 Associer Trotti à ma trottinette</button>
    <div class="about">Trotti v${V} · Cartes © OpenStreetMap, © CARTO · Itinéraires Valhalla · Adresses Photon</div>
    <button class="btn sec" id="chk" style="margin-bottom:10px">Chercher une mise à jour</button><button class="btn main" data-close>Fermer</button>`);
  m.querySelector('#bleBtn').onclick = () => bleDiag();
  m.querySelector('#linkBtn').onclick = () => bleLink();
  m.querySelector('#pairBtn').onclick = () => blePair();
  m.querySelector('#chk').onclick = async e => {
    e.target.textContent = 'Vérification…';
    const r = await (window.TrottiBoot && TrottiBoot.check ? TrottiBoot.check() : 'none');
    e.target.textContent = r === 'web' ? 'Mise à jour téléchargée ✓' : r === 'apk' ? 'Nouvelle version de l’appli disponible' : r === 'offline' ? 'Pas de connexion' : 'Trotti est à jour ✓';
  };
};

// ---------- Bluetooth : ma trottinette (étape 1 : diagnostic, lecture seule) ----------
// Rien n'est écrit sur la trottinette : on liste ce qu'elle expose, on lit les infos
// standard (nom, fabricant, modèle, firmware) et on écoute ce qu'elle émet 10 secondes.
const BLE = window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform() && Capacitor.nativePromise // pont natif Capacitor (sans la bibliothèque complète)
  ? new Proxy({}, { get: (_, m) => m === 'addListener' ? (ev, cb) => Capacitor.addListener('BluetoothLe', ev, cb) : o => Capacitor.nativePromise('BluetoothLe', m, o || {}) }) : null;
const hexAscii = h => (h.match(/../g) || []).map(b => parseInt(b, 16)).map(c => c >= 32 && c < 127 ? String.fromCharCode(c) : '·').join('');
const flags = p => Object.entries(p || {}).filter(([, v]) => v).map(([k]) => k).join(',');
async function bleDiag() {
  const m = openModal(`<h3>🔵 Ma trottinette</h3><div class="about" style="margin-top:-6px">Allume ta trottinette, ferme l’appli Segway, puis choisis-la dans la liste. Rien n’est modifié sur la trottinette.</div>
    <pre id="bleLog" class="blelog"></pre>
    <button class="btn sec" id="bleCopy" style="margin:10px 0" hidden>Copier le rapport</button><button class="btn main" data-close>Fermer</button>`);
  const pre = m.querySelector('#bleLog'), lines = [`Trotti v${V} · ${new Date().toLocaleString('fr-FR')}`];
  const log = t => { lines.push(t); pre.textContent = lines.join('\n'); pre.scrollTop = pre.scrollHeight; };
  m.querySelector('#bleCopy').onclick = async e => { try { await navigator.clipboard.writeText(lines.join('\n')); e.target.textContent = 'Rapport copié ✓'; } catch { e.target.textContent = 'Copie impossible : fais une capture'; } };
  if (!BLE) return log('Bluetooth indisponible : installe la dernière version de l’APK Trotti.');
  let id;
  try {
    await BLE.initialize({ androidNeverForLocation: true });
    log('Bluetooth prêt. Choisis ta trottinette…');
    const dev = await BLE.requestDevice({});
    id = dev.deviceId; log(`Appareil : ${dev.name || '(sans nom)'}  [${id}]`);
    await BLE.connect({ deviceId: id, timeout: 15000 }); log('Connecté ✓');
    const { services } = await BLE.getServices({ deviceId: id }), notif = [];
    for (const sv of services) {
      log(`\nService ${sv.uuid}`);
      for (const c of sv.characteristics) {
        log(`  ${c.uuid}  [${flags(c.properties)}]`);
        if (c.properties && (c.properties.notify || c.properties.indicate)) notif.push([sv.uuid, c.uuid]);
        if (/^0000(1800|180a)-/i.test(sv.uuid) && c.properties && c.properties.read) {
          try { const r = await BLE.read({ deviceId: id, service: sv.uuid, characteristic: c.uuid, timeout: 4000 }); log(`    = ${r.value}  « ${hexAscii(r.value)} »`); } catch (e) { log('    (lecture refusée)'); }
        }
      }
    }
    log(`\nÉcoute ${notif.length} canal(aux) pendant 10 s…`);
    for (const [s, c] of notif) {
      BLE.addListener(`notification|${id}|${s.toLowerCase()}|${c.toLowerCase()}`, ev => log(`« ${c.slice(4, 8)} ${ev.value}`));
      try { await BLE.startNotifications({ deviceId: id, service: s, characteristic: c }); } catch (e) { log(`  abonnement ${c.slice(4, 8)} refusé`); }
    }
    await new Promise(r => setTimeout(r, 10000));
    log('\nFin du diagnostic ✓');
  } catch (e) { log('\nErreur : ' + (e && (e.message || e.errorMessage) || JSON.stringify(e))); }
  finally { if (id) { try { await BLE.disconnect({ deviceId: id }); log('Déconnecté.'); } catch {} } m.querySelector('#bleCopy').hidden = false; }
}

// ---------- Bluetooth : liaison chiffrée Segway (étape 2a : PRE_COMM, ne modifie RIEN) ----------
// Protocole « Encryption2 » (documentation communautaire nootnooot.codeberg.page/segway-ninebot-ble).
// PRE_COMM est la trame que toute appli envoie à chaque connexion : elle ne change aucun état.
// SET_PWD / AUTH (qui écrivent un mot de passe) ne sont volontairement PAS implémentés ici.
const NB = { svc: '6e400001-0000-0000-006e-696e65626f74', tx: '6e400002-0000-0000-006e-696e65626f74', rx: '6e400004-0000-0000-006e-696e65626f74' };
const NUS = { svc: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', tx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', rx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e' };
const NB_FW = Uint8Array.from([0x97, 0xCF, 0xB8, 0x02, 0x84, 0x41, 0x43, 0xDE, 0x56, 0x00, 0x2B, 0x3B, 0x34, 0x78, 0x0A, 0x5D]);
const toHex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
const fromHex = h => Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16));
const pad16 = b => { const o = new Uint8Array(16); o.set(b.slice(0, 16)); return o; };
async function aesBlock(key, block) { // AES-128-ECB d'un bloc (WebCrypto n'a que CBC : IV nul, 1er bloc = ECB)
  const k = await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, k, block)).slice(0, 16);
}
async function nbKey(k1, k2) { // SHA-1(k1 ‖ k2)[0:16], k2 nul = 16 octets à zéro
  const c = new Uint8Array(32); c.set(pad16(k1)); if (k2) c.set(pad16(k2), 16);
  return new Uint8Array(await crypto.subtle.digest('SHA-1', c)).slice(0, 16);
}
async function nbSeal(key, pt, ecb) { // mode sans compteur : même flux pour chaque bloc, somme de contrôle en queue
  const ks = key ? await aesBlock(key, ecb || new Uint8Array(16)) : new Uint8Array(16), out = new Uint8Array(pt.length + 6); out.set(pt.slice(0, 3)); let sum = 0;
  for (let i = 3; i < pt.length; i++) { sum += pt[i]; out[i] = pt[i] ^ ks[(i - 3) % 16]; }
  const cs = ~sum & 0xFFFF; out[pt.length + 2] = cs & 255; out[pt.length + 3] = cs >> 8; return out;
}
async function nbOpen(key, ct, ecb) {
  const n = ct.length - 6, ks = await aesBlock(key, ecb || new Uint8Array(16)), pt = new Uint8Array(n); pt.set(ct.slice(0, 3)); let sum = 0;
  for (let i = 3; i < n; i++) { pt[i] = ct[i] ^ ks[(i - 3) % 16]; sum += pt[i]; }
  return { pt, ok: (ct[n + 2] | ct[n + 3] << 8) === (~sum & 0xFFFF) };
}
async function bleLink() {
  const m = openModal(`<h3>🔐 Liaison chiffrée</h3><div class="about" style="margin-top:-6px">Envoie la trame d’accueil PRE_COMM sous plusieurs variantes et écoute tous les canaux. Rien n’est modifié sur la trottinette.</div>
    <pre id="bleLog" class="blelog"></pre><button class="btn sec" id="bleCopy" style="margin:10px 0" hidden>Copier le rapport</button><button class="btn main" data-close>Fermer</button>`);
  const pre = m.querySelector('#bleLog'), lines = [`Trotti v${V} · liaison · ${new Date().toLocaleString('fr-FR')}`];
  const log = t => { lines.push(t); pre.textContent = lines.join('\n'); pre.scrollTop = pre.scrollHeight; };
  m.querySelector('#bleCopy').onclick = async e => { try { await navigator.clipboard.writeText(lines.join('\n')); e.target.textContent = 'Rapport copié ✓'; } catch { e.target.textContent = 'Copie impossible : fais une capture'; } };
  if (!BLE) return log('Bluetooth indisponible : installe la dernière version de l’APK Trotti.');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let id, rx = [], seen = 0;
  try {
    await BLE.initialize({ androidNeverForLocation: true });
    log('Choisis ta trottinette…');
    const dev = await BLE.requestDevice({}); id = dev.deviceId; const name = dev.name || '';
    log(`Appareil : ${name}  [${id}]`);
    await BLE.connect({ deviceId: id, timeout: 15000 }); log('Connecté ✓');
    try { log('MTU : ' + (await BLE.getMtu({ deviceId: id })).value); } catch {}
    await BLE.getServices({ deviceId: id });
    const subs = [[NB.svc, NB.rx, 'NB-0004'], [NB.svc, '6e400006-0000-0000-006e-696e65626f74', 'NB-0006'], [NUS.svc, NUS.rx, 'NUS-0003']];
    for (const [sv, ch, tag] of subs) {
      BLE.addListener(`notification|${id}|${sv}|${ch}`, ev => { seen++; rx.push(...fromHex(ev.value)); log(`   ‹${tag}› ${ev.value}`); });
      try { await BLE.startNotifications({ deviceId: id, service: sv, characteristic: ch }); log(`Écoute ${tag} ✓`); } catch (e) { log(`Écoute ${tag} refusée`); }
    }
    await sleep(600);
    const k1 = new TextEncoder().encode(name);
    const k0 = await nbKey(k1, null), kf = await nbKey(k1, NB_FW);
    const variants = [['Gen2 (flux=AES(fw_data))', k0, NB_FW], ['Gen3 (flux=AES(0))', k0, null], ['clé 2=fw, flux=AES(fw)', kf, NB_FW], ['clé 2=fw, flux=AES(0)', kf, null], ['sans chiffrement', null, null]];
    try { log('Appairé (bond) : ' + (await BLE.isBonded({ deviceId: id })).value); } catch {}
    let got = false;
    outer: for (const ch of [[NB.svc, NB.tx, 'NB-0002'], [NUS.svc, NUS.tx, 'NUS-0002']]) for (const sync of ch[2] === 'NB-0002' ? [0xA5, 0xB5] : [0xA5]) for (const [label, key, ecb] of variants) {
      const plain = Uint8Array.from([0x5A, sync, 0x00, 0x3E, 0x04, 0x5B, 0x00]), tx = await nbSeal(key, plain, ecb);
      rx = []; log(`\n→ ${ch[2]} sync ${sync.toString(16)} ${label} : ${toHex(tx)}`);
      try { await BLE.write({ deviceId: id, service: ch[0], characteristic: ch[1], value: toHex(tx), timeout: 5000 }); } catch (e) { log('  écriture refusée : ' + (e.message || e.errorMessage || e)); continue; }
      const t0 = Date.now(); while (Date.now() - t0 < 1800 && !(rx.length >= 3 && rx.length >= rx[2] + 13)) await sleep(50);
      if (!rx.length) continue;
      log(`← ${rx.length} octets`);
      if (toHex(rx) === toHex(tx)) { log('  écho de la requête'); continue; }
      if (rx.length >= 13 && key) {
        const { pt, ok } = await nbOpen(key, Uint8Array.from(rx), ecb);
        log(`  déchiffrement : ${ok ? 'OK ✓' : 'somme de contrôle fausse ✗'}  clair : ${toHex(pt)}`);
        if (ok && pt.length >= 37) { log(`  INDEX = ${pt[6]} → ${pt[6] ? 'mot de passe déjà enregistré' : 'aucun mot de passe enregistré'}\n  auth : ${toHex(pt.slice(7, 23))}\n  série : « ${hexAscii(toHex(pt.slice(23, 37)))} »`); got = true; break outer; }
      }
    }
    log(`\nNotifications reçues au total : ${seen}`);
    log(got ? 'Liaison chiffrée validée ✓ (aucune écriture d’état).' : 'Pas de réponse exploitable : envoie-moi ce rapport.');
  } catch (e) { log('\nErreur : ' + (e && (e.message || e.errorMessage) || JSON.stringify(e))); }
  finally { if (id) { try { await BLE.disconnect({ deviceId: id }); log('Déconnecté.'); } catch {} } m.querySelector('#bleCopy').hidden = false; }
}

// ---------- Mode SN (compteur) : CTR + CBC-MAC, pour SET_PWD et AUTH ----------
// Même algorithme que nbSeal/nbOpen mais avec le compteur anti-rejeu (obligatoire
// une fois la session établie). Vérifié contre une implémentation Python indépendante.
function nonce13(counter, auth8) {
  const n = new Uint8Array(13); const dv = new DataView(n.buffer);
  dv.setUint32(0, counter); n.set(auth8.slice(0, 8), 4); return n;
}
async function cbcMac(key, plain, nonce) {
  const payload = plain.slice(3);
  const b0 = new Uint8Array(16); b0[0] = 0x59; b0.set(nonce, 1); b0[14] = 0; b0[15] = payload.length & 0xFF;
  let x = await aesBlock(key, b0);
  const aad = new Uint8Array(16); aad.set(plain.slice(0, 3));
  x = await aesBlock(key, xor16(x, aad));
  for (let o = 0; o < payload.length; o += 16) { const blk = new Uint8Array(16); blk.set(payload.slice(o, o + 16)); x = await aesBlock(key, xor16(x, blk)); }
  return x.slice(0, 4);
}
const xor16 = (a, b) => Uint8Array.from({ length: 16 }, (_, i) => a[i] ^ b[i]);
async function nbSealSN(key, plain, counter, auth8) {
  const n = nonce13(counter, auth8), tag = await cbcMac(key, plain, n), payload = plain.slice(3);
  const ct = new Uint8Array(payload.length);
  for (let i = 1; i <= Math.ceil(payload.length / 16); i++) {
    const a = new Uint8Array(16); a[0] = 0x01; a.set(n, 1); a[14] = 0; a[15] = i & 0xFF;
    const ks = await aesBlock(key, a);
    for (let j = 0; j < Math.min(16, payload.length - (i - 1) * 16); j++) ct[(i - 1) * 16 + j] = payload[(i - 1) * 16 + j] ^ ks[j];
  }
  const a0 = new Uint8Array(16); a0[0] = 0x01; a0.set(n, 1);
  const encTag = xor16(new Uint8Array([...tag, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), await aesBlock(key, a0)).slice(0, 4);
  const out = new Uint8Array(plain.length + 6); out.set(plain.slice(0, 3)); out.set(ct, 3); out.set(encTag, 3 + ct.length);
  out[out.length - 2] = (counter >> 8) & 0xFF; out[out.length - 1] = counter & 0xFF;
  return out;
}
async function nbOpenSN(key, ct, counter, auth8) {
  const n = nonce13(counter, auth8), bodyLen = ct.length - 9, payloadCt = ct.slice(3, 3 + bodyLen);
  const pt = new Uint8Array(bodyLen);
  for (let i = 1; i <= Math.ceil(bodyLen / 16); i++) {
    const a = new Uint8Array(16); a[0] = 0x01; a.set(n, 1); a[14] = 0; a[15] = i & 0xFF;
    const ks = await aesBlock(key, a);
    for (let j = 0; j < Math.min(16, bodyLen - (i - 1) * 16); j++) pt[(i - 1) * 16 + j] = payloadCt[(i - 1) * 16 + j] ^ ks[j];
  }
  const plain = new Uint8Array(3 + bodyLen); plain.set(ct.slice(0, 3)); plain.set(pt, 3);
  const tagCalc = await cbcMac(key, plain, n);
  const a0 = new Uint8Array(16); a0[0] = 0x01; a0.set(n, 1);
  const recvTag = xor16(Uint8Array.from([...ct.slice(3 + bodyLen, 3 + bodyLen + 4), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), await aesBlock(key, a0)).slice(0, 4);
  return { pt: plain, ok: toHex(recvTag) === toHex(tagCalc) };
}

// ---------- Bluetooth : association (étape 2b — SET_PWD puis AUTH) ----------
// PORTÉE VOLONTAIREMENT LIMITÉE : ce code établit une session pour LIRE des
// informations (batterie, vitesse, etc.). Il n'implémente AUCUNE commande de
// contrôle du véhicule (ni déverrouillage, ni réglages, ni mise à jour firmware) —
// seules les trames PRE_COMM, SET_PWD et AUTH sont envoyées, plus des lectures (CMD 0x01).
// SET_PWD enregistre un nouveau mot de passe de session sur la trottinette : ça peut
// nécessiter un appui sur son bouton, et peut obliger à réassocier l'appli Segway
// officielle ensuite (fonctionnement normal du protocole, pas un bug).
const BOARD_BLE = 0x04;
async function nbFrame(target, cmd, index, data) {
  const d = data || new Uint8Array(0), f = new Uint8Array(7 + d.length);
  f[0] = 0x5A; f[1] = 0xA5; f[2] = d.length; f[3] = 0x3E; f[4] = target; f[5] = cmd; f[6] = index; f.set(d, 7);
  return f;
}
async function nbSend(id, tx, log, svc, chunk) { // envoie en un seul morceau quand la taille négociée le permet (certaines trottinettes ignorent un message fragmenté)
  const c = chunk || 20;
  for (let o = 0; o < tx.length; o += c) { await BLE.write({ deviceId: id, service: svc.svc, characteristic: svc.tx, value: toHex(tx.slice(o, o + c)), timeout: 5000 }); if (o + c < tx.length) await new Promise(r => setTimeout(r, 12)); }
}
async function nbWait(getBuf, ms) { // attend une trame complète (sync + LENGTH + queue 13 octets)
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const b = getBuf(); if (b.length >= 3 && b.length >= b[2] + 13) return b; await new Promise(r => setTimeout(r, 40)); }
  return null;
}
async function blePair() {
  const m = openModal(`<h3>🔑 Associer Trotti</h3><div class="about" style="margin-top:-6px">Garde la trottinette allumée et à portée. Un appui bref sur son bouton d’allumage peut être demandé pour confirmer — fais-le dès que le rapport te le dit. L’appli Segway reste utilisable ensuite ; si elle réclame une nouvelle association, c’est normal.</div>
    <pre id="bleLog" class="blelog"></pre><button class="btn sec" id="bleCopy" style="margin:10px 0" hidden>Copier le rapport</button><button class="btn main" data-close>Fermer</button>`);
  const pre = m.querySelector('#bleLog'), lines = [`Trotti v${V} · association · ${new Date().toLocaleString('fr-FR')}`];
  const log = t => { lines.push(t); pre.textContent = lines.join('\n'); pre.scrollTop = pre.scrollHeight; };
  m.querySelector('#bleCopy').onclick = async e => { try { await navigator.clipboard.writeText(lines.join('\n')); e.target.textContent = 'Rapport copié ✓'; } catch { e.target.textContent = 'Copie impossible : fais une capture'; } };
  if (!BLE) return log('Bluetooth indisponible : installe la dernière version de l’APK Trotti.');
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // La variante de clé qui fonctionne pour SET_PWD n'est pas documentée avec certitude pour ce
  // modèle (seule celle de PRE_COMM a été confirmée empiriquement) ; on essaie plusieurs
  // combinaisons raisonnables, sur des connexions fraîches si la trottinette coupe la liaison.
  let variants = null; // rempli après PRE_COMM (dépend de authParam/serial reçus)
  let vi = 0, found = null;

  async function oneConnection(id, name) {
    let rxBuf = [];
    await BLE.connect({ deviceId: id, timeout: 15000 }); log('Connecté ✓');
    let chunk = 20;
    try { chunk = Math.max(20, (await BLE.getMtu({ deviceId: id })).value - 3); log(`MTU : ${chunk + 3} (envoi en un seul morceau jusqu'à ${chunk} octets)`); } catch {}
    await BLE.getServices({ deviceId: id });
    BLE.addListener(`notification|${id}|${NUS.svc}|${NUS.rx}`, ev => rxBuf.push(...fromHex(ev.value)));
    await BLE.startNotifications({ deviceId: id, service: NUS.svc, characteristic: NUS.rx });

    // --- PRE_COMM (variante validée sur cette trottinette le 2026-11-06) ---
    const k1 = new TextEncoder().encode(name), keyPre = await nbKey(k1, NB_FW);
    rxBuf = []; const reqPre = await nbSeal(keyPre, await nbFrame(BOARD_BLE, 0x5B, 0x00), NB_FW);
    log('\n→ PRE_COMM : ' + toHex(reqPre)); await nbSend(id, reqPre, log, NUS, chunk);
    let resp = await nbWait(() => rxBuf, 3000);
    if (!resp) { log('Pas de réponse à PRE_COMM.'); return null; }
    let { pt, ok } = await nbOpen(keyPre, Uint8Array.from(resp), NB_FW);
    if (!ok) { log('PRE_COMM : somme de contrôle invalide.'); return null; }
    const authParam = pt.slice(7, 23), serial8 = pt.slice(23, 31), hasPwd = pt[6] !== 0;
    log(`← PRE_COMM OK · mot de passe déjà enregistré : ${hasPwd ? 'oui' : 'non'}`);
    if (!variants) variants = [
      { label: 'clé = auth, nonce = auth', key2: authParam, nonceAuth: authParam },
      { label: 'clé = fixe, nonce = auth', key2: NB_FW, nonceAuth: authParam },
      { label: 'clé = auth, nonce = série', key2: authParam, nonceAuth: serial8 },
      { label: 'clé = fixe, nonce = série', key2: NB_FW, nonceAuth: serial8 }
    ];
    const password = crypto.getRandomValues(new Uint8Array(16));
    log('\nSi la trottinette le demande, appuie brièvement sur son bouton d’allumage dès maintenant…');

    let ctr = 2;
    while (vi < variants.length) {
      const v = variants[vi];
      const keySet = await nbKey(new TextEncoder().encode(name), v.key2);
      const req = await nbSealSN(keySet, await nbFrame(BOARD_BLE, 0x5C, 0x00, password), ctr, v.nonceAuth);
      log(`\n→ SET_PWD [${v.label}] (compteur ${ctr}) : ` + toHex(req));
      rxBuf = [];
      await nbSend(id, req, log, NUS, chunk); // une coupure ici remonte au bloc try englobant (reconnexion)
      const myCtr = ctr; ctr++;
      const respSet = await nbWait(() => rxBuf, 2500);
      if (!respSet) { log('  (pas de réponse à cette variante)'); vi++; continue; }
      const r = await nbOpenSN(keySet, Uint8Array.from(respSet), myCtr, v.nonceAuth);
      if (!r.ok) { log('  réponse reçue mais non déchiffrable avec cette variante'); vi++; continue; }
      log(`← Réponse déchiffrée avec « ${v.label} » ✓ INDEX=${r.pt[6]}`);
      found = v; // la bonne variante est identifiée, qu'elle soit acceptée ou en attente
      if (r.pt[6]) { // acceptée tout de suite
        return { name, authParam, serial: hexAscii(toHex(pt.slice(23, 37))), password, variant: v, ctr, chunk };
      }
      // en attente de confirmation : on insiste avec LA MÊME variante, compteur croissant
      for (let essai = 0; essai < 20; essai++) {
        const req2 = await nbSealSN(keySet, await nbFrame(BOARD_BLE, 0x5C, 0x00, password), ctr, v.nonceAuth);
        rxBuf = []; await nbSend(id, req2, log, NUS, chunk);
        const c2 = ctr; ctr++;
        const r2 = await nbWait(() => rxBuf, 2000);
        if (!r2) { log('  (en attente…)'); continue; }
        const o2 = await nbOpenSN(keySet, Uint8Array.from(r2), c2, v.nonceAuth);
        if (o2.ok && o2.pt[6]) { log('← SET_PWD : accepté ✓'); return { name, authParam, serial: hexAscii(toHex(pt.slice(23, 37))), password, variant: v, ctr: c2 + 1, chunk }; }
      }
      log('  pas de confirmation reçue sur cette variante dans le temps imparti');
      vi++;
    }
    return null;
  }

  let result = null, id = null, name = '';
  try {
    await BLE.initialize({ androidNeverForLocation: true });
    log('Choisis ta trottinette…');
    const dev = await BLE.requestDevice({}); id = dev.deviceId; name = dev.name || '';
    log(`Appareil : ${name}  [${id}]`);
    for (let reconnect = 0; reconnect < 5 && !result; reconnect++) {
      if (reconnect > 0) log(`\nLa trottinette a coupé la liaison — nouvelle connexion (essai ${reconnect + 1})…`);
      try {
        const r = await oneConnection(id, name);
        if (r && typeof r === 'object') result = r;
        else if (vi >= (variants ? variants.length : 1)) break;
        else await sleep(800);
      } catch (e) {
        log('  (' + (e.message || e.errorMessage || e) + ')');
        await sleep(1200);
      }
    }
  } catch (e) { log('\nErreur : ' + (e && (e.message || e.errorMessage) || JSON.stringify(e))); }

  if (!result) {
    log(found ? '\nUne variante a été identifiée mais pas confirmée. Relance l’essai, la même sera réessayée en premier.' : '\nAucune des variantes essayées n’a obtenu de réponse exploitable. Envoie-moi ce rapport.');
  } else {
    try {
      const { authParam, serial, password, variant, ctr, chunk } = result;
      const keyAuth = await nbKey(password, variant.key2);
      const reqAuth = await nbSealSN(keyAuth, await nbFrame(BOARD_BLE, 0x5D, 0x00, new TextEncoder().encode(serial)), ctr, variant.nonceAuth);
      log('\n→ AUTH (compteur ' + ctr + ') : ' + toHex(reqAuth));
      let rxA = []; BLE.addListener(`notification|${id}|${NUS.svc}|${NUS.rx}`, ev => rxA.push(...fromHex(ev.value)));
      await nbSend(id, reqAuth, log, NUS, chunk);
      const respA = await nbWait(() => rxA, 3000);
      if (!respA) log('\nPas de réponse à AUTH.');
      else {
        const ra = await nbOpenSN(keyAuth, Uint8Array.from(respA), ctr, variant.nonceAuth);
        log(`← AUTH : ${ra.ok ? 'déchiffré' : 'non déchiffrable'}${ra.ok ? ', INDEX=' + ra.pt[6] : ''}`);
        if (ra.ok && ra.pt[6]) {
          log('\nSession ouverte ✓ Enregistrement de la clé pour les prochaines fois…');
          store.set('scooter', { name: result.name, id, password: toHex(password), authParam: toHex(authParam), variant: variant.label, counter: ctr + 1 });
          log('Trotti peut maintenant lire les informations de ta trottinette.');
        } else log('\nAUTH refusé.');
      }
    } catch (e) { log('\nErreur pendant AUTH : ' + (e.message || e.errorMessage || e)); }
  }
  if (id) { try { await BLE.disconnect({ deviceId: id }); log('Déconnecté.'); } catch {} }
  m.querySelector('#bleCopy').hidden = false;
}

// ---------- signalements ----------
let cache = [];
function loadReports() {
  const local = store.get('reports', []);
  return [...cache, ...local].filter(r => REPORT_TYPES[r.type] && Date.now() - r.t < CFG.reportTtlH * 3600e3);
}
async function fetchReports() {
  if (!CFG.server) return;
  const b = map.getBounds(), bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
  try { cache = await (await fetch(`${CFG.server}/api/reports?bbox=${bbox}`)).json(); renderReports(); } catch {}
}
async function postReport(type, lng, lat) {
  if (CFG.server) {
    try {
      const r = await fetch(`${CFG.server}/api/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, lng, lat }) });
      if (r.ok) { fetchReports(); return 'shared'; }
      if (r.status === 429) return 'limit';
    } catch {}
  }
  const a = store.get('reports', []); a.push({ type, lng, lat, t: Date.now() }); store.set('reports', a); renderReports(); return 'local';
}
const reportMarkers = [];
function renderReports() {
  reportMarkers.forEach(m => m.remove()); reportMarkers.length = 0;
  loadReports().forEach(r => {
    const [emoji, label, color] = REPORT_TYPES[r.type], el = document.createElement('div');
    el.className = 'pin'; el.style.setProperty('--c', color); el.textContent = emoji;
    el.onclick = e => { e.stopPropagation(); const m = Math.round((Date.now() - r.t) / 60e3); toast(`${label} · il y a ${m < 60 ? m + ' min' : Math.round(m / 60) + ' h'}${r.confirms > 1 ? ' · confirmé ' + r.confirms + ' fois' : ''}`); };
    reportMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([r.lng, r.lat]).addTo(map));
  });
}
$('report').onclick = () => {
  const m = openModal(`<h3>Signaler</h3><div class="grid">${Object.entries(REPORT_TYPES).map(([k, v]) => `<button data-t="${k}"><span>${v[0]}</span>${v[1]}</button>`).join('')}</div>
    <button class="btn sec" data-close style="margin-top:12px">Fermer</button>`);
  m.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => {
    const pos = me || [map.getCenter().lng, map.getCenter().lat], t = b.dataset.t;
    m.hidden = true; m.innerHTML = '';
    const s = await postReport(t, pos[0], pos[1]);
    toast(s === 'limit' ? 'Trop de signalements, réessaie plus tard' : 'Merci ! ' + REPORT_TYPES[t][1] + (s === 'shared' ? ' partagé' : ' (enregistré hors ligne)'));
  });
};

// ---------- POI sur la route : snacks, restos, réparateurs (OpenStreetMap / Overpass) ----------
const POI_CATS = {
  snack: { emoji: '🍔', label: 'Snacks & fast-food', color: '#f97316' },
  resto: { emoji: '🍽️', label: 'Restos, cafés & boulangeries', color: '#ef4444' },
  garage: { emoji: '🔧', label: 'Réparateurs trottinette, vélo & moto', color: '#3b82f6' }
};
const TROTTI_RE = /trott|scoot|edpm|ninebot|segway|dualtron|xiaomi|speedway|kaabo|vsett|mobilit[ée]/i;
const poiPrefs = () => ({ snack: false, resto: false, garage: false, ...store.get('pois', {}) });
const poiOn = () => Object.values(poiPrefs()).some(Boolean);
let poiSeq = 0, poiKey = '', poiData = [];
const poiMarkers = [];
function poiQuery(area, pr) {
  const q = [];
  if (pr.snack) q.push('nwr["amenity"="fast_food"]["name"]');
  if (pr.resto) q.push('nwr["amenity"~"^(restaurant|cafe)$"]["name"]', 'nwr["shop"="bakery"]["name"]');
  if (pr.garage) q.push('nwr["shop"~"^(bicycle|motorcycle|scooter|moped)$"]["name"]', 'nwr["service:bicycle:repair"="yes"]["name"]');
  return `[out:json][timeout:25];(${q.map(x => x + area + ';').join('')});out center tags 250;`;
}
async function overpass(q) {
  let err;
  for (const u of CFG.overpass) {
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(22000) });
      if (!r.ok) throw new Error('overpass ' + r.status);
      return (await r.json()).elements || [];
    } catch (e) { err = e; }
  }
  throw err;
}
function corridor() { // points de l'itinéraire tous les ~150 m, rayon 100 m
  const pts = []; let next = 0;
  route.coords.forEach((c, i) => { if (route.cum[i] >= next || i === route.coords.length - 1) { pts.push(c[1].toFixed(5), c[0].toFixed(5)); next = route.cum[i] + 150; } });
  return `(around:100,${pts.join(',')})`;
}
function poiOf(e) {
  const t = e.tags || {}, lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
  if (lat == null || !t.name) return null;
  const cat = t.amenity === 'fast_food' ? 'snack' : (t.amenity === 'restaurant' || t.amenity === 'cafe' || t.shop === 'bakery') ? 'resto' : 'garage';
  const trotti = cat === 'garage' && (TROTTI_RE.test(t.name) || TROTTI_RE.test(t.brand || '') || t.shop === 'scooter');
  const emoji = trotti ? '🛴' : t.amenity === 'cafe' ? '☕' : t.shop === 'bakery' ? '🥐' : POI_CATS[cat].emoji;
  return { id: e.type + e.id, cat, emoji, trotti, name: t.name, lat, lng, tags: t };
}
function clearPois() { poiMarkers.forEach(m => m.remove()); poiMarkers.length = 0; poiData = []; poiKey = ''; renderPoiChips(); }
async function refreshPois() {
  const pr = poiPrefs(), my = ++poiSeq;
  $('layersBtn').classList.toggle('on', poiOn());
  if (!poiOn()) return clearPois();
  let area, key = JSON.stringify(pr);
  if (route) { area = corridor(); key += 'r' + route.coords.length + Math.round(route.distance); }
  else {
    if (map.getZoom() < 13.5) return clearPois();
    const b = map.getBounds(), c = map.getCenter(), w = (b.getEast() - b.getWest()) * .1, h = (b.getNorth() - b.getSouth()) * .1;
    area = `(${(b.getSouth() - h).toFixed(4)},${(b.getWest() - w).toFixed(4)},${(b.getNorth() + h).toFixed(4)},${(b.getEast() + w).toFixed(4)})`;
    key += 'v' + c.lat.toFixed(2) + c.lng.toFixed(2) + Math.round(map.getZoom());
  }
  if (key === poiKey) return;
  try {
    const els = await overpass(poiQuery(area, pr));
    if (my !== poiSeq) return;
    let list = els.map(poiOf).filter(Boolean);
    if (route) {
      list.forEach(p => { const a = projectOnRoute([p.lng, p.lat], true); p.along = a.along; p.off = a.d; });
      list = list.filter(p => p.off <= 120).sort((a, b) => a.along - b.along);
    } else { const c = me || [map.getCenter().lng, map.getCenter().lat]; list.sort((a, b) => dist(c, [a.lng, a.lat]) - dist(c, [b.lng, b.lat])); }
    poiData = list.slice(0, 150); poiKey = key; renderPois();
  } catch (e) { if (my === poiSeq) toast('Commerces indisponibles pour l’instant'); }
}
function renderPois() {
  poiMarkers.forEach(m => m.remove()); poiMarkers.length = 0;
  poiData.forEach(p => {
    const el = document.createElement('div'); el.className = 'poi' + (p.trotti ? ' tr' : ''); el.style.setProperty('--c', POI_CATS[p.cat].color); el.textContent = p.emoji;
    el.onclick = e => { e.stopPropagation(); showPoi(p); };
    poiMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map));
  });
  renderPoiChips();
}
function renderPoiChips() {
  const box = $('poiChips'); if (!box) return;
  const n = c => poiData.filter(p => p.cat === c).length, tr = poiData.filter(p => p.trotti).length;
  box.innerHTML = route ? Object.entries(POI_CATS).filter(([k]) => poiPrefs()[k]).map(([k, v]) => `<span class="chip">${v.emoji} ${n(k)} ${{ snack: 'snack', resto: 'resto/café', garage: 'réparateur' }[k]}${n(k) > 1 && k !== 'resto' ? 's' : ''}</span>`).join('') +
    (tr ? `<span class="chip ok">🛴 ${tr} spécialiste${tr > 1 ? 's' : ''} trottinette</span>` : '') : '';
}
function showPoi(p) {
  const t = p.tags, addr = [[t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), t['addr:city']].filter(Boolean).join(', ');
  const row = (k, v) => v ? `<div><b>${k}</b> ${esc(v)}</div>` : '';
  const m = openModal(`<h3>${p.emoji} ${esc(p.name)}</h3><div class="poiInfo">
    ${row('', POI_CATS[p.cat].label)}${p.trotti ? '<div><b>🛴 Spécialiste trottinette / mobilité électrique</b></div>' : ''}
    ${row('Cuisine :', (t.cuisine || '').replace(/[;_]/g, ', '))}${row('Adresse :', addr)}${row('Horaires :', t.opening_hours)}${row('Tél :', t.phone || t['contact:phone'])}
    ${p.along != null ? `<div><b>Sur ton trajet :</b> à ${fmtDist(p.along)} du départ, détour ${Math.round(p.off)} m</div>` : ''}</div>
    <div class="btns"><button class="btn sec" data-close>Fermer</button><button class="btn main" id="poiGo">${I.go}Y aller</button></div>`);
  m.querySelector('#poiGo').onclick = () => { m.hidden = true; m.innerHTML = ''; $('q').value = p.name; $('clear').hidden = false; setDest([p.lng, p.lat], p.name); };
}
$('layersBtn').onclick = () => {
  const pr = poiPrefs();
  const m = openModal(`<h3>Sur ma route</h3><div class="about" style="margin-top:-6px">Affiche des adresses utiles le long de ton itinéraire (ou autour de toi quand il n’y en a pas).</div>
    ${Object.entries(POI_CATS).map(([k, v]) => `<label class="tog"><span class="te">${v.emoji}</span><span class="tl">${v.label}</span><input type="checkbox" data-k="${k}" ${pr[k] ? 'checked' : ''}></label>`).join('')}
    <div class="about">Données OpenStreetMap : les commerces ajoutés récemment peuvent manquer. Les 🛴 sont les boutiques dont le nom évoque la trottinette.</div>
    <button class="btn main" data-close>OK</button>`);
  m.querySelectorAll('[data-k]').forEach(i => i.onchange = () => { const p = poiPrefs(); p[i.dataset.k] = i.checked; store.set('pois', p); refreshPois(); });
};
let pt; map.on('moveend', () => { clearTimeout(pt); pt = setTimeout(() => { if (!route) refreshPois(); }, 900); });
let rt; map.on('moveend', () => { clearTimeout(rt); rt = setTimeout(fetchReports, 600); });
map.on('load', () => { renderReports(); fetchReports(); refreshPois(); document.body.classList.add('ready'); });
setTimeout(() => document.body.classList.add('ready'), 3500);
setInterval(fetchReports, 30000);

// ---------- mises à jour ----------
function applyUpdate() {
  pendingApply = false; toast('Mise à jour en cours…', 1500);
  setTimeout(() => TrottiBoot.reload(), 700);
}
function showApk(d) {
  const b = $('banner'); b.hidden = false;
  b.innerHTML = `<div><b>Trotti ${esc(d.v)} disponible</b><small>Mise à jour de l’application</small></div><button class="btn main" id="apkGo">Installer</button>`;
  $('apkGo').onclick = () => { location.href = d.url; };
}
window.addEventListener('trotti-update', e => {
  const d = e.detail;
  if (d.type === 'apk') return showApk(d);
  if (document.body.dataset.s === 'idle' && $('modal').hidden) applyUpdate(); else pendingApply = true;
});
if (window.TrottiBoot) {
  if (TrottiBoot.apk) showApk(TrottiBoot.apk);
  if (TrottiBoot.pending) pendingApply = true;
}
const lastV = store.get('lastv', null);
if (lastV && lastV !== V) setTimeout(() => toast(`Trotti mis à jour : v${V} ✓`, 3500), 1200);
store.set('lastv', V);

// ---------- démarrage ----------
const old = store.get('ride', null);
if (old && old.dist > 20) {            // trajet interrompu (appli fermée) : on le garde dans les totaux
  const s = { km: old.dist / 1000, secs: Math.max(1, (old.saved - old.t0) / 1000), avg: old.moving > 5 ? old.dist / old.moving * 3.6 : 0, max: old.max };
  addTotals(s); setTimeout(() => showSummary(s, false), 1500);
}
store.del('ride');
setState('idle');
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js').catch(() => {});
window.__ok = true;
})();
