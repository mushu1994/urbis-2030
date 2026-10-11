/**
 * Paramètres d'équilibrage de la simulation. Centralisés ici pour être ajustés sans toucher aux systèmes.
 * Les montants sont en euros (convertis en centimes par les systèmes).
 */
export const SIM = Object.freeze({
  /** Un tick de simulation = un jour de jeu. */
  DAYS_PER_MONTH: 30,
  MONTHS_PER_YEAR: 12,
  START_YEAR: 2030,

  /** Fréquences des sous-systèmes (en ticks). */
  FREQ: {
    utilities: 5,
    population: 3,
    growth: 2,
    demand: 5,
    environment: 10,
    services: 10,
    landValue: 10,
    logistics: 10,
    waste: 10,
    transit: 10,
    trafficOriginsPerTick: 24,
    /** Nombre de nœuds explorés visé par tick pour l'affectation du trafic. */
    trafficNodeBudget: 60000
  },

  START_TREASURY_EUROS: 400000,
  START_TAXES: { R: 9, C: 9, O: 9, I: 9, property: 1.2 },
  START_TARIFFS: { water: 1.2, power: 0.9, transit: 1.2 },

  /**
   * Échanges avec la région (prix en euros par unité et par mois pour l'électricité et l'eau,
   * par unité de déchets pour le traitement extérieur). L'achat est volontairement prohibitif :
   * il dépanne, il ne remplace pas une production locale.
   */
  TRADE: {
    power: { sell: 0.3, buy: 3.2 },
    water: { sell: 0.35, buy: 3.8 },
    waste: { buy: 1.6 },
    /** Part maximale des besoins qu'une interconnexion régionale peut couvrir. */
    importMaxShare: 0.6,
    /** Volume minimal importable, même pour une très petite ville. */
    importMin: 150
  },

  /** Revenus mensuels imposables par actif employé selon la catégorie de revenu (base fiscale). */
  TAXABLE_INCOME: { low: 120, mid: 190, high: 320 },
  /** Valeur ajoutée mensuelle par emploi occupé (base de la fiscalité des entreprises). */
  VALUE_ADDED_PER_JOB: { commerce: 160, offices: 260, industry: 200 },
  /** Valeur cadastrale d'une case bâtie par point de valeur foncière (taxe foncière annuelle). */
  ASSESSED_VALUE_PER_POINT: 900,
  /** Consommation mensuelle par habitant selon le revenu (alimente la demande commerciale). */
  CONSUMPTION: { low: 0.8, mid: 1.0, high: 1.4 },
  /** Ventes mensuelles absorbées par emploi commercial (unités de consommation). */
  SALES_PER_JOB_UNIT: 7,

  AGE_PROFILE: { young: 0.24, adult: 0.6, senior: 0.16 },
  PARTICIPATION: 0.86,
  QUALIFICATION: { low: 0.3, mid: 0.55, high: 0.8 },
  RENT_BASE: { low: 25, mid: 45, high: 80 },

  /** Part des déplacements effectués en voiture (avant politiques et technologies). */
  CAR_MODE_SHARE: 0.62,
  /** Déplacements quotidiens par actif occupé (aller + retour) et par habitant (achats, loisirs). */
  TRIPS_PER_WORKER: 2,
  TRIPS_PER_RESIDENT: 0.6,
  /** Unités-véhicules par livraison de fret (camionnette/porteur). */
  FREIGHT_PCU: 2.2,
  /** Longueur d'une case en km (pour les temps de trajet). */
  TILE_KM: 0.12,

  PARCELS_PER_RESIDENT: 0.06,
  PARCELS_PER_SALES_JOB: 0.5,
  /** Colis par tournée de véhicule de livraison. */
  PARCELS_PER_VAN_TRIP: 18,

  /** Seuils de déclin (en jours). */
  ABANDON_NO_ROAD_DAYS: 45,
  ABANDON_NO_POWER_DAYS: 75,
  ABANDON_UNHAPPY_DAYS: 120,
  COLLAPSE_ABANDONED_DAYS: 300,
  UPGRADE_STABLE_DAYS: 40,

  /** Endettement maximal = N mois de recettes (avec un plancher). */
  MAX_DEBT_MONTHS_OF_REVENUE: 24,
  MIN_DEBT_CAPACITY_EUROS: 250000,

  /** Ressources de calcul disponibles sans centre de données (cloud mutualisé). */
  BASE_COMPUTE: 30,

  LEDGER_MAX: 4000,
  PERIODS_MAX: 120
});

export const MONTH_NAMES = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** @param {number} tick */
export function dateOfTick(tick) {
  const day = (tick % SIM.DAYS_PER_MONTH) + 1;
  const monthIndex = Math.floor(tick / SIM.DAYS_PER_MONTH);
  const month = monthIndex % SIM.MONTHS_PER_YEAR;
  const year = SIM.START_YEAR + Math.floor(monthIndex / SIM.MONTHS_PER_YEAR);
  return { day, month, year, monthIndex };
}

export function formatDate(tick) {
  const d = dateOfTick(tick);
  return `${d.day} ${MONTH_NAMES[d.month]} ${d.year}`;
}
