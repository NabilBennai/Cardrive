# Performance

Budgets, instrumentation et mesures de référence. Les chiffres sont des **mesures réelles sur la machine de développement**, avec leurs limites indiquées : une machine d'entrée de gamme n'a pas encore été mesurée.

## Mesurer

| Moyen | Contenu | Quand l'utiliser |
| --- | --- | --- |
| Touche **F3** en jeu | Panneau de performance (voir ci-dessous) | Diagnostic à la main, sur n'importe quelle machine |
| `npm run e2e` | Parcourt 7 scénarios, lit le panneau, échoue au-delà des budgets physiques (×3 en rendu logiciel) | Contrôle automatique, CI |
| `npm run e2e -- --gpu` | Même chose avec la carte graphique : les images/s deviennent représentatives | Mesures de référence |
| `npm run measure-catalog` · `scripts/tire-diagnostics.mjs` | Coût et résultats du solveur de véhicule hors rendu | Régressions de physique |

### Panneau F3

| Ligne | Source | Budget |
| --- | --- | --- |
| Images / s · moyenne · p95 | `useFrame` (`PerfProbe`) | p95 ≤ 20 ms (60 FPS = 16,7 ms) |
| Pas physique moy. · max | Début → fin d'un pas Rapier (`useBeforePhysicsStep` / `useAfterPhysicsStep`) | moyenne ≤ 4 ms |
| Solveur véhicule | Durée du solveur (pneus, suspension, transmission) par pas | ≤ 1 ms |
| Triangles · appels de rendu | `gl.info.render` (dernière image) | ≤ 1,5 M · ≤ 400 |
| Colliders · corps · géométries · textures | `world.colliders.len()`, `gl.info.memory` | information |
| Chunks actifs · en échec · franchis · recentrages | `useChunkStreamer`, `useFloatingOrigin` | 0 en échec ; ≥ 9 actifs |
| Génération de chunk moy. · max | Construction des graphes de routes, bâtiments, eau | max ≤ 25 ms |
| Mémoire JS | `performance.memory` (Chrome uniquement) | information |

Les valeurs qui dépassent leur budget passent en rouge. Les budgets sont dans `src/debug/perfStats.ts` (`PERF_BUDGET`) et testés (`tests/perfStats.test.ts`). Le coût de la sonde elle-même est négligeable : deux lectures d'horloge et un tampon circulaire par image, relevé des compteurs de scène toutes les 30 images.

## Machine de référence (développement)

| | |
| --- | --- |
| Processeur | Intel Core i5-13400F (10 cœurs, 16 threads) |
| Carte graphique | NVIDIA GeForce RTX 4070 |
| Navigateur | Chrome (mode headless « new »), fenêtre 1280 × 720, facteur d'échelle 1 |
| Date | 10 octobre 2026 |

C'est une machine **haut de gamme**. Elle sert à détecter les régressions, pas à garantir les 60 FPS partout : voir « Ce qui n'est pas mesuré ».

## Mesures (rendu matériel, 1280 × 720)

| Scène | Triangles | Images/s | Pas physique moy. | Solveur véhicule |
| --- | --- | --- | --- | --- |
| Circuit de Monaco | 41 558 | ≈ 100 | 0,11 ms | 0,21 ms |
| Circuit de Singapour, camion | 53 542 | ≈ 100 | 0,12 ms | 0,22 ms |
| Ville synthétique (avenue de 5 km) | 11 906 | ≈ 100 | 0,11 ms | 0,20 ms |
| Paris, rue de Rivoli (réseau réel) | 54 212 | ≈ 99 | 0,08 ms | 0,14 ms |

Streaming, ville synthétique, 45 s de conduite à 185 km/h : **7 frontières de chunk franchies, 2 recentrages d'origine flottante, 0 chunk en échec**, génération maximale d'un chunk **0,2 à 0,3 ms** (budget 25 ms), 25 chunks actifs.

Le budget physique est très largement respecté : le pas physique complet (Rapier + solveur de véhicule) représente **≈ 2 % du budget d'une image à 60 FPS**, et le solveur de véhicule seul **≈ 1 %**.

### Rendu logiciel (SwiftShader, utilisé par l'e2e pour la reproductibilité)

10 à 28 images/s selon la scène : c'est le processeur qui dessine, ces valeurs ne disent **rien** de la fluidité réelle. Seuls les temps de physique sont comparables (0,02-0,04 ms).

## Ce qui n'est pas mesuré

- **Marge de rendu réelle.** Le mode headless affiche ≈ 100 images/s sur toutes les scènes, ce qui ressemble à une cadence plafonnée (rafraîchissement de l'environnement headless) plutôt qu'à la capacité de la carte. La marge GPU n'est donc pas connue. À mesurer en navigateur normal avec F3, vitesse d'image non limitée.
- **Machine d'entrée de gamme** (portable sans carte dédiée, GPU intégré) : rien de mesuré. C'est le point qui peut contredire l'objectif de 60 FPS.
- **Ville dense** : la scène de Paris mesurée est une rue ; un quartier à plusieurs milliers de bâtiments par chunk n'a pas été chargé.
- **Mémoire GPU et fuite de ressources** sur une longue session (plusieurs recentrages, éviction de centaines de chunks).
- **Scintillement visuel au recentrage de l'origine flottante.** L'automatisation prouve qu'il a lieu sans erreur et sans trou de chunk ; elle ne mesure pas une éventuelle saccade de l'image à ce moment précis (voir `useFloatingOrigin.ts`).
- Temps de chargement initial sur réseau lent (le moteur 3D et la physique pèsent ≈ 1,1 Mo compressés, chargés au lancement d'une partie).

## Poids du build

| Fichier | Taille | Compressé | Chargé |
| --- | --- | --- | --- |
| Application (menu) | ≈ 283 ko | 89 ko | au démarrage |
| Moteur 3D + physique (`DrivingScene`) | ≈ 3,26 Mo | 1,12 Mo | au lancement d'une partie |
| Tracés des 24 circuits | 72 ko | 22 ko | à l'ouverture du catalogue |
| Modèles de voitures (17 GLB) + textures | 3,4 Mo au total | — | un seul modèle à la fois |

Le moteur physique embarque son WebAssembly en base64 (≈ 1,5 Mo) : c'est l'essentiel du chunk. Un découpage manuel en fichiers de bibliothèques a été essayé : rolldown regroupait three, React et Rapier ensemble sans gain, il a été abandonné (`vite.config.ts`).

## Pistes d'optimisation (non nécessaires aujourd'hui)

Instanciation des bâtiments répétitifs (`InstancedMesh`), fusion des géométries de trottoirs par chunk (déjà fait), niveaux de qualité (ombres, résolution, distance de rendu), WebAssembly physique chargé séparément, mise en cache HTTP longue des modèles (déjà configurée dans `vercel.json`). À engager seulement si une mesure sur machine d'entrée de gamme les justifie.
