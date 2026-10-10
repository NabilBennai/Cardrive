# Altitudes : décision (R-4.1)

Étude réalisée le 10 octobre 2026. Elle tranche la source d'altitude pour le relief des circuits et des routes (R-3.2). Les mesures viennent de `scripts/elevation/probe.mjs` et `scripts/elevation/compare.mjs` (réseau requis, hors tests automatiques).

## Décision

**Source retenue : les tuiles « Terrarium » des Terrain Tiles d'AWS** (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`), lues directement par le navigateur.

| Critère | Constat |
| --- | --- |
| Accès | Public, sans clé, sans compte. **CORS ouvert** (`Access-Control-Allow-Origin: *`, vérifié sur requête GET et OPTIONS). |
| Format | PNG RVB 256 × 256, Web Mercator, mêmes numéros de tuiles que les tuiles de cartes déjà gérées (`src/map/tileMath.ts`). Altitude en mètres = R·256 + V + B/256 − 32768. Zoom maximal publié : 14. |
| Licence | Jeux publics (SRTM, 3DEP, GMTED2010 : domaine public américain, crédit **demandé** par l'USGS ; EU-DEM : mention « Produced using Copernicus data and information funded by the European Union - EU-DEM layers » ; ETOPO1 pour la bathymétrie). Aucune clause commerciale. Source : [attribution du projet Joerd](https://github.com/tilezen/joerd/blob/master/docs/attribution.md), [registre AWS](https://registry.opendata.aws/terrain-tiles). Le jeu est agrégé par Mapzen (projet de la Linux Foundation). |
| Taille | ≈ 100 Kio par tuile PNG ; **un circuit entier = 4 à 6 tuiles, 0,4 à 0,5 Mio** de téléchargement, 1,5 s à 2,6 s. |
| Mémoire | 256 Kio par tuile décodée en `Float32Array` (128 Kio en `Int16`) : **1 à 1,5 Mio par circuit**. |
| Disponibilité | Hébergement Amazon S3 : pas de limite de débit annoncée, mais aucun engagement de service. |

À afficher quand les altitudes servent : « Altitudes : AWS Terrain Tiles (SRTM, 3DEP, EU-DEM, GMTED — USGS, Copernicus) » (`ELEVATION_ATTRIBUTION` dans `src/geo/elevation.ts`).

### Pourquoi pas les autres

- **API Open-Meteo** (`/v1/elevation`) : CORS ouvert et sans clé, mais par points (100 par requête), limitée à **10 000 appels par jour** (5 000 par heure, 600 par minute), **usage non commercial** et licence CC BY 4.0 ([conditions](https://open-meteo.com/en/terms)), valeurs entières en mètres. Inadaptée à un relief continu sous des routes chargées par chunks. Utile seulement comme contrôle : sur 40 points de Spa, Monaco et Singapour, elle s'écarte des tuiles Terrarium de 9 à 11 m (écart quadratique), avec les mêmes plages d'altitude.
- **OpenTopoData** : fonctionne mais API publique limitée en débit et par points ; non retenue pour les mêmes raisons.
- **Jeu de données hors ligne par circuit** : possible plus tard pour les circuits les plus célèbres (profils saisis à la main), mais lourd à produire pour 24 circuits ; le téléchargement de 0,5 Mio, mis en cache, suffit.

## Résultats du prototype

Profil échantillonné tous les 5 m le long du tracé (`probe.mjs`). La « pente max » est celle du profil brut (puis lissé sur 40 m).

| Circuit | Zoom | Pixel | Tuiles / Kio | Altitude min → max | Montée par tour | Pente max brute (lissée) |
| --- | --- | --- | --- | --- | --- | --- |
| Spa-Francorchamps | 13 | 12,2 m | 4 / 407 | 364 → 471 m | 196 m | 24,8 % (23 %) |
| Spa-Francorchamps | 14 | 6,1 m | 6 / 544 | 364 → 471 m | 197 m | 29,2 % (23,8 %) |
| Suzuka | 13 | 15,7 m | 4 / 92 | 15,5 → 61,9 m | 154 m | 26,3 % (19,5 %) |
| Interlagos | 13 | 17,5 m | 1 / 33 | 744 → 789 m | 130 m | 24,3 % (20,5 %) |
| Monaco | 14 | 6,9 m | 4 / 268 | −1,4 → 52,7 m | 129 m | 84,7 % (50,5 %) |
| Singapour | 14 | 9,6 m | 4 / 354 | −11 → 45 m | 328 m | 163 % (55 %) |

### Ce que ça nous apprend

1. **Circuits en terrain naturel : excellent.** Spa donne 107 m de dénivelé (la littérature en cite environ 100 m), Interlagos 45 m, Suzuka 46 m : cohérents avec la réalité. Le raccord de la boucle est parfait (écart de fermeture 0 m, le profil est échantillonné sur un modèle continu).
2. **Circuits urbains : inutilisable tel quel.** Monaco (pente max 85 %, montée de 129 m par tour pour un circuit presque plat de 40 m de dénivelé) et Singapour (pente jusqu'à 163 %, montée de 328 m par tour, alors que le circuit est quasi plat) montrent que les modèles sont des **modèles de surface** : immeubles, ponts et tunnels sont comptés comme du sol. Pour ces circuits (Monaco, Singapour, Bakou, Jeddah, Las Vegas, Miami, Melbourne…), il faut une autre approche : profil plat, ou profil saisi à la main, ou filtrage médian très fort suivi d'un plafond de pente.
3. **Zoom 13 suffit pour un circuit.** Le zoom 14 double la résolution de l'image mais pas celle de la donnée (SRTM à 30 m, EU-DEM à 25 m : le jeu est suréchantillonné) ; il coûte 33 % de téléchargement en plus pour aucun gain de précision utile. Zoom 13 retenu pour les circuits.
4. **Un lissage de 40 m est nécessaire** pour calculer des pentes (la pente brute dépasse la réalité : le Raidillon d'Eau Rouge atteint environ 18 %, le profil brut donne 25 à 29 %) mais il ne réduit pas la montée totale de plus de quelques pour cent en terrain naturel.
5. **Routes de ville** (R-3.2 et R-4.3) : les mêmes artefacts (bâtiments, ponts) apparaîtront. À prévoir : lissage fort le long de chaque route, plafond de pente (≈ 15 %), et option « plat » si les altitudes d'une zone sont incohérentes.

## Intégration proposée

- Module pur `src/geo/elevation.ts` (**livré**, testé) : décodage, tuiles d'une zone, échantillonnage bilinéaire à cheval sur plusieurs tuiles, lissage cyclique, statistiques de profil.
- À écrire pour R-3.2 : un chargeur (fetch + décodage d'image dans le navigateur par `createImageBitmap` / canvas) avec cache mémoire et `localStorage`/IndexedDB, une liste `elevationReliable` par circuit (vrai pour les circuits en terrain naturel, faux pour les circuits urbains), puis la génération d'un maillage de sol et de routes suivant le profil.
- Hors ligne : sans réseau ni cache, le jeu reste plat comme aujourd'hui.

## Limites de l'étude

- Les 24 circuits n'ont pas tous été mesurés : 5 l'ont été. Les autres sont à classer (naturel / urbain) avant d'activer le relief.
- La précision verticale annoncée des sources n'a pas été vérifiée ; seule la cohérence avec les dénivelés connus de Spa, Suzuka et Interlagos l'est, de mémoire.
- Aucune mesure du coût de rendu ou de physique d'un sol non plat : c'est l'objet de R-3.2.
