// Vecteurs de test de la crypto NinebotCrypto embarquée dans www/app.js.
// Node >= 18, zéro dépendance. Reprend les tests du port de référence vérifié
// contre le trafic SHU réel (pepperonas/segway-zt3-pro, python/tests/test_crypto.py)
// et ajoute une session complète simulée : étapes 1/2/3 + lecture de la batterie.
// Usage : node tools/test-ble-vectors.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

if (!globalThis.crypto) globalThis.crypto = (await import('node:crypto')).webcrypto;

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'www', 'app.js'), 'utf8');
const block = src.match(/\/\/ ---- \[nb-crypto\] début du bloc pur[\s\S]*?\/\/ ---- \[nb-crypto\] fin du bloc pur ----/);
if (!block) { console.error('✗ bloc [nb-crypto] introuvable dans www/app.js'); process.exit(1); }
const scope = {};
new Function('scope', block[0] + `
;Object.assign(scope, { aesBlock, nbKey, xor16, NbCrypto, nbWrap, nbParse, NB_FW, toHex, fromHex, pad16 });`)(scope);
const { NbCrypto, nbWrap, nbParse, NB_FW } = scope;

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ ' + name + (extra != null ? ' — obtenu ' + extra : '')); }
};
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
const eq = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const sha1_16 = (k1, k2) => {
  const buf = Buffer.alloc(32);
  buf.set(Buffer.from(k1).subarray(0, 16), 0); buf.set(Buffer.from(k2).subarray(0, 16), 16);
  return new Uint8Array(createHash('sha1').update(buf).digest().subarray(0, 16));
};

console.log('\n[1] dérivation de clé');
{
  const c = new NbCrypto('ZT3-XXXX');
  await c.ready;
  ok(eq(c.key, sha1_16(Buffer.from('ZT3-XXXX'), NB_FW)), 'clé initiale = SHA-1(nom ‖ sel)[0:16]');
}

console.log('\n[2] trame étape 1 + CRC connu (vérifié contre pcap SHU)');
{
  const c = new NbCrypto('ZT3');
  const f = c.buildGetRandom(0x04);
  ok(hex(f) === '5aa5003e045b00', 'buildGetRandom(0x04) = 5A A5 00 3E 04 5B 00', hex(f));
  const w = await c.encrypt(f);
  ok(w.length === 13, 'trame fil étape 1 = 13 octets', w.length);
  ok(w[9] === 0x62 && w[10] === 0xff, 'CRC inversé = 62 FF', hex(w.slice(9, 11)));
  ok(w[11] === 0 && w[12] === 0, 'compteur 0000 en queue', hex(w.slice(11)));
}

console.log('\n[3] brouillage f() auto-inverse');
{
  const c = new NbCrypto('ZT3-XXXX');
  const body = Buffer.from('hello world abcd');
  ok(eq(await c.fXor(await c.fXor(body)), body), 'f(f(x)) = x');
}

console.log('\n[4] somme de contrôle en octets SIGNÉS (bug du 1er essai d’intégration)');
{
  const c = new NbCrypto('ZT3');
  ok(c.invSum([0x3E, 0x04, 0x5B, 0x00]).join(',') === '98,255', 'invSum([3E 04 5B 00]) = 62 FF', c.invSum([0x3E, 0x04, 0x5B, 0x00]).join(','));
  ok(c.invSum([0x80, 0x01]).join(',') === '126,0', 'invSum signé : [80 01] → 7E 00 (et non 7E FF)', c.invSum([0x80, 0x01]).join(','));
}

console.log('\n[5] aller-retour compteur 0 entre deux instances');
{
  const a = new NbCrypto('ZT3-XXXX'), b = new NbCrypto('ZT3-XXXX');
  const plain = a.buildGetRandom(0x04);
  const p = await b.decrypt(await a.encrypt(plain));
  ok(p && eq(p, plain), 'déchiffré = trame d’origine');
}

console.log('\n[6] aller-retour CTR en état appairé (trame de lecture batterie)');
{
  const a = new NbCrypto('ZT3-XXXX'), b = new NbCrypto('ZT3-XXXX');
  for (const c of [a, b]) {
    c.token.set(Uint8Array.from({ length: 16 }, (_, i) => i + 1));
    c.random.set(Uint8Array.from({ length: 16 }, (_, i) => i + 17));
    await c.deriveKey(c.random, c.token);
    c.counter = 1;
  }
  const plain = Uint8Array.from([0x5A, 0xA5, 0x01, 0x3E, 0x16, 0x01, 0x55, 0x02]);
  const w = await a.encrypt(plain);
  ok(w.length === plain.length + 6, '14 octets fil (queue tag+compteur)', w.length);
  const p = await b.decrypt(w);
  ok(p && eq(p, plain), 'déchiffré = 5A A5 01 3E 16 01 55 02');
}

console.log('\n[7] reprise silencieuse (setRandomAppData)');
{
  const c = new NbCrypto('ZT3-XXXX'); c.token.fill(1);
  await c.setRandomAppData(new Uint8Array(16).fill(2));
  ok(eq(c.key, sha1_16(new Uint8Array(16).fill(2), new Uint8Array(16).fill(1))), 'clé = SHA-1(secret ‖ jeton)[0:16]');
}

console.log('\n[8] session complète simulée (téléphone ↔ trottinette simulée)');
{
  const name = 'ZT3-TEST';
  const phone = new NbCrypto(name), scoot = new NbCrypto(name);
  const token = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
  const chal = Buffer.from('NBSERIES123456'); // 14 octets (série)

  // étape 1 : le téléphone envoie 0x5B, la trottinette répond jeton+série à compteur 0
  await phone.encrypt(phone.buildGetRandom(0x04));
  const resp1 = await scoot.encrypt(Uint8Array.from([0x5A, 0xA5, 0x1E, 0x04, 0x3E, 0x5B, 0x00, ...token, ...chal]));
  await phone.decrypt(resp1);
  ok(phone.L, 'drapeau L (jeton reçu)');
  ok(eq(phone.token, token) && eq(phone.challenge, chal), 'jeton + série capturés');
  ok(eq(phone.key, sha1_16(Buffer.from(name), token)), 'clé → SHA-1(nom ‖ jeton)');

  // étape 2 : envoi du secret puis ACK arg=0x00 (comportement constaté du firmware ZT3)
  await phone.encrypt(phone.buildPairInit(0x04));
  ok(phone.random.some(x => x), 'notre secret capturé à l’envoi de la trame 0x5C');
  const acker = new NbCrypto(name);
  acker.token.set(token); await acker.deriveKey(acker.name, token); acker.counter = phone.counter - 1;
  await phone.decrypt(await acker.encrypt(Uint8Array.from([0x5A, 0xA5, 0x00, 0x04, 0x3E, 0x5C, 0x00])));
  ok(phone.M, 'drapeau M (ACK arg=0x00 accepté — pas seulement 0x01)');
  ok(eq(phone.key, sha1_16(phone.random, token)), 'clé de session = SHA-1(secret ‖ jeton)');

  // étape 3 : renvoi de la série puis ACK 0x5D 01
  await nbWrap(phone, 0x04, 0x5D, 0x00, phone.challenge);
  const acker3 = new NbCrypto(name);
  acker3.token.set(token); await acker3.setRandomAppData(phone.random.slice()); acker3.counter = phone.counter - 1;
  await phone.decrypt(await acker3.encrypt(Uint8Array.from([0x5A, 0xA5, 0x00, 0x04, 0x3E, 0x5D, 0x01])));
  ok(phone.O && phone.M, 'drapeau O (appariement complet)');

  // lecture : requête registre 0x55, réponse 0x04 de la VCU (87 %)
  await nbWrap(phone, 0x16, 0x01, 0x55, Uint8Array.from([2]));
  const vcu = new NbCrypto(name);
  vcu.token.set(token); await vcu.setRandomAppData(phone.random.slice()); vcu.counter = phone.counter - 1;
  const ans = await vcu.encrypt(Uint8Array.from([0x5A, 0xA5, 0x02, 0x16, 0x3E, 0x04, 0x55, 0x57, 0x00]));
  const d = await nbParse(phone, ans);
  ok(d && d.cmd === 0x04 && d.arg === 0x55 && d.src === 0x16, 'réponse 0x04/0x55 depuis 0x16 reconnue');
  ok(d && d.payload[0] === 0x57, 'batterie décodée = 87 %', d && d.payload[0]);
  ok((await nbParse(phone, Uint8Array.from([9, 9, 9, 9, 9, 9, 9, 9, 9]))) === null, 'bruit rejeté par nbParse');
}

console.log(`\n${fail ? '✗ ' + fail + ' échec(s)' : '✓ tous verts'} — ${pass} assertion(s)`);
process.exit(fail ? 1 : 0);
