/**
 * Délais de construction des bâtiments de zone (en jours de jeu).
 * Un bâtiment neuf ne loge ni n'emploie personne avant sa livraison ; une montée de niveau se fait
 * en travaux (le bâtiment reste occupé à son niveau actuel jusqu'à la fin du chantier).
 */
export const BASE_CONSTRUCTION_DAYS = Object.freeze({ R_LOW: 15, R_HIGH: 30, C: 20, O: 30, I: 30 });

/** Chaque niveau supérieur demande 1,25 fois le délai du niveau précédent. */
export const LEVEL_FACTOR = 1.25;

/** Délai pour construire (niveau 1) ou atteindre le niveau `def.level` par travaux. */
export function constructionDaysFor(def) {
  const base = BASE_CONSTRUCTION_DAYS[def.zone] ?? 20;
  return Math.round(base * Math.pow(LEVEL_FACTOR, Math.max(0, (def.level ?? 1) - 1)));
}

/** Le bâtiment est-il encore en chantier (construction neuve ou travaux de montée de niveau) ? */
export function isUnderConstruction(state, b) {
  return b.constructionUntil > state.time.tick;
}

/** Bâtiment neuf pas encore livré : ni habitants, ni emplois, ni consommation. */
export function isNotDelivered(state, b) {
  return b.constructionUntil > state.time.tick && !b.upgradeTo;
}

/** Jour de mise en service (livraison du chantier), pour les délais de grâce après livraison. */
export function deliveredTick(b) {
  return b.deliveredTick ?? b.builtTick;
}
