# Étape 2 — Calibration du véhicule

Date : 7 octobre 2026. Cette étape reprend le véhicule de l’étape 1 et calibre son modèle simplifié. Elle ne prétend pas reproduire une voiture réelle à partir de données constructeur.

## 1. Fonctionnalités et corrections

- Marche arrière maintenue au-delà du seuil d’engagement, avec limite de propulsion progressive autour de 29 km/h.
- Changement de sens après freinage, à moins de 0,35 m/s pendant 0,30 s. En recul, W/Z freine avant de réengager la marche avant ; S devient l’accélérateur arrière.
- Freinage réparti entre les essieux et limité à l’impulsion nécessaire pour annuler la vitesse dans le pas courant. Il ne pousse plus la voiture dans le sens opposé à très basse vitesse.
- Direction progressive au clavier, avec une limite supplémentaire dépendant du carré de la vitesse.
- Efforts de pneus projetés dans le plan du contact, modèle de dérive et saturation combinée symétrique.
- Frein à main arrière avec réduction d’adhérence arrière.
- Régime amorti, lancement avec embrayage implicite, coupure de couple pendant les changements de rapport et contrôle des rétrogradages.
- Frein moteur, résistance au roulement et traînée aérodynamique séparés.
- Suspension corrigée pour empêcher la vitesse horizontale de produire un faux amortissement lorsque le châssis tangue.

Les commandes et l’interface restent celles de l’étape 1. Maintenir S après l’arrêt finit par engager le recul ; relâcher S conserve le rapport arrière. Appuyer sur W/Z en recul freine, puis engage le rapport avant après stabilisation à faible vitesse. Appuyer simultanément sur accélérateur et frein privilégie le freinage et bloque le changement de sens.

## 2. Architecture du solveur

`src/vehicle/physics/VehicleSimulation.ts` contient désormais le calcul automobile indépendant de React. `useVehiclePhysics.ts` le relie au monde Rapier, aux commandes, aux poses visuelles et à la télémétrie de l’application.

Le même solveur est utilisé par `scripts/calibrate-vehicle.mjs`. Les propriétés de masse, friction, restitution, reset et pas fixe sont partagées via `vehicleBody.ts`. Les mesures ne recopient pas une approximation de la physique du jeu.

La configuration mécanique et ses paramètres de calibration restent dans `genericVehicle.ts`. La validation rejette notamment les valeurs non finies, masses/inerties invalides, absence de roues motrices, rapports incohérents, seuils de boîte inversés et fractions d’adhérence/freinage hors bornes. La distribution motrice peut désormais désigner des roues avant, arrière ou les quatre roues ; seul le profil RWD fourni est calibré ici.

Les contacts sont tous échantillonnés avant d’appliquer les impulsions. Une roue ne lit donc pas une vitesse déjà modifiée par la roue précédente. Vecteurs, quaternions, raycast et buffers d’impulsions sont réutilisés. Les résultats de requêtes Rapier et la télémétrie continuent toutefois à créer certains objets.

## 3. Physique et paramètres

### Suspension et appui

Le pas fixe reste `dt = 1/60 s`. Les efforts sont appliqués par impulsions `J = F × dt`, sans accumulation de forces utilisateur Rapier.

Un impact n’est accepté comme support que si la normale s’oppose suffisamment au rayon descendant : `-normale · directionRayon >= 0.35`. Les murs verticaux ne servent ainsi pas de suspension. La vitesse relative au contact tient compte de la vitesse du corps portant la surface lorsqu’il existe.

```text
longueur = max(longueurMinimale, distanceImpact - rayonRoue)
compression = max(0, longueurRepos - longueur)
vCompression = -(vitesseRelative · normale) / max(0.35, -normale · directionRayon)
Fappui = clamp(k × compression + c × vCompression, 0, FappuiMax)
Jappui = normale × Fappui × dt
```

L’effort suit la normale de surface. L’amortissement mesure le mouvement vers la surface avec correction de l’angle du rayon. Utiliser directement `vitesse · directionRayon` faisait passer une partie de la vitesse horizontale pour de la compression lors du tangage : une première passe de calibration produisait alors une hauteur d’environ 1,33 m à l’accélération. La correction ramène la hauteur maximale à environ 0,90 m sur le scénario plat.

| Paramètre | Valeur |
| --- | --- |
| Masse et centre de gravité | 1 180 kg ; `(0, -0.08, 0)` m |
| Longueur au repos / extension déclarée | 0,57 / 0,30 m |
| Longueur minimale du calcul | 0,12 m |
| Raideur / amortissement par roue | 29 000 N/m ; 3 200 N·s/m |
| Effort maximal par roue | 19 000 N |
| Amortissement linéaire / angulaire Rapier | 0,01 / 0,5 |

La diminution de l’amortissement linéaire Rapier laisse les résistances explicites piloter davantage la décélération. Les ressorts restent non attractifs ; le compteur de roues au sol compte désormais les contacts avec charge positive.

### Pneus et adhérence combinée

L’axe longitudinal est projeté sur le plan défini par la normale. L’axe latéral est le produit vectoriel de cette normale et de l’axe longitudinal.

```text
angleDérive = atan2(vLatérale, max(2, abs(vLongitudinale)))
blend = clamp(abs(vLongitudinale) / 3, 0, 1)
FlatDemandée = -(1 - blend) × vLatérale × amortissementBasseVitesse
               - blend × Fappui × raideurDérive × angleDérive
```

Sous 3 m/s, la transition vers un amortissement de vitesse latérale régularise le comportement à l’arrêt et en recul. L’effort latéral est aussi limité par la masse nominale par roue et la vitesse annulable en un pas.

La demande longitudinale additionne moteur, freinage et résistances. Le cercle de friction réduit simultanément les deux composantes :

```text
Fmax = Fappui × grip
utilisation = hypot(FlatDemandée, FlongDemandée) / max(1, Fmax)
facteur = 1 / max(1, utilisation)
Jpneu = (axeLong × FlongDemandée + axeLat × FlatDemandée) × facteur × dt
```

Le transfert de charge provient des efforts appliqués au châssis, sans modifier directement sa pose. Il n’y a pas d’ABS ni de contrôle de traction. La limite de braquage n’est pas une garantie absolue de tenue de route sur une autre surface.

| Paramètre | Valeur |
| --- | --- |
| Coefficient d’adhérence | 1,08 |
| Raideur de dérive normalisée par la charge | 8 rad⁻¹ |
| Amortissement latéral basse vitesse | 4 600 N·s/m |
| Adhérence arrière avec frein à main complet | 60 % de la valeur normale |

### Freins et résistances

Le frein de service vaut **11 000 N pour le véhicule**, répartis à **64 % à l’avant**, le reste à l’arrière. Le frein à main vaut **5 000 N pour l’essieu arrière**. Ces valeurs remplacent les anciens efforts appliqués individuellement à chaque roue.

La demande résistante par roue est plafonnée à `abs(vLong) × (masse / 4) / dt` avant saturation d’adhérence. Son signe s’oppose à la vitesse. La résistance au roulement vaut `charge × 0.012` par roue.

Le frein moteur utilise un couple moteur résistant de 32 N·m, multiplié par rapport et pont, puis réparti entre les roues motrices. Il décroît avec la commande de propulsion. La traînée s’applique au centre de masse, même sans contact : `F = -0.5 × 1.225 × Cd × surface × vitesseHorizontale × vecteurVitesseHorizontale`, avec Cd = 0,32 et surface = 2 m². La composante verticale n’est pas freinée par ce modèle aérodynamique.

### Moteur et boîte

La courbe de couple, les cinq rapports avant, le rapport arrière et le pont de l’étape 1 sont conservés. Le rendement est explicite dans la configuration : 0,84.

Le régime couplé est calculé avec la vitesse longitudinale du châssis, le rayon et la démultiplication. Un lancement implicite porte la cible de ralenti de 850 à 1 800 tr/min selon la commande. Le régime rejoint sa cible avec `1 - exp(-8 × dt)` ; aucun régime n’est ajouté artificiellement au régime couplé.

La boîte monte à 5 700 tr/min, rétrograde sous 2 000 tr/min et coupe la propulsion pendant 0,28 s. Un rétrogradage est refusé si le rapport inférieur porterait le régime couplé au-delà de 90 % du seuil de montée. Le ratio utilisé pour le couple est recalculé après changement de rapport. La propulsion est coupée au-delà du régime maximal de 6 400 tr/min.

En recul, la propulsion décroît linéairement dans les derniers 20 % de la plage jusqu’à **8 m/s**, au lieu d’imposer une vitesse au châssis. Ce limiteur ne bloque pas une accélération imposée par une pente ou un choc.

### Direction

```text
limiteVitesse = atan(accélérationLatéraleCible × empattement / max(1, vitesse²))
angleMax = min(angleInitial / (1 + vitesse × réduction), limiteVitesse)
angleCible = commande × angleMax
```

La direction rejoint sa cible à **1,4 rad/s**. L’angle initial reste 0,48 rad, la réduction 0,032 s/m et l’accélération latérale cible 7,5 m/s². Cela rend l’entrée clavier progressive et réduit le surbraquage à haute vitesse.

## 4. Mesures reproductibles

```powershell
npm ci
npm run calibrate
npm run lint
npm run build
```

Le script de calibration demande une version de Node prenant en charge `--experimental-strip-types` ; l’exécution enregistrée utilise Node 22.23.1 sur Windows x64. Il utilise Rapier 0.19.2, identique à la version du wrapper, déclaré explicitement comme dépendance.

Le rapport complet est dans [calibration-results.json](calibration-results.json). Il contient les paramètres d’environnement, les 36 exécutions, les écarts entre cadences et les critères numériques. Une exécution hors bornes produit un code de sortie non nul.

Chaque scénario utilise un sol physique de 2 000 × 2 000 m, sans les barrières du circuit de démonstration. Le châssis est stabilisé pendant deux secondes avant le début des mesures et avant toute vitesse initiale. Bosse et obstacle sont ajoutés uniquement dans leurs scénarios. Les commandes suivent le temps physique, pas le nombre de frames.

| Scénario à cadence simulée de 60 FPS | Résultat |
| --- | --- |
| Repos, 15 s | Déplacement horizontal nul ; quatre appuis ; hauteur 0,897 à 0,900 m |
| Accélération, 20 s | 0–100 km/h en 7,42 s ; 155,5 km/h à 20 s ; trois montées de rapport |
| Freinage depuis 100 km/h | Sous 0,15 m/s en 3,38 s et 46,55 m ; sans inversion significative |
| Recul maintenu, 8 s | Rapport R conservé ; maximum 28,6 km/h |
| Recul 5 s puis commande avant 7 s | Freinage puis marche avant ; rapport final 2 |
| Virage constant, 10 s à partir de 36 km/h | Courbe dans le sens demandé ; roulis maximal 2,9° |
| Slalom, 12 s à partir de 36 km/h | Roulis maximal 3,8° |
| Frein à main, 5 s à partir de 54 km/h | Roulis maximal 4,4° ; parcours de 47,9 m |
| Bosse de 0,24 m à partir de 28,8 km/h | Hauteur maximale 0,995 m ; pas de chute sous 0,889 m |
| Collision contre un obstacle à Z = 30 m | Châssis bloqué avant l’obstacle ; hauteur maximale 0,903 m |
| Respawn après 5 s d’accélération | Retour à Z = 0, rapport 1 et vitesse horizontale nulle |
| Pause de 2 s puis reprise | Aucun temps caché ajouté à l’accumulateur ; trajectoire reproductible |

Les valeurs de freinage ne comprennent pas un temps de réaction du conducteur. Les résultats du virage et du frein à main ne constituent pas une calibration de comportement réel ou une démonstration de drift réaliste.

Les douze scénarios sont exécutés à **30, 60 et 120 FPS synthétiques**, avec la même physique à 60 Hz. Les différences finales de position et de vitesse sont nulles dans cette exécution. Cela valide le découplage du solveur vis-à-vis du découpage temporel des frames dans ce banc ; cela ne mesure pas les FPS GPU et ne valide pas le cycle React ou les événements clavier d’un navigateur.

Les douze critères numériques passent : résultats finis, absence de forces/couples persistants, indépendance de cadence, appui au repos, accélération stable, freinage, recul borné, changement de sens, virage/slalom, bosse, collision et reset. Les scénarios de frein à main et de pause fournissent aussi des mesures, mais n’ont pas de critère dédié de qualité de conduite.

## 5. Vérifications et limites restantes

Lint et build, incluant TypeScript, réussissent. Les tests unitaires de l’étape 1 restent présents ; ils n’ont pas été exécutés pour cette livraison. Le banc numérique de calibration utilise le solveur de production et Rapier, avec les limites indiquées ci-dessus.

Aucun navigateur pilotable n’est disponible dans cette session. La sensation au clavier, le suivi caméra, la pause par visibilité réelle et la fluidité WebGL restent à vérifier sur la machine de référence. Aucun chiffre de FPS réel n’est revendiqué. Le warning de taille du chunk 3D/WASM demeure.

Le modèle conserve des simplifications :

- Aucun solveur de vitesse angulaire physique des pneus ; leur inertie déclarée reste réservée à une évolution. La rotation visuelle suit la vitesse au contact et ne représente pas un patinage mécanique.
- Aucun embrayage dynamique, différentiel, courbe de glissement longitudinal ou modèle de pneu constructeur.
- Le HUD présente un indicateur combinant angle de dérive et demande dépassant l’adhérence, borné visuellement à 100 % ; ce n’est pas un taux physique de patinage.
- La vitesse affichée utilise maintenant uniquement le mouvement horizontal, afin que le rebond ne gonfle pas le compteur.
- Le calcul des surfaces inclinées et mobiles est préparé, mais les mesures ci-dessus portent sur un sol plat, une bosse rectangulaire et un obstacle fixe.
- Aucun anti-roulis, arrêt mécanique de suspension ou pneu volumique. Les bords d’une bosse ne reproduisent pas un contact de pneu réel.

La calibration numérique et les réglages sont livrés ; l’acceptation de la sensation de conduite dans le navigateur reste ouverte. GPS/OSM et streaming restent les étapes suivantes.
