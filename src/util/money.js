/**
 * Montants monétaires : stockés en centimes entiers (pas d'erreur d'arrondi cumulative).
 * Les catalogues expriment les montants en euros ; la conversion est faite une seule fois au chargement.
 */

/** @param {number} euros */
export function toCents(euros) {
  return Math.round(euros * 100);
}

/** Multiplie un montant en centimes par un facteur et arrondit à l'entier. */
export function scaleCents(cents, factor) {
  return Math.round(cents * factor);
}

const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const fmtCompact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });

/** @param {number} cents */
export function formatMoney(cents, { compact = false, sign = false } = {}) {
  const euros = cents / 100;
  const rounded = Math.round(euros) || 0; // évite l'affichage « -0 »
  const s = compact && Math.abs(euros) >= 100000 ? fmtCompact.format(euros) : fmt.format(rounded);
  const prefix = sign && cents > 0 ? '+' : '';
  return `${prefix}${s} €`;
}

export function formatNumber(n, digits = 0) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}
