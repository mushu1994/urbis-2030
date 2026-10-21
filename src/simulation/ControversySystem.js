import { SIM } from './config.js';
import { hash2 } from '../util/rng.js';
import { toCents } from '../util/money.js';
import { milestoneOf } from './Milestones.js';
import { CRISIS_TYPES } from './CrisisSystem.js';

/**
 * Polémiques municipales et journal local (v1.2, lot E).
 *
 * - Au plus une nouvelle polémique par trimestre, deux à la fois, aucune la première année ni pendant une crise.
 *   Chacune naît d'une situation réelle de la ville (installation de déchets près des logements, hausse d'impôt,
 *   accident d'un véhicule autonome, chantier du tramway…) puis d'un tirage déterministe.
 * - Intensité de 1 à 10 : −0,4 point de popularité par point d'intensité (facteur « Polémiques »). Sans réponse, elle
 *   monte d'un point par mois pendant cinq mois puis retombe (le silence compte comme une crise ignorée) ; « Assumer » la fait baisser d'un point, « Concerter » de trois (coût), « Reculer » la
 *   clôt aussitôt mais compte comme un revirement. À 10 : affaire (−6 de popularité, mémorisée pour la campagne).
 * - Relations presse (0–100) : elles colorent le ton du journal et pèsent ±0,5 point de popularité.
 * - Le Courrier de la ville : une mensuelle (titre et deux brèves) tirée des événements du mois.
 */

const monthOf = (state) => Math.floor(state.time.tick / SIM.DAYS_PER_MONTH);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const seedOf = (state) => state.meta?.seed ?? 2030;
const fmt = (n) => Math.round(n).toLocaleString('fr-FR');

export function defaultControversies() {
  return { active: [], history: [], affairs: [], lastNew: -999, nextId: 1, press: 50, freezeUntil: -1, front: [] };
}

export function controversiesOf(state) {
  state.controversies ??= defaultControversies();
  return state.controversies;
}

/** Résidents dans un rayon (cases) autour d'un point. */
function residentsAround(state, x, y, r) {
  let n = 0;
  for (const b of state.buildings.values()) {
    if (!(b.residents > 0)) continue;
    if (Math.abs(b.x - x) <= r && Math.abs(b.y - y) <= r) n += b.residents;
  }
  return n;
}

function avgOpex(state) {
  const p = state.economy.periods.slice(-3);
  if (!p.length) return 0;
  return p.reduce((s, q) => s + Object.values(q.opex).reduce((a, v) => a + v, 0), 0) / p.length;
}

function playerBuilt(state, ids, days) {
  const t = state.time.tick;
  return [...state.buildings.values()].filter((b) => b.origin === 'player' && ids.includes(b.defId) && t - b.builtTick <= days && t - b.builtTick >= 0);
}

const SECTOR_LABELS = { R: 'taxe d\'habitation', C: 'fiscalité commerciale', O: 'fiscalité des bureaux', I: 'fiscalité industrielle' };
const TECH_ACCIDENTS = ['autonomous_vehicles', 'autonomous_shuttles', 'drone_delivery', 'ground_robots'];

/**
 * Catalogue des polémiques. `detect` lit l'état réel et renvoie un contexte (ou null) ; `chance` est la probabilité
 * mensuelle une fois la condition remplie ; `responses` donne les trois réponses (coût en euros, effet).
 */
export const CONTROVERSIES = {
  wasteSite: {
    axis: 'ecology', intensity: 4, chance: 0.5,
    title: 'Un incinérateur sous les fenêtres',
    detect(state) {
      for (const b of playerBuilt(state, ['incinerator', 'landfill'], 180)) {
        const n = residentsAround(state, b.x + 1, b.y + 1, 6);
        if (n >= 200) return { buildingId: b.id, residents: n };
      }
      return null;
    },
    summary: (ctx) => `${fmt(ctx.residents)} riverains dénoncent l'installation de déchets construite près de chez eux.`,
    responses: {
      assume: { label: 'Assumer', detail: 'Expliquer que l\'installation est nécessaire.' },
      consult: { label: 'Concertation et filtres', detail: 'Réunions publiques et filtres supplémentaires.', euros: 30000 },
      retreat: { label: 'Suspendre l\'installation six mois', detail: 'Elle ne traite plus de déchets pendant six mois.', apply: (state, ctx) => { const b = state.buildings.get(ctx.buildingId); if (b) b.disabledUntil = state.time.tick + 180; state.dirty.utilities = true; } }
    }
  },
  taxHike: {
    axis: 'finance', intensity: 5, chance: 1,
    title: 'Coup de massue fiscal',
    detect(state) {
      const mem = state.politics?.memory?.taxes ?? [];
      if (mem.length < 2) return null;
      const a = mem.at(-2);
      const b = mem.at(-1);
      for (const k of ['R', 'C', 'O', 'I']) if (b[k] - a[k] >= 1.5) return { sector: k, from: a[k], to: b[k] };
      return null;
    },
    summary: (ctx) => `La ${SECTOR_LABELS[ctx.sector]} passe de ${String(ctx.from).replace('.', ',')} % à ${String(ctx.to).replace('.', ',')} % en un mois.`,
    responses: {
      assume: { label: 'Assumer', detail: 'Défendre la hausse au nom des comptes de la ville.' },
      consult: { label: 'Étaler la hausse', detail: 'Le taux revient à mi-chemin.', apply: (state, ctx) => { state.economy.taxes[ctx.sector] = Math.round(((ctx.from + ctx.to) / 2) * 10) / 10; } },
      retreat: { label: 'Annuler la hausse', detail: 'Le taux revient à son niveau d\'avant.', apply: (state, ctx) => { state.economy.taxes[ctx.sector] = ctx.from; } }
    }
  },
  autonomyAccident: {
    axis: 'mobility', intensity: 5, chance: 0.02,
    title: 'Accident d\'un véhicule autonome',
    detect(state) {
      const id = TECH_ACCIDENTS.find((t) => state.tech.researched[t] !== undefined);
      return id ? { techId: id } : null;
    },
    summary: () => 'Un engin autonome a renversé un cycliste : l\'opposition réclame un moratoire.',
    responses: {
      assume: { label: 'Maintenir le service', detail: 'Rappeler que l\'accident est isolé.' },
      consult: { label: 'Audit indépendant', detail: 'Un cabinet extérieur examine le système.', euros: 40000, drop: 2 },
      retreat: { label: 'Suspendre deux mois', detail: 'La technologie est coupée deux mois (ses effets disparaissent).', apply: (state, ctx) => { state.tech.outages[ctx.techId] = state.time.tick + 60; state.dirty.modifiers = true; } }
    }
  },
  dataPrivacy: {
    axis: 'safety', intensity: 4, chance: 0.12,
    title: 'Que fait l\'IA municipale de nos données ?',
    detect(state) {
      const n = Object.keys(state.tech.researched).length;
      if (state.policies.active.cyber_defense !== undefined) return null;
      return state.tech.researched.municipal_copilot !== undefined || n >= 4 ? { techs: n } : null;
    },
    summary: (ctx) => `${ctx.techs} technologies municipales collectent des données sans garde-fou annoncé.`,
    responses: {
      assume: { label: 'Rassurer', detail: 'Rappeler le cadre légal existant.' },
      consult: { label: 'Audit public', detail: 'Publication d\'un audit indépendant.', euros: 60000 },
      retreat: { label: 'Adopter la cybersécurité municipale', detail: 'La politique est adoptée (coût mensuel).', policy: 'cyber_defense', counts: false }
    }
  },
  tramWorks: {
    axis: 'mobility', intensity: 3, chance: 0.6,
    title: 'Les commerçants contre les travaux du tramway',
    detect(state) {
      const t = state.time.tick;
      let cents = 0;
      for (const tx of state.economy.ledger) if (tx.category === 'tramTracks' && tx.kind === 'capex' && t - tx.tick <= 90) cents -= tx.amount;
      return cents >= toCents(28000) ? { tiles: Math.round(cents / 140000) } : null;
    },
    summary: (ctx) => `${ctx.tiles} cases de rails posées en trois mois : la clientèle déserte les rues en chantier.`,
    responses: {
      assume: { label: 'Assumer', detail: 'Le tramway profitera à tous.' },
      consult: { label: 'Indemniser les commerçants', detail: 'Fonds d\'indemnisation des commerces riverains.', euros: 25000 }
    }
  },
  schools: {
    axis: 'social', intensity: 4, chance: 0.4,
    title: 'Classes surchargées',
    detect(state) {
      for (const b of state.buildings.values()) {
        if ((b.serviceLoad ?? 0) > 1.2 && ['school', 'high_school'].includes(b.defId)) return { buildingId: b.id, load: b.serviceLoad };
      }
      return null;
    },
    summary: (ctx) => `Une école accueille ${Math.round(ctx.load * 100)} % de sa capacité : les parents d'élèves manifestent.`,
    responses: {
      assume: { label: 'Assumer', detail: 'Une nouvelle école est à l\'étude.' },
      consult: { label: 'Classes provisoires', detail: 'Modulaires installés dans la cour.', euros: 15000, drop: 1 }
    },
    tool: 'building:school'
  },
  deputyConflict: {
    axis: null, intensity: 5, chance: 0.01,
    title: 'Conflit d\'intérêts à la mairie',
    detect(state) {
      const x = (state.politics?.council?.members ?? []).find((m) => m.loyalty < 40 && m.ambition >= 3 && !(m.suspendedUntil > monthOf(state)));
      return x ? { memberId: x.id, name: x.name, delegation: x.delegation } : null;
    },
    summary: (ctx) => `Un marché public attribué à un proche de ${ctx.name} fait scandale.`,
    responses: {
      assume: { label: 'Le soutenir', detail: 'La polémique continue de monter : risque d\'affaire.', supports: true },
      consult: { label: 'Suspendre sa délégation six mois', detail: 'Ses effets disparaissent pendant six mois.', apply: (state, ctx) => { const x = state.politics.council.members.find((m) => m.id === ctx.memberId); if (x) x.suspendedUntil = monthOf(state) + 6; state.dirty.modifiers = true; } },
      retreat: { label: 'Demander sa démission', detail: 'Il quitte le conseil.', counts: false, apply: (state, ctx) => { const c = state.politics.council; c.members = c.members.filter((m) => m.id !== ctx.memberId); state.dirty.modifiers = true; } }
    }
  },
  rents: {
    axis: 'urban', intensity: 4, chance: 0.3,
    title: 'Flambée des loyers',
    detect(state) {
      const h = state.history;
      if (h.length < 25) return null;
      const then = h.at(-25);
      const now = h.at(-1);
      if (!(then.rent > 0) || !(now.rent > 0) || now.rent < then.rent * 1.2) return null;
      if ((now.low ?? 0) >= (then.low ?? 0)) return null;
      return { rise: now.rent / then.rent - 1 };
    },
    summary: (ctx) => `Les loyers ont pris ${Math.round(ctx.rise * 100)} % en deux ans : les ménages modestes s'en vont.`,
    responses: {
      assume: { label: 'Assumer', detail: 'Le marché se régulera.' },
      consult: { label: 'Encadrer les loyers', detail: 'Adoption de la politique « Encadrement des loyers ».', policy: 'rent_control' },
      retreat: { label: 'Logement des actifs', detail: 'Adoption de la politique « Logement des actifs ».', policy: 'worker_housing', counts: false }
    }
  },
  smoke: {
    axis: 'ecology', intensity: 4, chance: 0.4,
    title: 'Fumées d\'usine',
    detect(state) {
      const g = state.grid;
      let n = 0;
      for (const b of state.buildings.values()) if (b.residents > 0 && g.pollution[g.idx(b.x, b.y)] > 25) n += b.residents;
      return n >= 300 ? { residents: n } : null;
    },
    summary: (ctx) => `${fmt(ctx.residents)} habitants respirent un air très pollué près des zones industrielles.`,
    responses: {
      assume: { label: 'Assumer', detail: 'L\'industrie fait vivre la ville.' },
      consult: { label: 'Mise aux normes', detail: 'Pollution des bâtiments privés −35 % pendant un an.', euros: 40000, apply: (state) => { state.events.active.push({ id: 'controversy-smoke', label: 'Mise aux normes des usines', until: state.time.tick + 360, effects: [{ key: 'pollution.buildings', op: 'mul', value: -0.35 }] }); state.dirty.modifiers = true; } }
    }
  },
  prestige: {
    axis: 'finance', intensity: 4, chance: 0.6,
    title: 'Dépense de prestige',
    detect(state, deps) {
      const list = playerBuilt(state, ['stadium', 'museum', 'zoo', 'airport'], 60);
      if (!list.length) return null;
      const grade = deps?.rating?.(state);
      const poor = ['BB', 'B', 'CCC', 'D'].includes(grade) || state.economy.treasury < 2 * avgOpex(state);
      return poor ? { buildingId: list[0].id, defId: list[0].defId } : null;
    },
    summary: () => 'Un équipement de prestige inauguré alors que les finances de la ville sont fragiles.',
    responses: {
      assume: { label: 'Justifier', detail: 'Défendre le rayonnement de la ville.' },
      consult: { label: 'Ouvrir les comptes', detail: 'Audit public du projet.', euros: 20000 },
      retreat: { label: 'Geler les investissements six mois', detail: 'Aucun équipement de plus de 50 000 € pendant six mois.', apply: (state) => { controversiesOf(state).freezeUntil = state.time.tick + 180; } }
    }
  },
  nights: {
    axis: 'safety', intensity: 3, chance: 0.05,
    title: 'Nuits agitées',
    detect(state) {
      const club = [...state.buildings.values()].find((b) => b.defId === 'com_3_club');
      const ev = state.civicEvents?.history ?? [];
      const nights = ev.filter((e) => e.night && monthOf(state) - e.month < 6).length;
      return club || nights >= 3 ? { club: !!club, nights } : null;
    },
    summary: (ctx) => (ctx.club ? 'Les riverains d\'une boîte de nuit dénoncent le bruit et les incivilités.' : `${ctx.nights} événements nocturnes en six mois : les riverains saturent.`),
    responses: {
      assume: { label: 'Assumer', detail: 'Une ville vivante fait du bruit.' },
      consult: { label: 'Insonorisation subventionnée', detail: 'Aide aux riverains.', euros: 25000 },
      retreat: { label: 'Horaires restreints', detail: 'Demande commerciale −5 pendant un an.', apply: (state) => { state.events.active.push({ id: 'controversy-nights', label: 'Horaires restreints la nuit', until: state.time.tick + 360, effects: [{ key: 'demand.C', op: 'add', value: -5 }] }); state.dirty.modifiers = true; } }
    }
  },
  towers: {
    axis: 'urban', intensity: 3, chance: 0.3,
    title: 'Des tours contre les pavillons',
    detect(state, deps) {
      const g = state.grid;
      const high = deps?.zoneCode?.('R_HIGH');
      if (!high) return null;
      let n = 0;
      for (const b of state.buildings.values()) {
        if (!b.defId.startsWith('res_low_') || Number(b.defId.at(-1)) < 3) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = b.x + dx;
          const y = b.y + dy;
          if (g.inBounds(x, y) && g.zone[g.idx(x, y)] === high) {
            n++;
            break;
          }
        }
      }
      return n >= 3 ? { houses: n } : null;
    },
    summary: (ctx) => `${ctx.houses} pavillons cossus voisinent désormais une zone d'immeubles : pétition des riverains.`,
    responses: {
      assume: { label: 'Assumer', detail: 'La ville doit loger tout le monde.' },
      consult: { label: 'Concertation', detail: 'Ateliers avec les riverains.', euros: 10000 }
    },
    tool: 'zone:none'
  }
};

export const CONTROVERSY_KINDS = Object.keys(CONTROVERSIES);

/** Effet mensuel sur la popularité : −0,4 par point d'intensité (plafonné à −8). */
export function controversyPenalty(state) {
  const list = state.controversies?.active ?? [];
  return Math.max(-8, -0.4 * list.reduce((s, c) => s + c.intensity, 0));
}

/** Avantage supplémentaire de l'adversaire en campagne (intensités résiduelles et affaires du mandat). */
export function controversyEdge(state) {
  const C = state.controversies;
  if (!C) return 0;
  const residual = Math.min(1.5, 0.1 * C.active.reduce((s, c) => s + c.intensity, 0));
  const since = (state.politics?.termStart ?? 0) * SIM.DAYS_PER_MONTH;
  const affairs = C.affairs.filter((a) => a.tick >= since).length;
  return residual + 1.5 * affairs;
}

export class ControversySystem {
  /** @param {{economy:any, bus?:any, catalog?:any}} deps */
  constructor({ economy, bus, catalog }) {
    this.economy = economy;
    this.bus = bus;
    this.catalog = catalog;
  }

  #notify(state, level, message, extra = {}) {
    const entry = { tick: state.time.tick, level, message, kind: 'politics', panel: 'politics', ...extra };
    state.events.history.push(entry);
    if (state.events.history.length > 80) state.events.history.shift();
    this.bus?.emit('notify', entry);
  }

  #deps() {
    return {
      rating: (state) => this.economy.creditRating(state).grade,
      zoneCode: (id) => this.catalog?.zoneById?.get(id)?.code
    };
  }

  /** Coût d'une réponse (euros). */
  cost(state, c, responseId) {
    return CONTROVERSIES[c.kind]?.responses?.[responseId]?.euros ?? 0;
  }

  /** Réponse du maire à une polémique. */
  respond(state, { id, response }, deps = {}) {
    const C = controversiesOf(state);
    const c = C.active.find((x) => x.id === id);
    if (!c) return { ok: false, reason: 'Polémique terminée' };
    if (c.response && c.response !== 'assume') return { ok: false, reason: 'Décision déjà prise' };
    const def = CONTROVERSIES[c.kind];
    const r = def.responses[response];
    if (!r) return { ok: false, reason: 'Réponse inconnue' };
    const cents = toCents(r.euros ?? 0);
    if (cents > 0 && !this.economy.canAfford(state, cents)) return { ok: false, reason: 'Budget insuffisant' };
    if (r.policy) {
      const res = deps.adoptPolicy?.(r.policy);
      if (res && !res.ok) return res;
    }
    if (cents > 0) this.economy.payOpex(state, { amount: cents, category: 'controversies', label: `${def.title} : ${r.label.toLowerCase()}` });
    r.apply?.(state, c.ctx);
    // Désavouer son adjoint (polémique de son domaine) entame sa loyauté
    const deputy = def.axis && (state.politics?.council?.members ?? []).find((m) => m.delegation === def.axis);
    if (deputy && response === 'retreat') deputy.loyalty = clamp(deputy.loyalty - 10, 0, 100);
    // Relations presse
    if (response === 'consult') C.press = clamp(C.press + 5, 0, 100);
    if (response === 'assume' && c.intensity >= 6) C.press = clamp(C.press - 5, 0, 100);
    c.response = response;
    c.supported = !!r.supports;
    c.intensity = Math.max(0, c.intensity - (r.drop ?? 0));
    if (response === 'retreat') {
      if (r.counts !== false) state.politics?.memory?.flipflops.push(state.time.tick);
      this.#close(state, c, 'retreat');
    } else if (c.intensity <= 0) this.#close(state, c, 'calmed');
    state.dirty.modifiers = true;
    return { ok: true };
  }

  #close(state, c, outcome) {
    const C = controversiesOf(state);
    C.active = C.active.filter((x) => x !== c);
    C.history.push({ id: c.id, kind: c.kind, title: c.title, since: c.since, end: monthOf(state), outcome, response: c.response ?? null });
    if (C.history.length > 40) C.history.shift();
  }

  /** Bilan mensuel : intensités, affaires, nouvelles polémiques, une du journal. Après la vie politique. */
  monthly(state) {
    const C = controversiesOf(state);
    const m = monthOf(state);
    const seed = seedOf(state);
    // 1. Évolution des polémiques en cours
    for (const c of [...C.active]) {
      const deputy = CONTROVERSIES[c.kind].axis && (state.politics?.council?.members ?? []).find((x) => x.delegation === CONTROVERSIES[c.kind].axis && x.competence >= 4 && !(x.suspendedUntil > m));
      // Sans réponse : elle enfle cinq mois, puis l'actualité passe à autre chose (mais le silence est retenu)
      let delta = m - c.since <= 5 ? 1 : -1;
      if (c.supported) delta = 1;
      else if (c.response === 'assume') delta = -1;
      else if (c.response === 'consult') delta = -3;
      if (delta < 0 && c.response && deputy) delta -= 1;
      c.intensity = clamp(c.intensity + delta, 0, 10);
      if (c.intensity <= 0) {
        if (!c.response) state.politics?.memory?.ignored.push(state.time.tick);
        this.#close(state, c, c.response ? 'calmed' : 'faded');
      }
      else if (c.intensity >= 10) {
        // Affaire : choc de popularité, souvenir durable
        C.affairs.push({ kind: c.kind, title: c.title, tick: state.time.tick, month: m });
        if (C.affairs.length > 20) C.affairs.shift();
        C.press = clamp(C.press - 10, 0, 100);
        if (state.politics) state.politics.approval = Math.max(0, state.politics.approval - 6);
        this.#close(state, c, 'affair');
        c.affairMonth = m;
        this.#notify(state, 'danger', `📰 L'affaire « ${c.title} » éclate : la popularité du maire chute de 6 points.`);
      }
    }
    // 2. Nouvelle polémique : au plus une par trimestre, deux à la fois, pas la première année ni pendant une crise
    const quiet = state.time.tick < 360 || (state.crises?.active ?? []).length > 0 || C.active.length >= 2 || m - C.lastNew < 3;
    if (!quiet) {
      const kinds = [...CONTROVERSY_KINDS].sort((a, b) => hash2(seed, m, a.length * 131 + a.charCodeAt(0)) - hash2(seed, m, b.length * 131 + b.charCodeAt(0)));
      for (const kind of kinds) {
        const def = CONTROVERSIES[kind];
        if (C.active.some((c) => c.kind === kind)) continue;
        const last = C.history.filter((h) => h.kind === kind).at(-1);
        if (last && m - last.since < 36) continue;
        const ctx = def.detect(state, this.#deps());
        if (!ctx) continue;
        if (hash2(seed, m, 0xc0f7 + kind.length * 17 + kind.charCodeAt(1)) >= def.chance) continue;
        const c = { id: C.nextId++, kind, title: def.title, axis: def.axis ?? ctx.delegation ?? null, intensity: def.intensity, since: m, response: null, ctx, summary: def.summary(ctx), newThisMonth: true };
        C.active.push(c);
        C.lastNew = m;
        this.#notify(state, 'warning', `📰 Polémique : ${def.title}. ${c.summary} (Mairie → Polémiques)`, { tab: 'press', decision: true, action: 'Répondre' });
        break;
      }
    }
    state.dirty.modifiers = true;
  }

  /** Facteurs de popularité : polémiques en cours, relations presse. */
  factors(state) {
    const C = state.controversies;
    if (!C) return [];
    const out = [];
    const pen = controversyPenalty(state);
    if (C.active.length) out.push({ id: 'controversies', label: 'Polémiques', value: pen, detail: C.active.map((c) => `${c.title} (${c.intensity}/10)`).join(', ') });
    if (C.press > 65) out.push({ id: 'press', label: 'Relations avec la presse', value: 0.5, detail: `bonnes (${Math.round(C.press)}/100)` });
    else if (C.press < 35) out.push({ id: 'press', label: 'Relations avec la presse', value: -0.5, detail: `tendues (${Math.round(C.press)}/100)` });
    return out;
  }

  // ───────────────────────────── Le Courrier de la ville ─────────────────────────────

  /**
   * Une du mois : le sujet le plus important en titre, deux brèves. Le ton dépend des relations presse.
   * Appelé en fin de mois, après les polémiques.
   */
  frontPage(state) {
    const C = controversiesOf(state);
    const m = monthOf(state);
    const t = state.time.tick;
    const city = state.meta?.name ?? 'la ville';
    const tone = C.press > 65 ? 'warm' : C.press < 35 ? 'cold' : 'neutral';
    const pick = (variants) => variants[tone] ?? variants.neutral;
    const items = [];
    const add = (priority, text) => items.push({ priority, text });
    const p = state.politics;
    const last = p?.elections?.at(-1);
    if (last && last.m === m) add(100, last.won ? pick({ warm: `Large victoire pour le maire : ${String(last.share).replace('.', ',')} %`, neutral: `Le maire réélu avec ${String(last.share).replace('.', ',')} % des voix`, cold: `Réélu de justesse ? ${String(last.share).replace('.', ',')} % pour le maire` }) : `Alternance : « ${last.rival.list} » l'emporte`);
    for (const a of C.affairs.filter((x) => x.month === m)) add(95, pick({ warm: `L'affaire « ${a.title} » secoue la mairie`, neutral: `L'affaire « ${a.title} » éclate`, cold: `Scandale : l'affaire « ${a.title} » éclabousse le maire` }));
    for (const c of C.active.filter((x) => x.since === m)) add(80, pick({ warm: `${c.title} : la mairie promet d'écouter`, neutral: `${c.title}`, cold: `${c.title} : la colère monte` }));
    for (const c of state.crises?.active ?? []) if ((c.start ?? 0) >= t - SIM.DAYS_PER_MONTH) add(75, `${CRISIS_TYPES[c.kind]?.name ?? 'Crise'} : la ville mobilisée`);
    const ms = milestoneOf(state);
    if ((state.events?.history ?? []).some((e) => e.kind === 'milestone' && e.tick > t - SIM.DAYS_PER_MONTH)) add(70, `${city} devient ${ms.rank >= 3 ? 'une' : 'un'} ${ms.name.toLowerCase()} : l'État verse une dotation`);
    for (const e of (state.civicEvents?.history ?? []).filter((x) => x.month === m)) add(60, e.cancelled ? `${e.label} annulé${e.feminine ? 'e' : ''} par la météo` : e.incident ? `${e.label} : des incidents gâchent la fête` : pick({ warm: `${e.label} : ${fmt(e.visitors)} visiteurs ravis`, neutral: `${e.label} : ${fmt(e.visitors)} visiteurs`, cold: `${e.label} : ${fmt(e.visitors)} visiteurs, à quel prix ?` }));
    for (const b of state.buildings.values()) {
      if (b.origin !== 'player' || t - b.builtTick > SIM.DAYS_PER_MONTH || t - b.builtTick < 0) continue;
      const def = this.catalog?.buildingFor?.(b);
      if (def && def.kind === 'plop' && (def.cost ?? 0) >= 100000) add(50, pick({ warm: `Inauguration : ${def.name}, un atout pour ${city}`, neutral: `Inauguration : ${def.name}`, cold: `${def.name} : ${fmt(def.cost)} € d'argent public` }));
    }
    const h = state.history ?? [];
    if (h.length >= 2) {
      const a = h.at(-2).population;
      const b = h.at(-1).population;
      const step = 5000;
      if (Math.floor(b / step) > Math.floor(a / step) && b >= step) add(45, `${city} franchit les ${fmt(Math.floor(b / step) * step)} habitants`);
    }
    const hist = p?.history ?? [];
    if (hist.length >= 2) {
      const d = hist.at(-1).approval - hist.at(-2).approval;
      if (Math.abs(d) >= 3) add(40, d > 0 ? `Sondage : le maire gagne ${Math.round(d)} points` : pick({ warm: `Sondage : le maire perd ${Math.round(-d)} points`, neutral: `Sondage : le maire perd ${Math.round(-d)} points`, cold: `Sondage : la chute continue pour le maire (−${Math.round(-d)})` }));
    }
    for (const c of C.active.filter((x) => x.since !== m)) add(30, `${c.title} : la polémique ${c.response ? 'retombe lentement' : 'enfle'}`);
    if (!items.length) add(10, pick({ warm: `Un mois paisible à ${city}`, neutral: `Mois calme à ${city}`, cold: `À ${city}, rien de neuf` }));
    items.sort((a, b) => b.priority - a.priority);
    const issue = { m, title: items[0].text, briefs: items.slice(1, 3).map((x) => x.text), tone, important: items[0].priority >= 70 };
    C.front.push(issue);
    if (C.front.length > 12) C.front.shift();
    if (issue.important) this.#notify(state, 'info', `📰 Le Courrier de ${city} : « ${issue.title} »`, { key: 'courrier' });
    return issue;
  }
}

/** Bâtiments verrouillés par un gel des investissements (polémique « Dépense de prestige »). */
export function investmentFrozen(state, def) {
  return (state.controversies?.freezeUntil ?? -1) > state.time.tick && (def.cost ?? 0) > 50000;
}

