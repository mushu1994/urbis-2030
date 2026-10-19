import { SIM } from './config.js';

/**
 * Conseiller « Circulation et pollution » (v0.9) : lit l'état réel de la ville et propose, par ordre d'impact, les
 * leviers pour désengorger les axes et réduire la pollution due aux voitures. Fonction pure, sans effet sur la partie.
 *
 * Indicateurs : congestion moyenne et part des axes saturés, déplacements en voiture, part des transports en commun,
 * durée moyenne des trajets, pollution moyenne et part estimée due au trafic, habitants desservis.
 * Points noirs : groupes d'axes saturés (au-delà de 90 % de leur capacité), avec le type de route et l'élargissement
 * possible.
 */

/** Seuil de saturation d'un axe (rapport flux / capacité). */
export const SATURATED = 0.9;
/** Capacité (véhicules par jour) et élargissement conseillé par type de route. */
const WIDEN = { road_street: 'road_avenue', road_avenue: 'road_boulevard' };

/** Masse d'un « nuage » de diffusion (même profil que EnvironmentSystem.splat), pour comparer les sources. */
const massCache = new Map();
function splatMass(r) {
  let m = massCache.get(r);
  if (m === undefined) {
    m = 0;
    const R = Math.ceil(r);
    for (let y = -R; y <= R; y++) {
      for (let x = -R; x <= R; x++) {
        const d = Math.hypot(x, y);
        if (d <= r) m += 1 - d / (r + 1);
      }
    }
    massCache.set(r, m);
  }
  return m;
}

/**
 * Part de la pollution émise par la circulation (estimation à partir des mêmes formules que la simulation).
 * @returns {{traffic:number, buildings:number, share:number}}
 */
export function pollutionSources(state, catalog) {
  const g = state.grid;
  const mods = state.modifiers ?? {};
  const pT = mods['pollution.traffic'] ?? 1;
  let traffic = 0;
  for (let i = 0; i < g.size; i++) {
    if (!g.road[i]) continue;
    const flow = g.traffic[i];
    if (flow >= 20) traffic += Math.min(14, flow * 0.006) * pT;
  }
  traffic *= splatMass(2);
  let buildings = 0;
  for (const b of state.buildings.values()) {
    const def = catalog.buildingFor(b);
    const env = def.environment;
    if (!env?.pollution) continue;
    let activity = 1;
    if (b.abandoned) activity = 0.15;
    else if (def.capacity.jobs && def.category === 'industry') activity = 0.3 + 0.7 * ((b.jobsFilled ?? 0) / def.capacity.jobs);
    else if (def.capacity.powerOutput) activity = b.output ? Math.min(1, b.output / def.capacity.powerOutput) : 0.2;
    const pMult = def.kind === 'growable' ? mods['pollution.buildings'] ?? 1 : 1;
    buildings += env.pollution * activity * pMult * splatMass(env.radius + Math.max(b.w, b.h) / 2);
  }
  const total = traffic + buildings;
  return { traffic, buildings, share: total > 0 ? traffic / total : 0 };
}

/**
 * Points noirs : groupes d'axes saturés contigus, triés par flux total.
 * @returns {{x:number, y:number, tiles:number, peak:number, flow:number, roadId:string, roadName:string, widenTo:string|null}[]}
 */
export function congestionHotspots(state, catalog, limit = 6) {
  const g = state.grid;
  const seen = new Uint8Array(g.size);
  const out = [];
  const nb = new Int32Array(4);
  for (let s = 0; s < g.size; s++) {
    if (seen[s] || !g.road[s] || g.congestion[s] < SATURATED || g.traffic[s] < 20) continue;
    const stack = [s];
    seen[s] = 1;
    let tiles = 0;
    let flow = 0;
    let peak = 0;
    let best = s;
    const types = new Map();
    while (stack.length) {
      const i = stack.pop();
      tiles++;
      flow += g.traffic[i];
      if (g.congestion[i] > peak) {
        peak = g.congestion[i];
        best = i;
      }
      types.set(g.road[i], (types.get(g.road[i]) ?? 0) + 1);
      const n = g.neighbors4(i, nb);
      for (let k = 0; k < n; k++) {
        const j = nb[k];
        if (!seen[j] && g.road[j] && g.congestion[j] >= SATURATED && g.traffic[j] >= 20) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    const code = [...types.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const road = catalog.roadByCode(code);
    out.push({ x: g.xOf(best), y: g.yOf(best), tiles, peak: Math.round(peak * 100) / 100, flow: Math.round(flow), roadId: road.id, roadName: road.name, widenTo: WIDEN[road.id] ?? null });
  }
  out.sort((a, b) => b.flow - a.flow);
  return out.slice(0, limit);
}

const pct = (v) => `${Math.round(v * 100)} %`;

/**
 * Diagnostic complet et conseils triés par impact.
 * Chaque conseil : { id, impact: 'fort'|'moyen'|'faible', score, title, why, how, actions: [{label, kind, ...}] }.
 * Types d'action : tool (outil de la barre), policy (adopter une politique), research (technologie), panel, overlay, focus.
 */
export function trafficDiagnosis(state, catalog) {
  const s = state.stats;
  const ts = state.traffic?.stats ?? {};
  const tr = state.transit?.stats ?? {};
  const mods = state.modifiers ?? {};
  const pop = s.population ?? 0;
  const peak = Math.max(pop, s.peakPopulation ?? 0);
  const trips = ts.vehicleTrips ?? 0;
  const pax = state.transit?.passengersPerDay ?? 0;
  const transitShare = trips + pax > 0 ? pax / (trips + pax) : 0;
  const congestion = ts.avgCongestion ?? 0;
  const congestedShare = ts.roadTiles ? (ts.congestedTiles ?? 0) / ts.roadTiles : 0;
  const commute = ts.avgCommute ?? 0;
  const covered = tr.coveredShare ?? 0;
  const pol = pollutionSources(state, catalog);
  const hotspots = congestionHotspots(state, catalog);
  const level = congestion < 0.35 && congestedShare < 0.03 ? 'fluide' : congestion < 0.6 && congestedShare < 0.1 ? 'chargée' : 'saturée';

  const indicators = {
    level,
    congestion,
    congestedShare,
    congestedTiles: ts.congestedTiles ?? 0,
    vehicleTrips: trips,
    transitPassengers: pax,
    transitShare,
    commute,
    covered,
    avgPollution: s.avgPollution ?? 0,
    trafficPollutionShare: pol.share,
    unreachable: ts.unreachableTrips ?? 0
  };

  const advice = [];
  const add = (a) => advice.push(a);
  const active = state.policies?.active ?? {};
  const researched = state.tech?.researched ?? {};
  const policy = (id) => catalog.policyById.get(id);
  const tech = (id) => catalog.techById.get(id);

  // 1. Axes saturés : élargir, doubler, mailler
  if (hotspots.length) {
    const widenable = hotspots.filter((h) => h.widenTo);
    const score = 40 + congestedShare * 300 + hotspots.length * 3;
    add({
      id: 'widen',
      score,
      impact: congestedShare > 0.05 ? 'fort' : 'moyen',
      title: `Désengorger ${hotspots.length} point${hotspots.length > 1 ? 's' : ''} noir${hotspots.length > 1 ? 's' : ''}`,
      why: `${indicators.congestedTiles} cases de route dépassent 90 % de leur capacité. Une rue écoule 650 véhicules par jour, une avenue 1 800, un grand boulevard 3 200.`,
      how: widenable.length
        ? 'Retracez les rues saturées en avenue (et les avenues en boulevard) : la nouvelle chaussée remplace l\'ancienne. Créez aussi un itinéraire parallèle ou une rocade pour répartir le flux, et évitez les culs-de-sac qui concentrent tout le trafic sur une seule rue.'
        : 'Ces axes sont déjà larges : ouvrez un itinéraire parallèle, une rocade, ou reportez les trajets vers les transports en commun.',
      actions: [
        ...hotspots.slice(0, 3).map((h, k) => ({ label: `Voir le point noir n°${k + 1}`, kind: 'focus', x: h.x, y: h.y })),
        ...(widenable.some((h) => h.widenTo === 'road_avenue') ? [{ label: 'Outil Avenue', kind: 'tool', tool: 'road:road_avenue' }] : []),
        ...(widenable.some((h) => h.widenTo === 'road_boulevard') ? [{ label: 'Outil Grand boulevard', kind: 'tool', tool: 'road:road_boulevard' }] : []),
        { label: 'Couche Congestion', kind: 'overlay', overlay: 'congestion' }
      ]
    });
  }

  // 2. Desserte en transports en commun
  if (pop > 300 && covered < 0.6) {
    const missing = Math.round((1 - covered) * pop);
    add({
      id: 'transit_cover',
      score: 30 + (1 - covered) * 45 + congestion * 20,
      impact: covered < 0.3 ? 'fort' : 'moyen',
      title: 'Desservir les quartiers en transports en commun',
      why: `Seuls ${pct(covered)} des habitants vivent près d'un arrêt (${missing.toLocaleString('fr-FR')} habitants sans desserte). Chaque voyageur en bus, tramway ou métro est une voiture de moins aux heures de pointe.`,
      how: (tr.depots ?? 0) === 0
        ? 'Construisez un dépôt de bus relié aux quartiers par la route, puis des arrêts tous les 8 à 10 cases dans les quartiers denses et près des zones d\'emplois.'
        : 'Ajoutez des arrêts dans les quartiers non couverts (couche « Transports en commun ») et reliez-les par des lignes fréquentes : la desserte dépend de la fréquence des passages.',
      actions: [
        { label: 'Couche Transports en commun', kind: 'overlay', overlay: 'transit' },
        { label: (tr.depots ?? 0) === 0 ? 'Construire un dépôt de bus' : 'Poser un arrêt de bus', kind: 'tool', tool: (tr.depots ?? 0) === 0 ? 'building:bus_depot' : 'building:bus_stop' },
        { label: 'Tracer une ligne de bus', kind: 'tool', tool: 'line:bus' }
      ]
    });
  }

  // 3. Lignes ou réseaux saturés
  const satLines = (state.lines?.list ?? []).filter((l) => (l.stats?.saturation ?? 0) > 0.9);
  const satModes = Object.entries(tr.saturation ?? {}).filter(([, v]) => v > 1);
  if (satLines.length || satModes.length) {
    add({
      id: 'transit_capacity',
      score: 35 + satLines.length * 4 + satModes.length * 6,
      impact: 'fort',
      title: 'Augmenter la capacité des transports en commun',
      why: satLines.length
        ? `${satLines.length} ligne${satLines.length > 1 ? 's sont saturées' : ' est saturée'} (${satLines.map((l) => l.name).slice(0, 3).join(', ')}) : des voyageurs restent à quai et reprennent la voiture.`
        : `Réseau saturé : ${satModes.map(([m]) => ({ bus: 'bus', metro: 'métro', rail: 'train', tram: 'tramway' }[m])).join(', ')}.`,
      how: 'Ajoutez des véhicules aux lignes chargées (panneau des lignes), un dépôt si la flotte est limitée, ou une ligne parallèle. Un tramway transporte quatre fois plus qu\'un bus.',
      actions: [{ label: 'Gérer les lignes', kind: 'panel', panel: 'lines' }, { label: 'Construire un dépôt de bus', kind: 'tool', tool: 'building:bus_depot' }]
    });
  }

  // 4. Modes lourds : tramway, métro
  if (peak >= 2500 && congestion > 0.4 && !(state.lines?.list ?? []).some((l) => l.mode === 'tram')) {
    add({
      id: 'tram',
      score: 28 + congestion * 25,
      impact: 'moyen',
      title: 'Créer une ligne de tramway sur l\'axe le plus chargé',
      why: 'Un tramway transporte 650 voyageurs par jour et par rame, ne prend pas de voiture sur la chaussée, coûte moins cher à exploiter par voyageur et fait monter la valeur foncière autour des stations.',
      how: 'Posez des stations de tramway le long d\'une avenue ou d\'un boulevard qui relie les logements aux emplois, un dépôt de tramway sur le même réseau, puis tracez la ligne.',
      actions: [{ label: 'Poser une station de tramway', kind: 'tool', tool: 'building:tram_stop' }, { label: 'Tracer une ligne de tramway', kind: 'tool', tool: 'line:tram' }]
    });
  }
  if (peak >= 2000 && congestion > 0.5 && (tr.metroStations ?? 0) < 2) {
    add({
      id: 'metro',
      score: 26 + congestion * 25,
      impact: 'moyen',
      title: 'Construire un métro entre les grands pôles',
      why: 'Le métro passe sous la ville : il ne touche pas aux routes, dessert un rayon de 8 cases et absorbe jusqu\'à 6 000 voyageurs par jour et par station.',
      how: 'Placez au moins deux stations : une dans le quartier le plus dense, une près des bureaux ou du centre commercial.',
      actions: [{ label: 'Poser une station de métro', kind: 'tool', tool: 'building:metro_station' }, { label: 'Couche Densité', kind: 'overlay', overlay: 'population' }]
    });
  }

  // 5. Rapprocher logements et emplois
  if (commute > 16 && pop > 500) {
    add({
      id: 'mix',
      score: 18 + (commute - 16) * 2,
      impact: commute > 24 ? 'fort' : 'moyen',
      title: 'Rapprocher les emplois des logements',
      why: `Les trajets durent ${Math.round(commute)} minutes en moyenne : les habitants traversent la ville pour travailler et chargent les mêmes axes.`,
      how: 'Zonez des commerces et des bureaux au cœur des quartiers résidentiels plutôt qu\'en périphérie, et des logements près des zones d\'activité. L\'industrie, elle, se place près de l\'autoroute pour que les camions ne traversent pas la ville.',
      actions: [{ label: 'Couche Emploi', kind: 'overlay', overlay: 'jobs' }, { label: 'Zoner du commerce', kind: 'tool', tool: 'zone:C' }, { label: 'Zoner des bureaux', kind: 'tool', tool: 'zone:O' }]
    });
  }

  // 6. Politiques publiques
  const policyAdvice = [
    ['remote_work', 'Télétravail encouragé', '12 % de déplacements en moins', congestion > 0.3],
    ['free_transit', 'Gratuité des transports en commun', '+30 % de voyageurs (sans recettes de billetterie)', covered > 0.3],
    ['low_emission_zone', 'Zone à faibles émissions', '−25 % de pollution due au trafic', pol.share > 0.35 && (s.avgPollution ?? 0) > 3],
    ['night_delivery', 'Livraisons de nuit', '−35 % de camions aux heures de pointe', congestion > 0.45]
  ];
  for (const [id, label, effect, relevant] of policyAdvice) {
    const p = policy(id);
    if (!p || active[id] !== undefined || !relevant) continue;
    add({
      id: `policy_${id}`,
      score: 14 + congestion * 12 + (id === 'low_emission_zone' ? pol.share * 20 : 0),
      impact: 'moyen',
      title: `Politique : ${label}`,
      why: `${effect}. ${p.description ?? ''}`.trim(),
      how: 'S\'adopte en un clic ; son coût mensuel et ses effets sur la popularité figurent dans le panneau IA et politiques (I).',
      actions: [{ label: 'Adopter', kind: 'policy', policy: id }]
    });
  }

  // 7. Technologies
  const techAdvice = [
    ['ai_traffic_lights', '+15 % de capacité sur toutes les routes', congestion > 0.35],
    ['ai_mobility_optimization', 'trajets 8 % plus rapides', congestion > 0.35],
    ['maas', '−5 points de part de la voiture, +15 % de voyageurs', covered > 0.3],
    ['autonomous_shuttles', 'capacité des bus +60 %', (tr.saturation?.bus ?? 0) > 0.8]
  ];
  for (const [id, effect, relevant] of techAdvice) {
    const t = tech(id);
    if (!t || researched[id] !== undefined || !relevant) continue;
    add({
      id: `tech_${id}`,
      score: 12 + congestion * 15,
      impact: 'moyen',
      title: `Technologie : ${t.name}`,
      why: `${effect}. ${t.description ?? ''}`.trim(),
      how: 'Se déploie depuis le panneau IA et politiques (I) ; elle demande de la puissance de calcul et a un coût d\'exploitation.',
      actions: [{ label: 'Déployer', kind: 'research', tech: id }]
    });
  }
  if (researched.autonomous_vehicles !== undefined && congestion > 0.5) {
    add({
      id: 'av_warning',
      score: 10,
      impact: 'faible',
      title: 'Attention aux véhicules autonomes',
      why: 'Ils augmentent la capacité des routes de 20 %, mais génèrent 18 % de déplacements en plus et des trajets à vide : sans transports en commun, la congestion revient.',
      how: 'Associez-les à la mobilité intégrée (MaaS) et à des lignes fréquentes.',
      actions: [{ label: 'IA et politiques', kind: 'panel', panel: 'ai' }]
    });
  }

  // 8. Pollution : écrans végétaux
  if ((s.avgPollution ?? 0) > 4 && pol.share > 0.3) {
    add({
      id: 'green',
      score: 12 + pol.share * 20 + (s.avgPollution ?? 0),
      impact: 'moyen',
      title: 'Protéger les habitants de la pollution des axes',
      why: `La circulation produit environ ${pct(pol.share)} de la pollution de la ville. Les logements collés aux axes chargés perdent en satisfaction et en valeur foncière.`,
      how: 'Plantez des forêts et des parcs le long des grands axes, éloignez les logements des boulevards les plus chargés (commerces et bureaux en bordure) et réduisez le nombre de voitures (transports, télétravail, zone à faibles émissions).',
      actions: [{ label: 'Couche Pollution', kind: 'overlay', overlay: 'pollution' }, { label: 'Planter une forêt', kind: 'tool', tool: 'terraform:plant' }]
    });
  }

  // 9. Sorties d'autoroute (v1.4 : une par côté de la carte)
  const exits = state.entries?.length ?? 0;
  if (peak >= 15000 && exits < 4 && congestion > 0.4) {
    add({
      id: 'exit',
      score: (exits < 2 ? 20 : 12) + congestion * 15,
      impact: 'moyen',
      title: exits < 2 ? 'Ouvrir une seconde sortie d\'autoroute' : 'Ouvrir une sortie d\'autoroute sur un autre côté',
      why: exits < 2
        ? 'Tous les navetteurs, les camions et les habitants qui sortent de la ville passent par le même accès.'
        : `La ville n'a que ${exits} accès vers la région : les quartiers éloignés font un long détour.`,
      how: 'Territoire → Sorties d\'autoroute : choisissez un côté, le tracé le moins cher est proposé. Vous pouvez aussi tracer l\'autoroute de sortie jusqu\'au bord de la carte.',
      actions: [{ label: 'Sorties d\'autoroute', kind: 'panel', panel: 'territory' }, { label: 'Outil Autoroute', kind: 'tool', tool: 'road:road_motorway' }]
    });
  }

  // 10. Prix du billet
  const fare = tr.fare ?? state.economy?.tariffs?.transit ?? 0;
  if (fare > 1.6 && covered > 0.2) {
    add({
      id: 'fare',
      score: 10 + (fare - 1.6) * 10,
      impact: 'faible',
      title: 'Baisser le prix du billet',
      why: `Le billet coûte ${fare.toFixed(2).replace('.', ',')} € : au-delà de 1,50 €, la fréquentation chute nettement.`,
      how: 'Finances → Fiscalité et tarifs : un billet autour de 1 € remplit les bus et vide les routes.',
      actions: [{ label: 'Fiscalité et tarifs', kind: 'panel', panel: 'finance', tab: 'taxes' }]
    });
  }

  // 11. Trajets impossibles
  if ((ts.unreachableTrips ?? 0) > 50) {
    add({
      id: 'unreachable',
      score: 25,
      impact: 'moyen',
      title: 'Relier les quartiers isolés',
      why: `${(ts.unreachableTrips ?? 0).toLocaleString('fr-FR')} déplacements par jour ne trouvent pas d'emploi accessible par la route.`,
      how: 'Raccordez chaque quartier au reste du réseau routier (couche Accessibilité).',
      actions: [{ label: 'Couche Accessibilité', kind: 'overlay', overlay: 'accessibility' }]
    });
  }

  advice.sort((a, b) => b.score - a.score);
  return { indicators, hotspots, advice, pollution: pol, carModeShare: SIM.CAR_MODE_SHARE + (mods.carModeShare ?? 0) };
}
