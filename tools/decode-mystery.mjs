// Cassage hors-ligne des trames mystère « …0002 » — https://github.com/Bilou691/ZEEGO
// Depuis la v1.4.42, les rapports d'association contiennent le jeton ET les secrets o1
// EN CLAIR de la même session : on peut enfin tester des paires (secret, jeton) APPARIÉES,
// ce que les tentatives précédentes (« anciens secrets × anciens jetons ») ne faisaient pas.
// Le bloc crypto est extrait de www/app.js ([nb-crypto]) — source unique de vérité.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'www', 'app.js'), 'utf8');
const m = src.match(/\/\/ ---- \[nb-crypto\] début du bloc pur[\s\S]*?\/\/ ---- \[nb-crypto\] fin du bloc pur ----/);
if (!m) { console.error('✗ bloc [nb-crypto] introuvable dans www/app.js'); process.exit(1); }
const block = m[0];
const nb = new Function('window', `'use strict'; ${block.replace(/async function/g, 'async function')};
  return { NB_FW, toHex, fromHex, pad16, nbKey, aesBlock, xor16, NbCrypto, nbSeal0, nbOpen0 };`)(null);
const { NB_FW, toHex, fromHex, nbKey, aesBlock, NbCrypto } = nb;

const NAME = '1K1EA2621P5722';
// Sessions du rapport du 2026-11-11 08:53 (v1.4.42) — jeton + secrets + trame mystère
const SESSIONS = [
  { token: 'b0a5a65e938073b7218eb7d59137db45', frame: '5aa500f17eebca95ae8a4a0002',
    secrets: ['5d432b6e90e7ed9e336ba765acf4dbc2', '0b22a2f48da9f343b4d539b333874913', '8ad24fbbef10e6fcbc813a2b219eabb6', 'c720d213947b96cf36e3dc013e99c03a'] },
  { token: '733f54ae7672cb69379c0cfaab2b3c1d', frame: '5aa500c361724ddc036e700002',
    secrets: ['afee6cfe5635bd4a701b7694f6651d82', '94cde9d8355dbcb63def85947c8f06e9', '6a91171c2e8c262c4bb0c8fa95b13b9e', '354011075bbb55d742bf252ce749a3e8'] },
  { token: '5fd7fc6189953d72228b1f4b5e096089', frame: '5aa5005e7ea4d1d181a9940002',
    secrets: ['4dd85ef9dcb4c7a775d67c9e3c9c80fa', '268d377a46e62c9d281ffb34776b653d', '3b28f27c5bee5477a1670717f76cefbd', '8e9ef8feee5ad1f448066125c1edd8ce'] },
  { token: '4157fbe6021e28db16b01a9034da7154', frame: '5aa500fab260e544175d440002',
    secrets: ['8dac4e71464987aa8e7a4f1d3c48ce2', '25bfa40609d3367be6b790a6efcc52e', '6378ced64bf5911fcbc1950c6c42d15f', 'ba3406e3f04236886b5d5a1a681cf8cf'] },
];
const CMDS = [0x5B, 0x5C, 0x5D, 0x04, 0x01]; // réponses possibles

// tag(plain, ctr) répliqué fidèlement (même code que NbCrypto.tag, indépendant de l'instance)
async function tag(key, plain, ctr, token) {
  const body = plain.slice(3), b0 = new Uint8Array(16);
  b0[0] = 0x59; b0[1] = ctr >>> 24 & 255; b0[2] = ctr >>> 16 & 255; b0[3] = ctr >>> 8 & 255; b0[4] = ctr & 255; b0.set(token.slice(0, 8), 5); b0[15] = body.length & 255;
  const { xor16 } = nb;
  let x = await aesBlock(key, b0);
  const aad = new Uint8Array(16); aad.set(plain.slice(0, 3)); x = await aesBlock(key, xor16(x, aad));
  for (let o = 0; o < body.length; o += 16) { const blk = new Uint8Array(16); blk.set(body.slice(o, o + 16)); x = await aesBlock(key, xor16(x, blk)); }
  const s0 = new Uint8Array(16); s0[0] = 1; s0.set(b0.slice(1, 13)); const ks = await aesBlock(key, s0);
  return Uint8Array.from([x[0] ^ ks[0], x[1] ^ ks[1], x[2] ^ ks[2], x[3] ^ ks[3]]);
}

let hits = 0;
for (const [si, s] of SESSIONS.entries()) {
  const token = fromHex(s.token), wire = fromHex(s.frame);
  const body = wire.slice(3, wire.length - 6), tagW = wire.slice(wire.length - 6, wire.length - 2);
  const ctrIn = (wire[wire.length - 2] << 8) | wire[wire.length - 1];
  const nameB = new TextEncoder().encode(NAME);
  const cles = [['courante nom‖jeton', await nbKey(nameB, token)], ['initiale nom‖sel', await nbKey(nameB, NB_FW)]];
  for (let i = 0; i < s.secrets.length; i++) {
    cles.push([`session o1#${i + 1}‖jeton`, await nbKey(fromHex(s.secrets[i]), token)]);
    cles.push([`reprise o1#${i + 1}‖zéros`, await nbKey(fromHex(s.secrets[i]), null)]);
  }
  cles.push(['sel‖jeton (inverse)', await nbKey(NB_FW, token)]);
  console.log(`\n— session ${si + 1} · jeton ${s.token} · trame ${s.frame} (corps ${body.length} o, queue ${toHex(wire.slice(-6))}) —`);
  for (const [nom, cle] of cles) {
    // 1) CTR (format SN) sur une plage de compteurs autour de celui de la queue
    for (let ctr = Math.max(0, ctrIn - 3); ctr <= ctrIn + 8; ctr++) {
      if (ctr === 0) continue;
      const b = new Uint8Array(16);
      b[0] = 1; b[1] = ctr >>> 24 & 255; b[2] = ctr >>> 16 & 255; b[3] = ctr >>> 8 & 255; b[4] = ctr & 255; b.set(token.slice(0, 8), 5); b[15] = 1;
      const ks = await aesBlock(cle, b);
      const out = Uint8Array.from(body, (v, i) => v ^ ks[i % 16]);
      if (out[1] === 0x3E && CMDS.includes(out[2])) {
        const plain = Uint8Array.from([0x5A, 0xA5, 0x00, ...out]);
        const tg = await tag(cle, plain, ctr, token);
        const ok = toHex(tg) === toHex(tagW);
        console.log(`  ✓ ${nom} · ctr ${ctr} → ${toHex(out)} (tag ${ok ? 'VÉRIFIÉ ✓' : 'non (' + toHex(tg) + ')'})`); hits++;
      }
    }
    // 2) f-XOR (format compteur 0)
    const ks0 = await aesBlock(cle, NB_FW);
    const out0 = Uint8Array.from(body, (v, i) => v ^ ks0[i % 16]);
    if (out0[1] === 0x3E && CMDS.includes(out0[2])) { console.log(`  ✓ ${nom} · fXor → ${toHex(out0)}`); hits++; }
  }
}
console.log(hits ? `\n${hits} combinaison(s) trouvée(s)` : '\nAUCUNE combinaison — la clé fait intervenir une donnée qu’on n’a pas (secret INDEX=1 stocké sur la trottinette ?)');
