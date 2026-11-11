// Garde-fou anti « bump silencieux » (leçon v1.4.38) + intégrité du bundle OTA.
// Vérifie que www/version.json et le secours `const V` de www/app.js disent la même chose,
// et que les sha256 du bundle (app.js + style.css) correspondent aux fichiers réels.
// Lancer : node tools/check-version.mjs          (npm test + CI)
//          node tools/check-version.mjs --fix    (réécrit les sha dans version.json après une modif)
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fail = msg => { console.error('✗ ' + msg); process.exit(1); };
const sha = s => createHash('sha256').update(s, 'utf8').digest('hex');

let vJson;
try {
  vJson = JSON.parse(readFileSync(join(root, 'www', 'version.json'), 'utf8'));
} catch { fail('www/version.json illisible ou invalide'); }
if (!/^\d+\.\d+\.\d+$/.test(vJson.v || '')) fail(`version.json : « v » absent ou pas au format x.y.z (trouvé : ${JSON.stringify(vJson.v)})`);

const appJs = readFileSync(join(root, 'www', 'app.js'), 'utf8');
const styleCss = readFileSync(join(root, 'www', 'style.css'), 'utf8');
const vLine = appJs.split('\n').find(l => l.includes('const V ='));
if (!vLine) fail('app.js : ligne `const V =` introuvable');
const m = vLine.match(/\|\|\s*'(\d+\.\d+\.\d+)'/);
if (!m) fail('app.js : secours de version introuvable sur la ligne `const V =` (attendu : || \'x.y.z\')');
if (m[1] !== vJson.v) fail(`DÉSYNCHRONISATION : version.json = ${vJson.v}, app.js = ${m[1]}. Bump les DEUX avant de pousser.`);

// Intégrité OTA : le sha de version.json doit être celui des fichiers réels.
const want = { js: sha(appJs), css: sha(styleCss) };
const have = vJson.sha || {};
if (have.js !== want.js || have.css !== want.css) {
  if (process.argv.includes('--fix')) {
    vJson.sha = want;
    writeFileSync(join(root, 'www', 'version.json'), JSON.stringify(vJson, null, 2) + '\n');
    console.log(`✓ sha256 mis à jour dans version.json (js ${want.js.slice(0, 12)}… · css ${want.css.slice(0, 12)}…)`);
  } else fail(`sha256 du bundle obsolète ou absent dans version.json — lance \`node tools/check-version.mjs --fix\` puis commit (js ${want.js.slice(0, 12)}… · css ${want.css.slice(0, 12)}…)`);
}

console.log(`✓ versions en phase : ${vJson.v} (version.json = app.js) · bundle intègre (sha256 vérifié)`);
