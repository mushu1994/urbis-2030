import { SIM } from './config.js';
import { hash2 } from '../util/rng.js';

/**
 * Marché régional de l'électricité, de l'eau et du traitement des déchets (v0.8).
 *
 * Les prix d'échange avec la région ne sont plus fixes. Chaque mois, pour chaque bien :
 *  - cours de référence (SIM.TRADE) × indice régional (marche aléatoire bornée, rappelée vers 1) ;
 *  - × saisonnalité : électricité chère en hiver (chauffage, éclairage) et un peu en plein été (climatisation),
 *    bon marché au printemps (hydraulique et solaire abondants) ; eau chère en été (étiage) ;
 *  - × événement régional éventuel : vague de froid, sécheresse, surproduction printanière.
 * La profondeur du marché limite ce que la ville peut vendre à bon prix : au-delà, chaque unité supplémentaire
 * rapporte moins (rendement décroissant) ; à l'achat, un gros volume renchérit le prix moyen.
 * Un contrat à prix fixe (12 mois) protège des variations : la ville paie une prime à l'achat ou accepte une décote
 * à la vente, et le panneau suit le gain ou la perte du contrat par rapport au prix du marché.
 * Tout est déterministe (hachage du mois et de la graine de la partie).
 */

export const MARKET_GOODS = {
  power: {
    label: 'Électricité',
    sides: ['sell', 'buy'],
    depth: 6000,
    season: [1.3, 1.25, 1.05, 0.88, 0.82, 0.92, 1.12, 1.15, 0.95, 0.95, 1.08, 1.25]
  },
  water: {
    label: 'Eau potable',
    sides: ['sell', 'buy'],
    depth: 5000,
    season: [0.9, 0.9, 0.92, 0.96, 1.04, 1.18, 1.35, 1.35, 1.15, 1.0, 0.92, 0.9]
  },
  waste: {
    label: 'Traitement des déchets',
    sides: ['buy'],
    depth: 6000,
    season: [1, 1, 1, 1, 1, 1.05, 1.08, 1.08, 1, 1, 1, 1]
  }
};
export const MARKET_KEYS = Object.keys(MARKET_GOODS);

/** Événements régionaux : bien concerné, mois possibles, probabilité mensuelle, multiplicateur, durée. */
export const MARKET_EVENTS = {
  coldwave: { good: 'power', months: [11, 0, 1], p: 0.14, mult: 1.7, duration: 2, label: 'Vague de froid', message: '🥶 Vague de froid sur la région : le prix de l\'électricité s\'envole pour deux mois.' },
  drought: { good: 'water', months: [5, 6, 7], p: 0.12, mult: 1.8, duration: 3, label: 'Sécheresse régionale', message: '🏜 Sécheresse régionale : l\'eau devient rare et chère pour trois mois.' },
  glut: { good: 'power', months: [3, 4], p: 0.12, mult: 0.6, duration: 2, label: 'Surproduction renouvelable', message: '🌬 Surproduction d\'électricité renouvelable au printemps : le prix chute pour deux mois.' }
};

/** Durée d'un contrat à prix fixe (mois) et prime (achat) ou décote (vente) demandée par la région. */
export const CONTRACT_MONTHS = 12;
export const CONTRACT_PREMIUM = 0.05;

export function defaultMarket() {
  return { index: { power: 1, water: 1, waste: 1 }, event: null, history: [], contracts: {}, prices: null, last: null };
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/** Prix au comptant d'un bien pour un mois donné (euros par unité). */
export function spotPrice(market, good, side, month) {
  const g = MARKET_GOODS[good];
  const ref = SIM.TRADE[good][side];
  if (!g || ref === undefined) return 0;
  const ev = market?.event && MARKET_EVENTS[market.event.kind]?.good === good ? MARKET_EVENTS[market.event.kind].mult : 1;
  return r3(ref * (market?.index?.[good] ?? 1) * g.season[((month % 12) + 12) % 12] * ev);
}

/** Prix applicable maintenant : celui du contrat s'il y en a un, sinon le prix du marché. */
export function marketPrice(state, good, side) {
  const m = state.market;
  const c = m?.contracts?.[`${good}:${side}`];
  const month = Math.floor(state.time.tick / SIM.DAYS_PER_MONTH);
  if (c && month < c.until) return c.price;
  return m?.prices?.[good]?.[side] ?? spotPrice(m, good, side, month);
}

/**
 * Montant d'un volume mensuel échangé, avec la profondeur du marché : la vente rapporte de moins en moins au-delà
 * de la profondeur, l'achat coûte de plus en plus cher. Renvoie des euros.
 */
export function tradeValue(good, side, units, price) {
  if (!(units > 0)) return 0;
  const depth = MARKET_GOODS[good]?.depth ?? 5000;
  if (side === 'sell') return price * depth * Math.log1p(units / depth);
  return price * units * (1 + units / (4 * depth));
}

/** Prix d'un contrat proposé maintenant : la moitié de l'écart au cours de référence persiste, saison neutralisée. */
export function contractOffer(state, good, side) {
  const ref = SIM.TRADE[good]?.[side];
  if (ref === undefined) return null;
  const idx = state.market?.index?.[good] ?? 1;
  const forward = ref * (0.5 + 0.5 * idx);
  return r3(side === 'buy' ? forward * (1 + CONTRACT_PREMIUM) : forward * (1 - CONTRACT_PREMIUM));
}

/**
 * Indemnité de résiliation anticipée d'un contrat (centimes) : 20 % de la valeur de trois mois d'échanges au prix du
 * contrat (volume du dernier mois), au moins 1 000 €.
 */
export function contractPenaltyCents(state, good, side) {
  const c = state.market?.contracts?.[`${good}:${side}`];
  if (!c) return 0;
  const units = state.market?.last?.detail?.[good]?.[side]?.units ?? 0;
  return Math.max(100000, Math.round(c.price * units * 3 * 0.2 * 100));
}

export class MarketSystem {
  /** @param {{bus?:any, economy?:any}} deps */
  constructor({ bus, economy } = {}) {
    this.bus = bus;
    this.economy = economy;
  }

  /** Garantit l'état du marché (anciennes parties) et les prix du mois en cours. */
  ensure(state) {
    state.market ??= defaultMarket();
    const M = state.market;
    M.index ??= { power: 1, water: 1, waste: 1 };
    M.contracts ??= {};
    M.history ??= [];
    const month = Math.floor(state.time.tick / SIM.DAYS_PER_MONTH);
    if (!M.prices || M.prices.month !== month) M.prices = this.#prices(M, month);
    return M;
  }

  #prices(M, month) {
    const out = { month };
    for (const k of MARKET_KEYS) {
      out[k] = {};
      for (const side of MARKET_GOODS[k].sides) out[k][side] = spotPrice(M, k, side, month);
    }
    return out;
  }

  /**
   * Bilan des échanges du mois clos (appelé par la clôture des comptes avec les volumes moyens) :
   * montants au prix applicable, et gain ou perte des contrats par rapport au marché.
   * @param {{power:{sell:number,buy:number}, water:{sell:number,buy:number}, waste:{buy:number}}} volumes
   * @returns {Record<string, Record<string, number>>} euros par bien et par sens
   */
  settle(state, volumes) {
    // Prix de la période close : ceux publiés en début de mois (la clôture a lieu au premier jour du mois suivant)
    state.market ??= defaultMarket();
    const M = state.market;
    M.contracts ??= {};
    if (!M.prices) M.prices = this.#prices(M, Math.floor(state.time.tick / SIM.DAYS_PER_MONTH));
    const month = M.prices.month;
    const out = {};
    const detail = {};
    for (const k of MARKET_KEYS) {
      out[k] = {};
      detail[k] = {};
      for (const side of MARKET_GOODS[k].sides) {
        const units = volumes?.[k]?.[side] ?? 0;
        const spot = M.prices?.[k]?.[side] ?? spotPrice(M, k, side, month);
        const c = M.contracts[`${k}:${side}`];
        const contract = c && month < c.until ? c : null;
        const price = contract ? contract.price : spot;
        const value = tradeValue(k, side, units, price);
        out[k][side] = value;
        detail[k][side] = { units: Math.round(units), price, spot, value: Math.round(value * 100) };
        if (contract && units > 0) {
          const atSpot = tradeValue(k, side, units, spot);
          // Gain du contrat : on vend plus cher, ou on achète moins cher, que le marché
          const gain = side === 'sell' ? value - atSpot : atSpot - value;
          contract.gainCents = (contract.gainCents ?? 0) + Math.round(gain * 100);
          contract.units = (contract.units ?? 0) + Math.round(units);
        }
      }
    }
    M.last = { month, detail };
    return out;
  }

  /** Évolution mensuelle des cours (après la clôture) : marche aléatoire, saison, événements, contrats échus. */
  monthly(state) {
    const M = this.ensure(state);
    const m = Math.floor(state.time.tick / SIM.DAYS_PER_MONTH); // mois qui commence
    const seed = state.meta?.seed ?? 2030;
    for (const [j, k] of MARKET_KEYS.entries()) {
      const step = (hash2(m, j + 11, seed ^ 0x3a7) - 0.5) * 0.14;
      const v = M.index[k] ?? 1;
      M.index[k] = r3(Math.max(0.7, Math.min(1.4, v + step + (1 - v) * 0.1)));
    }
    // Événement régional en cours ou nouveau
    if (M.event && m >= M.event.until) {
      const ev = MARKET_EVENTS[M.event.kind];
      this.#notify(state, 'info', `${ev?.label ?? 'Événement'} terminé : le prix de ${ev?.good === 'water' ? 'l\'eau' : 'l\'électricité'} revient à la normale.`);
      M.event = null;
    }
    if (!M.event && m > 6) {
      for (const [kind, ev] of Object.entries(MARKET_EVENTS)) {
        if (!ev.months.includes(m % 12)) continue;
        if (hash2(m, kind.length * 31, seed ^ 0x3a8) < ev.p) {
          M.event = { kind, since: m, until: m + ev.duration };
          this.#notify(state, ev.mult > 1 ? 'warning' : 'info', ev.message);
          break;
        }
      }
    }
    // Contrats arrivés à échéance
    for (const [key, c] of Object.entries(M.contracts)) {
      if (m >= c.until) {
        const [good, side] = key.split(':');
        const g = (c.gainCents ?? 0) / 100;
        this.#notify(state, 'info', `Contrat à prix fixe échu (${MARKET_GOODS[good].label.toLowerCase()}, ${side === 'buy' ? 'achat' : 'vente'}) : ${g >= 0 ? 'gain' : 'perte'} de ${Math.abs(Math.round(g)).toLocaleString('fr-FR')} € par rapport au marché.`);
        delete M.contracts[key];
      }
    }
    M.prices = this.#prices(M, m);
    M.history.push({ month: m, power: { ...M.prices.power }, water: { ...M.prices.water }, waste: { ...M.prices.waste }, event: M.event?.kind ?? null });
    if (M.history.length > 36) M.history.shift();
  }

  /** Signe (ou résilie) un contrat à prix fixe de 12 mois. */
  setContract(state, good, side, on) {
    const M = this.ensure(state);
    if (!MARKET_GOODS[good]?.sides.includes(side)) return { ok: false, reason: 'Contrat inconnu' };
    const key = `${good}:${side}`;
    const month = Math.floor(state.time.tick / SIM.DAYS_PER_MONTH);
    if (!on) {
      const c = M.contracts[key];
      if (!c) return { ok: false, reason: 'Aucun contrat en cours' };
      const penalty = contractPenaltyCents(state, good, side);
      if (penalty > 0) this.economy?.payOpex(state, { amount: penalty, category: 'marketFees', label: `Résiliation anticipée d'un contrat (${MARKET_GOODS[good].label.toLowerCase()})` });
      delete M.contracts[key];
      return { ok: true, penalty };
    }
    if (M.contracts[key]) return { ok: false, reason: 'Un contrat est déjà en cours' };
    const price = contractOffer(state, good, side);
    M.contracts[key] = { price, since: month, until: month + CONTRACT_MONTHS, gainCents: 0, units: 0 };
    return { ok: true, price };
  }

  #notify(state, level, message) {
    const entry = { tick: state.time.tick, level, message, kind: 'market' };
    state.events.history.push(entry);
    if (state.events.history.length > 80) state.events.history.shift();
    this.bus?.emit('notify', entry);
  }
}
