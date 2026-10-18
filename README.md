# URBIS 2030

City builder isométrique pour navigateur de bureau. Le joueur, maire d'une ville de 2030, construit sur une grille,
finance ses équipements, gère sa population et déploie des technologies autonomes (feux prédictifs, robots et drones
de livraison, véhicules autonomes, IA municipale) — avec leurs coûts, leurs besoins en calcul et leurs effets secondaires.

Toute la simulation tourne localement dans le navigateur : aucun serveur, aucun compte, aucune clé d'API.

## Nouveautés de la version 1.2 — polémiques, journal local et événements populaires

### Presse et polémiques (Mairie → Presse et polémiques)

- **Douze polémiques** nées de situations réelles : incinérateur ou décharge récents près de 200 habitants, hausse
  d'un impôt de 1,5 point ou plus en un mois, accident d'un véhicule autonome ou d'un drone, données de l'IA
  municipale sans cybersécurité, chantier de tramway, école à plus de 120 % de sa capacité, conflit d'intérêts d'un
  adjoint, flambée des loyers, fumées d'usine, dépense de prestige avec des finances fragiles, nuits agitées, tours
  contre pavillons. Au plus une nouvelle par trimestre, deux à la fois, aucune la première année ni pendant une crise,
  la même pas avant trois ans.
- **Intensité** de 1 à 10 : −0,4 point de popularité par point. Sans réponse, elle enfle cinq mois puis retombe (le
  silence compte comme une crise ignorée). **Assumer** : −1 par mois ; **concerter** : −3 par mois (coût, effet
  propre : filtres, étalement de la hausse, audit, classes provisoires, mise aux normes…) ; **reculer** : la polémique
  est close aussitôt (suspension de l'installation, annulation de la hausse, gel des investissements…), mais c'est un
  revirement. Un adjoint du domaine de compétence 4 ou plus accélère la décrue ; reculer le désavoue (−10 de loyauté).
- **Affaire** à 10 d'intensité : −6 points de popularité, et l'adversaire s'en sert en campagne (+1,5 point
  d'avantage par affaire du mandat, plus les polémiques encore ouvertes).
- **Le Courrier de la ville** : une par mois (élection, affaire, polémique, crise, nouveau statut, fête, inauguration,
  record de population, sondage). Son ton suit les **relations avec la presse** (0 à 100) : concerter les améliore,
  assumer une polémique virulente les dégrade ; au-dessus de 65, +0,5 point de popularité, sous 35, −0,5.

### Événements populaires (Mairie → Événements, ou « Organiser un événement » dans l'inspecteur d'un lieu)

| Événement | Lieu | Statut | Coût (Hameau) | Effet |
| --- | --- | --- | --- | --- |
| Fête de quartier | petit parc, place, aire de jeux, parc | Hameau | 3 000 € | satisfaction +4 sur 10 cases |
| Marché de producteurs | place, parc | Village | 2 000 € | satisfaction +2, commerce +3 |
| Tournoi sportif | terrain de sport | Village | 5 000 € | satisfaction +3 sur 12 cases |
| Fête de la musique (juin) | parc | Bourg | 15 000 € | satisfaction +3 sur 16 cases, nocturne |
| Marché de Noël (décembre) | place, parc | Bourg | 20 000 € | commerce +15 |
| Festival d'été | parc, marina | Ville | 60 000 € | satisfaction +4, recettes 30 000 à 60 000 € |
| Match ou concert | stade | Métropole | 120 000 € | recettes 80 000 à 160 000 €, trafic +30 % trois jours |
| Grand événement régional | stade (et aéroport ou gare) | Capitale régionale | 3 M€ sur 12 mois | 1,5 M€ de recettes, +3 de popularité et demande résidentielle +5 pendant deux ans ; fiasco : −5 et une affaire |

- Coûts multipliés par (1 + 0,15 × rang du statut). Un événement à la fois, un tous les quatre mois par lieu ;
  annulation possible (moitié remboursée).
- **Effet** = base × fréquentation (habitants autour, transports en commun) × météo (pluie ×0,6, chaleur ×0,85,
  orage : annulation et moitié des frais perdue, sauf **repli couvert** à +30 %) × 0,6 par édition du même type dans
  l'année × 0,5 en année électorale × adjoint aux Solidarités. Sans police, un incident peut gâcher la fête.
- **Vie locale** : facteur de popularité (jusqu'à +4) des réussites des six derniers mois. En campagne, trois
  événements dans l'année électorale font dénoncer le **clientélisme** (+0,5 point pour l'adversaire).

## Nouveautés de la version 1.1 — conseil municipal, adjoints et priorités du mandat

> **Anciennes parties.** Le conseil démarre vide et les priorités restent neutres tant que le joueur n'y touche pas :
> la popularité est calculée exactement comme avant.

### Conseil municipal (Mairie, touche E → Conseil)

- **Taille du conseil** selon la population, comme pour les communes françaises (15 sièges de 500 à 1 499 habitants,
  29 de 5 000 à 9 999, 43 de 40 000 à 49 999…).
- **Six délégations** : urbanisme, logement et emploi ; finances ; mobilité ; sécurité et secours ; transition
  écologique et réseaux ; solidarités, éducation, santé et culture. Le statut de la ville fixe combien peuvent être
  confiées : 2 au Village, 3 au Bourg, 4 à la Ville, 5 à la Grande ville, 6 à la Métropole.
- **Trois candidats par délégation** et par mandat, tirés de façon déterministe : compétence (1 à 5), ambition (plus
  souvent élevée chez les plus compétents), loyauté, notoriété (−2 à +3) et groupe d'électeurs dont ils sont proches.
- **Effets** par point de compétence au-dessus de 1, multipliés par la priorité de l'axe : croissance des quartiers
  et demande de logements (urbanisme) ; charges de structure −2 % et taux d'emprunt −0,1 point (finances) ; entretien de
  la voirie et des transports −3 %, fréquentation +2 % (mobilité) ; risques d'incendie, d'émeute et de manifestation
  (sécurité) ; entretien énergie et eau −3 %, pollution des bâtiments −4 % (écologie) ; entretien des services −3 %,
  satisfaction +0,25 (solidarités). Indemnité : 800 € × (rang du statut + 1) par adjoint et par mois.
- **Loyauté** : +1 par mois si l'axe a au moins 20 % des priorités, −2 sous 8 %, +6 pour une demande acceptée, −8 pour
  un refus, +5 pour une promesse tenue de son domaine, +3 pour une inauguration de plus de 50 000 €.
- **Demandes** (au plus une tous les trois mois, jamais la première année) : enveloppe exceptionnelle (2 à 6 % des
  recettes du mois), priorité de l'axe à 20 %, adoption d'une politique de son domaine.
- **Démission** sous 25 de loyauté (3 % par point manquant et par mois) : délégation vacante trois mois, −2 points de
  popularité pendant un an. **Remaniement** : un par an, −2 points de popularité et −5 de loyauté pour les autres, sauf
  si l'adjoint remplacé a perdu la confiance.
- **Délégation des crises** : un adjoint de compétence 3 ou plus peut répondre seul aux crises de son domaine (la
  réponse active, si elle coûte au plus 5 % de la trésorerie).
- **Liste dissidente** : pendant la campagne, un adjoint d'ambition 4 ou plus et de loyauté inférieure à 40 quitte la
  majorité si la popularité est sous 47 % ; sa liste prend 1 + ambition points de voix au maire.
- Nouveau facteur de popularité **« Équipe municipale »** : notoriété des adjoints (jusqu'à +4), délégations vacantes,
  démissions récentes.

### Priorités du mandat (Mairie → Priorités)

- **100 points** répartis entre les six axes (environ un sixième chacun au départ).
- **Efficacité** de l'adjoint de l'axe : × (0,85 + 0,9 × part) ; **poids dans l'opinion** des facteurs rattachés à
  l'axe : × (0,7 + 1,8 × part). Mettre 40 % sur la mobilité amplifie la popularité gagnée en désengorgeant la ville,
  et celle perdue si la congestion reste forte.
- Plus de 30 points déplacés en un an : « Priorités changeantes », −1 point de popularité.
- **Campagne** : un thème resté l'axe le plus prioritaire au moins 24 mois du mandat rapporte +1 point de voix ; un axe
  resté sous 10 % coûte 1,5 point (« opportunisme »). Le détail apparaît dans l'estimation et dans les résultats.

## Nouveautés de la version 1.0 — statut de la ville et rééquilibrage économique

> **Anciennes parties.** Elles gardent l'équilibrage des versions 0.x (pas de charges de structure, voirie à
> l'ancien tarif, pas de dotation). Paramètres → Partie → « Passer à l'équilibrage v1.0 » : bascule progressive sur
> 24 mois, définitive. Les statuts déjà atteints sont acquis ; les nouveaux prix des équipements et les déblocages par
> statut s'appliquent à toutes les parties (ce qui est construit reste en place).

### Statut de la ville (tableau de bord → Progression ; nom du statut sous celui de la ville)

| Statut | Habitants | Niveau max des immeubles | Débloque notamment | Dotation de l'État |
| --- | --- | --- | --- | --- |
| Hameau | 0 | 2 | rue, zones R, C, I et agricole, centrale à gaz et solaire, eau, épuration, déchets, mairie, dispensaire, bibliothèque, poste de pompiers | — |
| Village | 500 | 2 | école, poste de police, éolienne, bus, avenue, zone bureaux, industrie forestière, parc, terrain de sport | 60 000 € |
| Bourg | 2 000 | 3 | commissariat, caserne, lycée, centre de tri, batteries, gare et voie ferrée, logistique, extraction, marina ; lignes de bus tracées ; emprunts in fine et à amortissement constant | 150 000 € |
| Ville | 5 000 | 4 (avec l'ère 2) | hôpital, centre de données, incinérateur, barrage, dessalement, tramway, grandes surfaces, musée ; fiscalité par quartier | 300 000 € |
| Grande ville | 15 000 | 5 (avec l'ère 3) | boulevard, métro, université, usine d'eau potable, station d'épuration métropolitaine, zoo, port ; extensions de territoire, contrats à prix fixe | 700 000 € |
| Métropole | 40 000 | 5 | centrale nucléaire, stade, aéroport, autoroute de seconde sortie | 1 500 000 € |
| Capitale régionale | 80 000 | 5 | (grands événements, v1.2) | 3 000 000 € |

- Un statut est acquis sur la **population maximale atteinte** : il n'est jamais perdu. Au passage, écran « Nouveau
  statut » (ce qui est débloqué, la dotation) et dotation versée une fois, comptée en flux d'investissement.
- Les outils, fiches, panneaux (emprunts, quartiers, contrats, territoire) indiquent le statut requis.
- **Ères** : la ville autonome demande désormais 10 000 habitants (3 000 avant), la ville symbiotique 30 000
  (8 000 avant). Le défi « 2045 : ville symbiotique » vise 30 000 habitants.
- Les villes des scénarios et le bourg existant ont été bâtis par l'équipe précédente : leur statut ne limite pas ce
  qu'ils contiennent.

### Rééquilibrage économique (mesuré avec `npm run balance`)

- **Administration générale et personnel** : nouvelle ligne de charges, nulle sous 4 000 habitants, qui monte à 9 € par
  habitant et par mois à partir de 40 000 (1 € à 5 000, 4,4 € à 15 000). Le copilote budgétaire (−5 %) et le
  télétravail encouragé (−2 %) la réduisent.
- **Voirie** : entretien multiplié par 2,5 (rue 1,50 € par case et par mois).
- **Équipements publics plus chers** selon leur statut de déblocage : ×1,15 (Hameau, Village), ×1,4 (Bourg),
  ×1,8 (Ville), ×2,3 (Grande ville), ×3 (Métropole), ×2 pour ceux débloqués par une ère ou une technologie. Exemples :
  hôpital 216 000 €, université 414 000 €, centrale nucléaire 1,44 M€, aéroport 1,8 M€.
- **Difficulté** (nouvelle partie) : Facile 550 000 € et dotations ×1,5 ; Normal 380 000 € ; Difficile 300 000 €,
  dotations ×0,5 et capacité d'emprunt −30 %.
- **Taux d'épargne brute** (épargne brute / recettes, 3 derniers mois) dans Finances → Synthèse, repère 15 à 30 %.

Effet sur la ville planifiée de `scripts/balance.mjs` (96 × 96, graine 2030, réseaux et services suffisants) :

| | Années 1–2 | Années 3–9 | Années 11–15 | Épargne cumulée à 10 ans | à 15 ans |
| --- | --- | --- | --- | --- | --- |
| v0.9 | 14–18 % | 39–63 % | 61–63 % | 30,0 M€ | 68,4 M€ |
| v1.0 | 16–22 % | 28–35 % | 20–21 % | 15,3 M€ | 26,5 M€ |

En v0.9, un hôpital coûtait 1,6 mois d'épargne au moment de son déblocage et une centrale nucléaire 0,7 mois ; en v1.0,
environ 4 et 7 mois.

## Nouveautés de la version 0.9 — conseiller circulation, guide du maire, navigation

### Conseiller « Circulation et pollution » (touche P, ou tableau de bord → Mobilité)

- **Diagnostic** de la ville : niveau de circulation (fluide, chargée, saturée), déplacements en voiture, part des
  transports en commun et habitants desservis, durée moyenne des trajets, part de la pollution due au trafic
  (estimée avec les formules de la simulation).
- **Points noirs** : les axes saturés (au-delà de 90 % de leur capacité) sont regroupés par tronçons contigus, classés
  par flux, avec le type de route et l'élargissement possible (rue → avenue → boulevard) ; « Voir » centre la carte et
  affiche la couche Congestion.
- **Conseils classés par impact**, calculés sur la situation réelle : élargir et mailler le réseau, desservir les
  quartiers en transports en commun, renforcer les lignes saturées, créer un tramway ou un métro, rapprocher emplois et
  logements, politiques (télétravail, gratuité, zone à faibles émissions, livraisons de nuit), technologies (feux
  prédictifs, optimisation des trajets, MaaS, navettes autonomes), écrans végétaux le long des axes, seconde sortie
  d'autoroute, prix du billet, quartiers isolés. Chaque conseil a ses actions directes : outil, couche, panneau,
  adoption d'une politique ou déploiement d'une technologie (coût affiché, bouton grisé si verrouillé).
- Onglet **« Comprendre les leviers »** : comment se forment embouteillages et pollution, tableau des leviers chiffrés
  et de leurs contreparties (et le piège des véhicules autonomes).
- Une notification, au plus une fois par an, signale une circulation saturée et ouvre le conseiller.

### Guide du maire (touche G, aide, ou « Comment jouer ? » sur l'écran d'accueil)

- Tutoriel détaillé en **13 chapitres** : premiers pas, routes et accès, zones et croissance, électricité, eau et
  déchets, services publics, habitants et emploi, circulation et transports, finances, mairie et élections, crises,
  technologies et ères, territoire, conseils de maire.
- Boutons **« Montre-moi »** : ouvrent l'outil, le panneau, la couche ou le menu dont parle la section.
- Chapitres lus cochés (mémorisés dans le navigateur), navigation précédent / suivant ; lisible hors partie depuis
  l'écran d'accueil. Une notification le signale au premier lancement.

### Navigation : rotation de la carte et vue de dessus

- **Boussole** en bas à droite de la carte (sur téléphone : colonne sur le bord droit) : ⟲ et ⟳ font tourner la carte
  d'un quart de tour, pour voir derrière les immeubles et sous un autre angle ; l'aiguille indique le nord de la carte,
  un clic dessus revient à l'orientation d'origine.
- **Vue de dessus** (bouton ou touche V) : la ville en plan, vue du ciel — toits à la couleur des bâtiments avec une
  ombre portée selon la hauteur, houppiers des arbres, relief en dégradé et courbes de niveau, chantiers et ruines
  signalés. Pratique pour tracer un réseau régulier ou lire une couche de données. Elle se combine avec la rotation.
- Raccourcis : virgule (tourner à gauche), point-virgule ou point (tourner à droite), V (vue de dessus). Au doigt :
  **torsion à deux doigts** pour tourner la carte.
- La case au centre de l'écran reste au centre ; construction, sélection, tracés et couches fonctionnent dans toutes
  les orientations (pointage, ordre d'affichage, falaises et faces visibles recalculés). Orientation et vue sont
  mémorisées dans le navigateur.

## Nouveautés de la version 0.8 — lignes de transport, quartiers, dette et marché régional

> **Anciennes parties.** Rien ne change tant que vous ne tracez pas de ligne : le réseau de bus automatique continue de
> fonctionner. Les quartiers démarrent sans écart de taux, les emprunts en cours restent à annuités constantes et le
> marché régional démarre au cours de référence.

### Lignes de bus et de tramway (menu Transports, panneau des lignes : touche K)

- **Tracer une ligne** : outil « Tracer une ligne de bus » ou « de tramway », puis touchez les arrêts dans l'ordre du
  parcours ; Valider (ou toucher à nouveau le premier arrêt) crée la ligne. Elle fait la boucle par le plus court
  chemin routier ; l'aperçu montre le parcours, la longueur, l'intervalle entre deux passages et le coût des rails.
  Échap retire le dernier arrêt choisi.
- **Fréquence et flotte** : chaque ligne a son nombre de véhicules (boutons − et +). Avec la longueur de la boucle, il
  donne l'intervalle entre deux passages : un passage toutes les 6 minutes = desserte optimale, au-delà de 20 minutes
  la desserte tombe à 30 %. La capacité suit la flotte (160 voyageurs par jour et par bus, 650 par rame de tramway) ;
  une ligne saturée laisse des voyageurs à quai. Chaque véhicule coûte un entretien mensuel (bus 350 €, rame 1 500 €).
- **Dépôts** : un dépôt de bus abrite 14 bus, un dépôt de tramway 10 rames, pour les lignes du même réseau routier ;
  au-delà, la flotte est réduite (alerte « flotte limitée par les dépôts »).
- **Réseau de base** : les arrêts de bus hors des lignes restent desservis par les bus que les lignes laissent au
  dépôt, avec une desserte réduite (60 %) : une ville existante ne perd rien en traçant sa première ligne.
- **Tramway** (dès 2 500 habitants) : stations et dépôt de tramway ; les rails sont posés sur les rues, avenues et
  boulevards du parcours (1 400 € par case nouvelle, entretien 3 € par case et par mois), jamais sur l'autoroute. Le
  tramway ne prend pas de voiture sur la route, fait monter la valeur foncière autour des stations et coûte moins cher
  à exploiter par voyageur. Démolir une rue coupe les rails et interrompt la ligne (Ctrl+Z la rétablit) ; supprimer une
  ligne dépose les rails qu'aucune autre ligne n'emprunte.
- **Sur la carte** : tracés colorés et arrêts pendant le tracé, dans le panneau des lignes (survol : ligne en évidence)
  et avec la couche « Transports en commun » ; bus et rames circulent le long de leur ligne, en nombre égal à la flotte
  en service. L'inspecteur d'un arrêt indique les lignes qui le desservent et leur fréquence.

### Fiscalité par quartier (Finances → Quartiers)

- Chaque parcelle de 32 × 32 cases de la commune forme un **quartier** au nom stable (le centre-ville est celui de la
  mairie), renommable. Les résultats des élections par quartier utilisent ces noms.
- Pour chaque quartier, un **écart de taux** de −5 à +5 points par rapport au taux de la commune, pour l'impôt
  résidentiel, commercial, des bureaux et industriel. Effets : chaque bâtiment est imposé au taux de son quartier ;
  la taxe d'habitation locale pèse sur la satisfaction des habitants du quartier ; un quartier moins taxé attire les
  constructions de son secteur (+7 % par point, jusqu'à +35 %), un quartier plus taxé les décourage. La demande et la
  popularité suivent le taux moyen effectivement payé, affiché dans « Fiscalité et tarifs ».
- Couche « Fiscalité par quartier » : quartiers moins taxés en bleu, plus taxés en orange, limites de quartier.

### Dette par échéances (Finances → Emprunts)

- Trois **profils de remboursement** : annuités constantes (comme avant), amortissement constant (même part de capital
  chaque mois, premières échéances plus lourdes, moins d'intérêts au total) et **in fine** (intérêts seuls, capital à
  l'échéance, taux +0,4 point ; alerte trois mois avant). L'aperçu donne la première et la dernière échéance et le coût
  total des intérêts.
- **Échéancier** des 12 prochains mois (intérêts, capital) et **profil d'extinction** de la dette année par année.
- **Remboursement anticipé** : indemnité de six mois d'intérêts, au plus 3 % du capital remboursé.

### Marché régional à prix variables (Finances → Échanges régionaux)

- Les prix d'achat et de vente de l'électricité, de l'eau et du traitement des déchets changent chaque mois :
  conjoncture régionale (marche aléatoire bornée de 70 % à 140 %), **saisons** (électricité chère en hiver et un peu
  en plein été, bon marché au printemps ; eau chère en été) et **événements** : vague de froid (électricité ×1,7 pendant
  deux mois), sécheresse régionale (eau ×1,8 pendant trois mois), surproduction renouvelable au printemps (×0,6).
- **Profondeur du marché** : vendre beaucoup fait baisser le prix moyen obtenu, acheter beaucoup le fait monter.
- **Contrats à prix fixe** de 12 mois, à l'achat (prime de 5 %) ou à la vente (décote de 5 %) : le panneau suit le gain
  ou la perte du contrat par rapport au marché ; résiliation anticipée avec indemnité.
- Courbe des cours sur 24 mois ; les montants sont comptabilisés dans les lignes d'achats et de ventes à la région.

## Nouveautés de la version 0.7 — la politique au cœur de la ville

> **Anciennes parties.** La vie politique démarre au chargement : premières élections municipales dans 3 ans
> (6 ans pour une nouvelle partie), y compris dans les scénarios. Les élections se désactivent dans les paramètres
> de la partie ou dans « Mairie et élections ». Les extensions de territoire d'une ancienne partie gardent
> l'ancien raccord du relief ; le monde complet sans couture concerne les parties fondées en v0.7.

### Mairie et élections (touche E, ou la popularité dans la barre du haut)

- **Popularité** (0–100) recalculée chaque mois à partir de facteurs lisibles : satisfaction des habitants, emploi
  (chômage, et postes vacants au-delà de 15 %), fiscalité (niveau et hausses des 12 derniers mois), note financière
  et trésorerie, couverture des services publics, cadre de vie (congestion, pollution), pénurie de logements,
  gestion des crises (en cours, bien gérées, ignorées), promesses tenues ou rompues, dynamique de la population,
  inaugurations d'équipements, revirements (politique abrogée moins d'un an après son adoption), effets des
  politiques, état de grâce de début de mandat et usure du pouvoir. Elle a de l'inertie : 30 % de l'écart par mois.
  Sondage mensuel (marge d'erreur de ±3 points) et courbe d'évolution.
- **Mandat de 6 ans.** Six mois avant le scrutin, la **campagne** s'ouvre : la liste adverse (fictive) attaque les
  deux plus grandes faiblesses du bilan. Le maire choisit jusqu'à **3 engagements chiffrés**, un par thème, construits
  sur la situation réelle de la ville (chômage, population, taxe d'habitation, couverture écoles, santé et police,
  pollution, transports en commun, congestion, note financière, satisfaction, emplois non pourvus), chacun en
  version modeste (+1 point de voix) ou ambitieuse (+2,2 points), multipliés par la **crédibilité** (promesses
  tenues lors des mandats précédents). Un **thème de campagne** rapporte jusqu'à 3 points s'il met en avant un point
  fort du bilan… et en coûte autant s'il s'agit d'un point faible.
- **Score au scrutin** : 50 + 0,85 × (popularité − 50) + programme + thème − avantage de l'adversaire (jusqu'à 3
  points) ± aléa de campagne (2,5 points). Résultats par **quartier** (parcelles habitées de 32 × 32 cases, selon la
  satisfaction et les services locaux) et participation. La soirée électorale met la partie en pause.
- **Après l'élection** : les engagements deviennent des **promesses suivies** (progression, échéance). Une promesse
  « à atteindre » est tenue dès que l'objectif est atteint (+2,5 points de popularité) ; une promesse « à maintenir »
  (ne pas augmenter la taxe d'habitation, garder le chômage bas) est rompue au premier écart (−4 points).
- **Défaite** : continuer la partie sans élections, ou revenir au menu. **Crise de majorité** : sous 18 % de
  popularité pendant 9 mois, élections anticipées dans 6 mois.
- **Effets en jeu** : une popularité élevée attire des habitants (demande résidentielle +3), une défiance les fait
  fuir (jusqu'à −4) et déclenche manifestations et émeutes.

Équilibrage vérifié sur la partie de 88 000 habitants : sans intervention, avec un programme modeste, la ville
congestionnée (91 %) perd de peu (48 % des voix) ; trois engagements ambitieux font basculer le scrutin (≈ 51 %),
à condition de les tenir ensuite, et désengorger les axes peut rapporter jusqu'à 14 points de popularité.

### Crises sociales, ruines et reconstruction (lot E)

- **Manifestation** (popularité sous 45 %, hausses d'impôts, chômage) : cortège devant la mairie, circulation et
  commerce perturbés. *Recevoir une délégation* y met fin en deux jours ; *laisser passer* peut dégénérer en émeute,
  surtout si la police est peu présente.
- **Émeute** (manifestation ignorée, popularité sous 25 % et chômage élevé) : des commerces et bureaux sont saccagés
  chaque jour autour du foyer. La **couverture police** réduit sa durée et ses dégâts ; *déployer les forces de
  l'ordre* la contient en un à deux jours.
- **Épidémie** (ville dense, couverture santé faible ou hôpitaux saturés, déchets, eaux usées non traitées, hiver) :
  absentéisme (moins d'actifs), commerces désertés, satisfaction en baisse. La vaccination divise durée et effets.
- **Ruines** : incendies, crues majeures et émeutes laissent des ruines (gravats, ruban de sécurité). Les
  propriétaires rebâtissent leurs immeubles au bout de 30 jours (chantier visible). Un **équipement public** détruit
  ne rend plus aucun service tant que la ville ne finance pas sa reconstruction (35 % de son coût, inspecteur).

### Ressources (lot F, Finances → Ressources)

- Quatre ressources, en tonnes par mois : **cultures**, **élevage** (viande, lait), **pétrole**, **gaz**.
- Production : fermes maraîchères, nouvelles **fermes d'élevage**, exploitations et fermes verticales (zone
  agricole) ; puits de pétrole, nouveaux **puits de gaz naturel** et forages automatisés (zone d'extraction) ;
  méthaniseur (biogaz). Proportionnelle au personnel en poste.
- Besoins : alimentation des habitants, pétrole de l'industrie, chauffage au gaz (×1,8 en hiver), centrales à gaz.
- Le déficit est importé (surcoût logistique payé par la ville) ; l'excédent rapporte des redevances, à rendement
  décroissant au-delà de ce que le marché régional absorbe. Cours mensuels (75 à 135 %) et chocs pétroliers ou
  gaziers (+60 % pendant six mois). Une ville qui se nourrit elle-même gagne jusqu'à +1,5 de satisfaction.

### Emplois non pourvus

- **Besoins de la ville → Emploi** : emplois, actifs, postes vacants et chômeurs par niveau de qualification,
  navetteurs, quartiers isolés, et le **diagnostic** (inadéquation des qualifications, pénurie de main-d'œuvre,
  quartiers non reliés). Une alerte apparaît dans la vue d'ensemble dès que les postes vacants dépassent 3 %.
- Trois **politiques d'emploi** (adoptables d'un clic depuis le diagnostic) : **Formation professionnelle**
  (35 % des chômeurs requalifiés vers les postes vacants plus qualifiés, +8 points de qualification),
  **Accueil des navetteurs régionaux** (part des postes vacants pourvus par la région : 25 % → 60 %, trafic +6 %),
  **Logement des actifs** (demande résidentielle +10, construction +20 %).
- Les politiques ont désormais une part de coût par habitant, et certaines pèsent sur la popularité.

### Couches par service public et territoire

- Couches **Éducation**, **Sécurité (police)**, **Secours (pompiers)**, **Santé**, **Administration** et
  **Saturation des équipements**, chacune dans sa teinte : couverture en dégradé, équipements du service en couleur
  pleine (rouge s'ils sont saturés), logements hors couverture en gris foncé. Choisir une école, un commissariat ou
  un hôpital affiche automatiquement la couche du service. La liste des couches est regroupée par thème.
- **Territoire sans couture** : le monde complet (256 × 256 cases) est généré dès la fondation ; la carte de départ en
  est découpée et chaque parcelle achetée en recopie les cases — relief, rivières, lacs et forêts se raccordent
  exactement. L'autoroute prolongée franchit l'eau par un pont au lieu de combler le plan d'eau.

## Nouveautés de la version 0.6 (analyse d'une partie de 27 ans, 88 000 habitants)

> **Anciennes parties.** Une partie bloquée par la valeur foncière repart d'un coup : sur la partie analysée
> (88 700 habitants), la population atteint environ 139 000 habitants en six mois de jeu, et une quarantaine
> d'écoles, commissariats et casernes deviennent saturés. Il faut alors compléter les services.

### Lot D — transports

- **Grand boulevard** (dès 3 000 habitants) : 2 × 3 voies et large terre-plein planté, 3 200 véhicules par jour.
- **Voie ferrée** (menu Routes, dès 2 000 habitants) : se trace comme une route, franchit l'eau par des ponts droits,
  croise les routes par des passages à niveau, se démolit avec l'outil « Démolir les routes » et s'annule. Une gare
  qui touche une voie reliée au bord de la carte accueille des trains régionaux : capacité +50 % et une rame visible
  qui arrive de la région le long des rails, marque l'arrêt puis repart. L'inspecteur indique si la gare est reliée.
- **Autoroute de seconde sortie** (dès 15 000 habitants) : tracée jusqu'au bord de la carte, elle ouvre un nouvel
  accès au réseau régional (habitants, navetteurs, fret). La démolir retire cet accès ; l'accès d'origine reste.
- **Avions et navires** : un avion décolle ou atterrit régulièrement à l'aéroport (ombre au sol, montée, souffle des
  réacteurs) ; un porte-conteneurs relie le port au bord de la carte par l'eau, fait escale puis repart (corne de
  brume). Les sons ne jouent que si la scène est à l'écran, au plus toutes les 12 à 15 secondes.

### Lot C — ville vivante

- **Commerces variés** : en zone commerciale apparaissent aussi un bar de quartier, un salon de coiffure et une
  boutique de prêt-à-porter. Le bar devient restaurant puis boîte de nuit (bruyante, ère 2) ; la boutique devient une
  enseigne de commerce de détail. Chaque variante a son allure (couleurs, auvents, toit).
- **Grandes surfaces commerciales** : nouvelle zone (C+) où poussent, sur des îlots de 2 × 2, un supermarché puis un
  centre commercial puis un centre commercial connecté XXL (ère 2). Elle répond à la demande commerciale.
- **Grands formats** : quand la place zonée le permet (cases libres de la même zone, de plain-pied, touchant une
  route), environ un tiers des constructions prennent un grand format : maisons mitoyennes 2 × 1, îlot résidentiel
  2 × 2 (jusqu'à l'ensemble de tours), parc d'affaires 2 × 2 (jusqu'au quartier d'affaires), grande usine 2 × 1. Chaque
  filière garde son format en montant de niveau.
- **Sur-zonage** : tracer une zone par-dessus une autre la remplace directement. Les bâtiments de l'ancienne zone
  sont démolis (frais de démolition, confirmation, annulable par Ctrl+Z) ; les équipements publics ne sont pas touchés.
- **Services distincts** : la barre d'outils sépare « Éducation et culture », « Police et pompiers » et « Santé et
  administration ». La hauteur des boutons s'adapte à l'écran pour que tout tienne ; sur téléphone, deux rangées.

### Lot B — territoire

- **Extensions de territoire** (bouton carte de la barre d'outils, touche T) : le monde possible fait 8 × 8 parcelles
  de 32 × 32 cases, soit 256 × 256 au plus. La carte de départ occupe les parcelles du centre ; chaque parcelle voisine
  s'achète. Prix : environ une heure de jeu d'épargne (60 mois de variation moyenne de trésorerie sur 12 mois), au moins
  1,5 M€, +30 % à chaque achat (≈ 5,3 M€ pour la première extension de la partie analysée). La carte grandit au
  rectangle englobant ; une parcelle comprise dans ce rectangle mais non achetée reste verrouillée (assombrie). Le
  nouveau terrain prolonge le relief et l'autoroute est prolongée jusqu'au nouveau bord si besoin. Achat suspendu
  pendant une crise. Les anciennes sauvegardes en profitent.
- **Éditeur de carte** (écran d'accueil, « Personnaliser la carte ») : curseurs Eau, Relief, Roche et Forêt de 0 à
  100 % (50 % = carte d'origine). Les extensions suivent les mêmes réglages.
- **Industrie forestière** : nouvelle zone (scierie → usine de panneaux → bois lamellé-croisé, ère 2), uniquement à
  2 cases au plus d'une forêt. Les forêts repoussent d'elles-mêmes, une fois par mois, sur les prairies libres
  entourées d'au moins deux cases boisées.

### Lot A — équilibrage

- **Attractivité par secteur** : le logement garde la valeur foncière ; le commerce, les bureaux et l'industrie ont
  désormais leur propre critère pour monter de niveau. *Commerce* : clientèle à pied, passage, transports, une part de
  valeur foncière. *Bureaux* : éducation, transports en commun, accès, une part de valeur foncière. *Industrie,
  agriculture, extraction* : accès à l'autoroute, plateformes logistiques, gares et port, main-d'œuvre — la pollution
  d'une usine ne bloque plus son propre essor. Nouvelle couche de données « Attractivité des zones ». Sur la partie
  analysée, les bâtiments bloqués par ce critère passent de 96 % à 15 %.
- **Valeur foncière résidentielle rééquilibrée** (services et métro comptent plus, bruit et pollution un peu moins) et
  paliers abaissés d'environ 10 points.
- **Construction 50 % plus chère** (équipements, routes, ponts) ; démolition d'un équipement à 25 % de son prix
  (10 % auparavant), d'un bâtiment de zone à 150 € par case et par niveau, d'une route à 10 € la case.
- **Eau en grosses installations** : usine d'eau potable (3 × 3, 12 000 m³/j, au bord de l'eau, dès 6 000 habitants)
  et station d'épuration métropolitaine (3 × 3, 14 000 m³/j). Améliorations de fin de partie (ère 2), chères :
  captage profond et ultrafiltration (production × 2), bioréacteurs à membranes (épuration × 2).
- **Services à capacité** : chaque école, commissariat, caserne ou hôpital sert un nombre d'habitants donné (école
  5 000, lycée 9 000, université 22 000, commissariat 9 000, caserne 12 000, hôpital 25 000…). Au-delà, son efficacité
  baisse (jusqu'à 35 %) ; l'inspecteur affiche la fréquentation.
- **Défi « ville symbiotique »** : l'objectif financier porte sur le résultat moyen des 12 derniers mois.

## Nouveautés de la version 0.5 (retours de jeu)

- **Déchets simplifiés** : le *Grand centre de tri et de recyclage* (3 × 3, 45 000 €, dès 400 habitants) a désormais
  ses propres bennes : il collecte dans un rayon de 24 cases (900 u./jour) et trie lui-même (800 u./jour). Un seul
  centre suffit à une ville de plusieurs milliers d'habitants. Les autres installations collectent plus loin (centre de
  collecte 18 cases, décharge et incinérateur 14, valorisation IA 28) et la collecte est complète jusqu'aux 4/5 du
  rayon (3/5 auparavant).
- **Poste de pompiers de quartier** : 1 × 1, 8 000 €, rayon 8 cases, pour couvrir les quartiers éloignés de la caserne.
- **Roche** : elle ne bloque plus rien. Un équipement s'y construit et une zone s'y trace : la roche est dérochée
  (60 € la case, montant affiché avant de valider). L'outil Terrain « Défricher et dérocher » la retire aussi. La zone
  d'extraction, elle, garde la roche qu'elle exploite.
- **Ports** : emprise 3 × 2 pivotable, posée sur prairie, sable ou forêt. Le terrain inégal est nivelé automatiquement
  (2 niveaux au plus, 600 € par case et par niveau). L'emplacement s'aimante au rivage valable le plus proche
  (4 cases au plus, dans les deux orientations). La station de pompage profite du même aimant et du nivellement.

## Nouveautés de la version 0.4 (retours de jeu)

- **Besoins de la ville** : les jauges R, C, B, I de la barre du haut sont plus grandes, horizontales et chiffrées.
  Un clic ouvre le panneau « Besoins de la ville » : niveau et tendance de chaque secteur, décomposition de la
  demande facteur par facteur (même formule que la simulation), chiffres clés (logements vacants, emplois non
  pourvus, chômage par qualification, ventes, marchandises, taxes, parcelles libres) et conseils concrets.
- **Industries diversifiées** : deux nouvelles zones s'ajoutent à l'industrie manufacturière (ateliers et usines).
  *Industrie agricole* : ferme maraîchère → exploitation agricole (silo) → ferme verticale (ère 2), peu polluante,
  gourmande en eau, sur prairie ou forêt. *Forage et extraction* : puits de forage → carrière et concassage → forage
  automatisé (ère 2), très productive mais polluante, seulement à deux cases au plus d'un gisement (roche). Les trois
  filières répondent à la demande industrielle.
- **Dézonage d'une parcelle bâtie** : « Retirer le zonage » s'applique aussi aux cases occupées. Le bâtiment de zone
  est alors démoli (frais de démolition, habitants partis) après confirmation ; l'opération s'annule par Ctrl+Z. Les
  équipements publics ne sont jamais touchés.
- **Déplacer un équipement** (menu Démolir et déplacer) : toucher l'équipement, puis son nouvel emplacement, puis
  « Valider ». Il garde ses améliorations, son actif et son historique. Gratuit dans les 30 jours suivant la pose,
  puis 15 % du coût de construction. Annulable.
- **Bouton « Valider »** : au doigt, un appui place l'aperçu d'un bâtiment (toucher ailleurs le déplace) et le bandeau
  d'outil affiche « Valider · coût » (ou « Impossible ici »), « Annuler » et « Pivoter ». Entrée valide aussi. Une
  option des paramètres l'active à la souris.
- **Démolir les routes** : outils « Démolir (tout) », « Démolir les routes » (5 € la case, pont ×4, bâtiments
  épargnés) et « Démolir les bâtiments ». L'accès autoroutier est désormais ignoré au lieu de bloquer tout le rectangle.
- **Routes en dénivelé** : une route qui franchit une marche de terrain est dessinée en rampe (pente sur toute la case
  pour une voie droite, sur le seul bras concerné dans un carrefour), avec son talus. Plus de route « coupée ».
- **Terrassement** (nouveau menu Terrain) : élever, abaisser (pas sous le niveau du sol) ou aplanir à l'altitude de la
  case de départ (600 € par case et par niveau, roche ×2), défricher (15 €/case), planter une forêt (40 €/case, cases
  libres et non zonées). Cases bâties et routes ignorées ; tout est annulable.
- **Éclairage** : nuit nettement plus claire (environ 65 % de luminosité au cœur de la nuit au lieu de 38 %), voile du
  brouillard allégé et atténué la nuit.
- **Alertes qui mènent au problème** : le bouton d'alerte centre la vue sur le bâtiment sans électricité (ou sans eau,
  ou abandonné) le plus proche du centre de l'écran et l'ouvre dans l'inspecteur ; chaque clic suivant passe au
  suivant. Trésorerie négative → finances ; crise → lieu de la crise. Sur écran étroit, le bouton se réduit à « ⚠ n ».
- **Emprunts** : bouton « Max » (montant maximal empruntable) et **note de la dette** de AAA à D, calculée sur les
  trois derniers mois : capacité de désendettement (dette / épargne brute, seuil d'alerte 12 ans), dette rapportée
  aux recettes annuelles, trésorerie négative, résultat déficitaire. Le détail des critères est dépliable ; la note
  fixe la prime de risque des nouveaux emprunts (−0,8 point en AAA, +6 points en D).
- **Menus sur iPad** : un menu de construction ne dépasse plus le bas de l'écran ; il remonte et défile, le dernier
  bâtiment de chaque catégorie (le lycée, par exemple) est toujours atteignable.
- **Notifications discrètes** : compactes (deux lignes au plus, texte complet au survol), au plus trois, rangées dans le
  coin inférieur droit (au-dessus du dock sur téléphone).

## Nouveautés de la version 0.3 (retours de jeu)

- **Rythme** : à vitesse normale, un mois de jeu dure une minute (rapide ×3, très rapide ×9). Pendant une crise, le
  temps reste à vitesse normale.
- **Jour et nuit calés sur le calendrier** : un cycle par mois de jeu, 70 % de journée, 30 % de nuit.
- **Délais de construction réels** pour les bâtiments de zone : maison 15 jours, commerce 20 jours, immeuble,
  bureaux et industrie 1 mois. Chaque montée de niveau se fait en travaux, 1,25 fois plus longs que le niveau
  précédent ; le bâtiment reste occupé pendant les travaux. Un bâtiment neuf n'a ni habitants ni emplois avant sa
  livraison, ne consomme rien et ne déclenche aucune alerte « sans électricité » ou « sans eau » au moment où il est
  livré. L'inspecteur affiche l'avancement et la date de livraison.
- **Événements espacés** : au plus un événement aléatoire tous les trois mois (crises, épisodes climatiques ou
  économiques, incidents techniques confondus) ; les notifications météo ne reviennent pas avant deux mois.
- **Crues visibles** : pendant une inondation, la rivière monte d'un cran sur toute la carte.
- **Arbres** : plus d'arbres collés aux façades des grands bâtiments (ils passaient derrière ou flottaient), arbres
  clairsemés sur les parcelles zonées, redessin des arbres voisins quand un bâtiment apparaît ou disparaît.
- **Réglages du son** : le bouton haut-parleur de la barre du haut ouvre un menu dédié (coupure, volumes, essai).

## Nouveautés de la version 0.2

| Fonction | En bref |
| --- | --- |
| **Audio** | Entièrement synthétisé (Web Audio, aucun fichier) : effets d'interface et de construction, ambiance qui suit la caméra (rumeur, circulation, oiseaux, grillons, pluie, vent, tonnerre), musique générative propre à chaque ère, plus tendue pendant une crise. Volumes séparés, touche N pour couper. |
| **Effets visuels** | Cycle jour/nuit (fenêtres, lampadaires et phares allumés), chantiers avec échafaudages et grues animées, fumées des usines et centrales, saisons (herbe, feuillage d'automne, neige au sol). |
| **Météo et saisons** | Ensoleillé, nuageux, pluie, orage, neige, brouillard, fortes chaleurs, avec des effets chiffrés sur la simulation (chauffage et climatisation, solaire, éolien, capacité des routes, déneigement, îlots de chaleur, transports en commun). |
| **Scénarios et défis** | 6 villes à redresser ou à bâtir (dette, pollution, crues, embouteillages, ville fantôme, défi « ville symbiotique »), objectifs chiffrés, échéance, règles d'échec, bilan de fin. |
| **Catastrophes et crises** | Inondation, canicule extrême, cyberattaque de l'IA municipale, panne géante, grève des transports, incendie : causes, prévention, deux réponses chiffrées, dégâts réels. Fréquence réglable. |
| **Simulation dans un Web Worker** | Le calcul quitte le fil d'affichage : l'interface reste fluide, même en 128 × 128 à vitesse maximale. |
| **Application installable** | Manifeste, icônes, service worker : jeu en plein écran depuis l'écran d'accueil, utilisable hors connexion (iPhone, Android, ordinateur). |

## Démarrer

```bash
npm install          # versions verrouillées (package-lock.json)
npm run dev          # serveur de développement : http://localhost:5173
npm run build        # build de production dans dist/
npm run build:single # build autonome en un seul fichier HTML dans dist-single/
npm test             # tests unitaires et d'intégration (Vitest)
npm run test:e2e     # parcours utilisateur (Playwright ; `npx playwright install chromium` au préalable)
npm run bench        # mesures de performance de la simulation (64×64 et 128×128)
npm run balance      # équilibrage : épargne brute année par année d'une ville planifiée (≈ 1 min 30)
```

Node 20 ou plus récent. `PW_CHROMIUM=/chemin/vers/chromium npm run test:e2e` utilise un Chromium déjà installé.

## Installer le jeu sur un téléphone

Le build de production (`npm run build`, dossier `dist/`) est une application web installable. Il suffit de
l'héberger en HTTPS (GitHub Pages, Netlify, tout hébergement statique) :

- **Android (Chrome)** : bouton « Installer » sur l'écran d'accueil du jeu, ou menu ⋮ → « Installer l'application ».
- **iPhone et iPad (Safari)** : bouton Partager → « Sur l'écran d'accueil ». L'écran d'accueil du jeu le rappelle.
- **Ordinateur (Chrome, Edge)** : icône d'installation dans la barre d'adresse.

Une fois installé, le jeu s'ouvre en plein écran et fonctionne hors connexion (le service worker garde tous les
fichiers en cache ; une nouvelle version est récupérée dès que la connexion revient).

- **GitHub Pages** : le dépôt contient `.github/workflows/pages.yml`. Une seule fois : Settings → Pages →
  Source « GitHub Actions » ; chaque envoi sur `main` teste, construit et publie le jeu.
- **Netlify** : `netlify.toml` (commande `npm run build`, dossier `dist`) et `public/_headers` (cache).

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
| Clic gauche | Sélectionner ou construire ; glisser pour tracer routes, zones, démolitions, terrassement |
| Entrée | Valider la pose ou le déplacement en attente |
| Maj (pendant un tracé de route) | Tracer d'abord à la verticale |
| R | Pivoter le bâtiment (si compatible) |
| Échap | Annuler le tracé / fermer / revenir à la sélection |
| Suppr | Outil de démolition (menu Démolir et déplacer) |
| Ctrl+Z | Annuler la dernière action (30 jours de jeu, si rien n'a changé depuis) |
| Espace, 1, 2, 3 | Pause, vitesse normale (un mois par minute), rapide (×3), très rapide (×9) |
| B, C, I, T, E | Finances, tableau de bord de la ville, IA et politiques, territoire, mairie (conseil, priorités, élections) |
| K, P, G | Lignes de bus et de tramway, conseiller circulation et pollution, guide du maire |
| Virgule, point-virgule, V | Tourner la carte à gauche, à droite ; vue de dessus |
| L | Couche de données suivante |
| X | Rendre translucides les bâtiments devant le curseur |
| Ctrl+S | Sauvegarde rapide |
| N | Couper ou rétablir le son (le bouton haut-parleur ouvre les réglages du son) |
| M, H | Menu, aide |
| F | Plein écran (ou mode immersif) |
| F3 | Outils de débogage |

Toutes ces fonctions sont aussi accessibles à la souris.

### Sur téléphone et tablette

| Geste | Action |
| --- | --- |
| Pincer | Zoomer / dézoomer |
| Tourner deux doigts | Faire pivoter la carte d'un quart de tour |
| Glisser à deux doigts | Déplacer la carte, quel que soit l'outil (annule un tracé en cours) |
| Glisser à un doigt | Outil Sélection : déplacer la carte ; route ou zone : tracer |
| Toucher un emplacement, puis « Valider » | Poser ou déplacer un bâtiment (l'aperçu montre le coût ; toucher ailleurs le déplace) |
| Bandeau de l'outil actif | Valider, annuler, pivoter le bâtiment, revenir à la sélection |

La mise en page s'adapte au portrait et au paysage (dock d'outils en bas, panneaux plein écran, zones sûres
de l'encoche).

**Plein écran.** Le bouton en haut à droite (touche F) utilise l'API plein écran quand le navigateur l'autorise
(ordinateur, Android, iPad). Safari sur iPhone réserve le plein écran aux vidéos : le bouton bascule alors en
**mode immersif**, qui réduit l'interface du jeu au minimum. Pour un vrai plein écran sur iPhone, il faut héberger
le build (`npm run build`) puis, dans Safari, « Partager → Sur l'écran d'accueil » : les balises
`apple-mobile-web-app-capable` d'`index.html` font alors démarrer le jeu sans barre de navigateur.

## Contenu du jeu

### Météo et saisons

Le temps change par épisodes de quelques jours, selon la saison (climat tempéré : neige l'hiver, orages et
fortes chaleurs l'été). Il est tiré d'un hachage déterministe (graine de la partie, jour) et non du générateur
aléatoire de la partie : la croissance et les incidents gardent la même suite de tirages, et une partie rechargée
retrouve exactement la même météo. L'icône météo de la barre du haut ouvre le détail des effets
(tableau de bord → **Risques et météo**).

| Temps | Effets sur la ville |
| --- | --- |
| Ensoleillé | Production solaire maximale, éoliennes au ralenti |
| Nuageux | Production solaire −30 % |
| Pluie | Routes moins fluides, solaire −50 %, transports en commun +8 %, îlots de chaleur atténués ; une pluie qui dure sature les sols (risque de crue) |
| Orage | Routes perturbées, solaire −70 %, éoliennes +30 % |
| Neige | Capacité des routes −20 %, déneigement (entretien des routes +35 %), chauffage (demande électrique +15 %), collecte des déchets ralentie ; neige au sol |
| Brouillard | Circulation ralentie, solaire −35 % |
| Fortes chaleurs | Climatisation (demande électrique +12 %), eau +15 %, îlots de chaleur renforcés, satisfaction en baisse |

Les épisodes exceptionnels de la ville (tempête, canicule) imposent leur temps. L'automne roussit le feuillage,
l'hiver ternit l'herbe, la neige blanchit le sol.

### Catastrophes et crises

| Crise | Ce qui la provoque | Prévention | Réponses |
| --- | --- | --- | --- |
| Inondation | Pluie des derniers jours, quartiers bâtis au ras de l'eau | Politique « Plan de prévention des inondations » ; parcs et forêts en bord de rivière (la crue ne les traverse pas) | Mobiliser secours et pompes (décrue deux fois plus rapide, dégâts divisés par deux) / attendre |
| Canicule extrême | Fortes chaleurs, îlots de chaleur | « Plan canicule », toitures végétalisées, parcs, réserve électrique | Plan canicule (impact sur la satisfaction divisé par trois) / recommandations |
| Cyberattaque de l'IA municipale | Nombre de technologies ; une rançon déjà payée | « Cybersécurité municipale » | Restaurer les sauvegardes (durée −⅓) / payer la rançon (immédiat, mais attire d'autres attaques) |
| Panne géante | Faible marge de production, chaleur, orages | Surplus de production, batteries, interconnexion régionale | Achat d'urgence à la région / délestages tournants |
| Grève des transports | Fréquentation, satisfaction, trésorerie | « Dialogue social dans les transports » | Négocier (reprise en deux jours) / tenir bon |
| Incendie | Industrie, chaleur, densité, absence de pompiers | Casernes de pompiers : propagation et durée réduites | Renforts départementaux (maîtrisé le lendemain) / pompiers de la ville |

Chaque crise a des effets réels : bâtiments évacués ou à l'arrêt, habitants qui partent, technologies coupées,
centrales déconnectées, bus et métro arrêtés, bâtiments privés détruits par le feu, réparations payées à la fin
(ligne « Crises et catastrophes » du compte de résultat). La carte de crise propose les deux réponses avec leur coût
(grisées si la trésorerie ne suit pas) et met le jeu en pause le temps de décider (réglable). Fréquence :
désactivées, rares, normales, fréquentes (écran d'accueil et paramètres) ; aucune crise aléatoire la première
année. Le tableau de bord affiche le risque mensuel de chaque crise et permet, comme dans les SimCity, de déclencher
une catastrophe volontairement. Tous les tirages sont déterministes (hachage graine × jour).

### Scénarios et défis

Écran d'accueil → **Scénarios et défis**. Chaque ville de départ est construite avec les commandes du jeu (mêmes
règles, mêmes coûts) ; les cibles sont calculées sur la situation réellement obtenue.

| Scénario | Difficulté | Durée | Objectifs |
| --- | --- | --- | --- |
| Valmont-sur-Dette | ★★ | 5 ans | Dette divisée par deux, trésorerie en hausse chaque mois, 150 000 € de réserve, satisfaction ≥ 55, garder ses habitants (échec : trésorerie < −250 000 € pendant 6 mois) |
| Ferrange, ciel gris | ★★ | 6 ans | Pollution moyenne divisée par deux, +25 % d'habitants, satisfaction ≥ 58 |
| Riverbourg sous les eaux | ★★★ | 4 ans | Crues fréquentes : plan de prévention adopté, +40 % d'habitants, satisfaction ≥ 55 |
| Nova-Lys embouteillée | ★★ | 5 ans | Temps de trajet −20 %, voyageurs en transports en commun, +25 % d'habitants |
| Saint-Aubin, ville fantôme | ★★★ | 6 ans | Satisfaction ≥ 55, au plus 2 bâtiments abandonnés, +30 % d'habitants |
| Défi 2045 : ville symbiotique | ★★★★ | 15 ans | Terrain vierge : ère 3, 30 000 habitants, résultat positif |

La carte du scénario (en haut à gauche) suit chaque objectif, l'échéance et les règles d'échec ; un bilan s'affiche
à la fin, et la ville peut continuer en partie libre.

### Son

Tout est synthétisé à la volée (Web Audio API) : aucun fichier son. Effets de construction, route, zonage,
démolition, refus, notifications, sirène et tonnerre ; ambiance qui dépend de ce que montre la caméra (densité,
circulation, espaces verts, zoom), du temps et de l'heure ; musique générative : piano et nappes chaudes pour la
ville connectée, arpèges pulsés pour la ville autonome, cloches et nappes aériennes pour la ville symbiotique,
thème mineur pendant une crise. Le son démarre au premier geste (règle des navigateurs, iPhone compris).

### Effets visuels

Cycle jour/nuit calé sur le calendrier (un cycle par mois de jeu : 70 % de jour, 30 % de nuit) : la scène se teinte au
crépuscule, les fenêtres occupées, les lampadaires (bleutés dès l'ère 2) et les phares s'allument. Les chantiers
(palissade, structure qui monte, échafaudages, grue animée pour les immeubles) correspondent aux délais de
construction simulés des bâtiments de zone ; les équipements posés par le joueur ont un court chantier décoratif. Les cheminées fument quand l'usine tourne. Pluie, neige,
brouillard et éclairs se superposent à la scène. Tout se désactive dans les paramètres (« réduire les animations »
du système est respecté pour les éclairs).

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
| 2. Ville autonome | 10 000 habitants, 2 technologies, satisfaction ≥ 55, 80 % des déchets collectés |
| 3. Ville symbiotique | 30 000 habitants, 5 technologies, satisfaction ≥ 62, 90 % de collecte, 30 % de la population desservie par les transports |

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
panneaux et l'inspecteur, ne disparaissent pas tant que le pointeur est dessus. Elles sont compactes et rangées dans le
coin inférieur droit : trois au plus (deux sur téléphone, au-dessus du dock).

## Architecture

```
src/
├── app/          GameApp (assemblage), GameSession (état + simulation + services, sans rendu),
│                 GameState (données pures), GameLoop, EventBus, InputController, ToolController, scenarios,
│                 challenges (scénarios et défis), SimHost / SimWorkerCore / SimSync / sim.worker (simulation
│                 dans un Web Worker), InstallPrompt (installation de l'application)
├── world/        Grid (tableaux typés), Tile (vue d'une case), Terrain, WorldGenerator, PlacementSystem
├── simulation/   Simulation (orchestrateur), SimulationClock, PopulationSystem, BuildingSystem,
│                 EconomySystem, TrafficSystem, UtilitySystem, EnvironmentSystem, AISystem, WasteSystem,
│                 TransitSystem, ProgressionSystem, WeatherSystem, CrisisSystem, ScenarioSystem, Modifiers, config
├── systems/      ConstructionService, ZoningService, RoadNetwork, Pathfinding, RouteService (itinéraires en cache),
│                 TransportService, EventSystem, ActionHistory, BuildingFactory
├── debug/        Invariants (contrôles de cohérence de l'état)
├── rendering/    Renderer (PixiJS), IsometricProjection, Camera, LayerManager, SelectionRenderer,
│                 VehicleRenderer, EffectsRenderer (jour/nuit, météo, chantiers, fumées, crises), Overlays,
│                 art/ (dessin procédural original)
├── audio/        AudioEngine (effets, ambiance et musique synthétisés)
├── ui/           HUD, Toolbar, InspectorPanel, FinancePanel, TechPanel, CityPanel, OverlayManager,
│                 Notifications, PanelHost, MenuPanels (accueil, sauvegardes, paramètres, aide),
│                 ObjectivesCard (tutoriel et scénario), CrisisPanel, ScenarioDialogs, DebugPanel, BuildingSheet
├── persistence/  SaveService (IndexedDB), SaveMigration, SettingsService (localStorage)
├── data/         Catalog, Validators, Upgrades, defaultData
└── styles/
public/data/      buildings.json, technologies.json, policies.json, upgrades.json
public/           manifest.webmanifest, icons/, _headers
tests/            unit/, integration/, e2e/
scripts/          bench.js (performances), sw-plugin.js (service worker généré au build), make-icons.mjs
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

### Simulation dans un Web Worker

Par défaut, la simulation tourne dans un Web Worker (paramètre « Simulation en arrière-plan », repli automatique
dans le fil principal si le navigateur refuse). Le fil principal garde une **réplique** de l'état, lue par le rendu
et l'interface :

- l'horloge du fil principal demande des jours à la simulation ; au-delà de 24 jours en attente, le retard est
  abandonné (comme avant) ;
- les commandes du joueur s'appliquent tout de suite sur la réplique (coût, refus, annulation immédiats), puis
  sont transmises et appliquées dans le même ordre par la simulation, qui fait foi ;
- un instantané revient au plus toutes les 110 ms pendant que le temps s'écoule (immédiatement après une commande) :
  couches de la grille transférées sans copie, bâtiments en JSON, champs légers, et seulement ce qui a changé pour
  le journal comptable, les immobilisations, les périodes et l'historique ; les commandes pas encore confirmées
  sont rejouées sur la réplique ;
- les événements de la simulation (notifications, fin de mois, crises, météo…) et les cases ou bâtiments modifiés
  sont relayés à l'interface ; un écart entre prédiction et simulation est signalé et redessiné ;
- avant chaque sauvegarde, la réplique est synchronisée (`flush`) : la partie enregistrée est celle de la simulation.

Tests : la réplique est identique à l'état de la simulation après synchronisation, y compris avec des commandes
« en vol » pendant un calcul, et une partie simulée dans le worker est identique au bit près à la même partie
simulée dans le fil principal (`tests/unit/worker.test.js`).

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

IndexedDB, format versionné (`formatVersion` = 6) avec migrations explicites (`SaveMigration.js` : v1 → v2 ;
v2 → v3 ajoute ponts, transports, déchets et progression ; v3 → v4 ajoute améliorations et échanges régionaux, tous
désactivés, pour que l'équilibre d'une ancienne partie ne change pas ; v4 → v5 ajoute météo, crises, scénario et
options de partie, catastrophes désactivées pour une ancienne partie ; v5 → v6 ajoute le statut de la ville et
l'option d'équilibrage, « legacy » pour une ancienne partie).
Somme de contrôle, validation structurelle avant intégration, relecture après écriture. La sauvegarde automatique
alterne entre deux emplacements : un état invalide ou une écriture ratée n'écrase jamais la dernière sauvegarde valide.
Plusieurs sauvegardes, export et import de fichiers. Aucun objet graphique n'est enregistré.
`localStorage` ne contient que des préférences légères.

## Paramètres, accessibilité et débogage

- **Paramètres** : son (général, musique, effets, ambiance, coupure), fréquence des catastrophes et pause pendant
  une crise, effets visuels (jour/nuit, météo, chantiers et fumées), taille de l'interface (90 à 130 %), qualité
  graphique (automatique, haute, moyenne, économie : la résolution du rendu baisse pour les machines modestes),
  compteur d'images, véhicules et drones, quadrillage, défilement par les bords, confirmation des démolitions
  coûteuses, simulation en arrière-plan (Web Worker).
- **Accessibilité** : toutes les fonctions au clavier et à la souris (ou au toucher), libellés ARIA, focus
  visible, alertes annoncées (`role="status"`), aucune information portée par la seule couleur.
- **Outils de débogage** (F3 ou Paramètres) : images par seconde, temps de préparation, temps par sous-système,
  nombre de bâtiments simulés contre dessinés (détecte fuites et doublons d'objets graphiques), succès du cache
  d'itinéraires, mémoire JS, contrôle de cohérence complet (`Invariants.js` : grille, emprises, ponts, capacités,
  trésorerie = journal), avance jour par jour ou mois par mois, export de l'état en JSON.

## Tests

`npm test` : 374 tests Vitest (36 fichiers, dont le chargement de chacun des modules) — grille et sélection (projection, zoom, déplacement), construction et
finances, simulation, mobilité (itinéraires, cache, trajets impossibles), ponts, transports, déchets, progression et
niveaux, train (régression « gare sans voyageurs »), améliorations, échanges régionaux, fiches des bâtiments,
catalogue des 113 bâtiments, dessin de chaque bâtiment, sauvegardes et migrations, boucle de jeu (aucune
accumulation d'objets), invariants sur une ville simulée plusieurs années ; météo (saisons, déterminisme, effets),
crises (déclenchement, réponses, fin, propagation du feu selon les pompiers, désactivation), scénarios (départ,
victoire, échec), migration v4 → v5, simulation dans un Web Worker (réplique identique, déterminisme, événements) ;
v0.4 : démolition des routes seules, dézonage d'une parcelle bâtie et annulation, déplacement d'un équipement (coût,
annulation), terrassement (élever, abaisser, aplanir, planter, défricher), gisements et filières agricole et
d'extraction, note de la dette et emprunt maximal ; v0.8 : lignes de bus (boucle, réseau de base, flotte et dépôts,
coût mensuel), tramway (rails payants, dépôt, autoroute interdite, rue démolie puis rétablie, suppression),
fiscalité par quartier (recettes, satisfaction, implantation), profils d'emprunt et remboursement anticipé, marché
régional (saisons, événements, déterminisme, contrats), sauvegarde des lignes et anciennes parties ; v0.9 :
points noirs, part de pollution due au trafic, conseils classés et actions valides, chapitres du guide et cibles de
« Montre-moi », projection dans les quatre orientations et en vue de dessus (pointage inversible, ordre
d'affichage, faces visibles) ; v1.0 : paliers et déblocages (bâtiments, routes, zones, fonctions), plafond de
niveau, dotation versée une fois et annonce groupée, difficulté et capacité d'emprunt, charges de structure, voirie,
taux d'épargne, migration v5 → v6 (ancien équilibrage, paliers acquis sans dotation) et bascule progressive.
v1.1 : sièges du conseil, candidats déterministes, délégations par statut, effets pondérés par les priorités,
remaniement, indemnités, demandes, démission, délégation des crises, priorités (somme, perception, revirement,
cohérence du thème), liste dissidente, sauvegarde.
v1.2 : catalogue des polémiques, déclenchement après la première année, montée et décrue, réponses (étalement,
annulation, gel des investissements, suspension d'une technologie), affaire, rythme trimestriel, journal ; événements
(statut, lieu, frais, fréquentation, satisfaction locale, vie locale, rendements décroissants, orage et repli
couvert, année électorale et clientélisme, billetterie, sauvegarde).
`npm run test:e2e` : 18 parcours Playwright (adaptés en v0.6 : menus de services séparés, coûts, extinction d'un incendie) — iPad : chaque menu de construction tient à l'écran et défile jusqu'en bas
(paysage, portrait, petite hauteur) ; besoins de la ville, emprunt Max et note, pose validée, déplacement,
terrassement et démolition des routes depuis l'interface (v0.4) ; scénario lancé depuis l'accueil, crise déclenchée depuis le tableau de
bord puis gérée (réponse payante grisée faute de trésorerie), météo, son, Web Worker et sauvegarde synchronisée ; fiches du menu, amélioration depuis l'inspecteur, échanges régionaux,
gare animée et notifications ; fiche dépliable et notification fermée au doigt ; fonder une ville à la souris ; pont, bus, couches, progression, tutoriel
et débogage depuis l'interface ; aucun bouton principal décoratif ; pas de duplication d'objets graphiques ni de fuite
mémoire ; iPhone (gestes, pose validée par bouton, mode immersif) ; v0.8 : ligne de bus tracée à l'outil et validée,
ligne de tramway, panneau des lignes (flotte), écart de taux d'un quartier, emprunt in fine et échéancier, contrat à
prix fixe, couche des quartiers, sauvegarde ; v0.9 : guide depuis l'accueil et en partie (« Montre-moi »),
conseiller (politique adoptée, point noir localisé), navigation (quatre orientations, centre conservé, route posée à
la souris dans une vue tournée, vue de dessus et sélection d'un bâtiment, boussole au téléphone) ; v1.0 :
difficulté et trésorerie de départ, statut affiché, écran « Nouveau statut » et dotation, progression, taux d'épargne,
profils d'emprunt débloqués ; v1.1 : nomination d'un adjoint et priorités du mandat ;
v1.2 : polémique née d'une hausse d'impôt et réponse, journal, fête de quartier organisée depuis l'inspecteur.

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

- Lignes de transport : boucles uniquement (pas de lignes en navette aller-retour ni d'horaires) ; le métro et le train
  restent desservis par rayon et par réseau.
- Le cycle jour/nuit est visuel (un tick = un jour) ; les chantiers des équipements posés par le joueur sont décoratifs.
- Les e2e Playwright ne couvrent pas l'installation hors ligne : elle a été vérifiée sur le build de production
  (`vite preview`, rechargement sans réseau).
- Ponts droits uniquement ; pas de tunnels ni de ponts au-dessus des routes.
- Piétons : non implémentés.
- Graphismes 100 % procéduraux et originaux ; les dossiers `public/assets/*` accueilleront des sprites.
- Les e2e Playwright sont lents sans GPU (rendu logiciel, environ 1,5 image par seconde : une vingtaine de minutes pour les 8 parcours) ; ils coupent le son et les effets décoratifs (`storageState` de `playwright.config.js`) et passent avec les délais configurés.
- Une gare sans voie ferrée posée par le joueur garde un réseau ferré régional implicite.
