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
const V = (window.TrottiBoot && TrottiBoot.version) || '1.4.55';
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
  <div class="speedrow">Vitesse de croisière<input id="avg" type="range" min="12" max="45" step="1"><output id="avgOut"></output></div>
  <div class="btns"><button id="cancel" class="btn sec">Annuler</button><button id="start" class="btn main">${I.go}Démarrer</button></div>
</div>
<div id="hud" class="panel glass" hidden>
  <div class="top">
    <div class="odo"><div class="lbl">Compteur du trajet</div><div class="val"><span id="odo">0,00</span><small>km</small></div></div>
    <div class="batcell" id="batCell" hidden title="Batterie trottinette"><div class="batbar"><i id="batFill"></i></div><span><b id="batPct">–</b><small>%</small></span></div>
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
const ride = { active: false, mode: 'free', dist: 0, t0: 0, moving: 0, max: 0, last: null, speed: 0, off: 0, idx: 0, lastReroute: 0, trk: [] };
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
// Limite du compteur : 25 km/h = EDPM légal en France par défaut ; réglable pour une trottinette
// débridée ou un vélo électrique (la jauge adapte son échelle et son alerte). Sur voie publique, la loi reste la loi.
const LIMS = [25, 32, 45, 60];
const maxKmh = () => +store.get('maxkmh', 25);
let routeMode = store.get('rmode', 'safe') === 'fast' ? 'fast' : 'safe'; // défaut : sécurisé

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
// ---------- curseur de position : interpolation FLUIDE entre les fixes GPS ----------
// Les fixes arrivent ~1×/s : sans interpolation, le curseur saute et la rotation claque.
// On anime donc chaque déplacement (position + cap, arc minimal) image par image sur ~l'intervalle
// entre fixes, et pendant un trajet la caméra suit le curseur interpolé (mouvement continu,
// au lieu d'un easeTo relancé à chaque fix — l'ancienne source de saccades).
let meAnim = null, meRaf = 0, meShown = null, meShownHdg = null, lastFixT = 0, lastAcc = null, accMarker = null;
const meOffset = () => [0, Math.round((innerHeight - ($('hud')?.offsetHeight || 0) - 170) - innerHeight / 2)];
function makeMe() {
  meEl = document.createElement('div'); meEl.className = 'me'; meEl.innerHTML = '<b></b><i></i>';
  meMarker = new maplibregl.Marker({ element: meEl, rotationAlignment: 'map', pitchAlignment: 'viewport' }).setLngLat(me).addTo(map);
  meShown = me;
}
function updAcc() { // halo de précision GPS : rayon (m) converti en pixels selon le zoom
  const el = accMarker && accMarker.getElement();
  if (!me || !lastAcc) { el && (el.style.display = 'none'); return; }
  if (!accMarker) {
    const d = document.createElement('div'); d.className = 'acc';
    accMarker = new maplibregl.Marker({ element: d }).setLngLat(me).addTo(map);
    meEl.parentNode.insertBefore(d, meEl); // sous le curseur
  }
  const mpp = 156543.03392 * Math.cos(me[1] * Math.PI / 180) / 2 ** map.getZoom();
  const px = Math.min(280, Math.max(12, lastAcc * 2 / mpp));
  accMarker.getElement().style.cssText = `display:block;width:${px}px;height:${px}px`;
  accMarker.setLngLat(me);
}
function angDiff(a, b) { return ((b - a + 540) % 360) - 180; }
function meGo() { // (re)démarre l'animation vers le dernier fix reçu
  cancelAnimationFrame(meRaf);
  const step = () => {
    if (!meAnim || !meMarker) return;
    const k = Math.min(1, (Date.now() - meAnim.t0) / meAnim.dur), e = 1 - (1 - k) ** 2; // easeOutQuad
    const ll = [meAnim.from[0] + (meAnim.to[0] - meAnim.from[0]) * e, meAnim.from[1] + (meAnim.to[1] - meAnim.from[1]) * e];
    meMarker.setLngLat(ll); meShown = ll;
    accMarker && accMarker.setLngLat(ll);
    if (meAnim.h0 != null) { meShownHdg = meAnim.h0 + angDiff(meAnim.h0, meAnim.h1) * e; meMarker.setRotation(meShownHdg); }
    if (follow && ride.active) // caméra solidaire du curseur : continu, image par image
      map.jumpTo({ center: ll, zoom: 17, pitch: 55, bearing: meAnim.h0 != null ? meShownHdg : map.getBearing(), offset: meAnim.off });
    if (k < 1) meRaf = requestAnimationFrame(step); else meAnim = null;
  };
  meRaf = requestAnimationFrame(step);
}
function onFix(pos) {
  const c = pos.coords, first = !me;
  me = [c.longitude, c.latitude];
  if (c.heading != null && !isNaN(c.heading) && (c.speed || 0) > 1.2) hdg = hdg == null ? c.heading : (hdg + angDiff(hdg, c.heading) * .6 + 360) % 360;
  if (!meMarker) makeMe();
  const n = Date.now(), dur = Math.min(1100, Math.max(350, lastFixT ? n - lastFixT : 1000));
  lastFixT = n; lastAcc = c.accuracy || null;
  meAnim = { from: meShown || me, to: me, t0: n, dur, h0: hdg != null ? (meShownHdg != null ? meShownHdg : hdg) : null, h1: hdg, off: meOffset() };
  meGo();
  meEl.classList.toggle('hd', hdg != null && ride.active);
  updAcc();
  store.set('pos', me);
  if (first && !ride.active) map.flyTo({ center: me, zoom: 15.5, duration: 1200 });
  if (ride.active) trackRide(c, pos.timestamp || Date.now());
}
map.on('zoom', () => lastAcc && updAcc()); // le halo (en mètres) doit suivre le zoom
map.on('zoomstart', e => { if (e.originalEvent && ride.active) setFollow(false); }); // pincement pendant un trajet : on rend la main
function startWatch() {
  if (!navigator.geolocation) return toast('Géolocalisation indisponible');
  if (watchId == null) watchId = navigator.geolocation.watchPosition(onFix,
    e => { if (e.code === 1) toast('Autorise la localisation pour utiliser Trotti'); else if (Date.now() - (startWatch.w || 0) > 30000) { startWatch.w = Date.now(); toast('GPS : signal faible'); } },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}
function stopWatch() { // app en arrière-plan hors trajet : le GPS haute précision coûte la batterie pour rien
  if (watchId != null && !ride.active) { navigator.geolocation.clearWatch(watchId); watchId = null; }
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
// Profil « vélo » de Valhalla, deux réglages au choix (puces dans la fiche itinéraire) :
//  - SÉCURISÉ (défaut) : use_roads 0,25 = la préférence naturelle de Valhalla — pistes et voies
//    cyclables d'abord ; une grande route SANS aménagement n'est prise qu'en dernier recours.
//    avoid_bad_surfaces 0,75 : petites roues → pavés et chemins défoncés lourdement pénalisés.
//    Testé à Lyon : à distance égale (+2 % de temps), passe par les Voies Lyonnaises au lieu de rues ordinaires.
//  - RAPIDE : l'ancien réglage (use_roads 0,85, trafic ignoré, on se faufile sur le côté).
//  use_hills 1 : trottinette électrique, les côtes ne comptent pas.
//  use_living_streets : sans effet au-dessus de 0,5 (doc Valhalla) — on garde la valeur par prudence.
//  Jamais d'autoroute, ni de trottoir/escalier ; sens interdits respectés (comme la loi).
const OPT_FAST = { use_roads: .85, use_hills: 1, avoid_bad_surfaces: .5, use_living_streets: .6 };
const OPT_SAFE = { use_roads: .25, use_hills: 1, avoid_bad_surfaces: .75, use_living_streets: .6 };
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
const clean = t => String(t || '').replace(/P[ée]dalez/g, 'Roulez').replace(/p[ée]dalez/g, 'roulez').replace(/cycliste/g, 'trottinette')
  .replace(/\b(dans|sur la|au|sur le) ((?:rue|route|avenue|boulevard|chemin|place|allée|quai|cours|passage|pont) [^,.]+)/ig, 'sur $2') // « tournez à droite DANS Rue X » → « SUR Rue X » (Valhalla francise mal, et la voix le lit)
  .replace(/\.$/, '');
function excludePoints(a, b) {
  const x0 = Math.min(a[0], b[0]) - .02, x1 = Math.max(a[0], b[0]) + .02, y0 = Math.min(a[1], b[1]) - .02, y1 = Math.max(a[1], b[1]) + .02;
  return loadReports().filter(r => (r.type === 'blocked' || r.type === 'works' || r.type === 'danger') && r.lng > x0 && r.lng < x1 && r.lat > y0 && r.lat < y1).slice(0, 20).map(r => [r.lng, r.lat]);
}
async function valhalla(from, to, avg, excl, safe) {
  const body = {
    locations: [{ lat: from[1], lon: from[0] }, { lat: to[1], lon: to[0] }], costing: 'bicycle',
    costing_options: { bicycle: { bicycle_type: 'Hybrid', cycling_speed: avg, ...(safe ? OPT_SAFE : OPT_FAST) } },
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
async function fetchRoute(from, to, avg, safe) {
  const ex = excludePoints(from, to); let r;
  try { r = await valhalla(from, to, avg, ex, safe); }
  catch { try { r = await valhalla(from, to, avg, [], safe); } catch { r = await osrm(from, to, avg); } }
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
    const r = await fetchRoute(me, dest, avgSpeed(), routeMode === 'safe');
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
  const modeChip = (m, label) => `<span class="chip mode ${routeMode === m ? 'ok' : ''}" data-m="${m}" title="${m === 'safe' ? 'Pistes et voies cyclables en priorité' : 'Le trajet le plus court en temps'}">${label}</span>`;
  const voiceChip = TTS ? `<span class="chip mode ${voiceOn() ? 'ok' : ''}" data-voice="1" title="Annonces vocales : manœuvres, dangers, arrivée">🔊 Voix</span>` : '';
  $('chips').innerHTML = modeChip('safe', '🛡 Sécurisé') + modeChip('fast', '⚡ Rapide') + voiceChip + `<span class="chip">${I.pin}${esc(destName)}</span>` +
    (n ? `<span class="chip warn">${I.alert}${n} signalement${n > 1 ? 's' : ''}</span>` : '');
}
$('chips').addEventListener('click', e => { // puce voix + bascule Sécurisé / Rapide
  const v = e.target.closest('[data-voice]');
  if (v) { const on = !voiceOn(); store.set('voice', on ? 1 : 0); showSheet(); on ? say('Guidage vocal activé') : toast('Guidage vocal coupé 🔇'); return; }
  const b = e.target.closest('[data-m]');
  if (!b || b.dataset.m === routeMode) return;
  routeMode = b.dataset.m; store.set('rmode', routeMode);
  if (me && dest) computeRoute(false); else if (route) showSheet();
});
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
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { if (ride.active) wake(true); startWatch(); }
  else stopWatch(); // hors trajet : GPS coupé en arrière-plan — pendant un trajet il continue (compteur km)
});

function startRide(mode) {
  if (ride.active) return;
  Object.assign(ride, { active: true, mode, dist: 0, t0: Date.now(), moving: 0, max: 0, last: null, speed: 0, off: 0, idx: 0, lastReroute: 0, trk: [] });
  navSay = { i: -1, far: false, near: false }; alerted = new Set();
  setState('ride'); wake(true); startWatch(); setFollow(true);
  $('results').hidden = true; $('q').blur();
  meEl && meEl.classList.toggle('hd', hdg != null);
  $('remain').hidden = mode !== 'nav';
  hudTick(); hudTimer = setInterval(hudTick, 1000);
  map.easeTo({ center: me || map.getCenter(), zoom: 17, pitch: 55, bearing: hdg || 0, duration: 1000 });
  if (mode === 'nav') navUpdate();
  toast(mode === 'nav' ? 'C’est parti ! Max ' + maxKmh() + ' km/h' : 'Compteur lancé – bonne route !');
  mode === 'nav' && route && say('C’est parti. ' + fmtDist(route.distance).replace('.', ',') + ', environ ' + Math.max(1, Math.round(route.duration / 60)) + ' minutes.');
  sc.stored() && sc.connect(true); // trottinette associée : batterie en direct pendant le trajet
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
    else {
      ride.dist += d; if (dt < 15) ride.moving += dt; ride.last = { ll: me, t: now }; if (kmh == null) kmh = v;
      if (!ride.trk.length || dist(ride.trk[ride.trk.length - 1], me) >= 15) ride.trk.push([+me[0].toFixed(5), +me[1].toFixed(5)]); // trace pour l'export GPX (1 pt / 15 m)
    }
  }
  kmh = kmh == null ? 0 : kmh;
  ride.speed = ride.speed ? ride.speed * .4 + kmh * .6 : kmh;
  if (kmh < 60) ride.max = Math.max(ride.max, kmh);
  // (plus d'easeTo ici : la caméra suit le curseur interpolé image par image, cf. meGo)
  checkReportsAhead(); // nids-de-poule, contrôles… juste devant nous → vibre + voix
  if (ride.mode === 'nav') navUpdate();
}
function hudTick() {
  const el = (Date.now() - ride.t0) / 1000, sp = ride.speed < .8 ? 0 : ride.speed;
  $('odo').textContent = fmtKm(ride.dist);
  $('spd').textContent = Math.round(sp);
  const lim = maxKmh(); // l'échelle de la jauge suit la limite (pleine à lim × 1,25)
  $('gfg').style.strokeDasharray = `${Math.min(sp / (lim * 1.25), 1) * 160} 214`;
  $('gauge').classList.toggle('over', sp > lim);
  $('tm').textContent = fmtTime(el);
  $('avgs').textContent = ride.moving > 5 ? (ride.dist / ride.moving * 3.6).toFixed(1).replace('.', ',') : '–';
  $('mx').textContent = Math.round(ride.max);
  if (Math.round(el) % 5 === 0) store.set('ride', { t0: ride.t0, dist: ride.dist, moving: ride.moving, max: ride.max, saved: Date.now() });
}

// ---------- guidage vocal (TTS fr-FR) + alertes de proximité ----------
const TTS = 'speechSynthesis' in navigator;
const voiceOn = () => TTS && store.get('voice', 1) === 1;
let frVoice = null;
if (TTS) { const pick = () => { frVoice = speechSynthesis.getVoices().find(v => /^fr/i.test(v.lang)) || null; }; speechSynthesis.onvoiceschanged = pick; pick(); }
function say(txt, crit) { // crit = couper l'annonce en cours (manœuvre urgente) ; sinon on attend
  if (!voiceOn()) return;
  if (speechSynthesis.speaking) { if (!crit) return; speechSynthesis.cancel(); }
  const u = new SpeechSynthesisUtterance(txt);
  u.lang = 'fr-FR'; u.rate = 1.05; if (frVoice) u.voice = frVoice;
  speechSynthesis.speak(u);
}
const bearingTo = (a, b) => { // cap vers un point (pour savoir si un signalement est DEVANT nous)
  const rad = Math.PI / 180, y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad),
    x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};
let navSay = { i: -1, far: false, near: false }, alerted = new Set(), alertChk = 0;
function checkReportsAhead() { // signalement dans un cône de ±55° devant, < 160 m → vibre + voix (1 fois par trajet)
  if (!ride.active || hdg == null || Date.now() - alertChk < 4000) return;
  alertChk = Date.now();
  for (const r of loadReports()) {
    const key = r.id || r.t + '-' + r.type;
    if (alerted.has(key)) continue;
    const d = dist(me, [r.lng, r.lat]);
    if (d < 15 || d > 160 || Math.abs(angDiff(hdg, bearingTo(me, [r.lng, r.lat]))) > 55) continue;
    alerted.add(key);
    navigator.vibrate?.([70, 60, 70]);
    say('Attention, ' + REPORT_TYPES[r.type][1].toLowerCase() + ' dans ' + Math.round(d / 10) * 10 + ' mètres', true);
    toast(REPORT_TYPES[r.type][0] + ' ' + REPORT_TYPES[r.type][1] + ' à ' + fmtDist(d));
    break; // une alerte à la fois (les autres attendront le prochain tour, 4 s)
  }
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
    const dm = route.cum[next.begin] - p.along;
    $('navDist').textContent = fmtDist(dm); $('navText').textContent = next.text;
    if (navSay.i !== next.begin) navSay = { i: next.begin, far: false, near: false }; // une annonce loin + une proche, par manœuvre
    const kmh = Math.max(ride.speed, 8), farD = Math.max(150, kmh * 6), nearD = Math.max(40, kmh * 1.5);
    if (!navSay.far && dm < farD) { navSay.far = true; say('Dans ' + Math.round(dm / 10) * 10 + ' mètres, ' + next.text, true); navigator.vibrate?.(50); }
    else if (!navSay.near && dm < nearD) { navSay.near = true; say(next.text, true); navigator.vibrate?.([40, 40, 40]); }
  } else {
    $('navIcon').innerHTML = I.flag; $('navDist').textContent = fmtDist(rem); $('navText').textContent = 'Arrivée : ' + destName;
  }
  if (rem < 20 && Date.now() - ride.t0 > 8000) return endRide(true);
  if (ride.off >= 3 && Date.now() - ride.lastReroute > 12000) reroute();
}
async function reroute() {
  ride.lastReroute = Date.now(); toast('Recalcul de l’itinéraire…');
  try {
    const r = await fetchRoute(me, dest, avgSpeed(), routeMode === 'safe');
    if (!ride.active) return;
    route = r; ride.idx = 0; ride.off = 0; syncRoute(); navUpdate(); refreshPois();
    say('Itinéraire recalculé');
  } catch { toast('Recalcul impossible'); }
}

function endRide(arrived) {
  if (!ride.active) return;
  arrived && say('Vous êtes arrivés à destination');
  ride.active = false; clearInterval(hudTimer); wake(false); store.del('ride');
  const s = { km: ride.dist / 1000, secs: (Date.now() - ride.t0) / 1000, avg: ride.moving > 5 ? ride.dist / ride.moving * 3.6 : 0, max: ride.max };
  if (s.km >= .02) { addTotals(s); pushRide(s, Date.now(), ride.trk); }
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
function pushRide(s, t, trk) { // historique : 60 derniers trajets avec leur trace (allégée) pour l'export GPX
  const rides = store.get('rides', []);
  rides.push({ t: t || Date.now(), km: +s.km.toFixed(2), secs: Math.round(s.secs), avg: s.avg ? +s.avg.toFixed(1) : 0, max: Math.round(s.max), trk: trk || [] });
  store.set('rides', rides.slice(-60));
}
async function dlGpx(r) { // export GPX : partage Android d'abord, téléchargement en repli (PWA)
  const g = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Trotti" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Trotti ${new Date(r.t).toLocaleString('fr-FR')}</name><trkseg>${(r.trk || []).map(p => `<trkpt lat="${p[1]}" lon="${p[0]}"/>`).join('')}</trkseg></trk></gpx>`;
  try {
    const f = new File([g], 'trotti-' + new Date(r.t).toISOString().slice(0, 10) + '.gpx', { type: 'application/gpx+xml' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) return navigator.share({ files: [f], title: 'Trajet Trotti' });
  } catch {}
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([g], { type: 'application/gpx+xml' })); a.download = 'trotti-' + new Date(r.t).toISOString().slice(0, 10) + '.gpx';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch { toast('Export GPX impossible sur cet appareil'); }
}

// ---------- Mes trajets enregistrés (favoris + débrief comparatif) ----------
const trips = () => store.get('trips', []);
function saveTrip(name, s, trk) {
  if (!trk || trk.length < 5) return toast('Trace trop courte pour être gardée');
  const T = trips();
  T.push({ id: Date.now(), name: name || 'Trajet ' + (T.length + 1), start: trk[0], end: trk[trk.length - 1], km: +s.km.toFixed(2), secs: Math.round(s.secs), best: Math.round(s.secs), n: 1, t: Date.now(), trk });
  store.set('trips', T.slice(-15));
  toast('Trajet « ' + name + ' » gardé ⭐');
}
function matchTrip(trk) { // trajet répété ? (même départ < 300 m, même arrivée < 200 m)
  if (!trk || trk.length < 5) return null;
  const a = trk[0], b = trk[trk.length - 1];
  return trips().find(tp => dist(tp.start, a) < 300 && dist(tp.end, b) < 200) || null;
}
function makeRoute(coords, duration) { // objet route depuis une trace (pas de manœuvres → guidage « arrivée »)
  const r = { coords, duration, avg: avgSpeed(), maneuvers: [] };
  r.cum = [0]; for (let i = 1; i < coords.length; i++) r.cum[i] = r.cum[i - 1] + dist(coords[i - 1], coords[i]);
  r.distance = r.cum[r.cum.length - 1];
  return r;
}
function goTrip(tp, closeModal) { // naviguer en suivant TON itinéraire enregistré
  if (ride.active) return toast('Termine d’abord ton trajet en cours');
  closeModal && closeModal();
  dest = tp.end; destName = tp.name; placeDest();
  route = makeRoute(tp.trk, tp.secs); syncRoute(); fitRoute();
  showSheet(); setState('route'); refreshPois();
  toast('Itinéraire « ' + tp.name + ' » — le tien ⭐');
}
const verdictTxt = (myKm, myMin, sugKm, sugMin) => {
  const dk = +(myKm - sugKm).toFixed(1), dm = Math.round(myMin - sugMin);
  if (dk <= 0 && dm <= 0) return `✅ Ton trajet gagne : ${dk ? Math.abs(dk).toString().replace('.', ',') + ' km et ' : ''}${Math.abs(dm)} min de moins que le proposé`;
  if (dk <= 0) return `↔️ Ton trajet est plus court de ${Math.abs(dk).toString().replace('.', ',')} km, mais ${dm} min de plus`;
  if (dm <= 0) return `⚡ Ton trajet est plus rapide de ${Math.abs(dm)} min, mais ${dk.toString().replace('.', ',')} km de plus`;
  return `🐌 Le proposé gagne : ${dk.toString().replace('.', ',')} km et ${dm} min de moins`;
};
async function showDebrief(tp) { // mon trajet vs ce que Trotti proposerait aujourd'hui
  const m = openModal(`<h3>⚖️ Débrief « ${esc(tp.name)} »</h3><div id="dbBody"><div class="about">Calcul de l’itinéraire proposé…</div></div>
    <button class="btn main" data-close>Fermer</button>`);
  const body = m.querySelector('#dbBody');
  try {
    const r = await fetchRoute(tp.start, tp.end, avgSpeed(), routeMode === 'safe');
    body.innerHTML = `<div class="bigstat">
      <div class="hero"><b>${nb1(tp.km)} km</b><small>Ton trajet · ${fmtTime(tp.secs)}${tp.best < tp.secs ? ' · record ' + fmtTime(tp.best) : ''}</small></div>
      <div><b>${nb1(r.distance / 1000)} km</b><small>Proposé · ${fmtTime(r.duration)}</small></div></div>
      <div class="about" style="text-align:center;font-size:13.5px;font-weight:700;color:var(--g3)">${verdictTxt(tp.km, tp.secs / 60, r.distance / 1000, r.duration / 60)}</div>
      <div class="about">Proposé = profil ${routeMode === 'safe' ? '🛡 Sécurisé' : '⚡ Rapide'} à ${avgSpeed()} km/h. Le temps de TON trajet inclut tes arrêts (feux…) — le proposé ne les connaît pas.</div>`;
  } catch {
    body.innerHTML = '<div class="about">Itinéraire proposé indisponible (réseau ?) — réessaie plus tard.</div>';
  }
}
function keepTripPrompt(s, trk) { // nommer et garder le trajet qu'on vient de faire
  const m = openModal(`<h3>⭐ Garder ce trajet</h3><div class="about" style="margin-top:-6px">« Y aller » suivra TON itinéraire tel quel, et le débrief le comparera à ce que Trotti proposerait (km, minutes).</div>
    <input id="tn" autocomplete="off" style="width:100%;font:15px inherit;padding:11px;border-radius:12px;border:1px solid var(--bd);background:var(--chip);color:var(--fg)" placeholder="ex. Domicile → Travail (par les berges)">
    <div class="btns"><button class="btn sec" data-close>Annuler</button><button class="btn main" id="tnGo">Garder</button></div>`);
  const go = () => { const n = m.querySelector('#tn').value.trim(); if (!n) return toast('Donne-lui un nom'); saveTrip(n, s, trk); m.hidden = true; m.innerHTML = ''; };
  m.querySelector('#tnGo').onclick = go;
  m.querySelector('#tn').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

// ---------- sauvegarde / restauration des données ----------
const BACKUP_KEYS = ['totals', 'rides', 'trips', 'avg', 'rmode', 'maxkmh', 'pois', 'reports', 'pos', 'lastv'];
async function exportData() {
  const data = {};
  BACKUP_KEYS.forEach(k => { const v = localStorage.getItem('trotti.' + k); if (v != null) data['trotti.' + k] = v; });
  const txt = JSON.stringify({ app: 'Trotti', v: V, t: Date.now(), data });
  try {
    const f = new File([txt], 'trotti-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json', { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) return navigator.share({ files: [f], title: 'Sauvegarde Trotti' });
  } catch {}
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = 'trotti-sauvegarde.json';
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch { toast('Export impossible sur cet appareil'); }
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const j = JSON.parse(r.result);
      if (!j || j.app !== 'Trotti' || !j.data) throw 0;
      let n = 0;
      Object.entries(j.data).forEach(([k, v]) => { if (k.startsWith('trotti.') && BACKUP_KEYS.includes(k.slice(7))) { localStorage.setItem(k, v); n++; } });
      if (!n) throw 0;
      toast('Sauvegarde restaurée ✓ — redémarrage…');
      setTimeout(() => TrottiBoot.reload(), 900);
    } catch { toast('Fichier de sauvegarde invalide'); }
  };
  r.readAsText(file);
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
  const tp = matchTrip(ride.trk);
  let repeatHtml = '';
  if (tp) { // trajet connu : on met à jour ses stats et on débriefe la répétition
    tp.n++; tp.t = Date.now(); tp.km = +s.km.toFixed(2); tp.secs = Math.round(s.secs);
    const rec = tp.best; if (s.secs < tp.best) tp.best = Math.round(s.secs);
    const T = trips(); T[T.findIndex(x => x.id === tp.id)] = tp; store.set('trips', T);
    repeatHtml = `<div class="about" style="text-align:center;font-weight:700;color:var(--g3)">🔁 « ${esc(tp.name)} » · ${tp.n}ᵉ fois · ${s.secs <= rec ? '🏆 NOUVEAU RECORD !' : 'record ' + fmtTime(rec) + ' (+ ' + fmtTime(s.secs - rec) + ')'}</div>`;
  }
  const keepable = !tp && ride.trk && ride.trk.length >= 5;
  const m = openModal(`<h3>${arrived ? '🏁 Vous êtes arrivé !' : 'Trajet terminé'}</h3>
    ${repeatHtml}
    <div class="bigstat"><div class="hero"><b>${fmtKm(s.km * 1000)} km</b><small>Distance parcourue</small></div>
    <div><b>${fmtTime(s.secs)}</b><small>Durée</small></div><div><b>${s.avg ? s.avg.toFixed(1).replace('.', ',') : '–'}</b><small>Vitesse moy. km/h</small></div>
    <div><b>${Math.round(s.max)}</b><small>Vitesse max</small></div><div><b>${fmtKm((store.get('totals', { km: 0 }).km) * 1000)}</b><small>Total km</small></div></div>
    ${keepable ? '<button class="btn sec" id="keepTrip" style="margin-bottom:10px">⭐ Garder ce trajet (favori + débrief)</button>' : ''}
    <button class="btn main" data-close>Super !</button>`);
  keepable && (m.querySelector('#keepTrip').onclick = () => { m.hidden = true; m.innerHTML = ''; keepTripPrompt(s, ride.trk); });
}
$('statsBtn').onclick = () => {
  const t = store.get('totals', { km: 0, rides: 0, secs: 0 });
  const rides = store.get('rides', []);
  const histHtml = rides.length ? `<details class="sclog"><summary>Historique des trajets (${rides.length})</summary><div class="ridelist">${rides.slice(-40).reverse().map((r, i) => {
    const d = new Date(r.t);
    return `<div class="rideRow"><div><b>${fmtKm(r.km * 1000)} km</b><small>${d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmtTime(r.secs)} · max ${Math.round(r.max)} km/h${r.avg ? ' · moy ' + nb1(r.avg) : ''}</small></div>${r.trk && r.trk.length > 1 ? `<button class="chip mode" data-gpx="${rides.length - 1 - i}">GPX</button>` : ''}</div>`;
  }).join('')}</div></details>` : '';
  const T = trips();
  const tripsHtml = T.length ? `<details class="sclog"><summary>Mes trajets ⭐ (${T.length})</summary><div class="ridelist">${T.map(tp => `<div class="rideRow tripRow"><div><b>${esc(tp.name)}</b><small>${nb1(tp.km)} km · record ${fmtTime(tp.best)} · ${tp.n}× · dern. ${new Date(tp.t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</small></div><span class="chip mode" data-go="${tp.id}" title="Naviguer sur cet itinéraire">▶</span><span class="chip mode" data-db="${tp.id}" title="Débrief : mon trajet vs proposé">⚖️</span><span class="chip mode" data-del="${tp.id}" title="Supprimer">✕</span></div>`).join('')}</div></details>` : '';
  const m = openModal(`<h3>Mes kilomètres</h3>
    <div class="bigstat"><div class="hero"><b>${fmtKm(t.km * 1000)} km</b><small>Total en trottinette</small></div>
    <div><b>${t.rides}</b><small>Trajets</small></div><div><b>${t.secs >= 3600 ? Math.floor(t.secs / 3600) + ' h ' + pad(Math.floor(t.secs % 3600 / 60)) : Math.floor(t.secs / 60) + ' min'}</b><small>Sur la route</small></div></div>
    <div class="speedlim"><b>⚡ Limite du compteur</b><small>25 km/h = EDPM légal en France. À régler si ta monture va plus vite (débridée, vélo électrique) : la jauge adapte son échelle et son alerte. Sur voie publique, la loi reste la loi.</small>
      <div class="chips" style="margin-top:8px">${LIMS.map(v => `<span class="chip mode ${v === maxKmh() ? 'ok' : ''}" data-lim="${v}">${v} km/h</span>`).join('')}</div></div>
    ${histHtml}
    ${tripsHtml}
    ${scPanelHtml()}
    <div class="about">Trotti v${V} · Cartes © OpenStreetMap, © CARTO · Itinéraires Valhalla · Adresses Photon</div>
    <div class="btns"><button class="btn sec" id="exp">💾 Exporter mes données</button><button class="btn sec" id="imp">Importer</button></div>
    <input type="file" id="impF" accept="application/json,.json" hidden>
    <button class="btn sec" id="chk" style="margin:10px 0">Chercher une mise à jour</button><button class="btn main" data-close>Fermer</button>`,
    () => { sc.panel = null; sc.renderHook = null; });
  scPanelWire(m);
  m.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { const tp = trips().find(x => x.id === +b.dataset.go); tp && goTrip(tp, () => { m.hidden = true; m.innerHTML = ''; }); });
  m.querySelectorAll('[data-db]').forEach(b => b.onclick = () => { const tp = trips().find(x => x.id === +b.dataset.db); tp && showDebrief(tp); });
  m.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    if (b.dataset.c) { store.set('trips', trips().filter(x => x.id !== +b.dataset.del)); $('statsBtn').onclick(); }
    else { b.dataset.c = '1'; b.textContent = 'Sûr ?'; setTimeout(() => { delete b.dataset.c; b.textContent = '✕'; }, 2500); }
  });
  m.querySelector('#exp').onclick = exportData;
  const imp = m.querySelector('#imp');
  imp.onclick = () => { if (imp.dataset.c) m.querySelector('#impF').click(); else { imp.dataset.c = '1'; imp.textContent = 'Remplacer tout ?'; setTimeout(() => { delete imp.dataset.c; imp.textContent = 'Importer'; }, 2500); } };
  m.querySelector('#impF').onchange = e => { e.target.files[0] && importData(e.target.files[0]); };
  m.querySelectorAll('[data-lim]').forEach(ch => ch.onclick = () => { store.set('maxkmh', +ch.dataset.lim); $('statsBtn').onclick(); }); // régénère le modal (puces + jauge à jour)
  m.querySelectorAll('[data-gpx]').forEach(b => b.onclick = () => dlGpx(rides[+b.dataset.gpx]));
  m.querySelector('#chk').onclick = async e => {
    e.target.textContent = 'Vérification…';
    const r = await (window.TrottiBoot && TrottiBoot.check ? TrottiBoot.check() : 'none');
    e.target.textContent = r === 'web' ? 'Mise à jour téléchargée ✓' : r === 'apk' ? 'Nouvelle version de l’appli disponible' : r === 'offline' ? 'Pas de connexion' : 'Trotti est à jour ✓';
  };
};

// ---------- Bluetooth : ma trottinette (Segway-Ninebot, lecture seule) ----------
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

// ---------- Segway-Ninebot « Encryption2 » : crypto (lecture seule) ----------
// Portage JS fidèle de NinebotCrypto telle que SHU (ScooterHacking Utility) l'utilise
// sur la ZT3 Pro — vérifiée octet par octet contre le trafic réel par le projet
// pepperonas/segway-zt3-pro (python/zt3_cli) ; vecteurs repris dans tools/test-ble-vectors.mjs.
// Documentation : nootnooot.codeberg.page/segway-ninebot-ble
const NUS = { svc: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', tx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', rx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- [nb-crypto] début du bloc pur (extrait tel quel par tools/test-ble-vectors.mjs — pas de DOM ici) ----
const NB_FW = Uint8Array.from([0x97, 0xCF, 0xB8, 0x02, 0x84, 0x41, 0x43, 0xDE, 0x56, 0x00, 0x2B, 0x3B, 0x34, 0x78, 0x0A, 0x5D]); // « sel » fixe du protocole
const toHex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
const fromHex = h => Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16));
const pad16 = b => { const o = new Uint8Array(16); o.set(b.slice(0, 16)); return o; };
async function aesBlock(key, block) { // AES-128-ECB d'un bloc (WebCrypto n'a que CBC : IV nul, 1er bloc = ECB)
  const k = await crypto.subtle.importKey('raw', key, 'AES-CBC', false, ['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, k, block)).slice(0, 16);
}
async function nbKey(k1, k2) { // SHA-1(k1 ‖ k2)[0:16], chaque moitié bornée à 16 octets, k2 absent = zéros
  const c = new Uint8Array(32); c.set(pad16(k1 || new Uint8Array(0))); if (k2) c.set(pad16(k2), 16);
  return new Uint8Array(await crypto.subtle.digest('SHA-1', c)).slice(0, 16);
}
const xor16 = (a, b) => Uint8Array.from({ length: 16 }, (_, i) => a[i] ^ b[i]);
class NbCrypto {
  constructor(name) {
    this.name = new TextEncoder().encode(name);
    this.token = new Uint8Array(16);     // jeton fourni par la trottinette (réponse 0x5B)
    this.random = new Uint8Array(16);    // notre secret de session (trame 0x5C)
    this.challenge = new Uint8Array(14); // série de la trottinette, à renvoyer (0x5D)
    this.key = new Uint8Array(16); this.counter = 0;
    this.L = false; this.M = false; this.O = false; // étapes 1/2/3 franchies
    this.pwdStored = 0; // INDEX de la réponse 0x5B : secret de session déjà enregistré sur la trottinette
    this.ready = this.deriveKey(this.name, NB_FW); // la dérivation est asynchrone : on l'attend avant toute crypto
  }
  async deriveKey(k1, k2) { this.key = await nbKey(k1, k2); }
  async setRandomAppData(d) { this.random.set(d); this.ready = this.deriveKey(this.random, this.token); await this.ready; } // reprise silencieuse, sans renvoyer 0x5C
  buildGetRandom(dst) { return Uint8Array.from([0x5A, 0xA5, 0x00, 0x3E, dst, 0x5B, 0x00]); } // étape 1
  buildPairInit(dst, fixed) { // étape 2 : 16 octets aléatoires = notre secret (fixe si fourni — SHU garde le même à chaque renvoi)
    const f = new Uint8Array(23); f.set(Uint8Array.from([0x5A, 0xA5, 0x10, 0x3E, dst, 0x5C, 0x00])); f.set(fixed || crypto.getRandomValues(new Uint8Array(16)), 7); return f;
  }
  invSum(body) { // somme de contrôle en octets SIGNÉS (Kotlin « j7 += b7 ») — piège classique
    let s = 0; for (let i = 0; i < body.length; i++) s += body[i] < 128 ? body[i] : body[i] - 256;
    const v = ~s & 0xFFFF; return [v & 255, v >> 8];
  }
  async fXor(body) { // brouillage de la 1re trame : flux fixe AES(sel, clé), auto-inverse
    await this.ready;
    const ks = await aesBlock(this.key, NB_FW), out = new Uint8Array(body.length);
    for (let i = 0; i < body.length; i++) out[i] = body[i] ^ ks[i % 16]; return out;
  }
  async ctrBody(body, ctr) { // AES-CTR, bloc = [01][compteur32 BE][jeton(8)][00][n° bloc]
    await this.ready;
    const out = new Uint8Array(body.length), b = new Uint8Array(16);
    b[0] = 1; b[1] = ctr >>> 24 & 255; b[2] = ctr >>> 16 & 255; b[3] = ctr >>> 8 & 255; b[4] = ctr & 255; b.set(this.token.slice(0, 8), 5);
    for (let o = 0, i = 1; o < body.length; o += 16, i++) { b[15] = i & 255; const ks = await aesBlock(this.key, b); for (let j = 0; j < Math.min(16, body.length - o); j++) out[o + j] = body[o + j] ^ ks[j]; }
    return out;
  }
  async tag(plain, ctr) { // CBC-MAC custom (B0 = 0x59 …), condensé chiffré par le bloc S0, 4 octets
    await this.ready;
    const body = plain.slice(3), b0 = new Uint8Array(16);
    b0[0] = 0x59; b0[1] = ctr >>> 24 & 255; b0[2] = ctr >>> 16 & 255; b0[3] = ctr >>> 8 & 255; b0[4] = ctr & 255; b0.set(this.token.slice(0, 8), 5); b0[15] = body.length & 255;
    let x = await aesBlock(this.key, b0);
    const aad = new Uint8Array(16); aad.set(plain.slice(0, 3)); x = await aesBlock(this.key, xor16(x, aad));
    for (let o = 0; o < body.length; o += 16) { const blk = new Uint8Array(16); blk.set(body.slice(o, o + 16)); x = await aesBlock(this.key, xor16(x, blk)); }
    const s0 = new Uint8Array(16); s0[0] = 1; s0.set(b0.slice(1, 13)); const ks = await aesBlock(this.key, s0);
    return Uint8Array.from([x[0] ^ ks[0], x[1] ^ ks[1], x[2] ^ ks[2], x[3] ^ ks[3]]);
  }
  async encrypt(plain) { // trame interne [5A A5 len 3E dst cmd arg data] → trame fil (queue : tag + compteur)
    await this.ready;
    const body = plain.slice(3), out = new Uint8Array(plain.length + 6); out.set(plain.slice(0, 3));
    if (this.counter === 0) { // toute première trame : pas de tag, CRC signé en clair, compteur 0000
      const crc = this.invSum(body);
      out.set(await this.fXor(body), 3);
      out[plain.length + 2] = crc[0]; out[plain.length + 3] = crc[1];
      this.counter = 1;
    } else {
      this.counter++;
      out.set(await this.ctrBody(body, this.counter), 3);
      out.set(await this.tag(plain, this.counter), plain.length);
      out[plain.length + 4] = this.counter >> 8 & 255; out[plain.length + 5] = this.counter & 255;
      if (plain.length >= 23 && plain[2] === 0x10 && plain[5] === 0x5C && plain[6] === 0) this.random.set(plain.slice(7, 23)); // mémorise notre secret (miroir SHU)
    }
    return out;
  }
  async decrypt(wire) {
    await this.ready;
    if (wire.length < 9 || wire[0] !== 0x5A || wire[1] !== 0xA5) return null;
    const out = new Uint8Array(wire.length - 6); out.set(wire.slice(0, 3));
    const ctrIn = (wire[wire.length - 2] << 8) | wire[wire.length - 1];
    const eff = (this.counter & ~0xFFFF) + ctrIn; // compteur de RÉCEPTION lu dans la queue (16 bits)
    const body = wire.slice(3, wire.length - 6);
    out.set(eff === 0 ? await this.fXor(body) : await this.ctrBody(body, eff), 3);
    if (eff === 0 && out.length >= 37 && out[2] === 0x1E && out[4] === 0x3E && out[5] === 0x5B) { // étape 1 : jeton + challenge
      this.token.set(out.slice(7, 23)); this.challenge.set(out.slice(23, 37));
      await this.deriveKey(this.name, this.token); this.L = true; this.pwdStored = out[6];
    }
    if (eff > 0 && out.length >= 7 && out[4] === 0x3E && out[5] === 0x5C && out[6] === 1) { // étape 2 acceptée — SHU ne pose M QUE sur arg=1 (arg=0 = « j'attends le phare »)
      await this.deriveKey(this.random, this.token); this.M = true;
    }
    if (eff > 0 && out.length >= 7 && out[4] === 0x3E && out[5] === 0x5D && out[6] === 1) { this.O = true; this.M = true; } // étape 3
    this.counter = this.counter + 1; // SHU h() authentique : simple incrément — JAMAIS de saut vers le compteur du fil (le recul provoquait des rejeus)
    return out;
  }
}
async function nbWrap(c, dst, cmd, arg, data) { // construction + chiffrement d'une trame interne
  const d = data || new Uint8Array(0), f = new Uint8Array(7 + d.length);
  f.set(Uint8Array.from([0x5A, 0xA5, d.length, 0x3E, dst, cmd, arg])); f.set(d, 7);
  return c.encrypt(f);
}
async function nbParse(c, wire) { // déchiffre une trame fil et la découpe (null si ce n'est pas une trame)
  if (!wire || wire.length < 9 || wire[0] !== 0x5A || wire[1] !== 0xA5) return null;
  const p = await c.decrypt(wire);
  if (!p || p.length < 7 || p.length < p[2] + 7) return null;
  return { src: p[3], dst: p[4], cmd: p[5], arg: p[6], payload: p.slice(7, p[2] + 7) };
}
async function nbSeal0(key, plain) { // format « compteur 0 » (f-XOR + somme signée) — celui que la trottinette parle PENDANT l'appairage
  const ks = await aesBlock(key, NB_FW), out = new Uint8Array(plain.length + 6);
  out.set(plain.slice(0, 3)); let s = 0;
  for (let i = 3; i < plain.length; i++) { const b = plain[i]; s += b < 128 ? b : b - 256; out[i] = b ^ ks[(i - 3) % 16]; }
  const cs = ~s & 0xFFFF;
  out[plain.length + 2] = cs & 255; out[plain.length + 3] = cs >> 8;
  return out;
}
async function nbOpen0(key, wire) { // déchiffre une trame format compteur 0 et vérifie sa somme signée
  const n = wire.length - 6, ks = await aesBlock(key, NB_FW), pt = new Uint8Array(n);
  pt.set(wire.slice(0, 3)); let s = 0;
  for (let i = 3; i < n; i++) { const b = wire[i] ^ ks[(i - 3) % 16]; pt[i] = b; s += b < 128 ? b : b - 256; }
  return { pt, ok: n >= 7 && (wire[n + 2] | wire[n + 3] << 8) === (~s & 0xFFFF) };
}
// ---- [nb-crypto] fin du bloc pur ----

// Forçage de lecture : la trottinette répond par des acks « …0002 » qu'on ne sait PAS déchiffrer
// (prouvé le 2026-11-11 : même jeton+secrets appariés, 11 clés × compteurs 1-10 × 2 formats → rien,
// cf. tools/decode-mystery.mjs — la clé fait intervenir le secret INDEX=1 stocké côté trottinette).
// On tente quand même : clés de session de CHAQUE secret envoyé + courante + initiale × (f-XOR + compteurs voisins).
async function nbTryDecode(c, wire, log, secretsHex) {
  if (!wire || wire.length < 9 || wire[0] !== 0x5A || wire[1] !== 0xA5) return;
  const ctrIn = (wire[wire.length - 2] << 8) | wire[wire.length - 1];
  const body = wire.slice(3, wire.length - 6);
  const cles = [];
  for (let i = 0; i < (secretsHex || []).length; i++) cles.push(['session o1#' + (i + 1), await nbKey(fromHex(secretsHex[i]), c.token)]);
  cles.push(['courante', c.key], ['initiale', await nbKey(c.name, NB_FW)]);
  const cherche = out => { // motif d'un ack : [src, 0x3E, cmd, arg] — cmd juste APRÈS le 0x3E (bug d'offset corrigé)
    for (let i = 0; i + 3 <= out.length; i++)
      if (out[i] === 0x3E && [0x5B, 0x5C, 0x5D].includes(out[i + 1])) return { cmd: out[i + 1], arg: out[i + 2] };
    return null;
  };
  for (const [nom, cle] of cles) {
    const cc = Object.assign(Object.create(c), { key: cle });
    const essais = [];
    try { essais.push(['fXor', await cc.fXor(body)]); } catch {}
    for (let ctr = Math.max(1, ctrIn - 2); ctr <= ctrIn + 3; ctr++) { try { essais.push(['ctr ' + ctr, await cc.ctrBody(body, ctr)]); } catch {} }
    for (const [tag, out] of essais) {
      const m = cherche(out);
      if (m) { log(`  ← décodé ! clé ${nom} · ${tag} · cmd 0x${m.cmd.toString(16)} arg 0x${m.arg.toString(16)} — ce sont ces clé/compteur qu'il faut utiliser ici`); return; }
    }
  }
  log(`  ← trame indéchiffrable (corps ${body.length} o, queue ${toHex(wire.slice(-6))})`);
}

// ---------- Transport BLE : connexion + file de trames ----------
async function nbConnect(id, log) { // log facultatif (hex de chaque trame) pour l'écran d'association
  await BLE.connect({ deviceId: id, timeout: 15000 }); // le plugin y négocie déjà un MTU de 512 (max accepté par la trottinette)
  let chunk = 20;
  try { chunk = Math.max(20, (await BLE.getMtu({ deviceId: id })).value - 3); } catch {}
  log && log(`MTU négocié : ${chunk + 3} — trames jusqu'à ${chunk} octets d'un seul morceau` + (chunk < 29 ? ' ⚠ l’association (29 octets) sera fragmentée, risque d’échec' : ''));
  await BLE.getServices({ deviceId: id }); // certains Android en ont besoin avant startNotifications
  const t = { id, chunk, q: [], buf: [], lastTx: '', lost: false };
  t.hDisc = await BLE.addListener(`disconnected|${id}`, () => { t.lost = true; log && log('⚠ la trottinette a coupé la liaison'); });
  t.handle = await BLE.addListener(`notification|${id}|${NUS.svc}|${NUS.rx}`, ev => {
    t.buf.push(...fromHex(ev.value));
    for (;;) { // extraction des trames complètes : [5A A5 len] corps queue-de-13
      while (t.buf.length >= 2 && (t.buf[0] !== 0x5A || t.buf[1] !== 0xA5)) t.buf.shift();
      if (t.buf.length < 3) break;
      const n = t.buf[2] + 13;
      if (n < 13 || n > 517) { t.buf.shift(); continue; } // longueur aberrante : on resynchronise
      if (t.buf.length < n) break;
      const f = Uint8Array.from(t.buf.splice(0, n));
      if (toHex(f) !== t.lastTx) t.q.push(f); // on jette l'écho de notre propre écriture
    }
  });
  await BLE.startNotifications({ deviceId: id, service: NUS.svc, characteristic: NUS.rx });
  await sleep(200); // laisser l'abonnement notifications bien prendre avant l'étape 1 (cf. référence)
  t.send = async (wire, lg) => {
    const L = lg || log;
    t.lastTx = toHex(wire);
    if (wire.length > t.chunk) L && L(`⚠ trame de ${wire.length} octets : fragmentée en ${Math.ceil(wire.length / t.chunk)} écritures`);
    L && L('→ ' + toHex(wire));
    for (let o = 0; o < wire.length; o += t.chunk) {
      await BLE.write({ deviceId: id, service: NUS.svc, characteristic: NUS.tx, value: toHex(wire.slice(o, o + t.chunk)), timeout: 5000 });
    }
  };
  t.recv = async (ms, lg) => { // prochaine trame reçue, ou null après ms
    const L = lg || log;
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (t.q.length) { const f = t.q.shift(); L && L('← ' + toHex(f)); return f; } await sleep(15); }
    return null;
  };
  t.close = async () => { try { await t.hDisc.remove(); } catch {} try { await t.handle.remove(); } catch {} try { await BLE.disconnect({ deviceId: id }); } catch {} };
  return t;
}

// ---------- Poignée de main en 3 étapes (flot SHU, cf. pepperonas/zt3_cli/handshake.py) ----------
// PORTÉE VOLONTAIREMENT LIMITÉE : session établie pour LIRE (batterie, kilométrage…).
// Aucune commande de conduite (ni verrouillage, ni réglages, ni firmware).
async function nbHandshake(t, c, resume, log, onButton, variant, onAccepted) {
  if (variant && variant.hello) { // réplique du 1er fil réel SHU (Phase B/E2) : salut 0x5C VIDE, sans 0x5B préalable
    const h = Uint8Array.from([0x5A, 0xA5, 0x00, 0x3E, variant.dst || 0x04, 0x5C, 0x00]);
    for (let a = 0; a < 6 && !c.L; a++) {
      log(`salut 0x5C vide · essai ${a + 1} (compteur ${c.counter})`);
      await t.send(await c.encrypt(h));
      for (let i = 0; i < 15 && !c.L; i++) { const f = await t.recv(40); if (f) await nbParse(c, f); }
      if (!c.L) await sleep(300);
    }
    if (!c.L) throw new Error('salut sans réponse');
  }
  const etape1 = async () => {
    const s1 = c.buildGetRandom(0x04);
    for (let a = 0; a < 6 && !c.L && !t.lost; a++) {
      log(`étape 1 · essai ${a + 1} (compteur ${c.counter})`);
      await t.send(await c.encrypt(s1));
      for (let i = 0; i < 15 && !c.L; i++) { const f = await t.recv(40); if (f) await nbParse(c, f); }
      if (!c.L) await sleep(300);
    }
    if (!c.L) throw new Error('étape 1 : pas de réponse (trottinette allumée ? appli Segway fermée ?)');
  };
  await etape1();
  log(`étape 1 ✓ jeton reçu · série « ${hexAscii(toHex(c.challenge))} »${c.pwdStored ? ' · un secret est déjà enregistré (INDEX=' + c.pwdStored + '), le nouveau le remplacera' : ''}`);
  log('jeton de session : ' + toHex(c.token)); // en clair dans le rapport → décryptage hors-ligne possible
  const etape3 = async (nTries) => { // SHU D0() : écho de la série (0x5D) toutes les 500 ms jusqu'au 5D 01
    for (let a = 0; a < nTries && !c.O && !t.lost; a++) {
      await t.send(await nbWrap(c, 0x04, 0x5D, 0x00, c.challenge), l => log('  ' + l));
      const ta = Date.now();
      while (Date.now() - ta < 500 && !c.O) { const f = await t.recv(60, l => log('  ' + l)); if (f) await nbParse(c, f); }
    }
    log(c.O ? 'étape 3 ✓ appariement complet (5D 01)' : 'étape 3 sans réponse');
  };
  if (resume) {
    // Reprise par jeton (la clé est SHA1(secret‖jeton) : l'étape 1 a déjà rempli le jeton ci-dessus —
    // la vraie reprise Q0 « secret‖zéros SANS étape 1 » est testée à froid dans blePair, connexion vierge)
    await c.setRandomAppData(fromHex(resume)); c.M = true;
    log('reprise : 0x5D cpt0 (challenge zéro, clé secret‖jeton)…');
    // FIX 1.4.44 : cette trame partait SANS en-tête 5A A5 et avec len=0 malgré 14 octets de payload —
    // la trottinette ne pouvait pas la comprendre (le comparaison avec l'o1, qui marche, l'a révélé)
    const d0 = Uint8Array.from([0x5A, 0xA5, 0x0E, 0x3E, 0x04, 0x5D, 0x00, ...new Uint8Array(14)]);
    for (let a = 0; a < 3 && !c.O && !t.lost; a++) {
      await t.send(await c.encrypt(d0), l => log('  ' + l)); // compteur 0 → format cpt0, comme le vrai SHU
      const ta = Date.now();
      while (Date.now() - ta < 700 && !c.O) {
        const f = await t.recv(60, l => log('  ' + l)); if (!f) continue;
        const d = await nbParse(c, f);
        if (d && d.cmd === 0x5D && d.arg === 1) { c.O = true; c.M = true; log('  ← 5D 01 : reprise SHU confirmée ✓'); }
        else if (d) log('  ← réponse : cmd=0x' + d.cmd.toString(16) + ' arg=0x' + d.arg.toString(16));
      }
    }
    if (c.O) { log('reprise SHU complète ✓'); return true; }
    log('reprise SHU sans réponse — essai de la reprise par jeton (0x5B)…');
    await etape1();
    await c.setRandomAppData(fromHex(resume)); c.M = true; log('étape 2 ✓ reprise du secret avec le nouveau jeton');
    await etape3(6);
    if (c.O) return true;
    c.counter = 0; await c.deriveKey(c.name, c.token); c.M = false; // c6.c.j() : compteur à zéro + retour à l'état post-jeton
    log('reprise non confirmée — efface le secret, passage en appairage complet (comme SHU)');
  }
  // Secrets UNIQUES à chaque o1 (le pattern qui a été accepté 5 fois) — max 4 par connexion (limite firmware),
  // puis DISSECTION de la clé de session : quel secret la trottinette a-t-elle retenu ?
  log('étape 2 : enregistrement du secret (4 o1 cpt0, un secret différent chacun)…');
  onButton && onButton();
  let mFlag = false, asked = false, ackIllisible = 0;
  const envoyes = []; // les secrets envoyés (hex), dans l'ordre — on testera lequel a été retenu
  const envoi = async () => {
    const init = c.buildPairInit(0x04);
    const r = toHex(init.slice(7, 23));
    envoyes.push(r); c.random.set(init.slice(7, 23));
    log('  secret o1 #' + envoyes.length + ' (clair) : ' + r); // pour l'analyse hors-ligne depuis le rapport copié
    await t.send(await nbSeal0(await nbKey(c.name, c.token), init));
  };
  await envoi();
  const t1 = Date.now();
  let d2 = false, d3 = false, d4 = false;
  while (Date.now() - t1 < 30000 && !mFlag && !t.lost) {
    if (!d2 && Date.now() - t1 > 4000) { d2 = true; await envoi(); } // o1 #2, #3, #4 à +4/8/12 s (≤4 propositions par connexion)
    if (!d3 && Date.now() - t1 > 8000) { d3 = true; await envoi(); }
    if (!d4 && Date.now() - t1 > 12000) { d4 = true; await envoi(); }
    const f = await t.recv(60); if (!f) continue; // toute trame entrante est déjà journalisée par nbConnect
    let d = await nbParse(c, f);
    if (!d) { const r = await nbOpen0(await nbKey(c.name, c.token), f); if (r.ok && r.pt[4] === 0x3E && r.pt[5] === 0x5C) d = { cmd: 0x5C, arg: r.pt[6] }; }
    if (d && d.cmd === 0x5C) {
      if (d.arg === 1) { mFlag = true; log(`← 5C 01 : ACCEPTÉ ✓ (après ${envoyes.length} envois)`); }
      else if (!asked) { asked = true; log('⏺ 5C 00 : BASCULE LE PHARE (~toutes les 1-2 s) jusqu’à « ACCEPTÉ »…'); }
    } else if (!d || ![0x5B, 0x5C, 0x5D, 0x04, 0x01].includes(d.cmd)) {
      // ack illisible (les « …0002 ») : une trame au cmd inconnu « parse » quand même structurellement —
      // elle était jetée en silence avant. On la force sous toutes les clés, et SURTOUT on la compte :
      ackIllisible++;
      await nbTryDecode(c, f, log, envoyes);
    }
  }
  if (mFlag || ackIllisible) store.set('o1cand', [...new Set([...store.get('o1cand', []), ...envoyes])].slice(-12)); // acceptation OU ack : un de ces secrets est probablement stocké → la reprise À FROID de la prochaine session les testera
  if (!mFlag) { // jeton + secrets en clair dans le rapport : l'analyse hors-ligne ne dépend plus d'une nouvelle session
    log('jeton : ' + toHex(c.token) + ' · secrets proposés : ' + envoyes.join(' '));
    if (!ackIllisible) throw new Error('pas de 5C 01 sur cette connexion');
    // L'ack « …0002 » est indéchiffrable (clé inconnue — probablement le secret INDEX=1), MAIS s'il s'agit
    // d'un 5C 01 chiffré sous le secret retenu, une LECTURE sous ce secret répondra. La dissection qui suit
    // est notre juge de paix : lectures sous chaque secret envoyé → si l'une répond, la session est établie.
    log('⏺ ' + ackIllisible + ' ack' + (ackIllisible > 1 ? 's' : '') + ' illisible' + (ackIllisible > 1 ? 's' : '') + ' reçu' + (ackIllisible > 1 ? 's' : '') + ' — dissection quand même : si un secret a été retenu, une lecture batterie répondra');
  }
  // REPRISE-CANDIDATS : l'ack illisible signifiait peut-être « secret ENREGISTRÉ » (pas « accepté »).
  // Instance fraîche par candidat (jeton = zéros → clé SHA1(secret‖zéros), compteur 0 → cpt0).
  // ⚠ Limite constatée le 11/11 : sur une connexion où l'étape 1 a déjà eu lieu, ce test reste muet —
  // la version probante est la reprise À FROID (connexion vierge), faite dans blePair.
  if (!mFlag && ackIllisible && !t.lost) {
    log('reprise-candidats (même connexion — le vrai test est à froid à la prochaine tentative)…');
    const d0 = Uint8Array.from([0x5A, 0xA5, 0x0E, 0x3E, 0x04, 0x5D, 0x00, ...new Uint8Array(14)]);
    for (let i = envoyes.length - 1; i >= 0 && !c.O && !t.lost; i--) {
      const c2 = new NbCrypto(c.name); // jeton = zéros : la clé ne dépend que du secret
      await c2.ready; await c2.setRandomAppData(fromHex(envoyes[i])); c2.M = true;
      let conf = false;
      for (let a = 0; a < 2 && !conf && !t.lost; a++) {
        await t.send(await c2.encrypt(d0), l => log('  ' + l));
        const ta = Date.now();
        while (Date.now() - ta < 700 && !conf) {
          const f = await t.recv(60, l => log('  ' + l)); if (!f) continue;
          const d = await nbParse(c2, f);
          if (d && d.cmd === 0x5D && d.arg === 1) conf = true;
          else { const r = await nbOpen0(c2.key, f); if (r.ok && r.pt[4] === 0x3E && r.pt[5] === 0x5D && r.pt[6] === 1) conf = true; }
        }
      }
      log(conf ? `  ← 5D 01 : le secret o1 #${i + 1} EST ENREGISTRÉ sur la trottinette ✓` : `  secret o1 #${i + 1} : pas de reprise`);
      if (conf) { // ce secret est stocké côté trottinette : on l'adopte tout de suite
        await c.setRandomAppData(fromHex(envoyes[i])); c.M = true; c.O = true;
        onAccepted && onAccepted(envoyes[i]);
        log('secret enregistré identifié ✓ — la dissection confirmera la clé de lecture');
      }
    }
  }
  // DISSECTION DE LA CLÉ : quel secret envoyé la trottinette a-t-elle retenu ?
  const keyPre = await nbKey(c.name, c.token); // clé courante nom‖jeton
  const keyInit = await nbKey(c.name, NB_FW); // clé initiale nom‖sel
  await c.setRandomAppData(c.random); c.M = true; // pari : le dernier envoyé (vérifié juste après)
  const essaisCle = [c.random, ...envoyes.slice().reverse().filter(x => x !== toHex(c.random)).map(x => fromHex(x)), keyInit];
  const essaisNoms = ['dernier envoyé', ...envoyes.slice().reverse().filter(x => x !== toHex(c.random)).map((_, i) => 'envoi n°' + (envoyes.length - i)), 'clé initiale nom‖sel'];
  let trouve = null;
  for (let i = 0; i < essaisCle.length && !trouve; i++) {
    const kSess = await nbKey(essaisCle[i], c.token);
    log('dissection : lecture batterie sous la clé de session « ' + essaisNoms[i] + ' »…');
    const cc = Object.assign(Object.create(c), { key: kSess });
    for (const fmt of ['sn', 'cpt0']) {
      await t.send(fmt === 'sn'
        ? await nbWrap(cc, 0x16, 0x01, 0x55, Uint8Array.from([2]))
        : await nbSeal0(kSess, Uint8Array.from([0x5A, 0xA5, 0x01, 0x3E, 0x16, 0x01, 0x55, 0x02])), l => log('  ' + l)); // len=01 : le payload fait 1 octet (bug 02 depuis 1.4.23)
      if (cc !== c) c.counter = Math.max(c.counter, cc.counter); // anti-rejeu : le compteur SN ne doit jamais reculer entre candidats (leçon 1.4.27)
      const ta = Date.now(); let p = null;
      while (Date.now() - ta < 800 && !p) {
        const f = await t.recv(60, l => log('  ' + l)); if (!f) continue;
        const dd = await nbParse(cc, f); if (dd && dd.cmd === 0x04) { p = dd.payload; }
        if (!p) { const r = await nbOpen0(kSess, f); if (r.ok && r.pt[5] === 0x04) p = r.pt.slice(7); }
        if (p) log(`  ← RÉPONSE [${essaisNoms[i]} · ${fmt}] : ${(toHex(p).match(/../g) || []).join(' ')}`);
      }
      if (cc !== c) c.counter = Math.max(c.counter, cc.counter); // réceptions incluses : le compteur ne recule jamais
      if (p) { trouve = essaisCle[i]; break; }
    }
    if (trouve) break;
  }
  if (trouve) {
    await c.setRandomAppData(trouve); // on aligne la clé de session sur le secret retenu
    onAccepted && onAccepted(toHex(trouve));
    log('clé de session identifiée ✓ : ' + toHex(trouve));
  } else {
    log('aucune clé ne répond — la reprise tentera sa chance');
  }
  // 0x5D : essais dans les 4 combinaisons format × clé (SN-session seul avait été testé, jamais avec un 5C 01 valide !)
  const keyPreD = await nbKey(c.name, c.token); // clé courante nom‖jeton
  const keyInitD = await nbKey(c.name, NB_FW); // clé initiale nom‖sel
  const keySessD = await nbKey(c.random, c.token); // clé de session secret‖jeton
  const d05 = [
    ['SN · session secret‖jeton', 'sn', keySessD],
    ['SN · courante nom‖jeton', 'sn', keyPreD],
    ['cpt0 · courante nom‖jeton', 'cpt0', keyPreD],
    ['cpt0 · initiale nom‖sel', 'cpt0', keyInitD]
  ];
  for (const [lab, fmt, cle] of d05) {
    if (c.O) break;
    log('étape 3 · essai 0x5D ' + lab + '…');
    const cc = fmt === 'sn' ? Object.assign(Object.create(c), { key: cle }) : c;
    for (let a = 0; a < 2 && !c.O && !t.lost; a++) {
      await t.send(fmt === 'sn'
        ? await nbWrap(cc, 0x04, 0x5D, 0x00, c.challenge)
        : await nbSeal0(cle, Uint8Array.from([0x5A, 0xA5, 0x0E, 0x3E, 0x04, 0x5D, 0x00, ...c.challenge])), l => log('  ' + l));
      const ta = Date.now();
      while (Date.now() - ta < 700 && !c.O) {
        const f = await t.recv(60, l => log('  ' + l)); if (!f) continue;
        let d = await nbParse(cc, f);
        if (!d && fmt === 'cpt0') { const r = await nbOpen0(cle, f); if (r.ok && r.pt[4] === 0x3E && r.pt[5] === 0x5D) { c.O = true; c.M = true; log('  ← 5D ' + r.pt[6] + ' déchiffré (cpt0 ' + lab + ') ✓'); } }
        if (!c.O && d && d.cmd === 0x5D && d.arg === 1) { c.O = true; log('  ← 5D 01 déchiffré (' + lab + ') ✓'); }
      }
      if (cc !== c) c.counter = Math.max(c.counter, cc.counter); // anti-rejeu ici aussi
    }
    if (c.O) { log('étape 3 ✓ appariement complet — LA BONNE COMBINAISON ÉTAIT : ' + lab); break; }
  }
  if (!c.O) await etape3(6); // dernier recours : SN session en boucle
  if (!c.O) log('étape 3 non confirmée — les lectures tentent, puis la reprise confirmera');
  if (!c.L) log('jeton absent — la reconnexion en mode reprise s’en chargera');
  else {
    // DISSECTION : quelle combinaison format × clé fait répondre la trottinette ?
    const keyPre = await nbKey(c.name, c.token); // clé courante nom‖jeton
    const keyInit = await nbKey(c.name, NB_FW); // clé initiale nom‖sel
    const keySess = await nbKey(c.random, c.token); // clé de session secret‖jeton
    const essaisLecture = [
      ['cpt0 · clé courante nom‖jeton', 'cpt0', keyPre, 0x16],
      ['SN · clé de session secret‖jeton', 'sn', keySess, 0x16],
      ['cpt0 · clé initiale nom‖sel', 'cpt0', keyInit, 0x16],
      ['SN · clé courante nom‖jeton', 'sn', keyPre, 0x16],
      ['cpt0 · clé initiale → carte BLE 0x04', 'cpt0', keyInit, 0x04]
    ];
    for (const [lab, fmt, cle, board] of essaisLecture) {
      log('essai lecture batterie · ' + lab + '…');
      const cc = Object.assign(Object.create(c), { key: cle });
      await t.send(fmt === 'cpt0'
        ? await nbSeal0(cle, Uint8Array.from([0x5A, 0xA5, 0x01, 0x3E, board, 0x01, 0x55, 0x02])) // len=01 : payload 1 octet (bug 02 depuis 1.4.23)
        : await nbWrap(cc, board, 0x01, 0x55, Uint8Array.from([2])), l => log('  ' + l));
      const t0 = Date.now(); let vu = null;
      while (Date.now() - t0 < 900 && !vu) {
        const f = await t.recv(60, l => log('  ' + l)); if (!f) continue;
        let p = null;
        const d = await nbParse(c, f); if (d && d.cmd === 0x04) p = d.payload;
        if (!p) { const r = await nbOpen0(cle, f); if (r.ok && r.pt[5] === 0x04) p = r.pt.slice(7); }
        if (p) { vu = p; log(`  ← RÉPONSE [${lab}] : ${(toHex(p).match(/../g) || []).join(' ')}`); }
      }
      if (vu) break;
    }
    log('fin de la dissection — la reprise tentera les lectures confirmées');
  }
  if (!c.M) throw new Error('étape 2 : pas de confirmation');
  if (!mFlag && !c.O && !trouve) throw new Error('ack illisible sans confirmation : ni lecture ni 5D n’ont répondu — la fenêtre ne s’est sans doute pas ouverte (bascules du phare dès le DÉBUT de la fenêtre, pas après l’invite)');
  return true;
}

// ---------- Registres ZT3 Pro (dst 0x16 = VCU, 0x07 = BMS) — échelles : pepperonas/zt3-ble-register-reference ----------
const u16 = p => p[0] | p[1] << 8, s16 = p => { const v = u16(p); return v >= 0x8000 ? v - 0x10000 : v; };
const u32 = p => (p[0] | p[1] << 8 | p[2] << 16 | p[3] << 24) >>> 0;
const nb1 = n => n.toFixed(1).replace('.', ',');
const ZT3_MODES = { 1: 'Éco', 2: 'Standard', 3: 'Sport', 4: 'Marche' };
const ZT3_REGS = [
  { d: 0x16, r: 0x55, n: 2, k: 'battery', lab: 'Batterie', dec: p => p[0] + ' %' },
  { d: 0x16, r: 0x57, n: 2, k: 'speed', lab: 'Vitesse', dec: p => nb1(u16(p) / 10) + ' km/h' },
  { d: 0x16, r: 0x5F, n: 2, k: 'range', lab: 'Autonomie', dec: p => nb1(u16(p) / 100) + ' km' },
  { d: 0x16, r: 0x62, n: 4, k: 'odometer', lab: 'Km total', dec: p => u32(p).toLocaleString('fr-FR') + ' km' },
  { d: 0x16, r: 0x68, n: 4, k: 'trip', lab: 'Dernier trajet', dec: p => u32(p).toLocaleString('fr-FR') + ' km' },
  { d: 0x16, r: 0x5A, n: 2, k: 'mode', lab: 'Mode', dec: p => ZT3_MODES[p[0]] || 'Mode ' + p[0] },
  { d: 0x16, r: 0x6B, n: 2, k: 'temp', lab: 'Température', dec: p => nb1(s16(p) / 10) + ' °C' },
  { d: 0x07, r: 0x8C, n: 2, k: 'volt', lab: 'Tension', dec: p => nb1(u16(p) / 100) + ' V' },
  { d: 0x07, r: 0x8D, n: 2, k: 'amp', lab: 'Courant', dec: p => nb1(s16(p) / 100) + ' A' },
  { d: 0x07, r: 0x8F, n: 2, k: 'soc', lab: 'Charge BMS', dec: p => p[0] + ' %' },
  { d: 0x07, r: 0x8E, n: 2, k: 'health', lab: 'Santé batt.', dec: p => p[0] + ' %' },
  { d: 0x07, r: 0x96, n: 4, k: 'tempBms', lab: 'Temp. batt.', dec: p => p[0] + ' °C' }
];
async function nbReadReg(t, c, dst, reg, n, lg) { // lecture cmd 0x01 → réponse cmd 0x04 (≈600 ms de patience)
  if (t.lost) return null;
  await t.send(await nbWrap(c, dst, 0x01, reg, Uint8Array.from([n])), lg);
  const t0 = Date.now();
  while (Date.now() - t0 < 600) {
    const f = await t.recv(50, lg); if (!f) continue;
    const d = await nbParse(c, f);
    if (d && d.cmd === 0x04 && d.arg === reg && d.src === dst) return d.payload;
  }
  return null;
}

// ---------- Moteur de session : connexion auto au trajet, relevés, mémorisation ----------
const sc = {
  state: 'off', data: store.get('scooterData', null), t: null, c: null, timer: null, fails: 0, busy: false,
  panel: null, renderHook: null, log: [],
  stored() { const s = store.get('scooter', null); return !!(s && s.id); },
  say(l) { this.log.push(new Date().toLocaleTimeString('fr-FR') + ' · ' + l); if (this.log.length > 80) this.log.shift(); this.render(); },
  render() {
    const cell = $('batCell');
    if (cell) {
      cell.hidden = !this.stored();
      const b = this.data && this.data.battery, pct = b ? parseInt(b.v, 10) : null;
      $('batPct').textContent = pct != null ? pct : '–';
      $('batFill').style.width = pct != null ? Math.max(6, Math.min(100, pct)) + '%' : '0%';
      cell.classList.toggle('low', pct != null && pct <= 15);
      cell.classList.toggle('live', this.state === 'live');
      cell.title = this.state === 'live' ? 'Trottinette connectée (batterie en direct)' : 'Batterie : dernier relevé connu';
    }
    this.renderHook && this.renderHook();
  },
  async connect(quiet, sink) {
    if (!BLE || !this.stored() || this.state === 'connecting') return this.state === 'live';
    if (this.state === 'live') { this.startLoop(); return true; }
    const rec = store.get('scooter');
    const say = m => { this.say(m); sink && sink(m); };
    this.state = 'connecting'; this.fails = 0; this.render();
    try {
      await BLE.initialize({ androidNeverForLocation: true });
      const t = await nbConnect(rec.id, null);
      const c = new NbCrypto(rec.name || 'ZT3');
      say('reprise : connexion…');
      await nbHandshake(t, c, rec.random || rec.password, say); // « password » = anciens enregistrements
      store.set('scooter', { ...rec, random: toHex(c.random) });
      this.t = t; this.c = c; this.state = 'live'; this.swept = false; say('connectée ✓'); this.render();
      this.startLoop(); this.poll();
      return true;
    } catch (e) {
      this.err = e && (e.message || e.errorMessage) || String(e);
      say('connexion impossible : ' + this.err);
      if (this.t) { try { await this.t.close(); } catch {} this.t = null; }
      this.state = 'error'; this.render();
      if (!quiet) toast('Trottinette injoignable 🛴');
      return false;
    }
  },
  async sweep() { // diagnostic : même registre sur toutes les cartes + registres classiques — dit si QUELQUE CHOSE répond
    const tries = [[0x16, 0x55, 2], [0x16, 0x57, 2], [0x02, 0x86, 2], [0x07, 0x8F, 2], [0x04, 0x55, 2], [0x16, 0xB5, 2], [0x16, 0x26, 2], [0x16, 0xB7, 4], [0x09, 0x55, 2], [0x01, 0x55, 2]];
    const say = m => this.say(m);
    let ok = 0;
    for (const [d, r, n] of tries) {
      const p = await nbReadReg(this.t, this.c, d, r, n, say);
      if (p) { ok++; say(`✓ carte 0x${d.toString(16).padStart(2, '0')} reg 0x${r.toString(16).padStart(2, '0')} → ${(toHex(p).match(/../g) || []).join(' ')}`); }
      await sleep(80);
    }
    say(ok ? `balayage : ${ok}/${tries.length} ont répondu ✓` : 'balayage : AUCUNE carte n’a répondu — la clé de session ne correspond pas côté trottinette');
    return ok;
  },
  async poll(fast) { // fast = batterie + vitesse seulement
    if (this.state !== 'live' || !this.t || this.busy) return;
    this.busy = true;
    try {
      if (!this.swept) { this.swept = true; await this.sweep(); if (this.state !== 'live') return; }
      const regs = fast ? ZT3_REGS.filter(r => r.k === 'battery' || r.k === 'speed') : ZT3_REGS;
      let got = 0;
      for (const r of regs) {
        const p = await nbReadReg(this.t, this.c, r.d, r.r, r.n);
        if (p && p.length) { this.data = this.data || {}; this.data[r.k] = { v: r.dec(p), hex: toHex(p) }; got++; }
        await sleep(60); // cadence douce, comme SHU
      }
      if (got) { this.data.t = Date.now(); store.set('scooterData', this.data); this.fails = 0; this.render(); }
      else if (++this.fails >= 3) throw new Error('plus aucune réponse');
    } catch (e) {
      if (this.state === 'live' && ++this.fails >= 3) { // trottinette éteinte / hors portée
        this.say('liaison perdue (' + (e.message || e) + ')');
        this.state = 'off'; await this.stop(); this.render();
      }
    } finally { this.busy = false; }
  },
  startLoop() {
    this.stopLoop(); let n = 0;
    this.timer = setInterval(() => {
      n++;
      if (this.state !== 'live' || this.busy) return;
      const fast = ride.active || !!this.panel; // en trajet ou panneau ouvert : vitesse en direct
      if (fast ? n % 6 === 0 : n % 4 === 0) this.poll(); else if (fast) this.poll(true);
    }, 500);
  },
  stopLoop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },
  async stop() { this.stopLoop(); this.state = 'off'; if (this.t) { try { await this.t.close(); } catch {} this.t = null; } },
  async forget() { await this.stop(); this.state = 'off'; this.data = null; store.del('scooter'); store.del('scooterData'); this.render(); }
};

// ---------- Panneau « Ma trottinette » (dans Mes kilomètres) ----------
const scStateLabel = () => ({ connecting: 'connexion…', live: 'en direct ✓', error: 'injoignable' }[sc.state] || (sc.data ? 'dernier relevé' : 'jamais connectée'));
const scCell = r => { const d = sc.data && sc.data[r.k]; return `<div><b>${d ? d.v : '–'}</b><small>${r.lab}</small>${d ? `<code>${(d.hex.match(/../g) || []).join(' ')}</code>` : ''}</div>`; };
function scPanelHtml() {
  if (!sc.stored()) return `<button class="btn sec" id="pairBtn" style="margin-bottom:10px">🛴 Associer ma trottinette (Bluetooth)</button>
    <div class="about">Batterie, kilométrage et vitesse de ta trottinette Segway-Ninebot, en lecture seule, affichés ici et pendant tes trajets.</div>`;
  const s = store.get('scooter');
  return `<div class="scpanel">
    <div class="schead"><b>🛴 ${esc(s.name || 'Ma trottinette')}</b><span id="scState">${scStateLabel()}</span></div>
    <div class="scgrid" id="scGrid">${ZT3_REGS.map(scCell).join('')}</div>
    <div class="btns" style="margin-top:10px"><button class="btn sec" id="scGo">${sc.state === 'live' ? 'Actualiser' : 'Connecter'}</button><button class="btn sec" id="scForget">Oublier</button></div>
    <details class="sclog"><summary>Journal technique</summary><pre id="scLogPre">${sc.log.join('\n') || '—'}</pre></details>
    <details class="sclog"><summary>Outils de diagnostic</summary><button class="btn sec" id="bleBtn" style="margin-top:8px">🔵 Diagnostic Bluetooth (lecture seule)</button><button class="btn sec" id="sxBtn" style="margin-top:8px">🧪 Tester un secret (hex d'un rapport)</button></details>
  </div>`;
}
function scPanelWire(m) {
  const pair = m.querySelector('#pairBtn');
  if (pair) { pair.onclick = () => blePair(); return; }
  sc.panel = m;
  if (sc.state === 'live') sc.startLoop();
  sc.renderHook = () => { // rafraîchit le panneau tant qu'il est ouvert (s'il a été remplacé par un autre modal : on se débranche)
    const g = m.querySelector('#scGrid');
    if (!document.body.contains(m) || m.hidden || !g) { sc.panel = null; sc.renderHook = null; return; }
    g.innerHTML = ZT3_REGS.map(scCell).join('');
    const ago = sc.data && sc.data.t ? ' · vu ' + new Date(sc.data.t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
    const st = m.querySelector('#scState'); if (st) st.textContent = scStateLabel() + ago;
    const pre = m.querySelector('#scLogPre'); if (pre) pre.textContent = sc.log.join('\n') || '—';
  };
  m.querySelector('#scGo').onclick = async e => {
    if (sc.state === 'live') { e.target.textContent = '…'; await sc.poll(); e.target.textContent = 'Actualiser'; }
    else { e.target.textContent = 'Connexion…'; await sc.connect(); e.target.textContent = sc.state === 'live' ? 'Actualiser' : 'Connecter'; }
  };
  m.querySelector('#scForget').onclick = async e => {
    if (e.target.dataset.c) { await sc.forget(); $('statsBtn').onclick(); }
    else { e.target.textContent = 'Confirmer ?'; e.target.dataset.c = '1'; setTimeout(() => { e.target.textContent = 'Oublier'; delete e.target.dataset.c; }, 2500); }
  };
  const diag = m.querySelector('#bleBtn'); diag && (diag.onclick = () => bleDiag());
  const sx = m.querySelector('#sxBtn'); sx && (sx.onclick = () => bleTestSecret());
  sc.render();
}

// Affiche un bouton d'étape dans le journal d'association et attend son appui :
// le rythme doit rester humain — la trottinette doit être remise à plat (phare éteint) entre deux tentatives.
const waitBtn = (m, sel) => new Promise(r => { const b = m.querySelector(sel); b.hidden = false; b.onclick = () => { b.hidden = true; b.onclick = null; r(); }; });

// ---------- Association d'une nouvelle trottinette (flot SHU complet, avec journal) ----------
async function blePair() {
  const m = openModal(`<h3>🛴 Associer ma trottinette</h3><div class="about" style="margin-top:-6px">Allume la trottinette, ferme l’appli Segway, garde-la à portée. Un appui bref sur son bouton d’allumage peut être demandé. Trotti ne pilote jamais la trottinette : association et lectures uniquement.</div>
    <pre id="bleLog" class="blelog"></pre><button class="btn main" id="bleNext" hidden style="margin:10px 0">Trottinette prête (phare éteint) →</button><button class="btn sec" id="bleCopy" style="margin:10px 0" hidden>Copier le rapport</button><button class="btn main" data-close>Fermer</button>`);
  const pre = m.querySelector('#bleLog'), lines = [`Trotti v${V} · association · ${new Date().toLocaleString('fr-FR')}`];
  const log = t => { lines.push(t); pre.textContent = lines.join('\n'); pre.scrollTop = pre.scrollHeight; };
  m.querySelector('#bleCopy').onclick = async e => { try { await navigator.clipboard.writeText(lines.join('\n')); e.target.textContent = 'Rapport copié ✓'; } catch { e.target.textContent = 'Copie impossible : fais une capture'; } };
  if (!BLE) { log('Bluetooth indisponible : installe la dernière version de l’APK Trotti.'); m.querySelector('#bleCopy').hidden = false; return; }
  let t = null;
  try {
    await BLE.initialize({ androidNeverForLocation: true });
    log('Choisis ta trottinette dans la liste… (SHU et l’appli Segway bien FERMÉES : la liaison Bluetooth est exclusive)');
    const dev = await BLE.requestDevice({});
    const id = dev.deviceId, name = dev.name || 'ZT3';
    log(`Appareil : ${name}  [${id}]`);
    let ok = false, coldDone = false; // la reprise à froid doit partir dès la 1re connexion QUI S'ÉTABLIT (les 133 peuvent manger les premières tentatives)
    for (let essai = 1; essai <= 4 && !ok; essai++) { // jusqu'à 4 connexions fraîches — 4 o1 max par connexion (limite firmware ~5)
      if (essai > 1) { // avant : 1,5 s seulement → le phare restait allumé et la tentative était condamnée d'office (règle 4 du dossier)
        log(`\n— tentative ${essai}/4 (protocole ${essai <= 2 ? 'A · 1 appui laisse allumé' : 'B · bascules rythmées'}) — ÉTEINS le phare, attends 2 s, puis valide ci-dessous —`);
        await waitBtn(m, '#bleNext');
        await sleep(1500);
      }
      try {
        t = await nbConnect(id, h => log(h));
        // REPRISE À FROID (Q0 authentique) : connexion vierge, SANS étape 1 → la clé
        // SHA1(secret‖zéros) n'existe qu'avant tout 5B. Si l'ack illisible des sessions
        // précédentes était un « secret ENREGISTRÉ », un de ces candidats répondra 5D 01.
        // Du PLUS RÉCENT au plus ancien : le gagnant probable est en tête.
        // (1.4.45 ratait ce balayage si la tentative 1 mourait en GATT 133 — corrigé.)
        const cands = coldDone ? [] : store.get('o1cand', []);
        coldDone = true;
        for (let ci = 0; ci < cands.length && !ok && !t.lost; ci++) {
          const cand = cands[cands.length - 1 - ci];
          const cr = new NbCrypto(name); await cr.ready; await cr.setRandomAppData(fromHex(cand)); cr.M = true;
          const d0 = Uint8Array.from([0x5A, 0xA5, 0x0E, 0x3E, 0x04, 0x5D, 0x00, ...new Uint8Array(14)]);
          let conf = false;
          for (let a = 0; a < 2 && !conf && !t.lost; a++) {
            await t.send(await cr.encrypt(d0), l => log('  ' + l));
            const ta = Date.now();
            while (Date.now() - ta < 700 && !conf) {
              const f = await t.recv(60, l => log('  ' + l)); if (!f) continue;
              const d = await nbParse(cr, f);
              if (d && d.cmd === 0x5D && d.arg === 1) conf = true;
              else { const r = await nbOpen0(cr.key, f); if (r.ok && r.pt[4] === 0x3E && r.pt[5] === 0x5D && r.pt[6] === 1) conf = true; }
            }
          }
          log(conf ? `← 5D 01 À FROID ✓✓ le secret ${cand.slice(0, 8)}… est bien celui stocké dans la trottinette` : `  candidat ${ci + 1}/${cands.length} (à froid, du plus récent) : rien`);
          if (conf) { // secret récupéré : session en direct immédiatement, plus besoin d'appairer
            store.set('scooter', { name, id, random: cand }); store.del('o1cand');
            log('secret récupéré — session en direct…');
            await sc.stop(); sc.t = t; sc.c = cr; sc.state = 'live'; sc.swept = false; sc.render(); sc.startLoop(); await sc.poll();
            t = null; ok = true;
            log('\nC’est prêt : les infos s’affichent dans « Mes kilomètres » et pendant tes trajets 🛴');
          }
        }
        if (cands.length && !ok) log('reprise à froid : aucun candidat confirmé — appairage normal…');
        if (!ok) {
        const c = new NbCrypto(name);
        // A/B geste (archéologie git 11/11 : le chemin pré-acceptation est IDENTIQUE octet par octet
        // à la 1.4.38 des 6 acceptations — seule l'invite, donc le GESTE, diffère depuis 1.4.42).
        // Protocole A = le texte affiché PENDANT les 6 acceptations (« 1 appui puis laisse allumé »).
        const invite = essai <= 2
          ? '\n⏺ Protocole A (celui des 6 acceptations) : phare ÉTEINT maintenant. Dès cet instant : UN SEUL appui (le phare s’allume) puis N’Y TOUCHE PLUS — laisse-le ALLUMÉ jusqu’à « ACCEPTÉ ».\n'
          : '\n⏺ Protocole B (contrôle) : bascule le PHARE en rythme ON/OFF toutes les 1-2 s, sans t’arrêter, jusqu’à « ACCEPTÉ ».\n';
        await nbHandshake(t, c, null, l => log('  ' + l), () => log(invite), null, () => store.set('scooter', { name, id, random: toHex(c.random) })); // le secret est sauvé DÈS le 5C 01
        store.set('scooter', { name, id, random: toHex(c.random) }); // le secret est accepté : on le retient tout de suite
        // La connexion d'appairage ne sert JAMAIS les lectures (constaté sur 5 sessions) —
        // comme SHU : on déconnecte, on souffle, et on reprend en mode reprise (le chemin éprouvé).
        log('secret accepté ✓ — déconnexion puis reprise pour les lectures…');
        try { await t.close(); } catch {} t = null;
        await sleep(6000); // la trottinette doit souffler après ~60 trames : les reprises à +3 s ont mangé deux 133 le 11/11
        let lu = 0;
        for (const pause of [0, 15000]) { // 2 tentatives, la 2ᵉ bien après le souffle
          if (pause) { log('nouvelle tentative de reprise dans 4 s…'); await sleep(pause); }
          if (await sc.connect(true, l => log('  ' + l))) {
            await sleep(1200); await sc.poll();
            if (sc.data && (sc.data.battery || sc.data.odometer)) {
              lu = 1;
              log('Batterie : ' + (sc.data.battery || sc.data.odometer).v + (sc.data.battery && sc.data.odometer ? ' · Km total : ' + sc.data.odometer.v : ''));
            }
            if (lu) break;
          }
          await sc.stop();
        }
        if (!lu) throw new Error('la reprise n’a pas abouti — vois les lignes « reprise » ci-dessus (ou tape « Connecter » dans le panneau plus tard)');
        log('\nSession confirmée ✓ Trotti est associée à ta trottinette.');
        if (t) { // session directe : on la transfère au moteur
          await sc.stop(); sc.t = t; sc.c = c; sc.state = 'live'; sc.data = sc.data || {}; sc.startLoop(); sc.poll(); sc.render();
          t = null;
        }
        ok = true;
        log('\nC’est prêt : les infos s’affichent dans « Mes kilomètres » et pendant tes trajets 🛴');
        }
      } catch (e) {
        const msg = e && (e.message || e.errorMessage) || String(e);
        log('\nÉchec : ' + msg);
        if (/133|timeout/i.test(msg)) log('(éteins puis rallume la trottinette, attends 10 s, puis relance l’association)');
        if (t) { try { await t.close(); } catch {} t = null; }
        if (essai === 3) {
          log('Envoie-moi ce rapport (bouton Copier) pour que j’ajuste.');
          log('Plan B si ça bloque encore : un ancien secret est peut-être resté sur la trottinette (INDEX=1) — une réinitialisation d’usine depuis l’appli Segway officielle l’efface, puis relance l’association.');
        }
      }
    }
  } catch (e) {
    log('\nErreur : ' + (e && (e.message || e.errorMessage) || JSON.stringify(e)));
  } finally {
    if (t) { try { await t.close(); } catch {} }
    m.querySelector('#bleCopy').hidden = false;
  }
}

// ---------- Tester un secret (hex collé depuis un rapport) : trancher QUEL secret la trottinette a stocké ----------
// Cas d'usage : l'acceptation 5C 01 n'identifie pas le secret retenu (l'ack peut répondre à l'o1 #3 ou #4).
// Test À FROID (connexion vierge, sans étape 1, clé SHA1(secret‖zéros), 0x5D cpt0 challenge vide) :
// si la trottinette a stocké CE secret, elle répond 5D 01 → on l'adopte et la session s'établit.
async function bleTestSecret() {
  const rec = store.get('scooter'); if (!rec) return toast('Associe d’abord la trottinette');
  const m = openModal(`<h3>🧪 Tester un secret</h3><div class="about" style="margin-top:-6px">Colle un secret o1 (32 caractères hex) copié d'un rapport d'association — en priorité ceux envoyés juste avant un « 5C 01 : ACCEPTÉ ». Test à froid sur connexion vierge : si la trottinette l'a stocké, elle répondra 5D 01 et la session s'établira.</div>
    <input id="sx" autocomplete="off" spellcheck="false" style="width:100%;font:14px ui-monospace,monospace;padding:11px;border-radius:12px;border:1px solid var(--bd);background:var(--chip);color:var(--fg)" placeholder="ex. 22b21066a8673029beb07d39657cd4de">
    <pre id="bleLog" class="blelog"></pre><button class="btn main" id="sxGo" style="margin:10px 0">Tester ce secret</button><button class="btn sec" data-close>Fermer</button>`);
  const pre = m.querySelector('#bleLog');
  const log = t => { pre.textContent += t + '\n'; pre.scrollTop = pre.scrollHeight; };
  if (!BLE) return log('Bluetooth indisponible : installe le dernier APK.');
  m.querySelector('#sxGo').onclick = async () => {
    const hex = m.querySelector('#sx').value.trim().replace(/[\s,;]+/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hex)) return log('✗ il faut exactement 32 caractères hex (16 octets)');
    try {
      await BLE.initialize({ androidNeverForLocation: true });
      log('connexion à ' + (rec.name || 'la trottinette') + '…');
      const t = await nbConnect(rec.id, h => log(h));
      const c = new NbCrypto(rec.name || 'ZT3'); await c.ready; await c.setRandomAppData(fromHex(hex)); c.M = true;
      const d0 = Uint8Array.from([0x5A, 0xA5, 0x0E, 0x3E, 0x04, 0x5D, 0x00, ...new Uint8Array(14)]);
      let conf = false;
      for (let a = 0; a < 2 && !conf && !t.lost; a++) {
        await t.send(await c.encrypt(d0), h => log('  ' + h));
        const ta = Date.now();
        while (Date.now() - ta < 700 && !conf) {
          const f = await t.recv(60, h => log('  ' + h)); if (!f) continue;
          const d = await nbParse(c, f);
          if (d && d.cmd === 0x5D && d.arg === 1) conf = true;
          else { const r = await nbOpen0(c.key, f); if (r.ok && r.pt[4] === 0x3E && r.pt[5] === 0x5D && r.pt[6] === 1) conf = true; }
        }
      }
      // Phase 2 — PAR JETON (le chemin qui a produit des 5D 01 historiquement, cf. dossier §3) :
      // étape 1 (jeton frais) puis 0x5D sous SHA1(secret‖jeton) en 4 combinaisons format × challenge.
      if (!conf) {
        log('\npas de réponse à froid — test par jeton (étape 1, puis 0x5D sous secret‖jeton)…');
        try { await t.close(); } catch {}
        await sleep(1500);
        try {
          t = await nbConnect(rec.id, h => log(h));
          const c2 = new NbCrypto(rec.name || 'ZT3');
          const s1 = c2.buildGetRandom(0x04);
          for (let a = 0; a < 3 && !c2.L && !t.lost; a++) {
            await t.send(await c2.encrypt(s1), h => log('  ' + h));
            const ta = Date.now();
            while (Date.now() - ta < 500 && !c2.L) { const f = await t.recv(60, h => log('  ' + h)); if (f) await nbParse(c2, f); }
            if (!c2.L) await sleep(300);
          }
          if (!c2.L) log('étape 1 sans réponse — power-cycle de la trottinette puis réessaie');
          else {
            log('étape 1 ✓ jeton reçu — 0x5D sous SHA1(secret‖jeton), 4 combinaisons…');
            await c2.setRandomAppData(fromHex(hex)); c2.M = true;
            const z14 = new Uint8Array(14);
            const probes = [
              ['SN · challenge zéros', () => nbWrap(c2, 0x04, 0x5D, 0x00, z14)],
              ['cpt0 · challenge zéros', () => nbSeal0(c2.key, Uint8Array.from([0x5A, 0xA5, 0x0E, 0x3E, 0x04, 0x5D, 0x00, ...z14]))],
              ['SN · série', () => nbWrap(c2, 0x04, 0x5D, 0x00, c2.challenge)],
              ['cpt0 · série', () => nbSeal0(c2.key, Uint8Array.from([0x5A, 0xA5, 0x0E, 0x3E, 0x04, 0x5D, 0x00, ...c2.challenge]))]
            ];
            for (const [lab, mk] of probes) {
              if (conf || t.lost) break;
              log('0x5D · ' + lab + '…');
              await t.send(await mk(), h => log('  ' + h));
              const ta = Date.now();
              while (Date.now() - ta < 800 && !conf) {
                const f = await t.recv(60, h => log('  ' + h)); if (!f) continue;
                const d = await nbParse(c2, f);
                if (d && d.cmd === 0x5D && d.arg === 1) conf = true;
                else { const r = await nbOpen0(c2.key, f); if (r.ok && r.pt[4] === 0x3E && r.pt[5] === 0x5D && r.pt[6] === 1) conf = true; }
              }
            }
          }
        } catch (e) { log('connexion impossible : ' + (e && (e.message || e.errorMessage) || String(e)) + ' — power-cycle puis réessaie'); }
      }
      if (conf) {
        log('\n5D 01 ✓✓ CE SECRET EST STOCKÉ DANS LA TROTTINETTE — adoption et session…');
        store.set('scooter', { ...rec, random: hex });
        try { await t.close(); } catch {}
        await sleep(2000);
        await sc.connect(false, x => log(x));
      } else {
        log('\naucune combinaison n’a répondu — ce secret n’est probablement pas celui stocké (mais un module BLE coincé produit le même silence : éteins/rallume la trottinette et réessaie avant de conclure)');
        try { await t.close(); } catch {}
      }
    } catch (e) { log('\nErreur : ' + (e && (e.message || e.errorMessage) || String(e)) + '\n(133 → éteins/rallume la trottinette, attends 10 s)'); }
  };
}

// ---------- signalements ----------
let cache = [];
const reportTtl = t => (t === 'works' || t === 'police' ? CFG.reportTtlH : 30 * 24) * 3600e3; // travaux/contrôles : 48 h ; nids-de-poule, pavés, dangers, pistes : 30 jours
function loadReports() {
  const local = store.get('reports', []);
  return [...cache, ...local].filter(r => REPORT_TYPES[r.type] && Date.now() - r.t < reportTtl(r.type));
}
async function fetchReports() {
  if (!CFG.server || document.hidden) return; // pas de polling en arrière-plan (batterie)
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
if (old && old.dist > 20) {            // trajet interrompu (appli fermée) : on le garde dans les totaux et l'historique
  const s = { km: old.dist / 1000, secs: Math.max(1, (old.saved - old.t0) / 1000), avg: old.moving > 5 ? old.dist / old.moving * 3.6 : 0, max: old.max };
  addTotals(s); pushRide(s, old.saved, []); setTimeout(() => showSummary(s, false), 1500);
}
store.del('ride');
setState('idle');
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js').catch(() => {});
window.__ok = true;
})();
