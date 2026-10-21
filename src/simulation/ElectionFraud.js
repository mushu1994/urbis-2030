import { SIM } from './config.js';
import { hash2 } from '../util/rng.js';

/**
 * v1.6 — bourrage des urnes.
 *
 * Pendant la campagne, le maire peut payer pour faire glisser de faux bulletins dans les urnes. Les bulletins
 * ajoutés comptent aux deux tours (environ +2 points pour « quelques urnes », +4 à +5 pour un bourrage massif) :
 * de quoi gagner une élection serrée, pas de renverser un rejet massif.
 *
 * Le prix à payer vient ensuite :
 * - au dépouillement, des assesseurs peuvent repérer la fraude (5 % ou 12 %) : les faux bulletins sont annulés et
 *   le scandale éclate le soir même ;
 * - pendant le mandat suivant, chaque mois, une enquête peut aboutir (2,5 % ou 5 % par mois, plus quand les
 *   relations avec la presse sont mauvaises). Découverte dans les 18 premiers mois : le tribunal administratif
 *   annule l'élection (élections anticipées dans 6 mois).
 * - Le scandale : popularité en chute (−9 ou −14 points, qui s'estompent sur trois ans), une affaire reprise par
 *   l'adversaire, presse hostile, adjoints qui prennent leurs distances, manifestation et grève, amende.
 *
 * Tous les tirages sont des hachages déterministes (graine de la partie, mois) : rechargement et simulation dans
 * le Web Worker donnent le même résultat.
 */
export const FRAUD_LEVELS = {
  discreet: {
    id: 'discreet',
    label: 'Quelques urnes complaisantes',
    short: 'quelques urnes',
    detail: 'Des bulletins glissés dans une poignée de bureaux de vote.',
    ballots: 0.04,
    base: 20_000,
    perResident: 2,
    countRisk: 0.05,
    monthlyRisk: 0.025,
    penalty: 9,
    fine: 1.5
  },
  massive: {
    id: 'massive',
    label: 'Bourrage massif',
    short: 'bourrage massif',
    detail: 'Des urnes bourrées dans toute la ville : un vrai coup de pouce… et beaucoup de témoins.',
    ballots: 0.1,
    base: 60_000,
    perResident: 5,
    countRisk: 0.12,
    monthlyRisk: 0.05,
    penalty: 14,
    fine: 2
  }
};

/** Mois pendant lesquels le scandale pèse sur la popularité (décroissance linéaire). */
export const FRAUD_SCANDAL_MONTHS = 36;
/** Une découverte dans ce délai après le scrutin entraîne l'annulation de l'élection. */
export const FRAUD_ANNUL_MONTHS = 18;

const monthOf = (state) => Math.floor(state.time.tick / SIM.DAYS_PER_MONTH);

/** Coût (€) du bourrage selon le niveau et la taille de la ville. */
export function fraudCost(state, levelId) {
  const L = FRAUD_LEVELS[levelId];
  if (!L) return 0;
  return Math.round((L.base + L.perResident * (state.stats?.population ?? 0)) / 100) * 100;
}

/** Faux bulletins (en part des suffrages exprimés) prévus pour le scrutin en préparation. */
export function stuffingOf(state) {
  const f = state.politics?.campaign?.fraud;
  return f ? FRAUD_LEVELS[f.level]?.ballots ?? 0 : 0;
}

/** Les assesseurs repèrent-ils la fraude au dépouillement ? */
export function caughtAtCount(state, levelId) {
  const L = FRAUD_LEVELS[levelId];
  if (!L) return false;
  return hash2(state.meta?.seed ?? 2030, state.politics?.nextElection ?? 0, 0xb0b1) < L.countRisk;
}

/** Probabilité mensuelle de découverte pendant le mandat (presse hostile : +30 %). */
export function monthlyDiscoveryRisk(state, pending) {
  const L = FRAUD_LEVELS[pending?.level];
  if (!L) return 0;
  const press = state.controversies?.press ?? 50;
  return L.monthlyRisk * (press < 35 ? 1.3 : 1);
}

/** Tirage du mois : l'enquête aboutit-elle ? */
export function discoveredThisMonth(state, pending) {
  return hash2(state.meta?.seed ?? 2030, monthOf(state), 0xf4a0d) < monthlyDiscoveryRisk(state, pending);
}

/** Facteur de popularité « Scandale des urnes » (négatif, s'estompe sur trois ans). */
export function fraudScandalFactor(state) {
  const sc = state.politics?.memory?.fraud;
  if (!sc) return null;
  const age = monthOf(state) - sc.month;
  if (age < 0 || age >= FRAUD_SCANDAL_MONTHS) return null;
  const value = -(FRAUD_LEVELS[sc.level]?.penalty ?? 9) * (1 - age / FRAUD_SCANDAL_MONTHS);
  return { id: 'fraud', label: 'Scandale des urnes', value, detail: `fraude électorale révélée ${age ? `il y a ${age} mois` : 'ce mois-ci'}` };
}

/** Avantage de l'adversaire en campagne : la fraude révélée pendant les six dernières années est son meilleur argument. */
export function fraudEdge(state) {
  const sc = state.politics?.memory?.fraud;
  if (!sc) return 0;
  return monthOf(state) - sc.month < 72 ? 2 : 0;
}
