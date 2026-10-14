import { RAMPS, ramp, mix } from './art/color.js';
import { congestionColor } from './art/GroundArt.js';

/**
 * Couches cartographiques. Chaque couche lit un champ réel de la simulation et le convertit en couleur.
 * `color(state, i, catalog)` retourne une couleur entière, ou -1 pour ne rien dessiner sur la case.
 */
export const OVERLAYS = [
  {
    id: 'population',
    group: 'Ville',
    label: 'Densité de population',
    legend: { ramp: RAMPS.purple, min: '0', max: '40+ hab./case' },
    color: (s, i) => (s.grid.density[i] > 0 ? ramp(s.grid.density[i] / 40, RAMPS.purple) : -1)
  },
  {
    id: 'landValue',
    group: 'Ville',
    label: 'Valeur foncière',
    legend: { ramp: RAMPS.good, min: 'faible', max: 'élevée' },
    color: (s, i) => (s.grid.terrain[i] === 1 ? -1 : ramp(s.grid.landValue[i] / 90, RAMPS.good))
  },
  {
    id: 'siteValue',
    group: 'Ville',
    label: 'Attractivité des zones',
    legend: { ramp: RAMPS.good, min: 'faible', max: 'élevée', note: 'Valeur foncière pour le logement, attractivité commerciale, tertiaire ou industrielle ailleurs' },
    color: (s, i) => (s.grid.zone[i] ? ramp((s.grid.siteValue?.[i] ?? 0) / 90, RAMPS.good) : -1)
  },
  {
    id: 'accessibility',
    group: 'Mobilité',
    label: 'Accessibilité',
    legend: { ramp: RAMPS.good, min: '30 min+', max: 'immédiate', note: 'Temps d\'accès depuis l\'autoroute' },
    color: (s, i) => {
      const g = s.grid;
      const r = g.road[i] ? i : g.nearestRoad[i];
      if (r < 0) return -1;
      const m = g.accessibility[r];
      if (m >= 900) return 0x9c1d2a;
      return ramp(1 - Math.min(1, m / 30), RAMPS.good);
    }
  },
  {
    id: 'congestion',
    group: 'Mobilité',
    label: 'Congestion',
    legend: { ramp: [0x58b368, 0xc8d14f, 0xf0a33a, 0xe0553a, 0x9c1d2a], min: 'fluide', max: 'saturé' },
    roads: true,
    color: (s, i) => (s.grid.road[i] ? (s.grid.traffic[i] > 0.5 ? congestionColor(s.grid.congestion[i]) : 0x7d8a96) : -1)
  },
  {
    id: 'jobs',
    group: 'Ville',
    label: 'Emploi',
    legend: { ramp: RAMPS.mono, min: '0', max: '60+ emplois/case' },
    color: (s, i) => (s.grid.jobDensity[i] > 0 ? ramp(s.grid.jobDensity[i] / 60, RAMPS.mono) : -1)
  },
  {
    id: 'pollution',
    group: 'Environnement',
    label: 'Pollution atmosphérique',
    legend: { ramp: RAMPS.heat, min: 'air sain', max: 'très pollué' },
    color: (s, i) => (s.grid.pollution[i] > 0.5 ? ramp(s.grid.pollution[i] / 30, RAMPS.heat) : -1)
  },
  {
    id: 'noise',
    group: 'Environnement',
    label: 'Pollution sonore',
    legend: { ramp: RAMPS.heat, min: 'calme', max: 'bruyant' },
    color: (s, i) => (s.grid.noise[i] > 0.5 ? ramp(s.grid.noise[i] / 30, RAMPS.heat) : -1)
  },
  {
    id: 'heat',
    group: 'Environnement',
    label: 'Îlots de chaleur',
    legend: { ramp: RAMPS.heat, min: 'frais', max: 'îlot de chaleur' },
    color: (s, i) => (s.grid.terrain[i] === 1 ? -1 : ramp(s.grid.heat[i] / 40, RAMPS.heat))
  },
  {
    id: 'networks',
    group: 'Réseaux',
    label: 'Réseaux (énergie, eau)',
    legend: { swatches: [[0x3fae5a, 'Alimenté et raccordé'], [0xe0553a, 'Sans électricité'], [0x3f8fc7, 'Sans eau'], [0xf2d24b, 'Réseau électrique']] },
    color: (s, i) => {
      const g = s.grid;
      const id = g.building[i];
      if (id) {
        const b = s.buildings.get(id);
        if (!b) return -1;
        if (!b.powered) return 0xe0553a;
        if (!b.watered) return 0x3f8fc7;
        return 0x3fae5a;
      }
      if (g.road[i]) return g.powered[i] ? 0xf2d24b : 0x8a8a8a;
      return -1;
    }
  },
  {
    id: 'garbage',
    group: 'Environnement',
    label: 'Déchets',
    legend: { ramp: RAMPS.heat, min: 'collectés', max: 'en souffrance', note: 'Vert pâle : zone couverte par la collecte' },
    color: (s, i) => {
      const g = s.grid;
      if (g.building[i] && s.buildings.get(g.building[i])) {
        const b = s.buildings.get(g.building[i]);
        if (b.garbage !== undefined && (b.residents || b.jobsFilled)) return ramp(b.garbage, RAMPS.heat);
      }
      if (g.wasteCover[i] > 0.05 && g.terrain[i] !== 1) return ramp(0.15 + g.wasteCover[i] * 0.5, RAMPS.green);
      return -1;
    }
  },
  {
    id: 'transit',
    group: 'Mobilité',
    label: 'Transports en commun',
    legend: { swatches: [[0xe2b13c, 'Bus'], [0x2f6fc0, 'Métro'], [0x9b59b6, 'Train et hyperboucle']], note: 'Intensité : qualité de la desserte' },
    color: (s, i) => {
      const g = s.grid;
      const b = g.transitBus[i];
      const m = g.transitMetro[i];
      const r = g.transitRail[i];
      const best = Math.max(b, m, r);
      if (best < 0.05 || g.terrain[i] === 1) return -1;
      const base = m === best ? 0x2f6fc0 : r === best ? 0x9b59b6 : 0xe2b13c;
      return mix(0xf4f4f4, base, 0.35 + best * 0.65);
    }
  },
  {
    id: 'services',
    group: 'Services publics',
    label: 'Services publics (moyenne)',
    legend: { ramp: RAMPS.good, min: 'non couvert', max: 'bien couvert', note: 'Moyenne police, secours, santé, éducation' },
    color: (s, i) => {
      const g = s.grid;
      if (g.terrain[i] === 1) return -1;
      const v = (g.coverPolice[i] + g.coverFire[i] + g.coverHealth[i] + g.coverEducation[i]) / 4;
      return ramp(v, RAMPS.good);
    }
  },
  {
    id: 'autonomous',
    group: 'Mobilité',
    label: 'Systèmes autonomes',
    legend: { ramp: RAMPS.green, min: 'hors desserte', max: 'desserte automatisée', note: 'Contour orange : zones de desserte drones' },
    color: (s, i) => {
      const g = s.grid;
      if (g.delivery[i] > 0) return ramp(0.25 + g.delivery[i] * 0.75, RAMPS.green);
      if (g.deliveryZone[i]) return 0xf0b429;
      return -1;
    }
  }
];

/**
 * Couches par service public (v0.7) : chaque service a sa teinte. Le dégradé montre la couverture ; les équipements
 * du service sont dessinés en couleur pleine (rouge s'ils sont saturés) et les logements hors couverture en gris foncé.
 */
const SERVICE_STYLES = [
  { id: 'education', layer: 'coverEducation', label: 'Éducation', ramp: [0xf2f6fc, 0xb5cdee, 0x5f93d6, 0x2a5fae], solid: 0x1d3f7a },
  { id: 'police', layer: 'coverPolice', label: 'Sécurité (police)', ramp: [0xf6f3fb, 0xcdbfe6, 0x8f72c9, 0x55339b], solid: 0x3a1f72 },
  { id: 'fire', layer: 'coverFire', label: 'Secours (pompiers)', ramp: [0xfdf5ec, 0xf8cf9e, 0xf09a46, 0xc8621a], solid: 0x8a3a0a },
  { id: 'health', layer: 'coverHealth', label: 'Santé', ramp: [0xf2fbf8, 0xb4e4d4, 0x4fb895, 0x1b7c5d], solid: 0x0d4f3a },
  { id: 'admin', layer: 'coverAdmin', label: 'Administration', ramp: [0xfcf9ec, 0xf0e2a6, 0xd9b84c, 0xa88420], solid: 0x6b5208 }
];
const SATURATED = 0xd7191c;
const UNSERVED = 0x4a4a4a;

/** Type de service public d'un bâtiment (police, fire, health, education, admin) ou null. */
function serviceType(catalog, b) {
  return catalog?.building(b.defId)?.capacity?.service?.type ?? null;
}

function serviceOverlay(st) {
  return {
    id: `svc_${st.id}`,
    group: 'Services publics',
    label: st.label,
    service: st.id,
    legend: {
      ramp: st.ramp,
      min: 'non couvert',
      max: 'bien couvert',
      swatches: [[st.solid, `Équipement (${st.label.toLowerCase()})`], [SATURATED, 'Équipement saturé'], [UNSERVED, 'Logements hors couverture']]
    },
    color: (s, i, catalog) => {
      const g = s.grid;
      if (g.terrain[i] === 1) return -1;
      const v = g[st.layer][i];
      const id = g.building[i];
      if (id) {
        const b = s.buildings.get(id);
        if (b) {
          if (serviceType(catalog, b) === st.id) return (b.serviceLoad ?? 0) > 1.05 ? SATURATED : st.solid;
          if (b.residents > 0 && v < 0.15) return UNSERVED;
        }
      }
      return v < 0.03 ? -1 : ramp(Math.min(1, v), st.ramp);
    }
  };
}

const LOAD_RAMP = [0x1a9641, 0xa6d96a, 0xffffbf, 0xfdae61, 0xd7191c];

export const SERVICE_OVERLAYS = [
  ...SERVICE_STYLES.map(serviceOverlay),
  {
    id: 'svc_load',
    group: 'Services publics',
    label: 'Saturation des équipements',
    legend: { ramp: LOAD_RAMP, min: 'marge', max: 'débordé (×2)', note: 'Habitants à desservir rapportés à la capacité de chaque école, hôpital, commissariat…' },
    color: (s, i, catalog) => {
      const id = s.grid.building[i];
      if (!id) return -1;
      const b = s.buildings.get(id);
      if (!b || b.serviceLoad === undefined || !serviceType(catalog, b)) return -1;
      return ramp(Math.min(1, b.serviceLoad / 2), LOAD_RAMP);
    }
  }
];

OVERLAYS.push(...SERVICE_OVERLAYS);

export const OVERLAY_BY_ID = new Map(OVERLAYS.map((o) => [o.id, o]));
