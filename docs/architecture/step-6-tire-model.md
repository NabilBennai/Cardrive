# Modèle de pneu et de transmission

Cette étape remplace l'ancien modèle de contact (force latérale proportionnelle à un angle, force longitudinale appliquée directement à la caisse, un seul nœud thermique) par un modèle de pneu à glissement. Il est dans `src/vehicle/physics/tireModel.ts` (fonctions pures, testées) et `VehicleSimulation.ts` (solveur).

## Ce qui n'allait pas avant

- Aucune roue : pas de vitesse de rotation, donc pas de glissement longitudinal, ni patinage, ni blocage. Une « limite d'adhérence » n'existait que comme un écrêtage.
- Le grip chutait à 60 % pneus froids (20 °C), d'où une alerte « adhérence limite » dès le premier démarrage.
- Un seul nœud de température de 11 kJ/°C, avec un refroidissement de 3 W/°C (constante de temps ≈ 1 h) et une chaleur proportionnelle à un « dépassement de grip » arbitraire : 20 → 180 °C en quelques secondes, puis aucun refroidissement.

## Forces de contact

Formule magique de Pacejka (`magicCurve`, `tireForce`) en glissement combiné :

- Glissement longitudinal κ = (ω·R − v) / max(|v|, v₀), angle de dérive α = atan2(vₗ, max(|v|, v₀)).
- Glissements normalisés par leur pic (κₚ ≈ 0,12 ; αₚ ≈ 0,13 rad) puis combinés : s = √((κ/κₚ)² + (tan α / tan αₚ)²).
- Magnitude F = μ·Fz·sin(C·atan(B·s)), pic en s = 1, asymptote = 82 % du pic (le facteur C en découle). La direction suit le rapport des glissements : un pneu qui patine perd de l'adhérence latérale sans règle ad hoc.
- Sensibilité à la charge : μ diminue quand la charge de la roue augmente (le transfert de charge vient de la suspension et de la caisse Rapier).
- Raideur de dérive résultante ≈ 20 × la charge par radian, valeur de pneu de route.

## Roue, transmission, freins

- Chaque roue a une vitesse ω et une inertie. Équation : I·dω/dt = couple moteur − frein − R·Fx, intégrée de façon **implicite** avec la raideur sécante Fx/κ (la pente tangente s'annule au pic et rendrait le schéma instable).
- La vitesse de la caisse au pas suivant est **prédite** (accélération lissée) : sans cela une roue libre retarde toujours d'un pas, et la raideur du pneu transforme ce retard en une traînée parasite (≈ 29 % de l'accélération du prototype avant correction).
- Différentiel ouvert : le couple moteur est réparti à parts égales entre les roues motrices.
- Le moteur est entraîné par la vitesse des roues motrices : une roue qui patine emballe le moteur. Son inertie (volant, vilebrequin) est ramenée aux roues par le rapport au carré (≈ +30 % de masse apparente en 1re).
- Frein de service avec ABS prédictif (le glissement de freinage reste ≤ 1,25 × celui du pic) ; frein à main sans ABS (les roues arrière bloquent).
- Vitesses de référence de glissement `stableReferenceSpeedMps` : la raideur du pneu est adoucie à basse vitesse pour que l'intégration explicite de la caisse reste stable (condition dt·k/m < 0,8). Équivalent d'une longueur de relaxation ; sans effet au-delà de ~20 km/h.

## Température et adhérence

Deux nœuds par pneu, paramètres d'un 205/55 R16 (≈ 9 kg) mis à l'échelle de la charge statique de la roue :

| | Bande de roulement | Carcasse |
| --- | --- | --- |
| Capacité | 2 kJ/°C | 12 kJ/°C |
| Sources | frottement au contact (F × vitesse de glissement) × 60 % + 40 % de l'hystérésis | 60 % de l'hystérésis (résistance au roulement × vitesse) + conduction depuis la bande |
| Pertes | conduction (60 W/°C) vers la carcasse, convection (h = 10 + 7·v^0,6 W/m²/°C, 0,25 m²), route (8 W/°C) | convection (0,45 m²) |

Constantes de temps obtenues (testées) : la bande rejoint la carcasse en ~30 s ; à l'arrêt la carcasse perd la moitié de son excès en ~12 min ; en roulant à 108 km/h elle se stabilise autour de 30-65 °C ; un burn-out à 60 kW chauffe la bande de plus de 50 °C en 1 s. L'adhérence dépend de la température de la **bande** : perte douce à froid (~14 % à 20 °C, pas 40 %), plus marquée à chaud.

## Mesures

`npm run measure-catalog` (0-100, vitesse de pointe, freinage) et `node --experimental-strip-types scripts/tire-diagnostics.mjs [id]` (séries temporelles par roue). Le prototype (1,6 VTi 120) donne 0-100 en 10,5 s (publié : 10,5-10,8 s) et 100 → 0 en 44 m pneus froids. La vitesse de pointe reste sous-estimée (163 km/h contre 188 publiés) : écart non traité.

## Limites

- Pas de relief ni de pente ; sol sec uniquement, un seul coefficient de route.
- Le glissement de roulement (déformation) et l'usure ne sont pas modélisés.
- Pas de déportance aérodynamique : les voitures de course tiennent par leur gomme seule.
- Différentiel ouvert uniquement (pas d'autobloquant), pas de contrôle de traction.
