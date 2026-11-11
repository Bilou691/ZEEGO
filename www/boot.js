// Trotti – chargeur + mise à jour automatique.
// Au lancement : on démarre tout de suite la version connue (embarquée ou téléchargée),
// puis on vérifie sur GitHub s'il y a mieux. Une mise à jour (app.js + style.css) est
// téléchargée en arrière-plan et appliquée aussitôt, sauf pendant un trajet.
// Si le code reçu plante au démarrage, on revient automatiquement à la version embarquée.
(() => {
  const SHELL_REV = 2;          // révision du « socle » (APK) : à incrémenter si boot.js / index.html / Android changent
  const BUNDLED_V = '1.4.2';    // version de app.js + style.css embarqués dans l'APK
  const BASE = 'https://raw.githubusercontent.com/Bilou691/ZEEGO/main/www/';
  const KEY = 'trotti.bundle', TRIED = 'trotti.badbundle';

  const cmp = (a, b) => {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
    return 0;
  };
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const boot = window.TrottiBoot = { version: BUNDLED_V, shell: SHELL_REV, pending: null, apk: null, reload: () => location.reload() };

  let stored = read();
  if (stored && (cmp(stored.v, BUNDLED_V) <= 0 || !stored.js || !stored.css)) stored = null; // l'APK est plus récent
  let ota = false;
  if (stored && sessionStorage.getItem(TRIED) === stored.v) { localStorage.removeItem(KEY); stored = null; }

  function run(js) { const s = document.createElement('script'); if (js) s.textContent = js; else s.src = 'app.js'; document.body.appendChild(s); }
  if (stored) {
    ota = true; boot.version = stored.v;
    document.getElementById('css')?.remove();
    const st = document.createElement('style'); st.id = 'css'; st.textContent = stored.css; document.head.appendChild(st);
    sessionStorage.setItem(TRIED, stored.v); // si ça plante avant « ok », on ne réessaiera pas cette version
    run(stored.js);
    const bad = () => { if (!window.__ok) { localStorage.setItem('trotti.badv', stored.v); localStorage.removeItem(KEY); location.reload(); } };
    window.addEventListener('error', bad, { once: true });
    setTimeout(bad, 10000);
    const ok = setInterval(() => { if (window.__ok) { sessionStorage.removeItem(TRIED); clearInterval(ok); } }, 300);
  } else run();

  // Si l'app ne démarre pas, on affiche l'erreur sur l'écran de démarrage (au lieu d'un écran figé).
  let lastErr = '';
  window.addEventListener('error', e => { lastErr = (e.message || '') + ' @' + String(e.filename || '').split('/').pop() + ':' + e.lineno; });
  setTimeout(() => {
    const sp = document.getElementById('splash');
    if (!window.__ok && sp) sp.insertAdjacentHTML('beforeend', '<small style="color:#f87171;max-width:86%;text-align:center;font:12px monospace;margin-top:8px"></small>'), sp.lastChild.textContent = 'Erreur de démarrage v' + boot.version + ' : ' + (lastErr || 'inconnue');
  }, 6000);

  async function check() {
    if (!navigator.onLine) return 'offline';
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 8000);
    try {
      const get = async (f, json) => {
        const r = await fetch(BASE + f + '?t=' + Date.now(), { signal: ctl.signal, cache: 'no-store' });
        if (!r.ok) throw new Error(f + ' ' + r.status);
        return json ? r.json() : r.text();
      };
      const rv = await get('version.json', true);
      let res = 'none';
      if (rv.apk && rv.apk.rev > SHELL_REV) {                       // nouveau socle : il faut réinstaller l'APK
        boot.apk = { v: rv.apk.v, url: rv.apk.url };
        window.dispatchEvent(new CustomEvent('trotti-update', { detail: { type: 'apk', ...boot.apk } }));
        res = 'apk';
      }
      if (cmp(rv.v, boot.version) <= 0 || rv.v === localStorage.getItem('trotti.badv') || (rv.minShell || 1) > SHELL_REV) return res; // déjà à jour
      const [js, css] = await Promise.all([get('app.js'), get('style.css')]);
      if (js.length < 2000 || css.length < 200) throw new Error('bundle incomplet');
      if (rv.sha) { // intégrité du bundle (sha256) — les anciens socles ignorent ce champ
        const dig = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, '0')).join('');
        if (await dig(js) !== rv.sha.js || await dig(css) !== rv.sha.css) throw new Error('bundle corrompu (sha256)');
      }
      localStorage.setItem(KEY, JSON.stringify({ v: rv.v, js, css }));
      boot.pending = rv.v;
      window.dispatchEvent(new CustomEvent('trotti-update', { detail: { type: 'web', v: rv.v } }));
      return 'web';
    } catch (e) { return 'none'; /* hors-ligne ou GitHub indisponible : on garde la version actuelle */ }
    finally { clearTimeout(to); }
  }
  boot.check = check;
  const go = () => setTimeout(check, 1500);
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
})();
