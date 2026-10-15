/**
 * Guide du maire (v0.9) : tutoriel détaillé du fonctionnement du jeu, par chapitres.
 * Chaque section peut proposer des actions « Montre-moi » : outil de la barre (tool), panneau (panel, tab),
 * couche de données (overlay). Le contenu est pur (aucune dépendance) pour être testé et affiché hors partie.
 */
export const GUIDE = [
  {
    id: 'basics',
    title: 'Premiers pas',
    intro: 'Vous êtes le maire d\'une ville de 2030. Vous ne construisez pas les maisons vous-même : vous tracez les routes, délimitez des zones et installez les équipements publics. Les habitants et les entreprises s\'installent si la ville leur plaît.',
    sections: [
      {
        title: 'L\'écran de jeu',
        items: [
          'En haut : date et météo, vitesse du temps, trésorerie (et variation mensuelle), habitants, jauges de demande R C B I, popularité du maire, alertes, annuler, son, plein écran.',
          'À gauche (en bas sur téléphone) : la barre de construction par catégories, puis les panneaux de gestion (finances, ville, territoire, mairie, IA, couches, sauvegardes, paramètres, aide).',
          'En haut à gauche : la carte « Objectifs », un parcours de 13 étapes vérifiées automatiquement.',
          'Cliquer un bâtiment ou une case ouvre l\'inspecteur : état, besoins, conditions pour monter de niveau, améliorations.'
        ],
        show: [{ label: 'Ouvrir le tableau de bord', panel: 'city' }]
      },
      {
        title: 'Le temps',
        items: [
          'À vitesse normale, un mois de jeu dure une minute ; ×3 et ×9 accélèrent. Espace met en pause.',
          'Les comptes sont clôturés chaque fin de mois : impôts encaissés, entretien payé, emprunts remboursés.',
          'Un cycle jour/nuit par mois (70 % de jour), des saisons et une météo qui changent la consommation et la circulation.'
        ]
      },
      {
        title: 'Se déplacer sur la carte',
        items: [
          'Souris : clic droit ou molette enfoncée pour déplacer, molette pour zoomer, flèches ou ZQSD au clavier.',
          'Au doigt : un doigt avec l\'outil Sélection, deux doigts avec n\'importe quel outil, pincer pour zoomer.',
          'Sur téléphone et tablette, la vue gyroscopique permet de parcourir la ville en inclinant l\'appareil (bouton boussole en haut, ou Paramètres).',
          'X rend translucides les bâtiments devant le curseur ; L fait défiler les couches de données.'
        ]
      },
      {
        title: 'Construire, valider, annuler',
        items: [
          'Routes, zones, démolition et terrassement se tracent en glissant ; un aperçu affiche le coût et les raisons d\'un refus avant tout débit.',
          'Un bâtiment se pose d\'un clic (au doigt : toucher puis « Valider »). R le fait pivoter s\'il le permet.',
          'Ctrl+Z annule la dernière action et rembourse, tant que rien n\'a changé depuis (30 jours au plus).'
        ]
      }
    ]
  },
  {
    id: 'roads',
    title: 'Routes et accès',
    intro: 'Sans route reliée à l\'autoroute, personne ne s\'installe : c\'est la toute première chose à faire.',
    sections: [
      {
        title: 'Se relier à la région',
        items: [
          'L\'accès autoroutier arrive au bord de la carte. Tracez une rue depuis son extrémité : habitants, navetteurs et marchandises passent par là.',
          'Un réseau isolé (non relié) ne reçoit ni habitants, ni échanges avec la région.'
        ],
        show: [{ label: 'Outil Rue', tool: 'road:road_street' }]
      },
      {
        title: 'Les types de routes',
        items: [
          'Rue : 650 véhicules par jour, la moins chère. Avenue (dès 400 habitants) : 1 800. Grand boulevard (dès 3 000) : 3 200, avec terre-plein planté.',
          'Autoroute de seconde sortie (dès 15 000 habitants) : tracée jusqu\'au bord de la carte, elle ouvre une nouvelle porte vers la région.',
          'Retracer une route existante avec un type plus large la remplace : c\'est ainsi qu\'on élargit un axe saturé.'
        ]
      },
      {
        title: 'Relief, eau et voies ferrées',
        items: [
          'Une route relie deux cases d\'au plus un niveau d\'écart (rampe) ; le terrassement aplanit le terrain.',
          'Une rue tracée en ligne droite d\'une rive à l\'autre devient un pont (16 cases au plus).',
          'La voie ferrée relie une gare au bord de la carte : trains régionaux et capacité +50 %.',
          '« Démolir les routes » retire seulement la chaussée, sans toucher aux bâtiments voisins.'
        ],
        show: [{ label: 'Outil Voie ferrée', tool: 'rail' }]
      }
    ]
  },
  {
    id: 'zones',
    title: 'Zones et croissance',
    intro: 'Les zones disent quoi construire et où ; les bâtiments apparaissent tout seuls selon la demande.',
    sections: [
      {
        title: 'Les zones',
        items: [
          'Résidentiel individuel et collectif (R), commerce (C), bureaux (B), industrie (I), plus l\'agriculture, l\'extraction (sur la roche), l\'industrie forestière (près d\'une forêt) et les grandes surfaces commerciales.',
          'Une case zonée ne se développe qu\'à 3 cases au plus d\'une route, avec électricité et accès à l\'autoroute.',
          'Tracer une zone par-dessus une autre la remplace (sur-zonage) ; « Retirer le zonage » libère les cases. Les bâtiments touchés sont démolis après confirmation.'
        ],
        show: [{ label: 'Outil Zone résidentielle', tool: 'zone:R_LOW' }]
      },
      {
        title: 'La demande (jauges R C B I)',
        items: [
          'Chaque jauge va de −100 à +100. Au-dessus de zéro, des bâtiments de ce secteur apparaissent ; en dessous, ils déclinent.',
          'Logement : emplois vacants, satisfaction, logements vides, taxe d\'habitation, chômage. Commerce : consommation des habitants contre capacité de vente. Bureaux : actifs qualifiés sans emploi. Industrie : actifs peu qualifiés sans emploi, écoulement de la production.',
          'Toucher une jauge ouvre le détail de ses facteurs et les remèdes.'
        ],
        show: [{ label: 'Besoins de la ville', panel: 'demand' }]
      },
      {
        title: 'Construction et niveaux',
        items: [
          'Chaque bâtiment a un chantier : 15 jours pour une maison, un mois pour une usine ; chaque montée de niveau prend 1,25 fois le délai précédent.',
          'Les zones montent jusqu\'au niveau 5. Il faut une valeur foncière (ou une attractivité pour le commerce, les bureaux et l\'industrie), une satisfaction minimale et des besoins couverts : eau, déchets, éducation, santé, transports, ère.',
          'L\'inspecteur d\'un bâtiment liste les conditions du niveau suivant, cochées ou non.',
          'Quand la place zonée le permet, environ un tiers des constructions prennent un grand format (2 × 1 ou 2 × 2).'
        ],
        show: [{ label: 'Couche Valeur foncière', overlay: 'landValue' }, { label: 'Couche Attractivité', overlay: 'siteValue' }]
      }
    ]
  },
  {
    id: 'utilities',
    title: 'Électricité, eau et déchets',
    intro: 'Les réseaux sont invisibles mais vitaux : sans eux, la ville stagne puis se vide.',
    sections: [
      {
        title: 'Électricité',
        items: [
          'Une centrale posée le long d\'une route alimente tout le réseau : routes et bâtiments contigus transportent le courant.',
          'Si la demande dépasse la production, des délestages coupent des quartiers. Batteries et surplus évitent la panne géante.',
          'Les excédents se vendent à la région, les manques s\'achètent cher (Finances → Échanges régionaux).'
        ],
        show: [{ label: 'Menu Énergie', category: 'energy' }, { label: 'Couche Réseaux', overlay: 'networks' }]
      },
      {
        title: 'Eau et assainissement',
        items: [
          'Pompes au bord de l\'eau ou châteaux d\'eau, puis station d\'épuration : les eaux usées non traitées font baisser la satisfaction et favorisent les épidémies.',
          'Les grosses installations (usine d\'eau potable, station métropolitaine) et leurs améliorations de fin de partie doublent la capacité.'
        ]
      },
      {
        title: 'Déchets',
        items: [
          'Un centre de collecte couvre un rayon ; un grand centre de tri autonome dessert une ville entière.',
          'Les déchets sont traités dans l\'ordre le plus vertueux : recyclage, valorisation IA, méthanisation, incinération, décharge.',
          'Les déchets non collectés s\'accumulent : pollution, satisfaction en baisse, niveaux bloqués.'
        ],
        show: [{ label: 'Couche Déchets', overlay: 'garbage' }]
      }
    ]
  },
  {
    id: 'services',
    title: 'Services publics',
    intro: 'Écoles, police, pompiers, santé et administration font la satisfaction, la valeur foncière et la qualification des habitants.',
    sections: [
      {
        title: 'Couverture et capacité',
        items: [
          'Chaque équipement couvre un rayon et sert un nombre d\'habitants donné (école 5 000, lycée 9 000, université 22 000, commissariat 9 000, caserne 12 000, hôpital 25 000…). Au-delà, son efficacité baisse jusqu\'à 35 %.',
          'Choisir un équipement à construire affiche la couche de son service : les logements hors couverture apparaissent en gris foncé.',
          'La couche « Saturation des équipements » montre ceux qui débordent.'
        ],
        show: [{ label: 'Couche Éducation', overlay: 'svc_education' }, { label: 'Couche Saturation', overlay: 'svc_load' }]
      },
      {
        title: 'Effets',
        items: [
          'Éducation : qualification des actifs, donc emplois de bureaux et salaires plus élevés.',
          'Police : sécurité, et elle contient manifestations et émeutes. Pompiers : un incendie se propage moins et dure moins.',
          'Santé : satisfaction, et protection contre les épidémies. Parcs : verdure, fraîcheur, valeur foncière.',
          'Chaque équipement peut recevoir des améliorations depuis son inspecteur (rayon, capacité, efficacité).'
        ]
      }
    ]
  },
  {
    id: 'people',
    title: 'Habitants, emploi et satisfaction',
    intro: 'Les habitants choisissent votre ville… et peuvent la quitter.',
    sections: [
      {
        title: 'Satisfaction',
        items: [
          'Elle part de 54 et varie avec les services (jusqu\'à +29), la verdure, la pollution, le bruit, la chaleur, l\'électricité et l\'eau, la durée des trajets, le chômage, le loyer, la taxe d\'habitation de leur quartier, les déchets, les transports et les politiques.',
          'L\'inspecteur d\'un immeuble détaille chaque facteur en points.'
        ]
      },
      {
        title: 'Emploi',
        items: [
          'Les emplois sont répartis par niveau de qualification (bas, moyen, élevé). Des postes restent vacants si les actifs n\'ont pas la bonne qualification ou habitent trop loin.',
          'Remèdes : écoles et lycées, politique « Formation professionnelle », « Accueil des navetteurs régionaux », « Logement des actifs », transports vers les zones d\'emplois.'
        ],
        show: [{ label: 'Besoins → Emploi', panel: 'demand', tab: 'jobs' }]
      }
    ]
  },
  {
    id: 'mobility',
    title: 'Circulation et transports',
    intro: 'Chaque actif fait deux trajets par jour ; mal anticipés, ils saturent la ville et la polluent.',
    sections: [
      {
        title: 'Le trafic',
        items: [
          'Les déplacements prennent le plus court chemin. Un tronçon qui dépasse sa capacité devient rouge sur la couche « Congestion » : trajets plus longs, satisfaction en baisse.',
          'Les axes chargés polluent et font du bruit autour d\'eux.',
          'Le conseiller « Circulation et pollution » (touche P) analyse la ville et propose les leviers les plus efficaces.'
        ],
        show: [{ label: 'Ouvrir le conseiller', panel: 'traffic' }, { label: 'Couche Congestion', overlay: 'congestion' }]
      },
      {
        title: 'Bus et tramway en lignes',
        items: [
          'Un dépôt de bus et des arrêts suffisent pour un réseau automatique. Pour mieux faire, tracez des lignes : touchez les arrêts dans l\'ordre puis Valider.',
          'Le nombre de véhicules d\'une ligne fixe la fréquence (un passage toutes les 6 minutes = desserte optimale) et la capacité. Panneau des lignes : touche K.',
          'Le tramway (dès 2 500 habitants) roule sur des rails posés sur la chaussée et transporte quatre fois plus qu\'un bus.'
        ],
        show: [{ label: 'Tracer une ligne de bus', tool: 'line:bus' }, { label: 'Panneau des lignes', panel: 'lines' }]
      },
      {
        title: 'Métro, train, hyperboucle',
        items: [
          'Le métro exige au moins deux stations ; il dessert un rayon de 8 cases sans toucher aux routes.',
          'La gare relie la ville à la région (navetteurs, étudiants, visiteurs) ; avec deux gares, le train dessert aussi l\'intérieur. L\'hyperboucle (ère 3) va beaucoup plus loin.',
          'Le prix du billet compte : au-delà de 1,50 €, la fréquentation chute (Finances → Fiscalité et tarifs).'
        ]
      }
    ]
  },
  {
    id: 'finance',
    title: 'Finances',
    intro: 'Une ville en faillite ne peut plus rien construire : surveillez la trésorerie autant que la population.',
    sections: [
      {
        title: 'Recettes et dépenses',
        items: [
          'Recettes : impôt résidentiel (sur les revenus des actifs), fiscalité des commerces, bureaux et industries (sur la valeur ajoutée), taxe foncière, ventes d\'eau et d\'électricité, billetterie, équipements payants.',
          'Dépenses : entretien des équipements et des routes, transports, technologies, politiques, intérêts.',
          'Au-delà de 9 %, chaque point d\'impôt pèse sur la demande et la satisfaction.',
          'Le compte de résultat (avec amortissements) est séparé de la trésorerie (investissements décaissés immédiatement).'
        ],
        show: [{ label: 'Finances', panel: 'finance' }]
      },
      {
        title: 'Quartiers, emprunts, marché',
        items: [
          'Fiscalité par quartier : un quartier moins taxé attire les constructions de son secteur, un quartier plus taxé rapporte davantage.',
          'Emprunts : annuités constantes, amortissement constant ou in fine. La note de la dette (AAA à D) fixe le taux ; l\'échéancier montre les 12 prochains mois.',
          'Le marché régional fait varier chaque mois le prix de l\'électricité, de l\'eau et du traitement des déchets ; un contrat à prix fixe protège des flambées.',
          'Ressources : cultures, élevage, pétrole et gaz se produisent ou s\'importent ; l\'excédent se vend.'
        ],
        show: [{ label: 'Quartiers', panel: 'finance', tab: 'districts' }, { label: 'Emprunts', panel: 'finance', tab: 'loans' }]
      }
    ]
  },
  {
    id: 'politics',
    title: 'Mairie et élections',
    intro: 'Tous les six ans, les habitants votent. Votre popularité se gagne mois après mois.',
    sections: [
      {
        title: 'Popularité',
        items: [
          'Elle découle de la satisfaction, de l\'emploi, des impôts et de leurs hausses, des finances, des services, du cadre de vie, du logement, de la gestion des crises et des promesses tenues.',
          'Elle évolue avec inertie (30 % de l\'écart par mois) ; un sondage mensuel donne la tendance.'
        ],
        show: [{ label: 'Mairie et élections', panel: 'politics' }]
      },
      {
        title: 'Campagne et promesses',
        items: [
          'Six mois avant le scrutin, choisissez jusqu\'à trois engagements chiffrés et un thème de campagne. Un thème qui souligne un point faible coûte des voix.',
          'Après l\'élection, les engagements deviennent des promesses suivies : tenues, elles rapportent de la popularité et de la crédibilité ; rompues, elles en coûtent.',
          'Sous 45 % de popularité, des manifestations éclatent ; ignorées, elles peuvent tourner à l\'émeute.'
        ]
      }
    ]
  },
  {
    id: 'crises',
    title: 'Crises, météo et reconstruction',
    intro: 'Inondations, canicules, incendies, pannes, grèves, cyberattaques, manifestations, épidémies : chacune se prévient et se gère.',
    sections: [
      {
        title: 'Prévenir et répondre',
        items: [
          'Le tableau de bord (C) → Risques affiche le risque mensuel de chaque crise et sa prévention.',
          'Quand une crise éclate, une carte propose deux réponses chiffrées ; le jeu se met en pause le temps de décider.',
          'Incendies, crues et émeutes laissent des ruines : les immeubles privés sont rebâtis en 30 jours, un équipement public attend que vous financiez sa reconstruction.'
        ],
        show: [{ label: 'Risques et météo', panel: 'city', tab: 'risks' }]
      }
    ]
  },
  {
    id: 'future',
    title: 'Technologies, politiques et ères',
    intro: 'La ville de 2030 s\'appuie sur l\'IA… qui a ses coûts et ses effets secondaires.',
    sections: [
      {
        title: 'Technologies et politiques',
        items: [
          'Panneau IA et politiques (I) : chaque technologie a un coût, un besoin en puissance de calcul, des effets chiffrés et parfois des incidents.',
          'Les politiques publiques (télétravail, gratuité des transports, zone à faibles émissions, formation…) ont un coût mensuel et des effets sur la popularité ; les abroger moins d\'un an après est mal vu.'
        ],
        show: [{ label: 'IA et politiques', panel: 'ai' }]
      },
      {
        title: 'Les ères',
        items: [
          'Ère 2 « Ville autonome » : 3 000 habitants, 2 technologies, satisfaction ≥ 55, 80 % des déchets collectés.',
          'Ère 3 « Ville symbiotique » : 8 000 habitants, 5 technologies, satisfaction ≥ 62, 90 % de collecte, 30 % des habitants desservis par les transports.',
          'Chaque ère débloque des bâtiments et des niveaux d\'habitation futuristes.'
        ],
        show: [{ label: 'Progression', panel: 'city', tab: 'progression' }]
      }
    ]
  },
  {
    id: 'territory',
    title: 'Territoire et terrain',
    intro: 'La carte de départ n\'est qu\'une partie du monde : la commune peut s\'agrandir.',
    sections: [
      {
        title: 'Extensions',
        items: [
          'Le monde fait 8 × 8 parcelles de 32 × 32 cases. Achetez les parcelles voisines (touche T) : le prix suit votre épargne et augmente à chaque achat.',
          'Le monde complet est généré dès la fondation : relief, rivières et forêts se raccordent sans couture.'
        ],
        show: [{ label: 'Territoire', panel: 'territory' }]
      },
      {
        title: 'Terrassement',
        items: [
          'Élever, abaisser, aplanir, défricher ou planter une forêt (menu Terrain). Les forêts repoussent seules autour des bois existants.'
        ],
        show: [{ label: 'Planter une forêt', tool: 'terraform:plant' }]
      }
    ]
  },
  {
    id: 'strategy',
    title: 'Conseils de maire',
    intro: 'Quelques réflexes pour une ville qui grandit sans se ruiner.',
    sections: [
      {
        title: 'Un bon départ',
        items: [
          '1. Une rue depuis l\'autoroute, une centrale, puis peu de zones à la fois : beaucoup de résidentiel, un peu de commerce et d\'industrie.',
          '2. L\'eau et l\'épuration avant 1 000 habitants, la collecte des déchets juste après.',
          '3. Une école, un commissariat, une caserne et un centre de santé dès que les jauges ralentissent.',
          '4. Gardez les impôts autour de 9 % tant que la ville est petite ; empruntez pour les gros équipements, pas pour l\'entretien.'
        ]
      },
      {
        title: 'Erreurs fréquentes',
        items: [
          'L\'industrie collée aux logements : pollution, bruit, valeur foncière en berne. Séparez-les par des commerces ou des parcs.',
          'Une seule rue pour tout un quartier : elle sature. Prévoyez une trame en damier et des avenues dès le départ.',
          'Des équipements saturés : surveillez la couche « Saturation des équipements » quand la ville grandit vite.',
          'Une trésorerie négative plusieurs mois de suite : la note de la dette chute et les emprunts deviennent chers.'
        ]
      }
    ]
  }
];
