// Garde-fou anti « bump silencieux » (leçon v1.4.38 : version.json resté à l'ancienne
// valeur pendant que le code changeait → aucune mise à jour sur le téléphone).
// Vérifie que www/version.json et le secours `const V` de www/app.js disent la même chose.
// Lancer : node tools/check-version.mjs   ( fait partie de `npm test` et de la CI )
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fail = msg => { console.error('✗ ' + msg); process.exit(1); };

let vJson, appJs;
try {
  vJson = JSON.parse(readFileSync(join(root, 'www', 'version.json'), 'utf8'));
} catch { fail('www/version.json illisible ou invalide'); }
if (!/^\d+\.\d+\.\d+$/.test(vJson.v || '')) fail(`version.json : « v » absent ou pas au format x.y.z (trouvé : ${JSON.stringify(vJson.v)})`);

appJs = readFileSync(join(root, 'www', 'app.js'), 'utf8');
const vLine = appJs.split('\n').find(l => l.includes('const V ='));
if (!vLine) fail('app.js : ligne `const V =` introuvable');
const m = vLine.match(/\|\|\s*'(\d+\.\d+\.\d+)'/);
if (!m) fail('app.js : secours de version introuvable sur la ligne `const V =` (attendu : || \'x.y.z\')');
if (m[1] !== vJson.v) fail(`DÉSYNCHRONISATION : version.json = ${vJson.v}, app.js = ${m[1]}. Bump les DEUX (cf. README et docs/DOSSIER-ZT3-BLE.md §2) avant de pousser.`);

// Le bundle OTA télécharge exactement ces fichiers : s'assurer qu'ils existent.
for (const f of ['app.js', 'style.css']) {
  try { readFileSync(join(root, 'www', f)); } catch { fail(`www/${f} manquant — l'OTA livrera un bundle incomplet`); }
}

console.log(`✓ versions en phase : ${vJson.v} (version.json = app.js) · app.js + style.css présents`);
