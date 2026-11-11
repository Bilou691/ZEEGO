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

## 10. Rapports du 2026-11-11 — v1.4.41 (silence total) puis v1.4.42 (acks illisibles)

Rapport d'association de 08:35 (4 connexions fraîches, o1 cpt0 à secrets uniques ×4 par connexion) :

- **Étape 1 : 4/4 ✓** (jeton frais à chaque connexion, MTU 251, INDEX=1 signalé à chaque réponse 0x5B).
- **Étape 2 : AUCUNE trame entrante** pendant les 4 fenêtres de 30 s. Ce silence est **RÉEL** (pas un angle mort du journal : le `recv` de `nbConnect` journalise toute trame entrante via son logger par défaut). Avant, la trottinette ackait les o1 avec des réponses « …0002 » (probables 5C 00) ; là, elle a ignoré les propositions sans même les acker.
- **Hypothèses principales sur ce silence**, par ordre de probabilité :
  1. **Phare allumé au départ des tentatives** (règle 4 : allumé immobile = rien) — aggravé par le fait que l'app ne laissait que 1,5 s entre deux tentatives, donc impossible d'éteindre le phare : tentatives 2-4 condamnées d'office. Et l'allumage d'une ZT3 Pro rallume le phare par défaut.
  2. **État général de la trottinette** (règle 10 : les succès arrivent sur power-cycle récent).
  3. **INDEX=1 actif** = le secret d'une ACCEPTATION TROTTI PRÉCÉDENTE — tester « Connecter » dans le panneau (reprise avec le secret stocké dans `trotti.scooter`) pour voir si les lectures répondent.
- **v1.4.42 en réponse** : jeton + secrets o1 en CLAIR dans le rapport (analyse hors-ligne sans nouvelle session), `nbTryDecode` (3 clés × f-XOR/SN × compteurs voisins) sur toute trame indéchiffrable pour casser les « …0002 » en direct, invitation réalignée sur la règle 4 (**bascules répétées 1-2 s**, pas un seul appui — le texte 1.4.36 contredisait le dossier), attente d'un appui sur « Trottinette prête (phare éteint) » entre les tentatives.
- **Bifurcation suivante** : si SHU arrive à s'appairer à cette trottinette → `adb logcat -s ToothSErvice` pendant un appairage SHU réel (piste 5, le chemin le plus court vers la vérité) ; si SHU échoue aussi → réinitialisation d'usine (piste 6) comme variable contrôlée.

### 10 bis. Rapport v1.4.42 (08:53) + cassage hors ligne : les acks « …0002 » ne cèdent PAS — on les CONTOURNE

- **La v1.4.42 a fait réapparaître les acks** : bascules du phare en rythme → 1 ack `5aa500…0002` (13 octets, corps 4 o, queue ctr=0002) **après l'o1 #3, dans les 4 tentatives**. Le silence de la v1.4.41 était donc bien un état (phare), pas une régression.
- **Cassage hors ligne avec données APPARIÉES** (première fois : jeton + secrets de la MÊME session en clair dans le rapport, `tools/decode-mystery.mjs`) : 11 clés (courante, initiale, session o1#1-4, reprise o1#1-4‖zéros, sel‖jeton) × compteurs 1-10 × formats CTR/f-XOR + vérification du tag → **RIEN**. Conclusion : la clé de ces acks fait intervenir une donnée qu'on n'a pas — très probablement le **secret INDEX=1 stocké côté trottinette** (une de nos anciennes acceptations). On arrête d'essayer de les déchiffrer.
- **Trois bugs v1.4.42 trouvés en analysant pourquoi nbTryDecode n'a rien loggé** : (1) une trame au cmd garbage « parse » structurellement → jetée en silence sans forçage ; (2) nbTryDecode rejetait les trames < 15 octets or ces acks en font 13 ; (3) motif de cmd décalé d'un octet (`out[i+2]` au lieu de `out[i+1]`). Tous corrigés en v1.4.43.
- **Stratégie v1.4.43 — les lectures sont le juge de paix** : ack illisible reçu → on ne jette PLUS la connexion ; on lance quand même la dissection (lecture batterie sous la clé de session de CHAQUE secret envoyé + courante + initiale, formats SN et cpt0). Si l'ack était un 5C 01 chiffré sous le secret retenu, **une lecture répondra** → secret identifié + sauvegardé + session établie, sans jamais lire l'ack. Si rien ne répond (ni lecture ni 5D) → échec honnête, la fenêtre ne s'est pas ouverte.

### 10 ter. BUG DE LONGUEUR SYSTÉMIQUE découvert le 2026-11-11 (rapports v1.4.43) — invalide §3 en partie

En comparant les trames `→` du rapport v1.4.43 octet par octet avec l'o1 (le SEUL format qui marche), un bug historique est apparu : **l'octet de longueur (3ᵉ octet, nb de payload) était FAUX sur toutes les sondes construites à la main** :

| Trame | len envoyé | payload réel | corrigé en 1.4.44 |
|---|---|---|---|
| étape 1 `5B` (MARCHE) | 0x00 | 0 o | ✓ était bon |
| o1 `5C`+secret (MARCHE, 6 acceptations) | 0x10 | 16 o | ✓ était bon |
| lecture cpt0 `01 55 02` | **0x02** | 1 o | **0x01** (faux depuis 1.4.23) |
| 0x5D cpt0 + challenge | **0x00** | 14 o | **0x0E** (faux depuis 1.4.25) |
| reprise SHU 0x5D | en-tête **absent** + len 0 | 14 o | **5A A5 0E** (faux depuis 1.4.37) |

**Conséquence : « étape 3 muette » et « lectures muettes » (§3) ont été conclues sur des trames que la trottinette ne pouvait pas parser.** Ces conclusions sont à réévaluer avec la 1.4.44. Les règles 1/2/3/5/6/7 (crypto, acceptation, compteur) restent valides — elles portaient sur l'étape 1 et l'o1, qui étaient bien formés.

Autres ajouts 1.4.44 : synchro du compteur SN entre candidats de dissection (anti-rejeu, leçon 1.4.27 — chaque candidat repartait au même compteur), et **reprise-candidats** : après un ack illisible, 0x5D cpt0 sous SHA1(secret‖zéros) pour CHAQUE secret envoyé (cette clé n'utilise pas le jeton → testable dans la même connexion, instance fraîche par candidat). Si l'ack illisible était un « secret ENREGISTRÉ » plutôt qu'un « accepté », c'est ce test qui le révélera.

Rapport v1.4.43 (09:28) par ailleurs : panneau « Mes kilomètres » SANS bouton « Connecter » → le téléphone n'a pas de secret stocké → le secret INDEX=1 côté trottinette est ORPHELIN (aucun appareil ne le connaît). Si la 1.4.44 ne le récupère pas (reprise-candidats ou dissection), réinitialisation d'usine (piste 6) devient le chemin le plus rationnel.

### 10 quater. Rapport v1.4.44 (10:27) : trames enfin bien formées → toujours muet, mais un chemin jamais testé identifié

- Avec les len corrigés : reprise-candidats (même connexion), dissection (SN compteurs distincts 0004-0013 ✓ anti-rejeu réparé), matrice 0x5D, lectures — **TOUT reste muet**. L'ack `…0002` reste la SEULE réponse (systématique après l'o1 #3, 3/3 tentatives).
- **Découverte en relisant le flot** : `etape1()` s'exécute TOUJOURS avant le bloc reprise → la « reprise SHU authentique » de la 1.4.37 (clé `SHA1(secret‖zéros)`, SANS jeton) **n'a jamais réellement tourné sans jeton** — le jeton de l'étape 1 était déjà en place, donc la clé était `SHA1(secret‖jeton)`. Le chemin Q0 « connexion vierge + secret‖zéros » restait **inexploré**.
- **v1.4.45** : les secrets o1 de chaque fenêtre avec ack illisible sont stockés (`trotti.o1cand`, 12 max) et, à la tentative suivante, testés **À FROID** : connexion fraîche, pas d'étape 1, `0x5D` cpt0 sous `SHA1(secret‖zéros)`, instance fraîche par candidat. Si l'ack illisible est un « secret ENREGISTRÉ », un candidat répondra `5D 01` → secret récupéré, session directe, plus besoin d'appairer.
- **Pattern GATT 133 confirmé** : 2ᵉ session consécutive qui meurt à la 4ᵉ connexion — le module BLE de la trottinette se coince après ~3 connexions. **Power-cycle obligatoire avant chaque session de test.**
- **Rapport v1.4.45 (10:43)** : la reprise à froid n'a PAS tourné — bug de gating (limitée à `essai === 1`, or les tentatives 1-2 sont mortes en GATT 133 avant connexion, héritage de la session de 10:27). Les tentatives 3-4 ont par contre **stocké 8 candidats** (`trotti.o1cand`). **1.4.46** : le balayage à froid part sur la première connexion qui s'établit (peu importe le numéro), candidats testés **du plus récent au plus ancien**. 133 peut aussi se récupérer sans power-cycle après ~2 échecs (tentative 3 a connecté).

---

*Dossier rédigé par ZCode (GLM-5.3) avec Billel, 2026-11-08, mis à jour le 2026-11-11. Bonne chance à la prochaine IA — on est très proches : l'appairage marche, il ne reste que la lecture.* 🛴
