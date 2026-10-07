# Étape 1 — Fondation, véhicule et piste de démonstration

Date : 7 octobre 2026.

Ce document décrit la livraison initiale. Le solveur, le freinage, la transmission et certains paramètres ont ensuite évolué dans [l’étape 2 — Calibration](step-2-calibration.md), qui décrit le comportement actuel.

## 1. Périmètre livré

L’application Vite, React et TypeScript fournit une démonstration de conduite 3D avec Three.js, React Three Fiber et Rapier. Un seul monde physique fait autorité. Aucun backend, fournisseur cartographique ou modèle automobile tiers n’est nécessaire : piste, carrosserie et roues sont procédurales.

La démo fonctionne sans API externe une fois ses fichiers chargés. Aucun service worker ne garantit leur disponibilité hors ligne. Le prototype R-01 possède quatre suspensions par raycast, deux roues arrière motrices, une direction avant, une boîte automatique, des freins, des collisions, une caméra de poursuite et un HUD.

## 2. Fonctionnement pour le joueur

**Prendre le volant** charge la scène 3D à la demande et donne le focus au jeu. Le véhicule apparaît en `(38, 0.9, 0)` mètres, orienté vers `+Z`. Le HUD affiche vitesse, régime moteur, rapport, glissement et nombre de roues détectant le sol.

| Action | Touches |
| --- | --- |
| Accélérer | Z, W ou flèche haut |
| Freiner / demander le recul | S ou flèche bas |
| Tourner à gauche | Q, A ou flèche gauche |
| Tourner à droite | D ou flèche droite |
| Frein à main arrière | Espace |
| Repositionner | R ou bouton du HUD |
| Mettre en pause | Échap ou bouton du HUD |
| Reprendre | Bouton de reprise |

Les commandes sont interceptées uniquement lorsque le jeu a le focus, en excluant les champs éditables. Cliquer sur le canvas redonne le focus. La pause suspend Rapier et efface les commandes. Masquer l’onglet suspend également la simulation ; elle reprend à son retour si aucune pause manuelle n’était engagée. La perte de focus de la fenêtre relâche les touches, sans déclencher à elle seule la pause physique.

Le respawn restaure la position et la rotation de départ, annule vitesses linéaire et angulaire, forces et couples utilisateur, puis réinitialise roues, transmission et télémétrie. La caméra rejoint son point de suivi sans amortissement au changement de version du respawn. R efface aussi les commandes actives ; le bouton utilise le même reset physique, les touches maintenues restant gérées par leurs événements de relâchement.

La scène utilise `React.lazy` et un état de chargement. Un message signale WebGL indisponible. Une frontière d’erreur propose **Réessayer** pour recréer la scène en cas d’échec d’initialisation.

## 3. Organisation technique

| Fichier | Responsabilité |
| --- | --- |
| `src/main.tsx` | Montage React et styles |
| `src/app/App.tsx` | Accueil, session, pause, visibilité, focus, chargement et erreurs |
| `src/app/DrivingScene.tsx` | Canvas, lumières et monde Rapier |
| `src/app/app.css` | Présentation de l’accueil et du HUD |
| `src/input/useDrivingInput.ts` | Commandes clavier normalisées |
| `src/vehicle/configs/genericVehicle.ts` | Paramètres mécaniques et validation |
| `src/vehicle/physics/useVehiclePhysics.ts` | Contacts, efforts, transmission et télémétrie |
| `src/vehicle/physics/vehicleMath.ts` | Calculs purs de suspension, friction et couple |
| `src/vehicle/rendering/GenericCar.tsx` | Corps physique, collider, carrosserie et roues |
| `src/world/terrain/DemoTrack.tsx` | Géométrie procédurale, sol et barrières |
| `src/camera/ChaseCamera.tsx` | Suivi amorti, obstacles et reset |
| `src/ui/DrivingHUD.tsx` | Affichage et actions |
| `src/shared/types.ts` | Contrats véhicule et types préparant la géographie |
| `tests/vehicleMath.test.ts` | Tests unitaires des calculs purs |

Les commandes et poses de roues passent par des références React. Aucun `setState` n’est effectué par roue. La télémétrie est publiée environ toutes les 0,1 seconde ; les roues visuelles et la caméra sont actualisées à chaque frame graphique.

## 4. Modèle physique

### Repère, intégration et châssis

Distances en mètres, forces en newtons, couples en N·m, angles en radians. Y est vertical ; +Z est l’avant du véhicule dans son repère local. Rapier utilise une gravité `(0, -9.81, 0)` et un pas fixe de `1/60 s`. Le solveur s’exécute dans `useBeforePhysicsStep`. Le composant `Physics` active l’interpolation du rendu.

Le châssis est un corps dynamique avec collider cubique explicite. Les propriétés de masse sont appliquées au collider ; les meshes esthétiques ne génèrent pas de collisions automatiques. La détection continue des collisions est activée et le corps ne s’endort pas.

| Paramètre | Valeur initiale |
| --- | --- |
| Masse | 1 180 kg |
| Longueur × largeur × hauteur | 3,56 × 1,82 × 1,04 m |
| Centre de gravité local | `(0, -0.08, 0)` m |
| Inerties principales X / Y / Z | 540 / 1 850 / 1 650 kg·m² |
| Amortissement linéaire / angulaire Rapier | 0,08 / 0,5 |
| Friction / restitution du collider châssis | 0,72 / 0,08 |
| Empattement / voie | 2,20 / 1,38 m |
| Rayon des roues | 0,34 m |

### Contacts et suspension

Les montages des roues sont à X = ±0,69 m, Z = ±1,1 m et Y = -0,08 m. Leur position et la direction locale descendante sont transformées par la pose du châssis. Chaque rayon mesure `0.57 + 0.30 + 0.34 = 1.21 m` et exclut le châssis et les capteurs.

Sans impact, aucun effort n’est appliqué et la suspension visuelle prend sa longueur maximale de 0,87 m. Avec impact :

```text
L = max(0.06, distanceImpact - rayonRoue)
compression = max(0, longueurRepos - L)
vDescente = vitesseAuContact · directionRaycast
Fnormal = clamp(k × compression + c × vDescente, 0, 19000)
Jsuspension = -directionRaycast × Fnormal × dt
```

La longueur au repos vaut 0,57 m, le débattement déclaré 0,30 m, la raideur k = 29 000 N/m et l’amortissement c = 3 200 N·s/m par roue. La force est non attractive et plafonnée à 19 000 N par roue. La borne de compression du calcul est 0,06 m ; aucun arrêt mécanique distinct n’est simulé.

`applyImpulseAtPoint` applique l’impulsion au point d’impact, ce qui produit aussi un effet angulaire autour du centre de masse. Les roues sont des sondes et des meshes ; elles n’ont pas de corps rigides propres.

### Pneus, freins et résistance

Les axes longitudinal et latéral suivent le châssis, avec le braquage sur l’essieu avant. Le calcul utilise actuellement les composantes X/Z des vitesses au contact ; il ne projette pas encore les axes sur la normale de surface et vise la piste plate.

```text
FlatDemandée = -vLatérale × 4600
Ffrein = -sign(vLongitudinale) × (frein × 7200 + freinMainArrière × 5800)
Frésistance = (42 × v + 0.5 × 1.225 × 0.32 × 2.0 × v × |v|) / 4
FlongDemandée = FmotriceParRoue + Ffrein - Frésistance
Fmax = Fnormal × 1.08
Flat = clamp(FlatDemandée, -Fmax, Fmax)
FlongMax = sqrt(max(0, Fmax² - Flat²))
Flong = clamp(FlongDemandée, -FlongMax, FlongMax)
Jpneu = (axeAvant × Flong + axeLatéral × Flat) × dt
```

Les freins agissent seulement si `|vLongitudinale| > 0.12 m/s`, afin d’éviter une inversion de signe à l’arrêt. Le frein à main agit sur l’essieu arrière. Le cercle de friction donne priorité à la demande latérale, puis affecte à la demande longitudinale l’adhérence restante. Les deux roues arrière reçoivent chacune la moitié de l’effort moteur.

La rotation visuelle des roues est intégrée avec `vLongitudinale × dt / rayon`. Elle ne représente pas une vitesse angulaire physique indépendante.

### Direction et groupe motopropulseur

Le braquage vaut `commande × 0.48 / (1 + vitesse × 0.032)`. La vitesse utilisée est la norme tridimensionnelle de la vitesse du châssis. L’angle maximal diminue ainsi avec la vitesse.

| Régime (tr/min) | Couple (N·m) |
| --- | --- |
| 850 | 185 |
| 1 800 | 230 |
| 3 400 | 260 |
| 5 200 | 220 |
| 6 400 | 150 |

Le couple est interpolé linéairement. Les rapports avant sont `3.15, 2.12, 1.48, 1.12, 0.86`, le rapport arrière `3.05`, le pont `3.55` et le rendement `0.84`.

```text
rpmCouplé = |vLongitudinale| / rayon × |rapport| × pont × 60 / (2π)
rpm = clamp(rpmCouplé + accélérateur × 650, 850, 6400)
Fmotrice = couple(rpm) × |rapport| × pont × 0.84 / rayon
           × (accélérateur - commandeArrière)
```

La boîte monte un rapport au-dessus de 5 700 tr/min avec un délai de 0,32 s et rétrograde sous 2 200 tr/min avec un délai de 0,26 s. Le calcul du régime et de l’effort utilise le rapport précédant le changement ; le nouveau rapport intervient au pas suivant.

Le frein demande le recul lorsque `|vLongitudinale| < 0.45 m/s`. Au-delà, la commande redevient un frein et la boîte repasse en avant. Aucun maintien de l’état de marche arrière n’est encore implémenté : le recul continu au-delà du seuil reste à corriger lors de la calibration.

La configuration est validée au chargement : valeurs mécaniques positives, quatre montages dont deux avant et au moins une roue arrière motrice, courbe triée, rapports et régimes cohérents. L’inertie des roues est déclarée mais pas encore utilisée par un solveur de rotation des pneus.

## 5. Correction de l’envol au démarrage

**Symptôme signalé :** la voiture partait à la verticale dès le lancement.

**Cause identifiée :** suspension et pneus appelaient `addForceAtPoint` à chaque pas. Les forces utilisateur Rapier persistent entre les pas ; sans remise à zéro, les efforts s’accumulaient. Même après perte du contact, la poussée accumulée restait appliquée.

**Correction réalisée :** les deux appels utilisent désormais `applyImpulseAtPoint`, avec multiplication par `rapierWorld.timestep`. Chaque impulsion vaut `J = F × dt` et ne crée pas de force utilisateur persistante. La rotation visuelle des roues utilise aussi le timestep courant plutôt qu’un `1/60` séparé. Le respawn conserve l’annulation des forces et couples utilisateur.

La correction traite l’accumulation identifiée. La stabilité au lancement reste à confirmer dans le navigateur ; aucun test intégré prolongé de simulation n’est revendiqué.

## 6. Piste, rendu et caméra

La piste est une courbe Catmull-Rom fermée, définie par 12 points d’une ellipse de rayons 38 et 25 m, échantillonnée en 144 segments. La chaussée fait 15 m de large.

Le contact physique au sol provient d’un collider plat de 220 × 180 m, dont la face supérieure est à Y = 0. Asphalte et marquages sont des meshes légèrement surélevés, sans relief physique. Les barrières comportent 288 colliders fixes, avec un rendu instancié et des couleurs alternées. La voiture est construite avec des primitives Three.js.

La caméra vise un point à 2,4 m devant et 0,58 m au-dessus du châssis. Elle souhaite se placer 7,8 m derrière et 3,5 m au-dessus. Un raycast excluant véhicule et capteurs rapproche la caméra en cas d’obstacle, avec une marge de 0,38 m et une distance minimale de 0,8 m. Son amortissement utilise `1 - exp(-3.8 × deltaRendu)`.

Le canvas utilise un DPR entre 1 et 1,6, une perspective de 52°, du brouillard et des ombres directionnelles de 2 048 × 2 048 pixels.

## 7. Télémétrie et limites

La vitesse affichée est la norme de la vitesse du châssis convertie en km/h, incluant ses composantes verticale et latérale. Le glissement est la moyenne de `|vLatérale| / (|vLongitudinale| + 1.5)` sur les roues avec impact, bornée à 100 % dans le HUD. Il ne mesure pas le patinage longitudinal. Le compteur de roues au sol compte les impacts, même si leur force de suspension est nulle.

L’indication `SEC / 02:14` est décorative : ni météo ni chronométrage ne sont implémentés. Les coordonnées de l’accueil sont également décoratives ; elles ne pilotent pas le circuit local.

Les valeurs mécaniques sont des paramètres initiaux de démonstration. Restent à réaliser :

- Calibration mesurée du freinage, de la direction et du transfert de charge.
- Embrayage, différentiel, frein moteur explicite et rotation physique des roues.
- Maintien cohérent du recul, ABS et antipatinage.
- Surfaces inclinées, bosses et franchissement volumique des bordures.
- GPS/OSM, streaming, origine flottante, trafic et catalogue automobile.
- Manette, remappage, audio et préférences persistantes.

## 8. Exécution et déploiement

```powershell
npm ci
npm run dev
```

La production est compilée avec `npm run build`. Sur Vercel : preset **Vite**, racine du dépôt, commande `npm run build`, dossier de sortie `dist`.

`.idea`, `node_modules`, `dist`, `.vercel`, `.env*` et les caches TypeScript sont ignorés par Git. Les métadonnées IDE locales sont conservées sur disque et ne sont pas suivies.

## 9. Vérifications et validation restante

`npm run lint` et `npm run build` ont réussi après la correction. Le build inclut TypeScript via `tsc -b`. Vite signale un chunk de scène volumineux, notamment lié à Rapier/WASM : environ 3,19 Mo et 1,10 Mo gzip. Le chargement différé évite ce coût sur l’accueil mais pas au démarrage de la conduite.

Les trois tests unitaires existants couvrent le ressort-amortisseur borné, l’adhérence longitudinale restante et l’interpolation du couple. Ils avaient réussi lors de l’implémentation initiale ; ils n’ont pas été réexécutés pour cette correction. Ils ne testent pas le véhicule complet dans Rapier.

La validation graphique reste à effectuer dans un navigateur WebGL de bureau : départ sans envol, accélération, freinage, virage, recul, frein à main, collision, respawn et reprise après changement d’onglet. La comparaison à 30, 60 et 120 FPS de rendu et les mesures sur une machine de référence relèvent de l’étape 2. Un build réussi ne valide pas la sensation de conduite.
