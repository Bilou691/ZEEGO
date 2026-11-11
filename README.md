# Trotti – GPS trottinette

App Android (Capacitor) + serveur de signalements.

> 🛴 **Trottinette Segway ZT3 Pro (Bluetooth)** : fonctionnalité **gelée le 2026-11-11** (décision de Billel après ~20 sessions terrain — le firmware nov. 2026 ne parle aucune variante du protocole qu'on a su déchiffrer). Tout le reverse-engineering (protocole, appairage, règles prouvées, pistes) reste documenté dans **[docs/DOSSIER-ZT3-BLE.md](docs/DOSSIER-ZT3-BLE.md)** — à lire en premier si on la relance un jour. Le code BLE (lecture seule) est en sommeil dans `www/app.js`, il ne tourne que si une trottinette est associée.

```
www/        l'app (HTML/JS/CSS) – c'est ce que l'APK embarque
  boot.js   chargeur + mise à jour automatique depuis GitHub
  app.js    toute l'interface et la logique
  version.json   version publiée (lue par l'app à chaque ouverture)
android/    projet Android (Capacitor)
server/     API des signalements (Render)
tools/      logo (SVG) + make-icons.py
Trotti.apk  dernier APK installable
```

## Mises à jour automatiques

À chaque ouverture, l'app lit `www/version.json` sur GitHub (branche `main`).
- **Version plus récente** → elle télécharge `app.js` + `style.css`, puis se relance toute seule (jamais pendant un trajet).
  Si le nouveau code plante au démarrage, elle revient à la version embarquée et ne le réessaie pas.
- **`apk.rev` plus grand que celui de l'APK installé** (changement natif : permissions, plugin…) → un bandeau « Installer » ouvre `Trotti.apk`.

**Publier une nouvelle version de l'app :** modifier `www/app.js` / `www/style.css`, augmenter `"v"` dans `www/version.json`, `git push`. C'est tout, aucun nouvel APK.

**Changement de socle (rare) :** augmenter `SHELL_REV` dans `boot.js` et `apk.rev` / `apk.v` dans `version.json`, regénérer l'APK (ci-dessous), le remplacer `Trotti.apk`, pousser.
Mettre aussi `BUNDLED_V` (boot.js) à la version embarquée.

## Construire l'APK

```
npm ci
npx cap sync android
cd android && ./gradlew assembleDebug      # → app/build/outputs/apk/debug/app-debug.apk
```
Signer toujours avec la **même clé** (sinon Android refuse la mise à jour par-dessus l'ancienne installation).

## Sur ma route (POI)

Bouton « calques » : snacks/fast-food, restos/cafés/boulangeries, réparateurs trottinette-vélo-moto, affichés le long de l'itinéraire
(couloir de 100 m) ou autour de soi sans itinéraire. Données OpenStreetMap via Overpass (plusieurs serveurs en secours).

## Itinéraire

Moteur Valhalla (profil vélo), deux profils au choix via les puces dans la fiche itinéraire :
- **🛡 Sécurisé** (défaut) : pistes et voies cyclables en priorité (`use_roads` 0,25), pavés lourdement pénalisés —
  les grandes routes sans aménagement ne sont prises qu'en dernier recours.
- **⚡ Rapide** : le plus court en temps, trafic ignoré (`use_roads` 0,85).

Pas de contrainte de pente (trottinette électrique), jamais d'autoroute ni de trottoir, sens interdits respectés. Secours : OSRM vélo.
Les signalements « piste bloquée », « travaux » et « danger » sont évités automatiquement.
