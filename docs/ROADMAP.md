# Cardrive — Feuille de route

Dernière mise à jour : 10 octobre 2026. Ce document complète le [dossier d’architecture](architecture/README.md) (décisions de conception et plan initial en 7 étapes) : il décrit **l’état réel**, la **dette connue** et les **évolutions prévues**, avec pour chacune la raison, l’approche, les critères de fin, l’effort et les risques.

Légende des efforts (estimations indicatives pour une personne, à réviser au démarrage) : **S** < 1 jour · **M** 1 à 3 jours · **L** 1 à 2 semaines · **XL** > 2 semaines.
Légende des statuts : ✅ livré · 🟡 partiel · ⬜ à faire.

## Sommaire

1. [État actuel](#1-état-actuel)
2. [Principes de priorisation](#2-principes-de-priorisation)
3. [Phase 0 — Stabiliser et mesurer](#3-phase-0--stabiliser-et-mesurer)
4. [Phase 1 — Son et ressenti](#4-phase-1--son-et-ressenti)
5. [Phase 2 — Mode course](#5-phase-2--mode-course)
6. [Phase 3 — Physique avancée](#6-phase-3--physique-avancée)
7. [Phase 4 — Monde](#7-phase-4--monde)
8. [Phase 5 — Véhicules et personnalisation](#8-phase-5--véhicules-et-personnalisation)
9. [Phase 6 — Interface, commandes et accessibilité](#9-phase-6--interface-commandes-et-accessibilité)
10. [Phase 7 — Diffusion et en ligne](#10-phase-7--diffusion-et-en-ligne)
11. [Séquencement proposé](#11-séquencement-proposé)
12. [Registre des risques](#12-registre-des-risques)
13. [Hors périmètre](#13-hors-périmètre)
14. [Définition de « terminé »](#14-définition-de--terminé-)

---

## 1. État actuel

### 1.1 Ce qui est livré

| Domaine | Contenu | Statut | Où |
| --- | --- | --- | --- |
| Fondation | Vite, React 19, TypeScript strict, three.js via R3F, Rapier (WASM), Vitest, ESLint | ✅ | `package.json`, `src/main.tsx` |
| Véhicule | Suspension à 4 roues par raycast, caisse Rapier, caméra de poursuite, respawn | ✅ | `src/vehicle/`, `src/camera/` |
| Pneus et transmission | Pacejka en glissement combiné, rotation des roues, différentiel ouvert, inertie moteur, ABS prédictif, thermique à 2 nœuds | ✅ | `tireModel.ts`, `VehicleSimulation.ts`, [step-6-tire-model.md](architecture/step-6-tire-model.md) |
| Calibration | 12 contrôles automatiques (repos, accélération, freinage, recul, virage, slalom, bosse, collision, respawn, pause), indépendants de la cadence 30/60/120 Hz | ✅ | `scripts/calibrate-vehicle.mjs`, [step-2-calibration.md](architecture/step-2-calibration.md) |
| Routes réelles | Projection locale, Overpass avec repli sur 3 miroirs, géocodage Nominatim avec autocomplétion, cache IndexedDB (versionné) | ✅ | `src/geo/`, `src/map/` |
| Streaming | Chunks de 256 m (physique 3×3, rendu 5×5), origine flottante atomique, machine d’états, sol de secours | ✅ vérifié en navigateur : 7 frontières, 2 recentrages, saut de caméra 0,6 m, colliders alignés | `src/world/streaming/` |
| Décor OSM | Bâtiments extrudés avec colliders, trottoirs avec collision (coupés aux carrefours, y compris entre chunks voisins), eau (surfaces, rivières, mur invisible), textures procédurales | ✅ | `src/world/` |
| Catalogue de voitures | 18 véhicules (prototype + 17 modèles Kenney CC0), garage, mémorisation du choix | ✅ | `src/vehicle/catalog/`, `public/models/cars/` |
| Physique par véhicule | Profil réel (masse, gabarit, puissance, rapports, grip, freins, aéro, direction, transmission) → configuration complète | ✅ | `vehicleProfiles.ts` |
| Circuits F1 2026 | 24 tracés (piste, vibreurs, murs, ligne de départ), mini-carte hors ligne, sélecteur avec vignettes | ✅ | `src/circuits/` |
| Interface | Menu, garage, lieux récents, HUD (vitesse, rapport, régime, détails avec `T`), pause, tactile | ✅ | `src/app/`, `src/ui/` |
| Qualité | 157 tests, 12 contrôles de calibration, 8 scénarios de bout en bout, panneau de performance (F3), CI GitHub verte | ✅ | `tests/`, `scripts/`, `src/debug/` |

### 1.2 Chiffres de référence (prototype, pneus froids)

| Mesure | Valeur | Référence réelle |
| --- | --- | --- |
| 0-100 km/h | 9,9 s | 10,5-10,8 s (1.6 VTi 120) |
| Freinage 100 → 0 | 45 m | ≈ 40-45 m |
| Vitesse de pointe | 189 km/h | 188 km/h |

### 1.3 Limites connues

- Monde **plat** : routes, circuits et décor n’ont aucun relief.
- Une seule surface (asphalte sec) : l’herbe adhère comme la route.
- Aucun son, aucun chronomètre, aucun adversaire, aucune sauvegarde de score.
- Les modèles Kenney n’ont qu’une texture : pas de repeinture.
- Une route appartient au chunk de son **premier nœud** (pas de découpage exact aux frontières) ; les trottoirs et l’eau compensent, pas les routes elles-mêmes.
- Les miroirs Overpass publics sont instables et limitent les accès répétés (500, 504, 403 « liste blanche », réponse vide hors Suisse pour `osm.ch`). L'application les contourne (R-0.6) mais ne peut pas garantir un chargement : voir R-7.3.
- La conduite réelle dans un navigateur de bureau (sensation, FPS) n’a pas été validée sur une machine de référence.

---

## 2. Principes de priorisation

1. **Sensation de conduite d’abord** (déjà le principe du dossier d’architecture) : le son, le relief et les surfaces pèsent plus que le décor.
2. **Mesurer avant d’optimiser** : le panneau F3 et `npm run e2e -- --gpu` existent (R-0.4) ; la marge GPU réelle et les machines d’entrée de gamme restent à mesurer.
3. **Chaque fonctionnalité apporte son test** : le solveur est déterministe et indépendant de la cadence, ce qui permet des tests de bout en bout dans Rapier headless (`tests/tireRealism.test.ts`). À conserver.
4. **Pas de dépendance à un service payant ou à un secret côté navigateur** (toutes les variables `VITE_*` sont publiques).
5. **Licences vérifiées avant intégration** : modèles, sons, tuiles, données d’altitude.

---

## 3. Phase 0 — Stabiliser et mesurer ✅

Terminée le 10 octobre 2026. Bilan par fiche ; le détail des mesures est dans [PERFORMANCE.md](PERFORMANCE.md).

| Fiche | Statut | Résultat |
| --- | --- | --- |
| R-0.1 Vitesse de pointe | ✅ | 189 km/h (publié : 188). 0-100 en 9,9 s (publié : 10,5-10,8 s) |
| R-0.2 Vérification visuelle automatisée | ✅ | `npm run e2e` : 7 scénarios, images de référence, console surveillée |
| R-0.3 Conduite réelle des chunks | ✅ | **Trois défauts réels corrigés** (voiture qui traverse l'écran au recentrage, colliders de bâtiments restés dans l'ancien repère, ombres absentes hors de l'origine). Validé en navigateur : 7 frontières, 2 recentrages, saut de caméra 0,6 m |
| R-0.4 Budget de performance | ✅ | Panneau F3, budgets, mesures sur la machine de développement ; **machine d'entrée de gamme non mesurée** |
| R-0.5 Fins de ligne, licences | ✅ | `.gitattributes`, `NOTICE`, `README.md` |
| R-0.6 Miroirs Overpass | ✅ | Santé des miroirs, nouveaux miroirs ; les services publics restent instables |
| R-0.7 Cohérence | ✅ | Noms, seuils, tests ajoutés |
| R-0.8 Déploiement statique | 🟡 | `vercel.json` prêt ; **CI GitHub verte** (lint, typecheck, tests, build) ; **non déployé** (nécessite un compte) |

### R-0.1 Vitesse de pointe ✅
- **Causes trouvées** (deux, cumulées, et aucune dans le moteur) : l'amortissement linéaire de Rapier (`linearDamping: 0.01`) retirait 1 % de la vitesse par seconde, soit ≈ 530 N à 173 km/h, une résistance fantôme qui doublait presque la traînée de l'air ; la surface frontale (2,69 m²) était le rectangle largeur × hauteur et non la surface réelle d'une voiture (≈ 87 %, soit 2,2 m²).
- **Effet de bord corrigé** : retirer la résistance fantôme a fait dépasser leur cible à tous les véhicules du catalogue (berline sport à 307 km/h pour 270 visés). La vitesse visée est maintenant fixée par la démultiplication du dernier rapport (`REDLINE_OVER_TOP_SPEED` dans `vehicleProfiles.ts`) : le catalogue retombe sur ses cibles (berline 214 pour 215, pompiers 115 pour 115, tracteur 55 pour 55).
- **Garde-fous** : tests `tireRealism` sur le 0-100, la vitesse de pointe et l'absence d'amortissement linéaire caché.
- **Reste** : le 0-100 simulé est 6 à 9 % plus rapide que le chiffre publié.

### R-0.2 Vérification visuelle automatisée ✅
- **Contenu** (`scripts/e2e/`, `npm run e2e`) : menu, garage (18 véhicules, caractéristiques), catalogue de circuits (24), conduite à Monaco, pause et reprise, choix d'un camion et conduite à Singapour, ville synthétique (streaming, recentrage), collision contre un mur après deux recentrages. Échoue sur toute erreur de console, tout écran uniforme, toute régression visuelle des écrans d'interface au-delà de 0,4 % de pixels, tout dépassement grossier du budget physique.
- **Pilote** : Chrome sans interface par le protocole DevTools, sans dépendance. Rendu logiciel (SwiftShader) par défaut pour la reproductibilité, `--gpu` pour des mesures représentatives.
- **Ce qu'il a trouvé au premier passage** : un `favicon.ico` absent (erreur 404 en console, en production aussi).
- **Limites** : les scènes 3D ne sont pas comparées pixel à pixel (non déterministes) ; elles sont validées par des assertions (accélération, rendu non uniforme, compteurs, saut de caméra, position d'arrêt contre un mur). Une capture en fin de conduite (`scripts/e2e/output/*-fin.png`) permet de vérifier à l'œil l'éclairage et les ombres. Les images de référence dépendent de la police du système : `npm run e2e:update` sur une autre machine.

### R-0.3 Conduite réelle des chunks ✅
Mesurer au lieu de supposer a trouvé **trois défauts réels**, absents de tous les tests unitaires :

1. **La voiture traversait l'écran au recentrage de l'origine flottante.** Le vecteur voiture→caméra sautait de **351 m** (rendu matériel) à **915 m** (logiciel) entre deux images, contre ≈ 1 m en conduite normale. Causes cumulées : le châssis était déplacé dans le pas physique alors que chunks et caméra attendaient le rendu suivant ; l'interpolation de `@react-three/rapier` dessine le châssis entre sa position du pas précédent et celle du pas courant, deux repères différents après le déplacement ; et la caméra était replacée à sa position idéale alors qu'elle suit normalement avec ≈ 13 m de retard à 185 km/h. **Correctifs** : recentrage en deux temps, appliqué dans la même validation que les chunks (`FloatingOriginApplier`) ; interpolation de Rapier remplacée par une extrapolation sans état passé (`GenericCar`, `stepClock.ts`) ; caméra décalée du même vecteur que le monde au lieu d'être replacée. **Résultat : saut de 0,5 à 0,6 m, indiscernable de la conduite normale (0,5 à 0,7 m).**
2. **Les colliders des bâtiments restaient dans l'ancien repère après un recentrage.** `@react-three/rapier` ne relit la position d'un corps fixe que si l'une de *ses* propriétés change ; ici c'est le groupe parent qui bouge. Un mur placé à 2,5 km, après deux recentrages, laissait passer la voiture à 188 km/h (et des murs fantômes existaient ailleurs). **Correctif** : l'ancre fait partie de la clé de chaque corps fixe, ils sont recréés dans la validation qui déplace les groupes. **Résultat : arrêt contre le mur à 2,5 m de la valeur attendue après 1, 2 et 3 recentrages.** *Ce défaut touchait tous les bâtiments, trottoirs et plans d'eau en ville dès le premier kilomètre.*
3. **Plus d'ombres au-delà de 75 m de l'origine.** La lumière et sa zone d'ombre étaient fixes ; en ville l'origine se recentre toutes les ≈ 1 km, la voiture roulait donc presque tout le temps hors de la zone, sans ombre ni celle des bâtiments. **Correctif** : `FollowingSun` suit la voiture. Il a révélé de l'**acné d'ombre** (motif moiré sur les trottoirs et les murs de circuit, déjà visible avant sans qu'on le remarque) : biais de carte d'ombre réglé.

- **Scénarios** (`npm run e2e`) : ville synthétique **déterministe et hors ligne** (avenue de 5 km avec immeubles, trottoirs et étang, servie à la place d'Overpass et de Nominatim) : 45 s à 185 km/h, 7 frontières de chunk franchies, 2 recentrages, 0 chunk en échec, génération de chunk ≤ 0,3 ms, saut de caméra < 5 m exigé ; mur à 2,5 km exigé arrêtant la voiture après deux recentrages. Un test unitaire couvre la route longue (`tests/streamingCoverage.test.ts`). Le premier mock avait lui-même un défaut (anneaux de bâtiments mal fermés, tous rejetés : la ville n'avait aucun bâtiment) : trouvé en voyant le mur ne rien arrêter.
- **Vraie ville** (`--network`) : Paris, 30 puis 75 s, 162 km/h, 0 chunk en échec ; le seuil de recentrage n'y a pas été atteint (cause non établie). Les services publics ont ensuite limité les accès répétés : à refaire quand ils répondent.
- **Reste** : quartier très dense ; limite connue R-4.6 (une voie plus longue que le rayon de rendu disparaît derrière le véhicule, codée comme échec attendu).

### R-0.4 Budget de performance ✅
- Panneau F3 : images/s, p95, pas physique, solveur véhicule, triangles, appels de rendu, colliders, mémoire, chunks. Budgets et tests (`tests/perfStats.test.ts`). Machine de référence : i5-13400F / RTX 4070.
- **Résultat** : physique + solveur ≈ 2 % du budget d'une image ; génération d'un chunk ≈ 0,2 ms.
- **Reste, important** : le mode headless plafonne à ≈ 100 images/s, la marge GPU réelle n'est pas connue ; aucune mesure sur machine d'entrée de gamme.

### R-0.5 Fins de ligne et hygiène du dépôt ✅
`.gitattributes` (LF partout), `NOTICE` (OpenStreetMap, tracés `bacinger/f1-circuits`, Kenney Car Kit), `README.md` (commandes, organisation, documentation).

### R-0.6 Sélection des miroirs Overpass ✅
- `MirrorHealth` : un miroir en échec est repoussé en fin de liste pour 30 s, 1, 2 puis 5 min au plus ; une réponse vide suspecte compte pour moitié ; aucun miroir n'est jamais exclu. Partagé entre le chargement initial et le streaming. Testé sans réseau.
- Miroirs réévalués : `overpass.openstreetmap.fr` et `overpass.private.coffee` répondent vite (< 1 s) et autorisent le navigateur (CORS) aux premières requêtes, mais le premier bascule sur « usages sur liste blanche » (403) et le second sur 500 dès que les requêtes se répètent. **Aucun miroir public ne tient la charge d'un test automatisé** : c'est pourquoi la ville de l'e2e est simulée.
- **Reste** : un vrai correctif durable demande un cache plus agressif (zones déjà vues), voire un service dédié (voir R-7.3 pour la contrainte d'architecture).

### R-0.7 Petits écarts de cohérence ✅
- Nom d'un véhicule : source unique, le catalogue. Seuils « froid / chaud » du HUD : dérivés de la température optimale du véhicule. Frein moteur : vérifié, ce n'est **pas** un doublon (couple net = gaz × couple moteur − (1 − gaz) × frein moteur, la forme standard).
- Tests ajoutés : eau répartie entre chunks, trottoirs coupés par une route du chunk voisin.
- Erreur de comptage corrigée : le catalogue compte **18** entrées (le prototype et 17 modèles), pas 17.

### R-0.8 Déploiement statique 🟡
- `vercel.json` (build, `dist`, cache immuable des fichiers hachés, cache d'une semaine des modèles, en-têtes de sécurité) et `.github/workflows/ci.yml` (lint, typecheck, tests, build). Un favicon a été ajouté.
- **Reste** : le déploiement lui-même (compte Vercel), la vérification de l'URL publique et du temps de chargement réel. La CI n'a pas encore tourné sur GitHub.
- Bundle : 283 ko au démarrage ; le moteur 3D et physique (3,26 Mo, 1,12 Mo compressé) se charge au lancement d'une partie. Le découpage en fichiers de bibliothèques a été essayé et abandonné (aucun gain).

---

## 4. Phase 1 — Son et ressenti 🟡

Le jeu était muet : c’est ce qui lui retirait le plus de vie. Tout est synthétisé (aucun fichier audio, donc aucune licence à suivre).

### R-1.1 Moteur ✅
- Oscillateurs (fondamentale, harmoniques 2 à 4, sous-harmonique) → saturation → passe-bas, pilotés par `engineRpm` et la charge ; fréquence de combustion selon le nombre de cylindres ; ronflement d’admission. Un profil par véhicule du catalogue (4 cylindres, 6 cylindres, V8, diesel, 10 cylindres de course, 2-temps du kart) et un profil électrique (sifflement) pour le prototype futuriste.
- Coupure de couple aux changements de rapport (baisse de 0,22 s), limiteur de régime audible (hachage à 14 Hz). Le contexte démarre au premier geste, fondu et suspension à la pause.
- Vérifié en e2e (rendu matériel) : le contexte tourne, la hauteur passe de ≈ 30 Hz à ≈ 205 Hz et la sortie est à ≈ −13 dBFS.

### R-1.2 Pneus, vent, impacts ✅
- Crissement piloté par `telemetry.slip` (début 0,95, plein à 1,6, nul sous 3 m/s), bruit de roulement et vent selon la vitesse, chocs détectés par la variation de vitesse d’un pas physique à l’autre (> 2,5 m/s).
- Vérifié en e2e : un dérapage au frein à main fait monter le crissement (≈ 0,4) et la touche M coupe la sortie (−120 dBFS).
- Limite connue : le bruit de roulement ne dépend pas encore de la surface (R-3.1).

### R-1.3 Volume, mixage et accessibilité sonore ✅
- Menu pause : volume général, moteur, pneus/vent/chocs (courbe quadratique), « Sans son » (touche M) et « Effets de caméra » ; réglages mémorisés (`cardrive.audioSettings`). Le son se coupe quand le jeu est en pause ou l’onglet masqué.

### R-1.4 Retour visuel du ressenti 🟡
- Livré : fumée des pneus (puissance de frottement), traces noires au sol (anneau de 6 000 quadrilatères), étincelles aux chocs, tremblement de caméra (vibration à haute vitesse + choc qui s’éteint en 0,55 s), champ de vision de 52° à 65° selon la vitesse. Tout est désactivé par `prefers-reduced-motion` ou l’option « Effets de caméra ». Les effets suivent les recentrages d’origine flottante.
- **Reporté** : poussière hors piste, volontairement : sans surfaces (R-3.1) elle ne saurait pas quand apparaître.
- Vérifié sur capture (Singapour, frein à main à 90 km/h) : traces et fumée visibles ; non mesuré en images/s au-delà du scénario e2e (100 img/s, plafonné).

---

## 5. Phase 2 — Mode course

C’est le plus gros manque de gameplay : 24 circuits existent, mais rien ne les transforme en course.

### R-2.1 Chronométrage et tours — M ⬜
- **Approche** : la ligne centrale est fermée et la ligne de départ connue (`track.startLine`). Calculer l’abscisse curviligne de la voiture par projection sur la ligne centrale (grille déjà utilisée pour les murs) ; détecter le franchissement de la ligne ; secteurs = tiers du tour.
- **Anti-triche** : exiger le passage par tous les secteurs dans l’ordre ; invalider un tour si la voiture est restée plus de N secondes hors piste ou repositionnée (`R`).
- **Fin** : chrono du tour courant, meilleur tour, dernier tour, delta ; tests unitaires sur la détection (tour normal, marche arrière sur la ligne, raccourci).

### R-2.2 Records sauvegardés — S/M ⬜
- Meilleur tour par couple circuit × voiture, en `localStorage` (même approche que les lieux récents et le choix de voiture), format versionné ; écran « Records » dans le menu.
- **Piège** : le stockage peut être indisponible : toujours en `try/catch`, jamais bloquant.

### R-2.3 Fantôme du meilleur tour — M ⬜
- Enregistrer position et cap à fréquence fixe (par ex. 20 Hz), rejouer un modèle translucide interpolé ; stocker compressé (delta + quantification).
- **Dépend de** : R-2.1, R-2.2.

### R-2.4 Pilotes IA — L ⬜
- **Approche** : une IA qui suit la ligne centrale avec une **vitesse cible par virage** calculée depuis la courbure (v² = μ·g·R, plafonnée par la puissance et le freinage de la voiture via `vehicleConfigFor`), pilotage par poursuite de point, et les mêmes commandes que le joueur (`VehicleInput`) pour utiliser **le même solveur**.
- **Étapes** : (1) un adversaire isolé, (2) évitement simple et dépassement, (3) niveaux de difficulté (marge de vitesse), (4) plusieurs voitures et coût des colliders.
- **Risques** : les virages issus de tracés à la main sont approximatifs (rayons surestimés → IA trop prudente ou, à l’inverse, trop optimiste) ; prévoir un réglage par circuit. Performance : N solveurs de véhicule par pas physique.

### R-2.5 Départ, drapeaux et classement — M ⬜
- Grille de départ, feux de départ, faux départ, classement en direct, arrivée au bout de N tours, écran de résultats. Voiture-balai / limiteur de pit non requis au début.
- **Dépend de** : R-2.1, R-2.4.

### R-2.6 Modes complémentaires — M chacun ⬜
- **Contre-la-montre** (tours illimités, fantôme), **dérive** (score selon angle × vitesse × durée, utilisable dès maintenant sur un parking de piste), **slalom/coupe** de cônes sur la piste d’essai.

---

## 6. Phase 3 — Physique avancée

Chaque ligne s’appuie sur le solveur actuel, qui a des tests de bout en bout : ajouter le mécanisme **et** son scénario de calibration.

### R-3.1 Surfaces et coefficients — M/L ⬜
- **Pourquoi** : aujourd’hui l’herbe adhère comme l’asphalte (un seul `tireGrip`).
- **Approche** : une table de surfaces (`asphalt`, `concrete`, `gravel`, `grass`, `sand`, `ice` : le type `SurfaceMaterial` existe déjà) avec facteur de grip, résistance au roulement et chaleur transmise ; identifier la surface sous chaque roue (userData du collider ou index par triangle ; pour les circuits, distance à la ligne centrale suffit) ; le facteur multiplie la force maximale dans `tireForce`.
- **Fin** : sortie de piste visiblement plus lente et glissante, bruit et particules adaptés (R-1.2, R-1.4), test : freinage sur herbe ≥ 1,5× plus long que sur asphalte.

### R-3.2 Relief des routes et des circuits — L/XL ⬜
- Voir R-4.1 pour les données ; côté physique : collider en maillage de hauteur plutôt que sol plat, raycasts de suspension inchangés, normales du terrain utilisées par les pneus (déjà gérées : la force suit la normale du contact).
- **Points délicats** : continuité aux frontières de chunks, coût des colliders trimesh/heightfield, pente maximale tolérée par le franchissement d’obstacles, ponts et tunnels (exclus aujourd’hui par `roadGraph.ts`).
- **Fin** : montée et descente continues, compression en bas de côte visible en télémétrie, pas de décollage parasite aux raccords.

### R-3.3 Contrôle de traction et différentiel — M ⬜
- Différentiel autobloquant (couple réparti selon l’écart de vitesse des roues motrices) et contrôle de traction réglable (limite de κ sur les roues motrices). Option dans le menu : **aides** (aucune / moyennes / complètes), qui agissent aussi sur l’ABS et la stabilité.
- **Pourquoi** : une propulsion de 300 kW patine énormément au départ avec un différentiel ouvert.
- **Fin** : le départ lancé d’une berline sport est 20 % plus rapide avec aides complètes ; tests de non-régression sur les 12 contrôles.

### R-3.4 Aérodynamique — M ⬜
- Déportance (portance négative selon v²) répartie avant/arrière, qui augmente la charge de roue donc le grip ; sillage derrière un autre véhicule (réduction de traînée). Paramètres par profil (`vehicleProfiles.ts`).
- **Effet** : les voitures de course tiennent aujourd’hui par leur gomme seule (grip 1,8-2,0) ; avec déportance on peut ramener la gomme à des valeurs réalistes et obtenir la vraie dépendance à la vitesse.

### R-3.5 Usure des pneus et carburant — M/L ⬜
- Usure en fonction du travail de glissement déjà calculé (`slidingPowerW`), qui réduit le grip ; carburant qui allège la voiture pendant la course et fixe l’autonomie. Stratégie : arrêt aux stands (R-2.x futur).

### R-3.6 Météo et état de la piste — L ⬜
- Pluie : réduction du grip (facteur global puis par zone mouillée), aquaplanage au-delà d’une vitesse dépendant de la hauteur d’eau, séchage de la trajectoire. Température de l’air et de la piste influençant l’échauffement des pneus (le paramètre `ambientTemperatureC` existe déjà).
- **Dépend de** : R-3.1 ; coût visuel : voir R-4.4.

### R-3.7 Dégâts et collisions — L ⬜
- Dégâts mécaniques (perte de puissance, déséquilibre de direction, pneu qui crève) selon l’énergie d’impact, et déformation visuelle simple (déplacement de sommets du modèle). Le collider reste un pavé : ne pas viser BeamNG.
- **Options** : mode « sans dégâts » (par défaut) pour ne pas pénaliser les débutants.

### R-3.8 Boîte manuelle et embrayage — M ⬜
- Mode manuel (montée/descente de rapport au clavier ou à la manette), embrayage modélisé (couple transmis limité, patinage au démarrage), régime moteur libre. Le solveur sait déjà lier le régime aux roues motrices et réfléchir l’inertie moteur ; il manque la sélection de rapport par le joueur et la mise en neutre.
- **Fin** : calage possible, rétrogradage trop haut en régime bridé (ou dommage), indicateur de rapport conseillé.

### R-3.9 Franchissement et stabilité — M ⬜
- Test de retournement et de remise sur roues (aujourd’hui `R` repositionne), protection contre les erreurs numériques à très haute vitesse (CCD actif, valider à 350 km/h sur la voiture de course futuriste), limites de vitesse angulaire.

---

## 7. Phase 4 — Monde

### R-4.1 Source d’altitude — M ⬜ (étude puis intégration)
- **À trancher** (point déjà ouvert au dossier d’architecture) : service de tuiles d’élévation public (CORS, quotas, licence, résolution) ou jeu de données hors ligne par circuit. Pour les 24 circuits, l’altitude du départ existe déjà dans la source des tracés ; le profil complet pourrait être saisi pour les plus célèbres (Spa, Suzuka, Interlagos, COTA) et lissé pour les autres.
- **Fin de l’étude** : décision écrite (source, licence, taille, format, cache), prototype de lecture sur une zone, estimation du coût mémoire par chunk.
- **Dépend de** : R-3.2.

### R-4.2 Circuits plus fidèles — L ⬜
- Largeur de piste réelle par tronçon (la largeur actuelle est estimée par circuit), épingles et chicanes affinées (le tracé à la main est approximatif en virage), voie des stands, zones d’échappatoire en gravier/herbe/asphalte, tribunes, bâtiments de stands, panneaux de distance, éclairage de nuit pour Singapour, Las Vegas, Bahreïn, Jeddah, Abou Dabi et Lusail.
- **Piège** : ne pas surcharger le fichier de données généré `f1Circuits2026.ts` ; ajouter des fichiers de détails par circuit chargés à la demande.

### R-4.3 Ville vivante — XL ⬜
- **Décor** : arbres, lampadaires, feux et passages piétons (déjà présents dans OpenStreetMap), mobilier urbain, instanciation (`InstancedMesh`) pour tenir le budget.
- **Trafic** : voitures qui suivent le graphe routier (`roadGraph.ts`) avec priorités aux jonctions ; densité réglable, désactivable. Le graphe actuel ne gère ni sens uniques ni feux : à enrichir.
- **Piétons** : après le trafic, optionnel.
- **Risque** : coût CPU physique et rendu ; commencer par du trafic sans collision physique (rendu seul) avant d’ajouter des corps.

### R-4.4 Jour, nuit et ciel — M/L ⬜
- Cycle jour/nuit (soleil, ombres, ambiance), phares et feux de la voiture, ciel dégradé et brouillard au lieu du noir uni, éclairage public nocturne. L’éclairage actuel est une configuration unique (`DrivingScene.tsx`).

### R-4.5 Eau praticable, ponts et tunnels — L ⬜
- Aujourd’hui l’eau est un mur invisible et les ponts, tunnels et niveaux sont **exclus** du graphe (`bridge`, `tunnel`, `layer`). Les remettre exige une notion de hauteur (dépend de R-3.2) : ponts avec rampes, tunnels, passages sous un pont.

### R-4.6 Routes aux frontières de chunks — M ⬜
- Une route appartient au chunk de son premier nœud : un chunk évincé fait disparaître une route longue que l’on longe encore. Appliquer à `splitRawByChunk` la même logique que `splitWaterByChunk` (copie dans chaque chunk touché + découpage), avec tests de non-doublon des colliders.
- **Risque** : colliders dupliqués, donc d’abord un test de cycle de vie des chunks.

### R-4.7 Circuit sur mesure — M/L ⬜
- Générer un circuit depuis des routes réelles : choisir un lieu, tracer une boucle sur le graphe routier, obtenir un circuit chronométré (réutilise R-2.x et la mini-carte hors ligne).

---

## 8. Phase 5 — Véhicules et personnalisation

### R-5.1 Peinture et finitions — M ⬜
- **Contrainte** : les modèles Kenney partagent une texture unique (`colormap.png`) : on ne peut pas teinter sans affecter les vitres et les roues.
- **Approche** : séparer les matériaux par nom au chargement (carrosserie / vitres / pneus) si les GLB le permettent, ou masque de teinte dérivé de la palette de la texture ; sinon passer au prototype procédural, qui a déjà `PAINT_COLOR`.
- **Fin** : sélecteur de couleur dans le garage, mémorisé par voiture.

### R-5.2 Réglages mécaniques — M/L ⬜
- Pression des pneus (grip et chaleur), raideur de suspension, rapport final, répartition de freinage, déportance. Exposer des **curseurs bornés** autour du profil ; écran de réglages avec effet affiché (0-100, vitesse de pointe, g en virage) calculé par le script de mesure existant.
- **Dépend de** : R-3.4 pour la déportance.

### R-5.3 Modèles plus détaillés — L/XL ⬜
- Remplacer ou compléter les modèles stylisés par des modèles à licence compatible (vérifier redistribution, attribution). Chaque modèle doit exposer ses 4 roues sous des noms normalisés (comme le test du catalogue le vérifie aujourd’hui : `wheel-front-left`, etc.), un point d’appui au sol et des dimensions.

### R-5.4 Progression et déblocage — M ⬜
- Monnaie ou points gagnés en course, déblocage de véhicules et d’améliorations. À ne faire qu’après R-2.x ; éviter toute économie qui rende le catalogue inaccessible : tout reste jouable en mode libre.

### R-5.5 Profils plus justes — S/M ⬜
- Revoir les profils (`vehicleProfiles.ts`) une fois R-0.1, R-3.3 et R-3.4 faits : ils ont été équilibrés avec le solveur actuel et perdraient leur cohérence (l’intégrale, par exemple, compense aujourd’hui l’absence d’autobloquant).

---

## 9. Phase 6 — Interface, commandes et accessibilité

### R-6.1 Manettes et volants — M/L ⬜
- API Gamepad : axes de direction/accélérateur/frein progressifs (le solveur accepte déjà des entrées analogiques, `VehicleInput`), zones mortes et courbes de réponse réglables, volants avec retour de force **dérivé du couple d’auto-alignement** calculé à partir de la force latérale des roues avant (disponible dans `tireForce`).
- **Fin** : conduite complète à la manette, retour de force qui s’allège à la limite d’adhérence.

### R-6.2 Remappage et réglages — M ⬜
- Remappage des touches (clavier AZERTY par défaut ; QWERTY en alternative), sensibilité de la direction, assistance de braquage selon la vitesse, qualité graphique (ombres, distance de vue, résolution de rendu, FPS plafonné), tout mémorisé.

### R-6.3 Caméras — M ⬜
- Cockpit, capot, pare-chocs, caméra TV, poursuite à distance réglable ; regard libre. La caméra de poursuite (`ChaseCamera.tsx`) a une distance fixe de 7,8 m qui convient mal aux poids lourds (9 m de long) : adapter à la longueur du véhicule.

### R-6.4 Replay et mode photo — L ⬜
- Enregistrement des dernières minutes (positions/entrées, déterministe grâce au pas fixe) et relecture avec caméras libres, ralenti, export de capture ; mode photo avec masquage de l’interface.

### R-6.5 Tableau de bord enrichi — M ⬜
- Compte-tours analogique en option, jauge de carburant et d’usure (R-3.5), température des pneus colorée selon l’état réel (R-0.7), delta de chrono (R-2.1), carte des secteurs. Garder le HUD par défaut minimal (retour utilisateur : l’ancien HUD était « un cirque »).

### R-6.6 Accessibilité — M ⬜
- Navigation clavier complète des menus (focus visible déjà présent), contraste vérifié, option de réduction des mouvements (déjà prise en charge dans le CSS : l’étendre à la caméra et aux effets), taille du texte, daltonisme (les alertes ne reposent pas que sur la couleur : ajouter une icône), sous-titres des événements sonores importants.

### R-6.7 Tactile — M ⬜
- Les commandes tactiles existent (joystick unique + frein à main) mais n’ont **jamais été vérifiées visuellement** (le CSS le dit). Test sur appareil réel ou émulation, ajustements de disposition avec la mini-carte et le bloc de vitesse.

### R-6.8 Langues — S/M ⬜
- Tous les textes sont en dur en français : extraire dans un dictionnaire et ajouter l’anglais. Formats de nombres et d’unités (km/h ↔ mph) selon la langue.

---

## 10. Phase 7 — Diffusion et en ligne

### R-7.1 Déploiement et intégration continue — S/M ⬜
- GitHub Actions : `lint`, `typecheck`, `test`, `build` sur chaque PR ; déploiement de prévisualisation ; échec si l’e2e (R-0.2) régresse ; `npm run calibrate` en tâche manuelle avec rapport.

### R-7.2 PWA et hors ligne — M ⬜
- Service worker : cache des modèles, textures et du code ; tuiles de carte non mises en cache par défaut (politique d’usage OSM : usage léger) ; la piste d’essai et les circuits (mini-carte hors ligne) fonctionnent sans réseau, les villes nécessitent le réseau.

### R-7.3 Classements en ligne — L ⬜
- **Contrainte du dossier d’architecture** : pas de backend applicatif. Un service tiers (base gérée avec règles d’accès, ou fonction serverless minimale) est une révision d’architecture à documenter avant de commencer. Prévoir validation côté serveur des temps (rejeu des entrées déterministes, grâce au pas fixe) pour limiter la triche.
- **Dépend de** : R-2.x, R-6.4 (rejeu).

### R-7.4 Multijoueur — XL ⬜
- Le plus lourd : synchronisation de physique, latence, triche. Approche à étudier en dernier : courses « asynchrones » (fantômes des autres joueurs, dérivé de R-2.3 et R-7.3) avant tout temps réel.

### R-7.5 Télémétrie d’usage — S/M ⬜
- Mesures anonymes optionnelles (FPS médian, erreurs, circuits joués) avec consentement ; rien de personnel. À arbitrer selon la politique de confidentialité visée.

---

## 11. Séquencement proposé

| Jalon | Contenu | Résultat attendu |
| --- | --- | --- |
| **M1 — Fiable** ✅ | R-0.1 à R-0.8 (R-0.8 : déploiement restant) | Un jeu mesuré, dont les régressions sont détectées ; reste à déployer |
| **M2 — Vivant** | R-1.1 à R-1.4, R-6.3, R-3.1 | Moteur, pneus, impacts, particules, caméras, surfaces : la conduite « se sent » |
| **M3 — Compétitif** | R-2.1 à R-2.3, R-2.5, R-2.6, R-6.5 | Chrono, records, fantôme, départ, classement, nouveaux modes |
| **M4 — Adversaires** | R-3.3, R-2.4, R-3.8, R-6.1 | IA, aides réglables, boîte manuelle, manette |
| **M5 — Relief** | R-4.1, R-3.2, R-4.6, R-4.5 | Monde en 3D réelle, routes sans disparitions, ponts et tunnels |
| **M6 — Contenu** | R-4.2, R-4.4, R-4.3, R-5.1 à R-5.5, R-3.4, R-3.5, R-3.6 | Circuits détaillés, nuit, trafic, personnalisation, météo, usure |
| **M7 — Communauté** | R-6.4, R-6.2, R-6.6, R-6.8, R-7.1 à R-7.3 | Replay, réglages, accessibilité, langues, classements |
| **Plus tard** | R-3.7, R-7.4, R-7.5 | Dégâts, multijoueur, télémétrie d’usage |

Deux ordres possibles selon l’objectif :
- **Amusant d’abord** : M1 → M2 → M3 → M4.
- **Simulateur d’abord** : M1 → R-3.1 → R-3.3 → R-4.1/R-3.2 (M5) → R-3.4, R-3.5 → M3.

---

## 12. Registre des risques

| Risque | Probabilité | Impact | Mitigation |
| --- | --- | --- | --- |
| Plusieurs solveurs de véhicules (IA) dépassent le budget physique par pas | Moyenne | Élevé | Mesurer dès R-0.4 ; solveur simplifié pour les adversaires lointains ; limiter à 8-12 voitures |
| Relief : discontinuités aux frontières de chunks, colliders trop coûteux | Élevée | Élevé | Prototyper sur un seul circuit ; hauteurs partagées aux bords ; budget de colliders mesuré |
| Instabilité numérique des pneus à très basse vitesse ou avec des véhicules légers | Moyenne | Moyen | Les garde-fous existent (vitesses de référence calculées, tests d’immobilité et de stabilité) : tout nouveau paramètre de pneu doit les repasser (`tests/tireRealism.test.ts`) |
| Fournisseurs publics (Overpass, Nominatim, tuiles OSM) instables ou limités | Élevée | Moyen | Cache, repli entre miroirs (R-0.6), états d’erreur explicites ; éviter toute charge en rafale |
| Licences (modèles, sons, tuiles, altitudes) | Moyenne | Élevé | Vérifier avant intégration ; attributions affichées ; tenir un `NOTICE` |
| Tracés de circuits approximatifs (tracés à la main) | Certaine | Moyen | Lissage déjà appliqué ; affiner circuit par circuit (R-4.2) ; ne pas promettre de fidélité au mètre |
| Dépendance à un seul développeur et à la validation manuelle | Moyenne | Moyen | Automatiser (R-0.2, R-7.1) ; documenter les décisions dans `docs/` |

---

## 13. Hors périmètre

- Reproduction exhaustive de la physique d’un simulateur professionnel (déformation de carrosserie en éléments finis, thermique de freins, aérodynamique CFD).
- Licences officielles (marques, pilotes, équipes de F1 : les circuits sont des tracés géographiques, sans logos ni noms de constructeurs).
- Application native ou console.
- Backend applicatif dans le premier MVP (voir R-7.3 si une révision d’architecture est décidée).

---

## 14. Définition de « terminé »

Une fonctionnalité de cette feuille de route est terminée quand :

1. Les **critères de fin** de sa fiche sont satisfaits et vérifiés (pas seulement « le build passe », conformément au dossier d’architecture).
2. Elle a ses **tests** : unitaires pour la logique pure, de bout en bout (Rapier headless) pour la physique, e2e (R-0.2) pour l’affichage.
3. `npm run lint`, `npm run typecheck`, `npm test` et `npm run build` passent ; les 12 contrôles de `npm run calibrate` restent verts.
4. Les **chiffres de référence** (§1.2) sont inchangés ou leur évolution est justifiée dans le commit.
5. La documentation (`docs/`) est à jour : cette feuille de route (statut), le dossier d’architecture si une décision change, et une note d’étape pour tout modèle physique nouveau.
6. Les **limites connues** (§1.3) sont mises à jour : une limite levée est retirée, une limite introduite est ajoutée.
