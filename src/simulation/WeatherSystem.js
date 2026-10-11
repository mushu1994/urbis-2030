import { SIM } from './config.js';
import { hash2 } from '../util/rng.js';

/**
 * Météo et saisons.
 *
 * Le temps qu'il fait est tiré d'un hachage déterministe (graine de la partie, jour) et non du générateur
 * aléatoire de la partie : la suite des autres tirages (croissance, incidents) reste inchangée, et une partie
 * rechargée retrouve exactement la même météo.
 *
 * Un « épisode » dure quelques jours. Chaque type de temps a des effets chiffrés sur la simulation
 * (modificateurs) : consommation électrique (chauffage, climatisation), production solaire et éolienne,
 * capacité des routes, coût du déneigement, îlots de chaleur, fréquentation des transports en commun.
 */

export const WEATHER = Object.freeze({
  clear: { label: 'Ensoleillé', icon: '☀' },
  cloudy: { label: 'Nuageux', icon: '☁' },
  rain: { label: 'Pluie', icon: '🌧' },
  storm: { label: 'Orage', icon: '⛈' },
  snow: { label: 'Neige', icon: '❄' },
  fog: { label: 'Brouillard', icon: '🌫' },
  heat: { label: 'Fortes chaleurs', icon: '🔥' }
});

export const SEASONS = ['Hiver', 'Hiver', 'Printemps', 'Printemps', 'Printemps', 'Été', 'Été', 'Été', 'Automne', 'Automne', 'Automne', 'Hiver'];

/** Température moyenne (°C) par mois, climat tempéré. */
const BASE_TEMP = [4, 6, 10, 13, 17, 21, 24, 23, 19, 14, 8, 5];

/** Probabilités des épisodes par mois (somme = 1). */
const CLIMATE = {
  winter: [['clear', 0.27], ['cloudy', 0.3], ['rain', 0.15], ['snow', 0.22], ['fog', 0.06]],
  spring: [['clear', 0.4], ['cloudy', 0.25], ['rain', 0.29], ['storm', 0.04], ['fog', 0.02]],
  summer: [['clear', 0.56], ['cloudy', 0.14], ['rain', 0.1], ['storm', 0.09], ['heat', 0.11]],
  autumn: [['clear', 0.3], ['cloudy', 0.3], ['rain', 0.3], ['fog', 0.07], ['storm', 0.03]]
};

export function seasonKey(month) {
  if (month === 11 || month <= 1) return 'winter';
  if (month <= 4) return 'spring';
  if (month <= 7) return 'summer';
  return 'autumn';
}

/** Météo neutre d'une nouvelle partie (1er janvier). */
export function defaultWeather() {
  return { kind: 'cloudy', intensity: 0.4, temp: 5, since: 0, until: 0, rain7: 0, snowCover: 0, forced: null };
}

/**
 * Effets d'un type de temps (convention des modificateurs : « mul » multiplie par 1 + v).
 * @param {{kind:string, intensity:number, temp:number}} w
 */
export function weatherEffects(w) {
  if (!w) return [];
  const k = Math.max(0.2, Math.min(1, w.intensity ?? 0.5));
  const fx = [];
  const add = (key, op, value) => fx.push({ key, op, value });
  switch (w.kind) {
    case 'clear':
      add('solarFactor', 'mul', 0.08);
      add('windFactor', 'mul', -0.15);
      break;
    case 'cloudy':
      add('solarFactor', 'mul', -0.3);
      break;
    case 'rain':
      add('solarFactor', 'mul', -0.5);
      add('roadCapacityMult', 'mul', -0.06 * k);
      add('travelTimeMult', 'mul', 0.05 * k);
      add('transit.ridershipMult', 'mul', 0.08);
      add('heatMult', 'mul', -0.2);
      break;
    case 'storm':
      add('solarFactor', 'mul', -0.7);
      add('windFactor', 'mul', 0.3);
      add('roadCapacityMult', 'mul', -0.1 * k);
      add('travelTimeMult', 'mul', 0.08 * k);
      add('transit.ridershipMult', 'mul', 0.05);
      break;
    case 'snow':
      add('solarFactor', 'mul', -0.6);
      add('roadCapacityMult', 'mul', -0.2 * k);
      add('travelTimeMult', 'mul', 0.15 * k);
      add('upkeep.roads', 'mul', 0.35 * k);
      add('powerDemandMult', 'mul', 0.15);
      add('waste.collectMult', 'mul', -0.1);
      add('satisfaction.all', 'add', -1);
      break;
    case 'fog':
      add('solarFactor', 'mul', -0.35);
      add('roadCapacityMult', 'mul', -0.05);
      add('travelTimeMult', 'mul', 0.08);
      break;
    case 'heat':
      add('powerDemandMult', 'mul', 0.12);
      add('waterDemandMult', 'mul', 0.15);
      add('heatMult', 'mul', 0.25);
      add('satisfaction.all', 'add', -1.5);
      break;
    default:
      break;
  }
  // Froid sec : chauffage
  if (w.kind !== 'snow' && (w.temp ?? 10) < 3) add('powerDemandMult', 'mul', 0.08);
  return fx;
}

/** Libellés lisibles des effets du temps présent (tableau de bord). */
export function weatherEffectLabels(w) {
  const L = {
    clear: ['Production solaire maximale', 'Éoliennes au ralenti'],
    cloudy: ['Production solaire −30 %'],
    rain: ['Routes moins fluides', 'Production solaire −50 %', 'Bus et métro +8 % de voyageurs', 'Îlots de chaleur atténués'],
    storm: ['Routes perturbées', 'Production solaire −70 %', 'Éoliennes +30 %'],
    snow: ['Routes ralenties (−20 % de capacité)', 'Déneigement : entretien des routes +35 %', 'Chauffage : demande électrique +15 %', 'Collecte des déchets ralentie'],
    fog: ['Circulation ralentie', 'Production solaire −35 %'],
    heat: ['Climatisation : demande électrique +12 %', 'Consommation d\'eau +15 %', 'Îlots de chaleur renforcés', 'Satisfaction en baisse']
  }[w?.kind] ?? [];
  if (w && w.kind !== 'snow' && w.temp < 3) return [...L, 'Froid : chauffage, demande électrique +8 %'];
  return L;
}

export class WeatherSystem {
  /** @param {{bus?: any}} deps */
  constructor({ bus } = {}) {
    this.bus = bus;
  }

  /** Tirage déterministe dans [0, 1) pour le jour `day` et le canal `salt`. */
  static roll(state, day, salt) {
    return hash2(day, salt, (state.meta?.seed ?? 2030) ^ 0x5eed);
  }

  /** Mise à jour quotidienne (après l'avancée du temps). */
  daily(state) {
    state.weather ??= defaultWeather();
    const w = state.weather;
    const t = state.time.tick;
    const month = Math.floor(t / SIM.DAYS_PER_MONTH) % 12;
    const before = w.kind;

    // Les épisodes exceptionnels (tempête, canicule déclarées par les événements de la ville) priment.
    const ev = state.events?.active ?? [];
    const forced = ev.some((e) => e.id === 'heatwave' || e.kind === 'heatwave') ? 'heat' : ev.some((e) => e.id === 'storm') ? 'storm' : null;
    if (forced) {
      if (w.kind !== forced) {
        w.kind = forced;
        w.intensity = 0.9;
        w.since = t;
      }
      w.forced = forced;
      w.until = Math.max(w.until, t + 1);
    } else if (w.forced || t >= w.until) {
      w.forced = null;
      const r = WeatherSystem.roll(state, t, 1);
      let acc = 0;
      let kind = 'clear';
      for (const [k, p] of CLIMATE[seasonKey(month)]) {
        acc += p;
        if (r < acc) {
          kind = k;
          break;
        }
      }
      // Pas de neige quand il fait doux, pas de fortes chaleurs hors été
      if (kind === 'snow' && BASE_TEMP[month] > 8) kind = 'rain';
      w.kind = kind;
      w.intensity = 0.35 + 0.65 * WeatherSystem.roll(state, t, 2);
      w.since = t;
      const len = { storm: [1, 2], heat: [3, 6], snow: [2, 5], fog: [1, 3] }[kind] ?? [2, 6];
      w.until = t + len[0] + Math.floor(WeatherSystem.roll(state, t, 3) * (len[1] - len[0] + 1));
    }

    // Température du jour
    const offset = { heat: 9, snow: -6, rain: -2, storm: 1, fog: -1, cloudy: -1, clear: month >= 4 && month <= 8 ? 2 : -1 }[w.kind] ?? 0;
    const noise = (WeatherSystem.roll(state, t, 4) - 0.5) * 4;
    w.temp = Math.round((BASE_TEMP[month] + offset * (w.kind === 'heat' || w.kind === 'snow' ? 1 : 0.7) + noise) * 10) / 10;

    // Cumul de pluie récent (risque de crue) et manteau neigeux (rendu)
    const rainfall = { rain: 1, storm: 1.6, snow: 0.3 }[w.kind] ?? 0;
    w.rain7 = Math.round((w.rain7 * 0.82 + rainfall * w.intensity) * 1000) / 1000;
    if (w.kind === 'snow') w.snowCover = Math.min(1, w.snowCover + 0.25 * w.intensity);
    else w.snowCover = Math.max(0, w.snowCover - (w.temp > 2 ? 0.2 : 0.05));
    w.snowCover = Math.round(w.snowCover * 1000) / 1000;

    if (w.kind !== before) {
      state.dirty.modifiers = true;
      this.bus?.emit('weather:changed', { weather: { ...w }, previous: before });
      if (!forced && t > 0) {
        if (w.kind === 'snow') this.bus?.emit('notify', { level: 'info', message: 'Neige : routes ralenties, déneigement en cours (entretien des routes en hausse)', key: 'weather-snow' });
        else if (w.kind === 'fog') this.bus?.emit('notify', { level: 'info', message: 'Brouillard : circulation ralentie', key: 'weather-fog' });
        else if (w.kind === 'storm') this.bus?.emit('notify', { level: 'info', message: 'Orages : production solaire en berne', key: 'weather-storm' });
        else if (w.kind === 'heat') this.bus?.emit('notify', { level: 'warning', message: 'Fortes chaleurs : la climatisation fait grimper la demande électrique', key: 'weather-heat' });
      }
    }
  }
}
