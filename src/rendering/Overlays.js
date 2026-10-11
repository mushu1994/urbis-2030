import { RAMPS, ramp, mix } from './art/color.js';
import { congestionColor } from './art/GroundArt.js';

/**
 * Couches cartographiques. Chaque couche lit un champ réel de la simulation et le convertit en couleur.
 * `color(state, i)` retourne une couleur entière, ou -1 pour ne rien dessiner sur la case.
 */
export const OVERLAYS = [
  {
    id: 'population',
    label: 'Densité de population',
    legend: { ramp: RAMPS.purple, min: '0', max: '40+ hab./case' },
    color: (s, i) => (s.grid.density[i] > 0 ? ramp(s.grid.density[i] / 40, RAMPS.purple) : -1)
  },
  {
    id: 'landValue',
    label: 'Valeur foncière',
    legend: { ramp: RAMPS.good, min: 'faible', max: 'élevée' },
    color: (s, i) => (s.grid.terrain[i] === 1 ? -1 : ramp(s.grid.landValue[i] / 90, RAMPS.good))
  },
  {
    id: 'accessibility',
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
    label: 'Congestion',
    legend: { ramp: [0x58b368, 0xc8d14f, 0xf0a33a, 0xe0553a, 0x9c1d2a], min: 'fluide', max: 'saturé' },
    roads: true,
    color: (s, i) => (s.grid.road[i] ? (s.grid.traffic[i] > 0.5 ? congestionColor(s.grid.congestion[i]) : 0x7d8a96) : -1)
  },
  {
    id: 'jobs',
    label: 'Emploi',
    legend: { ramp: RAMPS.mono, min: '0', max: '60+ emplois/case' },
    color: (s, i) => (s.grid.jobDensity[i] > 0 ? ramp(s.grid.jobDensity[i] / 60, RAMPS.mono) : -1)
  },
  {
    id: 'pollution',
    label: 'Pollution atmosphérique',
    legend: { ramp: RAMPS.heat, min: 'air sain', max: 'très pollué' },
    color: (s, i) => (s.grid.pollution[i] > 0.5 ? ramp(s.grid.pollution[i] / 30, RAMPS.heat) : -1)
  },
  {
    id: 'noise',
    label: 'Pollution sonore',
    legend: { ramp: RAMPS.heat, min: 'calme', max: 'bruyant' },
    color: (s, i) => (s.grid.noise[i] > 0.5 ? ramp(s.grid.noise[i] / 30, RAMPS.heat) : -1)
  },
  {
    id: 'heat',
    label: 'Îlots de chaleur',
    legend: { ramp: RAMPS.heat, min: 'frais', max: 'îlot de chaleur' },
    color: (s, i) => (s.grid.terrain[i] === 1 ? -1 : ramp(s.grid.heat[i] / 40, RAMPS.heat))
  },
  {
    id: 'networks',
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
    label: 'Services publics',
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

export const OVERLAY_BY_ID = new Map(OVERLAYS.map((o) => [o.id, o]));
