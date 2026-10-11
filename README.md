# URBIS 2030

City builder isométrique pour navigateur de bureau. Le joueur, maire d'une ville de 2030, construit sur une grille,
finance ses équipements, gère sa population et déploie des technologies autonomes (feux prédictifs, robots et drones
de livraison, véhicules autonomes, IA municipale) — avec leurs coûts, leurs besoins en calcul et leurs effets secondaires.

Toute la simulation tourne localement dans le navigateur : aucun serveur, aucun compte, aucune clé d'API.

## Démarrer

```bash
npm install          # versions verrouillées (package-lock.json)
npm run dev          # serveur de développement : http://localhost:5173
npm run build        # build de production dans dist/
npm run build:single # build autonome en un seul fichier HTML dans dist-single/
npm test             # tests unitaires et d'intégration (Vitest)
npm run test:e2e     # parcours utilisateur (Playwright ; `npx playwright install chromium` au préalable)
npm run bench        # mesures de performance de la simulation (64×64 et 128×128)
```

Node 20 ou plus récent.

## Prise en main

La carte **Objectifs** (en haut à gauche) sert de tutoriel : 13 étapes vérifiées automatiquement sur l'état réel de la
partie, chacune avec son explication. Elle se replie, se masque et se réaffiche depuis l'aide (H).

1. Tracez une rue depuis l'accès autoroutier (bord ouest). Sans liaison régionale, personne ne s'installe.
2. Construisez une centrale le long d'une route : routes et bâtiments contigus transportent l'électricité.
3. Zonez (résidentiel, collectif, commerce, bureaux, industrie) à moins de 3 cases d'une route alimentée.
4. Apportez l'eau (pompe au bord de l'eau ou château d'eau) puis une station d'épuration.
5. Organisez la collecte des déchets : centre de collecte près des quartiers, décharge ou incinérateur pour traiter.
6. Équipez la ville (police, secours, santé, écoles, parcs), desservez-la en bus puis en métro, et pilotez le budget (B).
7. Déployez les technologies de 2030 (touche I) et franchissez les ères pour débloquer bâtiments et niveaux futuristes.

Le mode « Bourg existant » de l'écran d'accueil construit un bourg avec les commandes du jeu (mêmes règles et mêmes
coûts que le joueur) puis le simule pendant un an.

### Raccourcis

| Touche | Action |
| --- | --- |
| Flèches, ZQSD ou WASD | Déplacer la caméra |
| Clic droit / molette enfoncée + glisser | Déplacer la caméra |
| Molette | Zoom |
| Clic gauche | Sélectionner ou construire ; glisser pour tracer routes, zones, démolitions |
| Maj (pendant un tracé de route) | Tracer d'abord à la verticale |
| R | Pivoter le bâtiment (si compatible) |
| Échap | Annuler le tracé / fermer / revenir à la sélection |
| Suppr | Outil de démolition |
| Ctrl+Z | Annuler la dernière action (30 jours de jeu, si rien n'a changé depuis) |
| Espace, 1, 2, 3 | Pause, vitesse normale, rapide, très rapide |
| B, C, I | Finances, tableau de bord de la ville, IA et politiques |
| L | Couche de données suivante |
| X | Rendre translucides les bâtiments devant le curseur |
| Ctrl+S | Sauvegarde rapide |
| M, H | Menu, aide |
| F | Plein écran (ou mode immersif) |
| F3 | Outils de débogage |

Toutes ces fonctions sont aussi accessibles à la souris.

### Sur téléphone et tablette

| Geste | Action |
| --- | --- |
| Pincer | Zoomer / dézoomer |
| Glisser à deux doigts | Déplacer la carte, quel que soit l'outil (annule un tracé en cours) |
| Glisser à un doigt | Outil Sélection : déplacer la carte ; route ou zone : tracer |
| Toucher deux fois au même endroit | Poser un bâtiment (le premier appui montre l'aperçu et le coût) |
| Bandeau de l'outil actif | Pivoter le bâtiment, revenir à la sélection |

La mise en page s'adapte au portrait et au paysage (dock d'outils en bas, panneaux plein écran, zones sûres
de l'encoche).

**Plein écran.** Le bouton en haut à droite (touche F) utilise l'API plein écran quand le navigateur l'autorise
(ordinateur, Android, iPad). Safari sur iPhone réserve le plein écran aux vidéos : le bouton bascule alors en
**mode immersif**, qui réduit l'interface du jeu au minimum. Pour un vrai plein écran sur iPhone, il faut héberger
le build (`npm run build`) puis, dans Safari, « Partager → Sur l'écran d'accueil » : les balises
`apple-mobile-web-app-capable` d'`index.html` font alors démarrer le jeu sans barre de navigateur.

## Contenu du jeu

### Ponts

Une rue, une avenue ou une autoroute tracée **en ligne droite** d'une rive à l'autre devient un pont sur la partie
en eau (16 cases au plus, les deux extrémités sur la terre ferme). Le tablier est porté à la hauteur des berges, se
raccorde au réseau des deux côtés, coûte plus cher à construire et à entretenir, et apparaît dans l'inspecteur.
Un tracé impossible (virage sur l'eau, pas de rive d'arrivée, trop long) est refusé avec sa raison avant tout débit.

### Transports en commun

| Équipement | Rôle |
| --- | --- |
| Dépôt de bus | Fournit les bus (1 800 voyageurs/j) aux arrêts **du même réseau routier** |
| Arrêt de bus | Dessert un rayon de 5 cases ; les bus empruntent la route (part résiduelle de trafic) |
| Station de métro | Rayon 8, souterrain ; il faut **au moins deux stations** pour former une ligne |
| Gare régionale, hyperboucle (ère 3) | Rayons 10 et 16 ; relient la ville à la région (navetteurs sortants et entrants, déplacements régionaux des habitants) ; à partir de deux gares, trajets internes aussi |

La part modale dépend de la couverture et du tarif (élasticité réglable dans Finances → Fiscalité et tarifs, gratuité
possible par politique). Les voyageurs réduisent les trajets en voiture et la congestion, remontent la satisfaction et,
pour le métro et le train, la valeur foncière. Recettes de billetterie et coûts d'exploitation par voyageur sont
comptabilisés séparément. Onglet **Transports** du tableau de bord (C) et couche de données dédiée.

Les gares sont animées : une rame entre en gare, marque l'arrêt et repart, d'autant plus souvent que la gare est
fréquentée ; une gare hors service (électricité, accès, personnel) ne voit passer aucun train. L'inspecteur affiche
les voyageurs de chaque équipement.

### Gestion des déchets

Chaque habitant et chaque emploi produit des déchets. Les centres de collecte (et les équipements dotés d'une flotte)
couvrent un rayon ; les déchets collectés sont traités dans l'ordre le plus vertueux disponible :
**recyclage → valorisation IA (ère 3) → méthanisation (ère 2) → incinération → décharge**. Recyclage et valorisation
rapportent des recettes ; incinérateur, méthaniseur et centre de valorisation produisent de l'électricité ; la décharge
se remplit (barre de remplissage dans l'inspecteur). Les déchets non collectés s'accumulent case par case : pollution,
baisse de la valeur foncière et de la satisfaction, alerte. Onglet **Déchets** et couche de données dédiée.

### Ères et niveaux futuristes

| Ère | Conditions de passage (vérifiées chaque mois, jamais perdues) |
| --- | --- |
| 1. Ville connectée | Départ |
| 2. Ville autonome | 3 000 habitants, 2 technologies, satisfaction ≥ 55, 80 % des déchets collectés |
| 3. Ville symbiotique | 8 000 habitants, 5 technologies, satisfaction ≥ 62, 90 % de collecte, 30 % de la population desservie par les transports |

Les zones montent désormais jusqu'au **niveau 5**. Chaque palier exige une valeur foncière et une **satisfaction minimales**
et des besoins couverts (électricité, eau, déchets, éducation, santé, transports, ère) : l'inspecteur affiche la liste
cochée des conditions du niveau suivant. Les niveaux 4 et 5 ont une architecture futuriste (tours vitrées à liserés
lumineux, terrasses végétalisées, plateformes à drones, arcologies). L'ère change aussi l'ambiance : voies
« intelligentes » lumineuses, ciel, drones en circulation à l'ère 3. Onglet **Progression** du tableau de bord.

### Bâtiments ajoutés

82 bâtiments au total, dont, inspirés des premiers SimCity quand ils sont pertinents en 2030 :

- **Énergie et eau** : barrage hydroélectrique, centrale nucléaire, réacteur à fusion (ère 3), usine de dessalement.
- **Services publics** : poste de police de quartier, bibliothèque, lycée, caserne à drones de secours (ère 2),
  centre de santé IA (ère 2).
- **Parcs et loisirs** : place, aire de jeux, terrain de sport, statue, marina, résidence du maire, musée, zoo, stade,
  jardin vertical (ère 2), parc holographique (ère 3).
- **Transports et logistique** : arrêt et dépôt de bus, métro, gare, hyperboucle, port de commerce, aéroport régional.
- **Déchets** : centre de collecte, décharge, incinérateur, centre de tri, méthaniseur, centre de valorisation IA.

Certains équipements ont des effets à l'échelle de la ville (tourisme, attractivité, demande commerciale ou
industrielle) et des **risques** maîtrisés : incident technique qui met le bâtiment hors service quelques jours, avec
alerte et coût de remise en état.

### Améliorations des équipements publics

35 améliorations (fichier `public/data/upgrades.json`) s'achètent depuis l'inspecteur d'un équipement déjà construit :
patrouilles et vidéoprotection, grande échelle, imagerie médicale, classes numériques, tuteurs IA (ère 2), filtres
catalytiques, cycle combiné, suiveurs solaires, sûreté nucléaire, pompes à haut rendement, bennes supplémentaires,
extension de décharge, filtres à fumées, tri optique, bus supplémentaires, rames allongées, quai supplémentaire,
parc relais, entretien des parcs, programmation culturelle… Chacune a un coût (immobilisation amortie), un entretien
mensuel, parfois une condition de déblocage, et des effets chiffrés sur ce seul bâtiment (rayon, efficacité,
capacité, production, nuisances, risque, recettes). Les pastilles dorées au pied d'un bâtiment indiquent ses
améliorations. « Annuler » fonctionne ; une démolition sort aussi les améliorations du bilan.

### Échanges régionaux

Finances → **Échanges régionaux**. Les réseaux reliés à l'accès autoroutier peuvent :

| Échange | Prix | Règle |
| --- | --- | --- |
| Vendre l'électricité excédentaire | 0,30 € / u. / mois | après la recharge des batteries |
| Acheter l'électricité manquante | 3,20 € / u. / mois | après les batteries ; au plus 60 % des besoins |
| Vendre l'eau excédentaire | 0,35 € / u. / mois | |
| Acheter l'eau manquante | 3,80 € / u. / mois | au plus 60 % des besoins |
| Faire traiter les déchets hors de la ville | 1,60 € / unité | il faut toujours des bennes pour collecter |

L'achat est volontairement prohibitif (les habitants paient 0,90 € l'électricité : chaque unité achetée est revendue à
perte). Tout est désactivé par défaut ; les alertes de pénurie rappellent que le dépannage existe. Ventes et achats
apparaissent sur des lignes distinctes du compte de résultat.

### Fiches avant construction

Le menu de construction affiche, pour chaque bâtiment, une fiche calculée à partir de ses données : rôle et conseil
d'implantation, effets positifs et négatifs chiffrés (rayon, capacités, pollution, bruit, valeur foncière, risques),
besoins (électricité, eau, bord de l'eau, accès routier), coûts et nombre d'améliorations possibles. Sur ordinateur,
la fiche suit le survol ; au doigt, le bouton « i » la déplie sous l'élément. Un bâtiment verrouillé reste consultable.
Pendant la pose, le bandeau de l'outil rappelle les effets principaux.

### Notifications

Un clic ou un appui ferme une notification (bouton × également), un glissement latéral aussi ; « Tout effacer »
apparaît dès qu'il y en a deux. Les messages identiques sont fusionnés (×2, ×3). Elles passent sous les menus, les
panneaux et l'inspecteur, ne disparaissent pas tant que le pointeur est dessus, et sont limitées à deux sur téléphone.

## Architecture

```
src/
├── app/          GameApp (assemblage), GameSession (état + simulation + services, sans rendu),
│                 GameState (données pures), GameLoop, EventBus, InputController, ToolController, scenarios
├── world/        Grid (tableaux typés), Tile (vue d'une case), Terrain, WorldGenerator, PlacementSystem
├── simulation/   Simulation (orchestrateur), SimulationClock, PopulationSystem, BuildingSystem,
│                 EconomySystem, TrafficSystem, UtilitySystem, EnvironmentSystem, AISystem, WasteSystem,
│                 TransitSystem, ProgressionSystem, Modifiers, config
├── systems/      ConstructionService, ZoningService, RoadNetwork, Pathfinding, RouteService (itinéraires en cache),
│                 TransportService, EventSystem, ActionHistory, BuildingFactory
├── debug/        Invariants (contrôles de cohérence de l'état)
├── rendering/    Renderer (PixiJS), IsometricProjection, Camera, LayerManager, SelectionRenderer,
│                 VehicleRenderer, Overlays, art/ (dessin procédural original)
├── ui/           HUD, Toolbar, InspectorPanel, FinancePanel, TechPanel, CityPanel, OverlayManager,
│                 Notifications, PanelHost, MenuPanels (accueil, sauvegardes, paramètres, aide),
│                 ObjectivesCard (tutoriel), DebugPanel, BuildingSheet (fiches)
├── persistence/  SaveService (IndexedDB), SaveMigration, SettingsService (localStorage)
├── data/         Catalog, Validators, Upgrades, defaultData
└── styles/
public/data/      buildings.json, technologies.json, policies.json, upgrades.json
tests/            unit/, integration/, e2e/
scripts/bench.js  mesures de performance
```

Règles respectées :

- **La simulation ne dépend pas du rendu.** `GameSession` et tout `simulation/`, `systems/`, `world/` s'exécutent sous
  Node sans navigateur (c'est ce que font les tests et le banc de mesure).
- **Le rendu ne décide d'aucune règle** : il lit l'état et écoute le bus d'événements.
- **L'interface ne modifie jamais le monde directement** : elle envoie des commandes à `GameSession.execute()`,
  qui passent par `ConstructionService`, `ZoningService`, `EconomySystem` ou `AISystem`. Chaque commande a une
  prévisualisation (`preview()`) qui renvoie coût, validité et raisons du refus.
- **Données séparées du code** : bâtiments, routes, zones, technologies et politiques sont dans `public/data/*.json`,
  validés au chargement (`Validators.js`). Ajouter un bâtiment ne demande aucune modification du moteur.
- Aucune dépendance circulaire (vérifiée), aucun singleton : chaque partie crée ses instances.

### Grille et projection

La grille logique `(x, y)` est la source de vérité. Les couches sont des tableaux typés (terrain, altitude, zone, route,
bâtiment, valeur foncière, pollution, bruit, chaleur, réseaux, trafic, couverture des services, desserte…).
`IsometricProjection.js` reprend les formules du cahier des charges et les complète par la caméra (translation, zoom),
la position du canevas et l'altitude (pointage du plan le plus haut vers le plus bas). La sélection d'un bâtiment teste
d'abord la silhouette dessinée (on peut cliquer sur une tour), puis la case au sol ; la touche X rend translucides les
bâtiments qui masquent le curseur.

### Temps

Un tick = un jour de jeu ; 30 jours par mois. `SimulationClock` accumule le temps réel et fixe le nombre de ticks,
plafonné par image ; `GameLoop` applique en plus un budget de 10 ms par image. Un onglet inactif ne provoque pas de
rattrapage massif. Les sous-systèmes tournent à des fréquences adaptées (réseaux tous les 5 jours ou après une
modification, environnement tous les 10 jours, trafic incrémental à chaque jour, clôture comptable mensuelle).
Le résultat ne dépend que des ticks simulés : à état et actions identiques, deux parties sont identiques au bit près,
y compris après sauvegarde et rechargement (testé).

### Simulation

- **Population** agrégée par bâtiment résidentiel : effectif, revenu (modeste / intermédiaire / aisé), âges, actifs,
  qualification (progresse avec l'éducation), emploi, loyer, satisfaction détaillée par facteur.
- **Emploi** : appariement par bassin routier et par niveau de qualification, navetteurs entrants et sortants.
- **Demande** résidentielle, commerciale, bureaux, industrielle : logements vacants, emplois vacants, chômage par
  qualification, consommation contre capacité commerciale, débouchés industriels, fiscalité, politiques.
- **Croissance** sur zones : apparition, montée de niveau (valeur foncière, réseaux, occupation, satisfaction),
  déclin, abandon (accès, électricité, satisfaction) et effondrement.
- **Réseaux** : électricité par composantes connexes avec délestage par priorité et stockage ; eau et assainissement.
- **Environnement** : pollution, bruit, végétation, îlots de chaleur, valeur foncière, couverture des services.
- **Mobilité** : graphe routier (chaque case = segment avec capacité, vitesse, entretien, catégorie, état de circulation,
  voisins), affectation agrégée des déplacements domicile-travail, achats et livraisons par Dijkstra pondéré par la
  congestion (fonction BPR) et distribution gravitaire ; A* disponible pour les trajets ponctuels. Les flux sont
  remontés le long de l'arbre des plus courts chemins en un seul passage, avec un budget de calcul par tick.
  `RouteService` calcule les itinéraires ponctuels (inspecteur : trajet jusqu'à l'autoroute) avec un cache invalidé
  à chaque modification du réseau ou cycle de trafic ; un trajet impossible est signalé explicitement avec sa raison.
- **Transports en commun et déchets** : voir « Contenu du jeu ».
- **IA et technologies** : 11 technologies (dont navettes autonomes et mobilité intégrée « MaaS ») (coûts de déploiement et d'exploitation, ressources de calcul fournies par les
  centres de données, effets positifs modulés par le calcul disponible, effets secondaires, incidents aléatoires
  contrôlés). Logistique autonome : plateformes, entrepôts automatisés, micro-hubs, robots, drones limités aux zones de
  desserte autorisées, avec indicateurs mesurés (tournées évitées, délais, part automatisée, consommation, bruit).

### Économie

- Montants en **centimes entiers** ; chaque mouvement est une transaction numérotée du journal.
- Investissements **atomiques** (refusés en bloc si la trésorerie est insuffisante) et **amortis** selon la durée de vie
  du bien ; une démolition passe la valeur nette restante en charge (sortie d'actif).
- Distinction **résultat comptable / flux de trésorerie** : compte de résultat (recettes, charges, résultat opérationnel,
  amortissements, intérêts, résultat net) et tableau de flux (opérationnel, investissement, financement).
- Impôts assis sur des **bases taxables** calculées : revenus des actifs, valeur ajoutée des commerces, bureaux et
  industries, valeur cadastrale. Tarifs de l'eau et de l'électricité, redevances logistiques, hébergement de données.
- Emprunts à annuités constantes (capacité d'endettement, taux), prévision de trésorerie à 12 mois fondée sur la tendance
  des trois derniers mois et l'échéancier réel de la dette.

### Sauvegardes

IndexedDB, format versionné (`formatVersion` = 4) avec migrations explicites (`SaveMigration.js` : v1 → v2 ;
v2 → v3 ajoute ponts, transports, déchets et progression ; v3 → v4 ajoute améliorations et échanges régionaux, tous
désactivés, pour que l'équilibre d'une ancienne partie ne change pas).
Somme de contrôle, validation structurelle avant intégration, relecture après écriture. La sauvegarde automatique
alterne entre deux emplacements : un état invalide ou une écriture ratée n'écrase jamais la dernière sauvegarde valide.
Plusieurs sauvegardes, export et import de fichiers. Aucun objet graphique n'est enregistré.
`localStorage` ne contient que des préférences légères.

## Paramètres, accessibilité et débogage

- **Paramètres** : taille de l'interface (90 à 130 %), qualité graphique (automatique, haute, moyenne, économie : la
  résolution du rendu baisse pour les machines modestes), compteur d'images, véhicules et drones, quadrillage,
  défilement par les bords, confirmation des démolitions coûteuses.
- **Accessibilité** : toutes les fonctions au clavier et à la souris (ou au toucher), libellés ARIA, focus
  visible, alertes annoncées (`role="status"`), aucune information portée par la seule couleur.
- **Outils de débogage** (F3 ou Paramètres) : images par seconde, temps de préparation, temps par sous-système,
  nombre de bâtiments simulés contre dessinés (détecte fuites et doublons d'objets graphiques), succès du cache
  d'itinéraires, mémoire JS, contrôle de cohérence complet (`Invariants.js` : grille, emprises, ponts, capacités,
  trésorerie = journal), avance jour par jour ou mois par mois, export de l'état en JSON.

## Tests

`npm test` : 205 tests Vitest (21 fichiers, dont le chargement de chacun des 79 modules) — grille et sélection (projection, zoom, déplacement), construction et
finances, simulation, mobilité (itinéraires, cache, trajets impossibles), ponts, transports, déchets, progression et
niveaux, train (régression « gare sans voyageurs »), améliorations, échanges régionaux, fiches des bâtiments,
catalogue des 82 bâtiments, dessin de chaque bâtiment, sauvegardes et migrations, boucle de jeu (aucune
accumulation d'objets), invariants sur une ville simulée plusieurs années.
`npm run test:e2e` : 7 parcours Playwright — fiches du menu, amélioration depuis l'inspecteur, échanges régionaux,
gare animée et notifications ; fiche dépliable et notification fermée au doigt ; fonder une ville à la souris ; pont, bus, couches, progression, tutoriel
et débogage depuis l'interface ; aucun bouton principal décoratif ; pas de duplication d'objets graphiques ni de fuite
mémoire ; iPhone (gestes, pose au double appui, mode immersif).

## Performances mesurées

Machine de mesure : Intel Xeon 2,1 GHz (2 cœurs, serveur virtuel), Node 22, Chromium 156 sans GPU (rendu WebGL logiciel
SwiftShader). Les chiffres de rendu sont donc des majorants côté processeur ; la fréquence d'images réelle dépend du GPU
et n'a pas pu être mesurée sur cette machine.

| Mesure | 64 × 64 | 128 × 128 |
| --- | --- | --- |
| Chargement jusqu'au menu (build de production) | 0,3 s | 0,3 s |
| Tick de simulation moyen / p95 (`npm run bench`) | 2,2 ms / 5,2 ms | 10,9 ms / 20,9 ms |
| Préparation CPU d'une image (vue normale) | 5,2 ms | 1,9 ms |
| Préparation CPU d'une image (carte entière) | 5,4 ms | 10,1 ms |
| Redessin complet du sol (cas extrême) | 12 ms | 49 ms |

Le budget de 16,7 ms par image (60 i/s) est respecté côté processeur sur 64 × 64. Sur 128 × 128, la vue d'ensemble
s'en approche : les tronçons hors écran sont masqués et seuls les tronçons modifiés sont redessinés.

## Limites connues et suites

- Lignes de transport implicites (desserte par rayon et par réseau) : pas de tracé manuel de lignes ni d'horaires.
- Ponts droits uniquement ; pas de tunnels ni de ponts au-dessus des routes.
- Piétons, tramway, dette par échéances complexes, fiscalité différenciée par quartier : non implémentés.
- Pas d'audio dans la v0.1 (dossier `public/assets/audio` réservé).
- Graphismes 100 % procéduraux et originaux ; les dossiers `public/assets/*` accueilleront des sprites.
- Les e2e Playwright sont lents sans GPU (≈ 7 min pour les 7 parcours) ; ils passent avec les délais configurés.
- Les gares n'ont pas de voies tracées sur la carte : le réseau ferré régional est implicite.
- Prix des échanges régionaux fixes (pas de marché qui varie selon la saison ou la demande).
