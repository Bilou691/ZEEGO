# Dossier ZT3 Pro — intégration Bluetooth dans Trotti

> **Journal de bord pour la prochaine IA.** Écrit le 2026-11-08 après ~12 h de reverse-engineering et ~20 sessions terrain avec la trottinette réelle. Tout ce qui est noté ici a été **prouvé sur le fil** ou **vérifié par décompilation**, sauf mention contraire. Lire ce dossier AVANT de toucher au code.

## 1. Objectif

Lire **batterie, kilométrage, vitesse** de la Segway-Ninebot **ZT3 Pro** dans l'app **Trotti** (ce repo), via Bluetooth LE, en **lecture seule stricte** (aucune commande de conduite — engagement pris envers Billel).

## 2. Le décor technique

| Élément | Détail |
|---|---|
| App | Capacitor 8, `www/app.js` monolithique (~79 Ko), UI dans `www/index.html` généré par app.js |
| Mises à jour | OTA : bump `const V` dans `app.js` **ET** `"v"` dans `www/version.json`. CDN GitHub raw = cache ~5 min. S'applique au lancement SUIVANT. ⚠ Un bump a déjà échoué silencieusement (remplacement de chaîne raté) → toujours vérifier les deux fichiers |
| BLE | `@capacitor-community/bluetooth-le` via un Proxy dans app.js. Service NUS `6e400001-b5a3-f393-e0a9-e50e24dcca9e`, écriture char `…0002`, notifications char `…0003`. MTU 251 négocié auto par le plugin |
| Trottinette | Série **`1K1EA2621P5722`** (EU 25 km/h), firmware **novembre 2026** — plus récent que tout ce qui est documenté publiquement |
| Tests | `node tools/test-ble-vectors.mjs` — 23 assertions, extrait le bloc pur `[nb-crypto]` de app.js entre deux marqueurs de commentaires |
| Historique versions | v1.4.9 → v1.4.39 en une nuit. Git log du repo = l'historique détaillé |

## 3. État au 2026-11-08 (v1.4.39)

**FONCTIONNE :**
- Étape 1 (`0x5B` → jeton 16 o + série 14 o) : 100 % fiable, à chaque connexion
- Appairage (`o1` cpt0 à secrets uniques → ack `5C 01`) : accepté 6 fois — pattern reproductible
- Sauvegarde du secret dès le `5C 01` (callback `onAccepted`)
- UI complète : panneau « Ma trottinette » (12 registres), cellule batterie HUD, reconnexion auto au trajet, moteur de session `sc`
- Crypto validée par 23 tests unitaires + preuves sur le fil

**BLOQUÉ (le seul problème restant) :**
- Étape 3 (`0x5D`) : **jamais** de réponse, dans aucun format × clé testé
- Lectures (`0x01`) : **jamais** de réponse (VCU 0x16, BMS 0x07, MCU 0x02, BLE 0x04 — en SN et cpt0, sous clés session/courante/initiale)
- La reprise connecte (« étape 1 ✓ / reprise du secret ✓ / connectée ✓ ») mais reste muette ensuite

**EN ATTENTE DE TEST TERRAIN :** la v1.4.39 contient la **dissection de clé** (après `5C 01`, lecture test sous chaque secret envoyé — voir §8 piste 1).

## 4. Les règles DURES découvertes (toutes prouvées)

1. **Cette trottinette dérive ses clés en MOITIÉS DE 16 OCTETS** : `SHA1(k1[0:16] ‖ k2[0:16])[0:16]`. Preuve : son étape 1 et ses acks `5C 01` ne se déchiffrent qu'ainsi. ⚠ La ZT3 de référence (pepperonas, firmware d'avril) utilise **12 octets** — prouvé contre la capture SHU Phase E1 (flux `60 63 2E 49`). **Deux firmwares, deux conventions.** Ne jamais « corriger » vers 12 sur la foi de la capture.
2. **L'appairage ne passe qu'en format compteur 0** (`f-XOR` + somme signée, pas de tag) : les `o1` en format SN sont ignorés → **coupure après ~5 propositions**. Les `o1` cpt0 **octet-identiques** répétés sont aussi rejetés. Ce qui marche : **cpt0 + secret DIFFÉRENT à chaque envoi**, max 4 par connexion.
3. **L'acceptation** : la trottinette répond `5C 01` (chiffré SN compteur 2, sous la clé courante `SHA1(nom‖jeton)`). Les réponses `…0002` indéchiffrables (probables `5C 00`) n'ont cédé à AUCUNE dérivation testée offline (16/12/brut × compteurs 1-12 × anciens secrets × anciens jetons) — **inexpliquées à ce jour**.
4. **Le geste utilisateur** : bascules du PHARE toutes les 1-2 s pendant la fenêtre = les succès. Phare allumé immobile = rien. (Théorie non confirmée : l'extinction annulerait.) Le texte officiel SHU (extrait de l'APK) : « *Please toggle the headlight by pressing the power button* ».
5. **Compteur anti-rejeu (authentique SHU, `c6/c.java` h())** : `counter = counter + 1` à CHAQUE trame reçue, jamais `counter = numéro_du_fil`. Chiffrement : incrémente PUIS utilise. Règle d'or : **ne jamais renvoyer la même trame chiffrée deux fois**.
6. **Drapeau M uniquement sur `5C arg=1`** (arg=0 = « proposal reçue, j'attends le phare » — c'est là que SHU affiche son prompt). O sur `5D arg=1`.
7. **Checksum en octets SIGNÉS** (`0x80` = −128) — le piège qui bloquait l'étape 1 au tout début.
8. **SHU réel (décompilé, `ScooterActivity.Q0()`)** : étape 1 en boucle 900 ms tant que !L ; **reprise SANS étape 1** : `setRandomAppData(persisté)` sur instance fraîche (jeton=zéros → clé `SHA1(secret‖zéros16)`) puis `0x5D` **cpt0 avec challenge VIDE (14 zéros)** ×3 ; si échec → `j()` (compteur=0, clé=nom‖jeton) → boucle o1 500 ms même secret. **Mais** le pattern « même secret » contredit la règle 2 de CETTE trottinette — d'où l'impasse actuelle.
9. **Erreurs GATT 133 / Connection timeout** = trottinette à éteindre/rallumer (module BLE coincé après une coupure). La liaison BLE est **exclusive** : fermer SHU et l'appli Segway avant tout test.
10. Les succès d'appairage arrivent sur **état frais** (power-cycle récent de la trottinette).

## 5. Architecture du code (www/app.js)

- **Bloc pur `[nb-crypto]`** (entre marqueurs, extrait par les tests) : `aesBlock` (AES-ECB via CBC+IV nul), `nbKey`, `xor16`, classe `NbCrypto` (encrypt/decrypt/ctrBody/tag/invSum signé, drapeaux L/M/O, `setRandomAppData`), `nbSeal0`/`nbOpen0` (format compteur 0), `nbWrap`/`nbParse`.
- **Transport** : `nbConnect` (file de trames, détection coupure via événement `disconnected|id`, écho filtré), `nbSend`/`recv` acceptent un logger par appel.
- **Handshake** : `nbHandshake(t, c, resume, log, onButton, variant, onAccepted, fixedRandom)` — étape 1 en helper, reprise SHU-cpt0-zéros PUIS par jeton, appairage 4×o1 secrets uniques, dissection de clé, matrice 0x5D.
- **Registres** : `ZT3_REGS` (12 registres VCU/BMS, échelles incertaines pour odometer `0x62`), `nbReadReg`.
- **Moteur** : objet `sc` (états off/connecting/live/error, poll, sweep diagnostique, auto-connect au trajet). ⚠ Le panneau et les modaux partagent `#modal` → toujours null-garder `#scGrid` dans `renderHook` (crash v1.4.21).
- **Association** : `blePair` (modal + journal + « Copier le rapport »), 4 connexions fraîches max.

## 6. Chronologie condensée des leçons

| Versions | Leçon |
|---|---|
| 1.4.10 | Portage SHU complet ; échec étape 2 → checksum SIGNÉ découvert |
| 1.4.11-13 | Bouton : maintien (faux) → phare bascule (texte officiel APK) |
| 1.4.14 | Compteur 2 vs 3 : innocent (les deux silence) |
| 1.4.16 | **Salut 0x5C vide → PREMIER ack** (format compteur 0 !) |
| 1.4.17 | L'ack n'arrive qu'à l'état vierge ; renvois identiques = rejeu → coupure |
| 1.4.19-20 | **5C 01 déchiffré (clé courante)** ; compteur authentique SHU |
| 1.4.25-26 | Boucle o1 500 ms (SHU Q0) ; renvois par encrypt() (compteur croissant) → coupure quand même |
| 1.4.28 | **Dérivations divergentes 16/12 prouvées** |
| 1.4.31-32 | **o1 cpt0 à secrets uniques = ACCEPTÉ** (le pattern gagnant) |
| 1.4.34-35 | Secret unique par association (SHU) → rejeté par CE firmware ; fix signature |
| 1.4.36-37 | Phare : bascules gagnantes ; reprise SHU-cpt0-zéros découverte dans Q0 |
| 1.4.38-39 | Bump échoué (silence) corrigé ; secrets uniques + dissection de clé |

## 7. Ressources

- **Repo de référence** : `pepperonas/segway-zt3-pro` (clone local possible) — port Python vérifié (`python/zt3_cli/`), `app/FIELD-TEST-LOG.md` (or : captures réelles), l'APK SHU (`reverse-engineering/apps/shu/…apk`), `zt3.json` (registres/adresses : VCU 0x16, BMS 0x07, MCU 0x02, BLE 0x04).
- **Décompilation SHU** (à régénérer si perdue) :
  ```
  jadx --no-res -d shu-src ScooterHackingUtility-*.apk
  ```
  Fichiers clés : `sources/sh/cfw/utility/activities/ScooterActivity.java` (Q0 = orchestration, parse des drapeaux ~L650-690), `sources/c6/c.java` (crypto authentique : h/i/d/f/g, j()).
- **Mémoire locale ZCode** : `~/.zcode/cli/memories/projects/default-*/trotti-zt3-pro-integration.md` (règles terrain condensées).

## 8. Prochaines pistes (dans l'ordre)

1. **Tester la v1.4.39 sur le terrain** (non fait à la rédaction) : la dissection de clé essaie une lecture sous chaque secret envoyé — si une `← RÉPONSE` apparaît, c'est le secret retenu → le sauvegarder rend la reprise cohérente.
2. **Si dissection muette** : journaliser TOUS les secrets o1 dans localStorage (`trotti.o1history`) pour pouvoir les rejouer offline ; puis tester le ack mystère contre chaque secret historique × jeton du jour.
3. **Décoder le flux post-O de SHU** : dans `ScooterActivity` après O (`case 93`), SHU appelle `registerManager.e("about")` → lire ce que fait le registerManager (ordre des trames, format de la 1re lecture). C'est LA partie qu'on n'a pas encore répliquée.
4. **Hypothèse firmware** : cette ZT3 (nov. 2026) parle une révision du protocole (dérivation 16 + appairage cpt0). Vérifier si SHU lui-même arrive à s'y appairer — si oui, sniffer les trames SHU (l'APK loggue `enc out`/`rcv dec` en Log.e ! Un `adb logcat` pendant un appairage SHU donnerait le fil complet — voir FIELD-TEST-LOG.md qui décrit exactement cette méthode « Patched-SHU-CRYPTO_DUMP »).
5. **Piste adb logcat (forte)** : brancher le téléphone en USB, filtrer `adb logcat -s ToothSErvice`, lancer SHU, appairer → on obtient les trames chiffrées + décodées de la VRAIE app sur CETTE trottinette. Comparer octet par octet avec les nôtres. C'est probablement le chemin le plus court vers la vérité.
6. En dernier recours : réinitialisation d'usine via l'appli Segway (efface INDEX=1/secret stocké) — jamais faite, à garder comme variable contrôlée.

## 9. Mode opératoire terrain (itérer avec Billel)

1. Pousser la version (vérifier `version.json` ET `const V` !), attendre ~5 min de cache CDN (vérifier avec curl sur raw.githubusercontent.com).
2. Billel : fermer/rouvrir Trotti (l'update s'applique au 2ᵉ lancement), vérifier la version en bas de « Mes kilomètres ».
3. **Éteindre/rallumer la trottinette** avant chaque session (règle 10) + fermer SHU/Segway.
4. Lancer « Associer », basculer le phare toutes les 1-2 s au ⏺.
5. Récupérer le rapport (« Copier le rapport ») — chaque ligne `→`/`←` est de l'or : décoder offline avec les clés candidates (scripts Node dans l'historique de session).
6. Une seule variable par version si possible ; le rapport de Billel fait foi.

---

*Dossier rédigé par ZCode (GLM-5.3) avec Billel, 2026-11-08. Bonne chance à la prochaine IA — on est très proches : l'appairage marche, il ne reste que la lecture.* 🛴
