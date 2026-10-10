# Cardrive

Jeu de conduite 3D dans le navigateur. On roule sur une piste d'essai, sur les 24 circuits de Formule 1 de la saison 2026, ou dans n'importe quelle ville du monde grâce aux routes d'OpenStreetMap. Sur circuit : contre-la-montre avec records et fantôme, ou course contre des pilotes automatiques. Chaque véhicule du catalogue (18) a sa propre physique : masse, puissance, adhérence des pneus selon la surface (asphalte, gravier, herbe), freinage, transmission (différentiel, contrôle de traction réglable), déportance des monoplaces.

Stack : Vite, React 19, TypeScript strict, three.js via React Three Fiber, Rapier (WebAssembly), Vitest.

## Démarrer

```bash
npm install
npm run dev        # serveur de développement
```

Commandes : `ZQSD` ou les flèches pour conduire, `Espace` frein à main, `R` repositionner, `Échap` pause, `T` détails du véhicule, `M` couper le son, `F3` panneau de performance. Le son est entièrement synthétisé ; ses réglages sont dans le menu pause.

## Vérifier

| Commande | Rôle |
| --- | --- |
| `npm run lint` · `npm run typecheck` · `npm test` | Contrôles statiques et tests unitaires / de physique (Rapier sans interface) |
| `npm run build` | Build de production (`dist/`) |
| `npm run e2e` | Tests de bout en bout dans Chrome sans interface : menu, garage, circuits, conduite, pause, ville synthétique (streaming, recentrage), collision contre un mur après deux recentrages, son et dérapage, chronométrage, course, régressions visuelles des écrans d'interface. Options : `--full-lap` (un tour complet de Monaco piloté par le pilote automatique, ≈ 4 min), `--gpu` (rendu matériel, seul mode où les FPS sont représentatifs), `--network` (ajoute une vraie ville, via Overpass), `--only=texte`, `--drive=secondes` |
| `npm run e2e:update` | Régénère les images de référence de `scripts/e2e/baseline/` |
| `npm run calibrate` | 12 contrôles de comportement du véhicule à 30, 60 et 120 Hz ; régénère `docs/architecture/calibration-results.json` |
| `npm run measure-catalog` | 0-100 km/h, vitesse de pointe et freinage de chacun des 18 véhicules |
| `node --experimental-strip-types scripts/tire-diagnostics.mjs [id]` | Séries temporelles roue par roue (glissement, températures) |

Une fonctionnalité est terminée quand ses tests passent, que `calibrate` reste vert et que les chiffres de référence ne régressent pas : voir [la feuille de route](docs/ROADMAP.md#14-définition-de--terminé-).

## Organisation

```
src/
  app/          écrans (menu, garage, circuits, lieu), scène de conduite
  vehicle/      solveur (pneus, transmission), profils par véhicule, catalogue, rendu
  world/        routes, bâtiments, eau, trottoirs, streaming de chunks
  circuits/     tracés des 24 circuits et leur géométrie
  geo/ map/     projection, origine flottante, Overpass, géocodage, cache
  ui/ debug/    tableau de bord, mini-cartes, panneau de performance
scripts/        calibration, mesures, tests de bout en bout (e2e/)
docs/           architecture, feuille de route, performance
```

## Documentation

- [Feuille de route](docs/ROADMAP.md) : état réel, limites connues, évolutions prévues.
- [Dossier d'architecture](docs/architecture/README.md) : décisions de conception.
- [Modèle de pneu et de transmission](docs/architecture/step-6-tire-model.md).
- [Performance](docs/PERFORMANCE.md) : budgets, mesures, comment mesurer.

## Déploiement

Application statique, sans backend. `vercel.json` configure Vercel (`npm run build`, sortie `dist/`, en-têtes de cache). Le workflow `.github/workflows/ci.yml` exécute lint, typecheck, tests et build à chaque push.

## Données et licences

Voir [NOTICE](NOTICE) : © contributeurs OpenStreetMap (ODbL), tracés de circuits `bacinger/f1-circuits` (MIT), modèles Kenney Car Kit (CC0).
