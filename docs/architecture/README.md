# Cardrive — Dossier d’architecture

Statut : architecture cible ; étape 1 implémentée et calibration numérique de l’étape 2 livrée, validation de conduite dans le navigateur restante.
Langue de l’interface initiale : français.
Déploiement cible : application statique sur Vercel, sans backend applicatif.

## 1. Objectif et périmètre

Cardrive est un jeu de conduite 3D dans le navigateur. À terme, le joueur choisit un lieu réel, charge les routes environnantes et conduit un véhicule dont le comportement dépend de sa configuration mécanique.

La première livraison est une vertical slice sur une piste locale générée : un véhicule générique, une suspension à quatre roues, accélération, freinage, marche arrière, virages, collisions, caméra et télémétrie. Les données GPS viennent ensuite. Une sensation de conduite convaincante est prioritaire sur le décor.

Cible initiale : ordinateur avec clavier et WebGL, navigateur moderne. Objectif de fluidité : 60 FPS sur la machine de référence à documenter, sans garantie universelle. Mobile, trafic, IA, multijoueur, dégâts de carrosserie, météo et relief mondial sont hors du premier MVP.

La physique vise une simulation automobile crédible et réglable, pas une reproduction exhaustive de type BeamNG. Les routes OSM ne fournissent pas une reconstitution exacte de leur revêtement ou de leur relief.

## 2. Stack et décisions

| Domaine | Choix cible | Rôle |
| --- | --- | --- |
| Application | React, TypeScript, Vite | Interface, compilation statique |
| Rendu | Three.js via React Three Fiber | Monde 3D et véhicules |
| Physique | Rapier via @react-three/rapier | Corps rigides, collisions, requêtes de contact |
| Véhicule | Solveur automobile dédié au-dessus de Rapier | Suspension, pneus, moteur et transmission |
| Géographie | OpenStreetMap, adaptateur de fournisseur | Routes réelles |
| Carte de sélection | MapLibre GL JS, dans une étape ultérieure | Choix du lieu et contexte 2D |
| Assets | GLTF/GLB, géométrie procédurale au départ | Modèles visuels indépendants de la physique |
| Préférences | localStorage versionné | Commandes, véhicule et lieu récents |
| Cache géographique | IndexedDB avec limite et expiration | Réutilisation des zones téléchargées |

Choisir et verrouiller les versions compatibles lors de l’initialisation, puis committer le lockfile. Un seul monde Rapier fait autorité. Ne pas mélanger plusieurs moteurs ou deux solveurs de suspension.

L’application n’a ni API serveur, ni base de données distante, ni fonction Vercel. Les fournisseurs de données externes restent des dépendances réseau : « sans backend applicatif » ne signifie pas fonctionnement intégral hors ligne.

## 3. Organisation proposée

```text
public/
  assets/vehicles/
  data/demo/
src/
  app/              # Composition, écrans, cycle de session
  vehicle/
    configs/        # Configurations et validation
    physics/        # Suspension, pneus, moteur, transmission
    rendering/      # Carrosserie et animation des roues
  physics/          # Monde Rapier, pas fixe, surfaces, collisions
  world/
    chunks/         # Planification, chargement, déchargement
    roads/          # Graphe routier, meshes et colliders
    terrain/        # Sol simplifié et piste de test
  geo/              # Projection, coordonnées, origine flottante
  map/              # Fournisseurs, cache, sélection du lieu
  input/            # Actions clavier et abstraction manette
  camera/           # Caméra chase et interpolation
  rendering/        # Lumière, qualité, ressources partagées
  ui/               # HUD, menus, erreurs et chargement
  shared/           # Types et utilitaires sans dépendances métier
tests/
  fixtures/         # Petits jeux de données OSM et scénarios
docs/
  architecture/
```

Les fichiers restent regroupés par responsabilité. Ne pas créer chaque dossier vide avant d’en avoir besoin.

## 4. Flux et frontières

- InputManager produit un état d’actions normalisées : accélérateur, frein, direction, frein à main, respawn.
- VehiclePhysics lit cet état et VehicleConfig à chaque pas fixe, interroge le sol, puis applique les forces au châssis Rapier.
- VehicleRenderer lit un instantané physique interpolé ; il ne déplace jamais le corps physique.
- CameraController suit cet instantané avec un amortissement indépendant.
- WorldStreamer utilise la position géographique du joueur pour demander les chunks.
- GeoProvider fournit des données ; RoadBuilder produit géométrie et collision dans le repère local.
- L’UI reçoit une télémétrie échantillonnée à environ 10 Hz. Aucun setState React à chaque calcul de roue.

Types minimaux à définir :
VehicleConfig, VehicleInput, VehicleTelemetry, VehicleSnapshot, GeoPoint, LocalPoint, RoadSegment, ChunkKey, ChunkData et SurfaceMaterial.

Les types de coordonnées géographiques et locales doivent être distincts. Utiliser des noms avec unités : speedMps, torqueNm, massKg, wheelRadiusM, steeringRad. Convertir en km/h uniquement dans le HUD.

## 5. Physique automobile

### Châssis et roues

Un corps rigide dynamique représente le châssis. Sa masse, son inertie, ses colliders et son centre de gravité sont configurables. Employer des colliders simples ; le mesh esthétique ne définit pas automatiquement la collision.

Quatre roues virtuelles utilisent des raycasts de suspension, en excluant le châssis et les capteurs. Les contacts et normales du sol pilotent les forces. Les raycasts ne reproduisent pas entièrement le franchissement d’une bordure par un pneu ; un modèle à plusieurs sondes ou shape casts pourra être étudié après le MVP.

Pour chaque roue :
1. Déterminer le contact, la longueur de suspension et la vitesse relative au point de contact.
2. Calculer une force ressort-amortisseur, limitée et jamais attractive.
3. Construire les axes longitudinal et latéral dans le plan du contact.
4. Estimer le glissement longitudinal et l’angle de dérive avec une régularisation à basse vitesse.
5. Limiter les efforts combinés par une ellipse de friction dépendant de la charge et de la surface.
6. Appliquer les efforts au point de contact du châssis et intégrer la vitesse angulaire de roue.

Réglage initial : modèle de pneu simplifié, stable et documenté, plutôt qu’un modèle complexe mal calibré. Le transfert de charge doit résulter des forces appliquées et du mouvement du châssis. Aucune rotation ou translation directe pour forcer un virage.

### Groupe motopropulseur

Courbe de couple en fonction du régime, rapports de boîte, pont final, rendement, répartition FWD/RWD/AWD, frein moteur et limiteur. Coupler le régime aux roues motrices avec un embrayage simplifié pour éviter un moteur figé ou divergent à l’arrêt.

Boîte automatique initiale avec hystérésis et délai de passage. Afficher le rapport et un régime issu de la simulation. Marche arrière engagée seulement à faible vitesse après freinage. Frein à main sur l’essieu arrière. ABS/TCS simplifiés sont des aides ultérieures désactivables ; le cœur physique ne doit pas en dépendre.

### Boucle temporelle

Pas fixe initial : 1/60 s, configurable. Accumulateur et nombre de rattrapages borné ; ne pas transmettre un delta arbitrairement long après suspension de l’onglet. Calculer les forces avant chaque pas Rapier. Si l’API applique des impulsions, utiliser J = F × dt. Vérifier les conventions de l’API retenue.

Le rendu interpole les états précédent et courant. La simulation se met en pause quand l’onglet perd sa visibilité ; effacer les touches actives à la perte de focus.

### Configuration du véhicule

Inclure au minimum :
- Identifiant, nom affiché, référence du modèle visuel et provenance/licence.
- Masse, dimensions, inertie et centre de gravité.
- Positions des roues, empattement, voies, rayon et inertie des roues.
- Débattement, longueur au repos, raideur et amortissement par essieu.
- Courbe de couple, régime de ralenti/maximal, rapports et pont.
- Transmission, distribution du couple, freinage et frein à main.
- Grip, raideurs de glissement et aérodynamique simplifiée.
- Angle maximal de direction et réduction avec la vitesse.

Valider les valeurs au chargement. Le premier véhicule est générique ; des profils de voitures réelles pourront être ajoutés avec données sourcées. L’utilisation de modèles, noms et logos doit être vérifiée asset par asset avant leur distribution.

## 6. Coordonnées GPS et origine flottante

Stocker latitude/longitude en degrés WGS84. La physique travaille uniquement en mètres.

Convention de scène : X = est, Y = altitude, Z = sud. Le nord correspond donc à -Z. La première zone utilise un point d’ancrage géographique immuable.

Pour une petite zone, une approximation locale documentée peut suffire :
x = R × cos(latitudeOrigine) × deltaLongitude ;
z = -R × deltaLatitude ;
avec angles en radians et R ≈ 6 378 137 m.
Normaliser les écarts de longitude au passage de l’antiméridien. Pour les parcours longs ou zones polaires, remplacer cette approximation par une projection locale robuste et tester l’aller-retour.

Ne pas utiliser les coordonnées Web Mercator de la carte comme distances physiques sans correction.

Prévoir une origine flottante dès les interfaces, l’activer avec le streaming : au-delà d’un seuil initial d’environ 1 km, décaler ensemble châssis, chunks, colliders, caméra et historiques d’interpolation entre deux pas. Les clés de chunks et positions géographiques restent stables. Le décalage ne modifie pas la vitesse et ne doit pas apparaître comme un déplacement physique.

## 7. Données routières et génération du monde

GeoProvider expose une opération annulable getRoads(bounds, signal). Aucun fournisseur concret ne doit être importé par VehiclePhysics.

Première intégration : petite zone OSM par requête bornée via un service compatible avec les appels navigateur, après vérification des conditions, quotas et CORS. Overpass est un candidat de prototype, pas une promesse de service gratuit illimité. Choisir le fournisseur avant l’intégration réelle ; ne pas dépendre implicitement des serveurs de tuiles publics OSM.

Latitude/longitude manuelles et quelques lieux prédéfinis précèdent la recherche textuelle. Le géocodage est un adaptateur distinct avec soumission explicite, cache et limites ; ne pas faire d’autocomplétion sans fournisseur autorisant cet usage.

Pipeline :
1. Télécharger/cache des nœuds et chemins dans une zone bornée avec marge.
2. Filtrer les voies carrossables et conserver les tags utiles.
3. Construire un graphe avec identifiants OSM stables et intersections partagées.
4. Projeter en mètres et estimer la largeur depuis width/lanes ou des valeurs par défaut documentées.
5. Générer chaussées, raccords et colliders cohérents.
6. Choisir un segment valide et orienter le spawn selon sa tangente.
7. Ajouter un sol simplifié et les informations d’attribution.

Ne pas confondre croisement géométrique et intersection : bridge, tunnel et layer distinguent les niveaux. Le MVP GPS reste plat et doit exclure ou signaler les géométries non prises en charge. Aucune hauteur de pont ne doit être présentée comme une mesure réelle sans source d’altitude.

L’approximation des intersections doit éviter trous et chevauchements de colliders. Les mêmes routes traversant plusieurs chunks ont une propriété déterministe et ne doivent pas créer des collisions doubles.

Afficher l’attribution OpenStreetMap et celle du fournisseur utilisé ; documenter la provenance et les licences des données distribuées.

## 8. Streaming et cache

Valeurs initiales à profiler : chunks de 256 m, voisinage physique 3 × 3, rendu 5 × 5, préchargement dans la direction de déplacement. Adapter les rayons à la distance d’arrêt, à la vitesse et au délai réseau.

Cycle : absent → demandé → données disponibles → généré → actif → éviction. Les échecs sont identifiables et réessayables avec temporisation, sans boucle de requêtes.

Limiter la concurrence réseau, fusionner les zones voisines, annuler les requêtes obsolètes et mettre les échecs temporaires en attente. Versionner les clés de cache avec le fournisseur et la version du générateur ; borner la taille par éviction LRU.

Conserver le chunk du véhicule tant qu’il n’est pas remplacé. Si la zone suivante n’est pas prête, signaler la limite et arrêter/pause de façon contrôlée avant le bord physique. Une erreur réseau ne doit pas faire tomber la voiture dans le vide.

Prévoir RoadBuilder dans un Web Worker si le profilage révèle des blocages. Les objets Rapier et GPU sont créés sur le thread principal ; libérer les géométries, textures et colliders à l’éviction.

## 9. Interface et expérience

Écrans : accueil/choix du lieu → chargement → conduite → pause/réglages.
Une piste de démonstration doit fonctionner sans API géographique.

Commandes initiales :
| Action | Touches |
| --- | --- |
| Accélérer | Z ou W |
| Freiner puis reculer à faible vitesse | S |
| Direction gauche | Q ou A |
| Direction droite | D |
| Frein à main | Espace |
| Respawn | R |
| Pause | Échap |

Bloquer le défilement des touches de conduite uniquement lorsque le jeu a le focus ; ne pas intercepter les champs de saisie. Prévoir remappage ultérieur et une abstraction compatible manette.

HUD : km/h, RPM, rapport, indicateur de glissement/traction, état de chargement. Caméra chase amortie, avec évitement simple des obstacles et reset instantané au respawn.

Le respawn restaure une pose sûre avec roues au-dessus de la chaussée, remet vitesses linéaire/angulaire à zéro et réinitialise transmission, roues et interpolation.

## 10. Performance, erreurs et déploiement

Limiter les allocations dans les boucles physiques, mutualiser matériaux et géométries, instancier le décor répétitif. Régler résolution, ombres et distance de rendu par niveau de qualité. Mesurer temps physique, rendu, génération, nombre de colliders et mémoire.

Prévoir des états explicites : WebGL indisponible, initialisation physique échouée, fournisseur inaccessible, quota atteint, aucune route, asset introuvable. Les erreurs permettent retry ou retour à la démo.

Scripts attendus : dev, lint, typecheck, test et build. Vercel compile avec npm run build et sert dist. Le MVP peut employer une navigation interne sans routes URL ; configurer une réécriture vers index.html si des routes SPA sont ajoutées.

Toutes les variables VITE_* sont publiques. Aucun secret dans le bundle. Une clé fournisseur côté navigateur n’est acceptable que si prévue pour cet usage, restreinte selon les possibilités du fournisseur. Ne pas ajouter un proxy serveur en contournement du périmètre sans revoir l’architecture.

## 11. Validation

Tests ciblés :
- Projection et conversion inverse, unités, longitude ±180°.
- Courbe de couple, rapports, freinage et saturation des efforts des pneus.
- Suspension au repos sans génération d’énergie persistante.
- Fixtures OSM : intersection, voie traversant un chunk, pont/tunnel, zone vide.
- Changement d’origine conservant position géographique et vitesses.
- Cycle de chunk sans collisions dupliquées ni fuite de ressources.

Scénarios de conduite à répéter à 30, 60 et 120 FPS de rendu :
départ arrêté, freinage, virage constant, slalom, marche arrière, frein à main, bosse, collision, respawn et reprise après changement d’onglet. La fréquence de rendu ne doit pas changer significativement les résultats physiques.

Avant chaque livraison de code : lint, vérification TypeScript, tests pertinents et build. Pour cette première livraison documentaire, aucun test applicatif n’est requis. Ne pas déclarer la qualité de conduite validée uniquement sur la réussite du build.

## 12. Plan de réalisation et critères de fin

| Étape | Livrable | Critères de fin |
| --- | --- | --- |
| 1 — Fondation et véhicule | Vite/React/TS, Rapier, piste et voiture générique | Conduite jouable, quatre suspensions, collision, caméra, HUD, respawn ; lint/typecheck/build passent |
| 2 — Calibration | Pneus, moteur, boîte et configuration | Comportements cohérents au freinage/virage ; comparaison des fréquences de rendu ; réglages documentés |
| 3 — GPS et routes | Coordonnées, fournisseur et petite zone OSM | Spawn sur une route, attribution, cache et erreurs ; piste disponible sans réseau |
| 4 — Streaming | Chunks et origine flottante | Traversée des frontières sans trous ; budgets bornés ; comportement contrôlé si chargement lent |
| 5 — Environnement | Bâtiments/décor et qualité visuelle | Collisions pertinentes, ressources libérées, fluidité mesurée |
| 6 — Catalogue | Plusieurs configurations et modèles autorisés | Différences FWD/RWD/AWD perceptibles ; changement de voiture sans réécriture du solveur |
| 7 — Finition | Audio, manette, réglages et déploiement | Parcours utilisateur vérifié et version statique déployable sur Vercel |

L’étape 1 est décrite dans [step-1-vehicle.md](step-1-vehicle.md). La calibration de l’étape 2, ses équations, réglages et mesures Rapier à 30/60/120 FPS synthétiques sont détaillés dans [step-2-calibration.md](step-2-calibration.md), avec un [rapport numérique reproductible](calibration-results.json). La sensation de conduite et les cadences WebGL réelles restent à valider sur un navigateur de bureau. OSM, trafic et catalogue automobile restent hors de ces deux étapes.

## 13. Points à trancher pendant l’implémentation

- Fournisseur routier, carte et géocodage : quotas, CORS, attribution et coûts vérifiés avant branchement.
- Machine de référence et budget de performance mesurés.
- Paramètres du pneu et de suspension calibrés sur la piste.
- Source d’altitude si le relief et les ouvrages deviennent nécessaires.
- Assets automobiles et conditions de redistribution vérifiés avant publication.

Ce dossier conserve les décisions de conception et les critères de livraison des étapes restantes. La présence d’un critère dans le plan ne signifie pas qu’il est déjà implémenté ou validé.
