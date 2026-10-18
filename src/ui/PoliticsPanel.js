import { h } from './dom.js';
import { lineChart, meter } from './charts.js';
import { formatNumber } from '../util/money.js';
import { MONTH_NAMES, SIM } from '../simulation/config.js';
import { THEMES, MAX_PROMISES, METRICS, CAMPAIGN_MONTHS } from '../simulation/PoliticsSystem.js';
import { DELEGATIONS, DEPUTY_EFFECTS, AXES, CRISIS_AXIS, councilOf, agendaOf, slotsOf, candidatesFor, councilSeats, allowanceEuros, efficiency } from '../simulation/CouncilSystem.js';
import { milestoneOf } from '../simulation/Milestones.js';

/** Délégations dont l'adjoint peut gérer seul certaines crises. */
const CRISIS_DELEGATIONS = [...new Set(Object.values(CRISIS_AXIS))];

const monthLabel = (mi) => `${MONTH_NAMES[((mi % 12) + 12) % 12]} ${String(SIM.START_YEAR + Math.floor(mi / 12)).slice(2)}`;
const monthLong = (mi) => `${MONTH_NAMES[((mi % 12) + 12) % 12]} ${SIM.START_YEAR + Math.floor(mi / 12)}`;
const pts = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1).replace('.', ',')}`;
const pc = (v) => `${String(Math.round(v * 10) / 10).replace('.', ',')} %`;
const months = (n) => (n >= 12 ? `${Math.floor(n / 12)} an${n >= 24 ? 's' : ''}${n % 12 ? ` et ${n % 12} mois` : ''}` : `${n} mois`);

const TIPS = {
  satisfaction: 'Services, parcs, moins de pollution et de bruit, loyers maîtrisés : la satisfaction est le premier moteur de l\'opinion.',
  jobs: 'Créez des emplois (zones d\'activité reliées) ou, si les postes restent vacants, adoptez « Formation professionnelle » ou « Accueil des navetteurs ».',
  taxes: 'Les électeurs sanctionnent les hausses d\'impôts pendant un an : préférez des hausses modérées, loin des élections.',
  finances: 'Une note financière dégradée inquiète : réduisez les charges, remboursez la dette, évitez une trésorerie négative.',
  services: 'Étendez la couverture des écoles, hôpitaux, commissariats et casernes (couches « Services publics »).',
  living: 'Désengorgez les axes (transports en commun, boulevards) et éloignez l\'industrie polluante des habitations.',
  housing: 'Zonez du logement : une pénurie fait grimper les loyers et le mécontentement.',
  crises: 'Répondez à chaque crise : une crise ignorée laisse un souvenir durable.',
  promises: 'Tenez vos engagements : chaque promesse rompue coûte 4 points et entame votre crédibilité.',
  growth: 'Une ville qui gagne des habitants donne une image de dynamisme.',
  flipflops: 'Évitez d\'abroger une politique moins d\'un an après l\'avoir adoptée.',
  wear: 'L\'usure du pouvoir s\'installe au fil des mandats : un programme ambitieux et tenu la compense.',
  team: 'Choisissez des adjoints connus et gardez leur confiance (Mairie → Conseil) : une démission se paie dans l\'opinion.',
  agenda: 'Changer souvent de priorités brouille votre message : ajustez-les par petites touches.'
};

/**
 * Mairie et vie politique (v0.7) : popularité et ses causes, mandat et promesses, campagne (programme chiffré,
 * thème) et résultats des élections par quartier.
 */
export class PoliticsPanel {
  constructor({ execute, notify }) {
    this.id = 'politics';
    this.title = 'Mairie et élections';
    this.execute = execute;
    this.notify = notify;
    this.tabs = [
      { id: 'opinion', label: 'Opinion' },
      { id: 'council', label: 'Conseil' },
      { id: 'agenda', label: 'Priorités' },
      { id: 'mandate', label: 'Mandat et promesses' },
      { id: 'campaign', label: 'Campagne' },
      { id: 'results', label: 'Élections' }
    ];
    this.draft = null;
  }

  render(session, tab = 'opinion', rerender) {
    const s = session.state;
    const p = s.politics;
    if (!p) return h('p.hint', 'La vie politique démarre à la fin du premier mois.');
    if (tab === 'mandate') return this.#mandate(session, rerender);
    if (tab === 'council') return this.#council(session, rerender);
    if (tab === 'agenda') return this.#agenda(session, rerender);
    if (tab === 'campaign') return this.#campaign(session, rerender);
    if (tab === 'results') return this.#results(session);
    return this.#opinion(session);
  }

  #header(session) {
    const p = session.state.politics;
    const m = Math.floor(session.state.time.tick / SIM.DAYS_PER_MONTH);
    const left = p.nextElection - m;
    const status = !p.enabled
      ? 'Élections désactivées (partie libre)'
      : p.defeated
        ? 'Battu(e) aux élections'
        : p.campaign
          ? `Campagne en cours · scrutin en ${monthLong(p.nextElection)} (dans ${months(Math.max(0, left))})`
          : `Prochaines municipales : ${monthLong(p.nextElection)} (dans ${months(Math.max(0, left))})`;
    const tone = p.approval >= 55 ? 'pos' : p.approval < 45 ? 'neg' : '';
    return h('div.kpis',
      h('div.kpi', h('span', 'Popularité'), h('strong', { class: tone }, `${Math.round(p.approval)} %`), h('small', `tendance ${p.target > p.approval + 0.5 ? '↗' : p.target < p.approval - 0.5 ? '↘' : '→'} vers ${Math.round(p.target)} %`)),
      h('div.kpi', h('span', 'Mandat'), h('strong', `${p.mandate}${p.mandate === 1 ? 'er' : 'e'}`), h('small', `depuis ${monthLong(p.termStart)}`)),
      h('div.kpi', h('span', 'Calendrier'), h('strong', p.campaign ? 'Campagne' : p.enabled ? `${Math.max(0, left)} mois` : '—'), h('small', status))
    );
  }

  #opinion(session) {
    const s = session.state;
    const p = s.politics;
    const factors = [...(p.factors ?? [])].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const weak = factors.filter((f) => f.value < -1.5 && TIPS[f.id]).slice(0, 3);
    const hist = p.history ?? [];
    const polls = new Map((p.polls ?? []).map((x) => [x.m, x]));
    return [
      this.#header(session),
      h('h3', 'Évolution de la popularité'),
      lineChart({
        labels: hist.map((x) => monthLabel(x.m - 1)),
        series: [
          { label: 'Popularité (%)', color: '#f2c230', values: hist.map((x) => x.approval) },
          { label: 'Sondage', color: '#6ec6ff', dashed: true, values: hist.map((x) => polls.get(x.m)?.approval ?? null) },
          { label: 'Seuil de réélection', color: 'rgba(255,255,255,0.35)', dashed: true, values: hist.map(() => 50) }
        ],
        height: 140
      }),
      h('h3', 'Ce que pensent les habitants'),
      factors.length
        ? h('table.fin.demand-factors',
          h('thead', h('tr', h('th', 'Facteur'), h('th', 'Détail'), h('th.num', 'Effet'), h('th', ''))),
          h('tbody', factors.map((f) => h('tr',
            h('td', f.label),
            h('td', h('small', f.detail)),
            h('td.num', { class: f.value < 0 ? 'neg' : 'pos' }, pts(f.value)),
            h('td.fbar', h('span', { class: f.value < 0 ? 'neg' : 'pos', style: { width: `${Math.min(100, Math.abs(f.value) * 5)}%` } }))
          ))))
        : h('p.hint', 'Les premiers indicateurs arrivent à la fin du mois.'),
      weak.length ? h('div', h('h4', 'Pour regagner l\'opinion'), h('ul.demand-advice', weak.map((f) => h('li', h('strong', `${f.label} : `), TIPS[f.id])))) : null,
      h('p.hint', 'La popularité part de 50 et additionne ces facteurs ; elle évolue de 30 % de l\'écart chaque mois. Une popularité élevée attire de nouveaux habitants ; sous 18 % pendant 9 mois, la majorité municipale éclate et des élections anticipées sont convoquées.')
    ];
  }

  // ───────────────────────────── v1.1 : conseil municipal ─────────────────────────────

  #council(session, rerender) {
    const s = session.state;
    const p = s.politics;
    const C = session.sim.council;
    const council = councilOf(s);
    const m = Math.floor(s.time.tick / SIM.DAYS_PER_MONTH);
    const slots = slotsOf(s);
    const status = milestoneOf(s);
    const run = (cmd, ok) => {
      const r = this.execute({ type: 'council', ...cmd });
      if (!r?.ok) this.notify?.('warning', r?.messages?.[0] ?? r?.reason ?? 'Action impossible');
      else if (ok) this.notify?.('success', ok);
      rerender?.();
    };
    const dots = (n, max = 5) => h('span.dots', { 'aria-label': `${n} sur ${max}` }, '●'.repeat(n), h('span.off', '●'.repeat(max - n)));
    const initials = (name) => name.split(' ').map((x) => x[0]).join('');
    const person = (x, extra) => h('div.deputy',
      h('span.avatar', { style: { background: `hsl(${(x.name.length * 47 + x.competence * 31) % 360} 45% 42%)` } }, initials(x.name)),
      h('div.deputy-body',
        h('strong', x.name),
        h('small', `Proche des ${x.leaning.toLowerCase()} · notoriété ${x.notoriety >= 0 ? '+' : '−'}${Math.abs(x.notoriety)}`),
        h('div.deputy-traits',
          h('span', 'Compétence ', dots(x.competence)),
          h('span', 'Ambition ', dots(x.ambition)),
          h('span', { class: x.loyalty < 25 ? 'neg' : x.loyalty < 40 ? 'warn' : '' }, `Loyauté ${Math.round(x.loyalty)}`))),
      extra);
    const requests = council.requests.map((r) => h('article.card.council-request',
      h('p', r.label),
      h('div.dialog-actions',
        h('button.btn.small.primary', { type: 'button', on: { click: () => run({ op: 'answer', requestId: r.id, accept: true }, 'Demande acceptée') } }, r.type === 'budget' ? `Accepter (${formatNumber(r.euros)} €)` : 'Accepter'),
        h('button.btn.small', { type: 'button', on: { click: () => run({ op: 'answer', requestId: r.id, accept: false }) } }, 'Refuser (loyauté −8)')),
      h('small', `Sans réponse, la demande expire dans ${Math.max(0, r.expires - m)} mois et compte comme un refus.`)));
    const rows = DELEGATIONS.map((d) => {
      const x = council.members.find((y) => y.delegation === d.id);
      const vacant = (council.vacantUntil[d.id] ?? -1) > m;
      const effects = (DEPUTY_EFFECTS[d.id] ?? []).map((e) => e.label.toLowerCase()).join(', ');
      if (x) {
        const canAuto = CRISIS_DELEGATIONS.includes(d.id);
        return h('section.delegation', h('h4', d.label), person(x,
          h('div.deputy-actions',
            canAuto ? h('label.check', h('input', { type: 'checkbox', checked: !!council.autoCrisis[d.id], disabled: x.competence < 3, on: { change: (e) => run({ op: 'autoCrisis', delegation: d.id, enabled: e.target.checked }) } }), x.competence < 3 ? 'Gérer seul les crises (compétence 3 requise)' : 'Gérer seul les crises de son domaine') : null,
            h('button.btn.small', { type: 'button', on: { click: () => { this.pick = this.pick === d.id ? null : d.id; rerender?.(); } } }, 'Remplacer'))),
          h('small.hint', `Effets : ${effects} (×${efficiency(s, d.id).toFixed(2).replace('.', ',')} selon la priorité de l'axe).`),
          this.pick === d.id ? this.#candidates(session, d.id, run, person, true) : null);
      }
      const full = council.members.length >= slots;
      return h('section.delegation', { class: 'empty' }, h('h4', d.label),
        vacant ? h('p.hint.neg', `Vacante après une démission : le conseil élira un remplaçant dans ${council.vacantUntil[d.id] - m} mois.`)
          : full ? h('p.hint', `Statut « ${status.name} » : ${slots} délégation${slots > 1 ? 's' : ''} au plus. Effets possibles : ${effects}.`)
            : this.#candidates(session, d.id, run, person, false));
    });
    return [
      this.#header(session),
      h('div.kpis',
        h('div.kpi', h('span', 'Conseil municipal'), h('strong', `${councilSeats(s.stats.population)} sièges`), h('small', 'selon la population (comme les communes françaises)')),
        h('div.kpi', h('span', 'Délégations'), h('strong', `${council.members.length} / ${slots}`), h('small', `statut « ${status.name} »`)),
        h('div.kpi', h('span', 'Indemnités'), h('strong', `${formatNumber(allowanceEuros(s) * council.members.length)} €`), h('small', `${formatNumber(allowanceEuros(s))} € par adjoint et par mois`))),
      requests.length ? h('div', h('h3', 'Demandes des adjoints'), requests) : null,
      p.campaign?.dissident ? h('p.hint.neg', `${p.campaign.dissident.name} a quitté la majorité et mène une liste dissidente.`) : null,
      slots === 0 ? h('p.hint', 'Au statut Hameau, le maire gouverne seul. Les premières délégations arrivent au statut Village (500 habitants).') : null,
      h('div.delegations', rows),
      h('p.hint', 'Un adjoint compétent renforce son domaine ; un adjoint ambitieux et peu loyal peut démissionner ou mener une liste dissidente pendant la campagne. Remplacer un adjoint coûte 2 points de popularité (un seul remaniement par an), sauf s\'il a perdu la confiance (loyauté sous 25).')
    ];
  }

  #candidates(session, delegation, run, person, replacing) {
    const list = candidatesFor(session.state, delegation);
    const council = councilOf(session.state);
    return h('div.candidates', list.filter((c) => !council.members.some((x) => x.sourceId === c.id)).map((c) => person(c,
      h('div.deputy-actions', h('button.btn.small.primary', { type: 'button', on: { click: () => { this.pick = null; run({ op: 'appoint', delegation, candidateId: c.id }, `${c.name} reçoit la délégation`); } } }, replacing ? 'Nommer à sa place' : 'Nommer')))));
  }

  // ───────────────────────────── v1.1 : priorités du mandat ─────────────────────────────

  #agenda(session, rerender) {
    const s = session.state;
    const a = agendaOf(s);
    if (!this.agendaDraft || this.agendaDraft.base !== JSON.stringify(a.shares)) this.agendaDraft = { base: JSON.stringify(a.shares), shares: { ...a.shares } };
    const d = this.agendaDraft.shares;
    const total = AXES.reduce((x, k) => x + d[k], 0);
    const moved = AXES.reduce((x, k) => x + Math.abs(d[k] - a.shares[k]), 0) / 2;
    const already = session.sim.council.movedLastYear(s);
    const setShare = (axis, value) => {
      // Les autres axes compensent, proportionnellement à leur part, pour garder une somme de 100
      const v = Math.max(0, Math.min(100, Math.round(value)));
      const others = AXES.filter((k) => k !== axis);
      let rest = 100 - v;
      const base = others.reduce((x, k) => x + d[k], 0) || others.length;
      const next = { [axis]: v };
      others.forEach((k, i) => {
        const share = i === others.length - 1 ? rest : Math.round(((d[k] || (base === others.length ? 1 : 0)) / base) * (100 - v));
        next[k] = Math.max(0, Math.min(rest, share));
        rest -= next[k];
      });
      Object.assign(d, next);
      rerender?.();
    };
    const row = (dl) => {
      const v = d[dl.id];
      const k = 0.85 + 0.9 * (v / 100);
      const w = 0.7 + 1.8 * (v / 100);
      return h('div.agenda-row',
        h('label', { for: `agenda-${dl.id}` }, dl.label),
        h('input', { type: 'range', id: `agenda-${dl.id}`, min: 0, max: 60, step: 1, value: v, 'aria-label': `Priorité ${dl.short}`, on: { change: (e) => setShare(dl.id, Number(e.target.value)) } }),
        h('output', `${v} %`),
        h('small', `efficacité ×${k.toFixed(2).replace('.', ',')} · poids dans l'opinion ×${w.toFixed(2).replace('.', ',')}`));
    };
    return [
      this.#header(session),
      h('p.hint', 'Répartissez 100 points entre les six axes du mandat. Un axe prioritaire renforce les effets de son adjoint, mais les électeurs le jugent davantage sur ce sujet, dans les deux sens. Avec la répartition de départ (environ un sixième par axe), rien ne change.'),
      h('div.agenda', DELEGATIONS.map(row)),
      h('div.dialog-actions',
        h('button.btn.primary', {
          type: 'button',
          disabled: total !== 100 || moved === 0,
          on: { click: () => {
            const r = this.execute({ type: 'council', op: 'agenda', shares: { ...d } });
            if (!r?.ok) this.notify?.('warning', r?.messages?.[0] ?? 'Répartition invalide');
            else this.notify?.('success', 'Priorités du mandat mises à jour');
            this.agendaDraft = null;
            rerender?.();
          } }
        }, moved ? `Appliquer (${moved} points déplacés)` : 'Appliquer'),
        h('button.btn', { type: 'button', disabled: moved === 0, on: { click: () => { this.agendaDraft = null; rerender?.(); } } }, 'Annuler')),
      h('p', h('small', `Déjà déplacés sur les 12 derniers mois : ${Math.round(already)} points. Au-delà de 30, l'opinion vous trouve changeant (−1 point de popularité). Pendant la campagne, choisir comme thème l'axe resté le plus prioritaire au moins 2 ans rapporte +1 point de voix ; un axe resté sous 10 % coûte 1,5 point.`))
    ];
  }

  #mandate(session, rerender) {
    const s = session.state;
    const p = s.politics;
    const pol = session.sim.politics;
    const cred = pol.credibility(s);
    const items = p.promises.map((pr) => {
      const g = pol.progress(s, pr);
      const fmt = METRICS[pr.metric].fmt;
      const badge = pr.status === 'kept' ? h('span.badge.ok', 'Tenue') : pr.status === 'broken' ? h('span.badge.bad', 'Rompue') : h('span.badge', pr.kind === 'keep' ? 'À maintenir' : 'En cours');
      return h('article.card.promise', { class: pr.status },
        h('header', h('h4', pr.label), badge),
        h('p', h('small', `${THEMES[pr.theme]?.label ?? ''} · ${pr.level === 'ambitious' ? 'ambitieux' : 'modeste'} · départ ${fmt(pr.baseline)} → objectif ${fmt(pr.target)} · aujourd'hui ${fmt(g.value)}`)),
        pr.status === 'pending' ? meter(pr.kind === 'keep' ? 1 : g.frac, { color: g.ok ? 'var(--ok)' : 'var(--accent, #f2c230)', label: `${Math.round(g.frac * 100)} %` }) : null,
        h('p', h('small', pr.status === 'pending' ? `Échéance : ${monthLong(pr.deadline)}` : `Constaté en ${monthLong(pr.settledMonth ?? pr.deadline)}`))
      );
    });
    return [
      this.#header(session),
      h('h3', 'Engagements du mandat'),
      items.length ? h('div.cards', items) : h('p.hint', p.mandate === 1 ? 'Premier mandat : vous avez été élu(e) sans programme chiffré. Vos engagements se décideront lors de la prochaine campagne, six mois avant le scrutin.' : 'Aucun engagement en cours.'),
      h('dl.demand-figures',
        h('dt', 'Promesses tenues (toute la carrière)'), h('dd', String(p.record.kept)),
        h('dt', 'Promesses rompues'), h('dd', String(p.record.broken)),
        h('dt', 'Crédibilité'), h('dd', `${Math.round(cred * 100)} %`)),
      h('p.hint', `Une promesse « à atteindre » est tenue dès que l'objectif est atteint (+2,5 points de popularité) ; une promesse « à maintenir » est rompue au premier écart (−4 points). La crédibilité pondère les voix que rapportera votre prochain programme.`),
      h('div.politics-toggle',
        h('span', p.enabled ? 'Élections municipales activées' : 'Élections municipales désactivées : la popularité est suivie sans scrutin.'),
        h('button.btn.small', {
          type: 'button',
          on: {
            click: () => {
              const r = this.execute({ type: 'option', key: 'elections', value: p.enabled ? 'off' : 'on' });
              if (!r?.ok) this.notify?.('warning', 'Changement impossible');
              rerender?.();
            }
          }
        }, p.enabled ? 'Désactiver' : 'Activer'))
    ];
  }

  #campaign(session, rerender) {
    const s = session.state;
    const p = s.politics;
    const pol = session.sim.politics;
    const m = Math.floor(s.time.tick / SIM.DAYS_PER_MONTH);
    if (!p.enabled) return [this.#header(session), h('p.hint', 'Les élections sont désactivées dans cette partie (onglet « Mandat et promesses » pour les réactiver).')];
    if (!p.campaign) {
      return [
        this.#header(session),
        h('p.hint', `La campagne s'ouvrira en ${monthLong(p.nextElection - CAMPAIGN_MONTHS)}, six mois avant le scrutin. Vous choisirez alors jusqu'à ${MAX_PROMISES} engagements chiffrés (un par thème) et un thème de campagne.`),
        h('h3', 'Comment se joue l\'élection'),
        h('ul.demand-advice',
          h('li', 'Votre popularité au moment du vote fait l\'essentiel du score (chaque point au-dessus de 50 vaut 0,85 point de voix).'),
          h('li', 'Programme : un engagement modeste rapporte 1 point, un engagement ambitieux 2,2 points, multipliés par votre crédibilité. Une fois élu(e), il faudra les tenir.'),
          h('li', 'Thème de campagne : mettre en avant un point fort de votre bilan rapporte jusqu\'à 3 points ; un point faible en coûte autant.'),
          h('li', 'La liste adverse attaque votre plus grande faiblesse (jusqu\'à −3 points). Un aléa de campagne de ±2,5 points subsiste.'))
      ];
    }
    const c = p.campaign;
    if (!this.draft || this.draft.opened !== c.opened) this.draft = { opened: c.opened, chosen: [...c.chosen], theme: c.theme };
    const d = this.draft;
    const byTheme = new Map();
    for (const o of c.offers) {
      if (!byTheme.has(o.theme)) byTheme.set(o.theme, []);
      byTheme.get(o.theme).push(o);
    }
    const cred = pol.credibility(s);
    const toggle = (o) => {
      const i = d.chosen.indexOf(o.id);
      if (i >= 0) d.chosen.splice(i, 1);
      else {
        d.chosen = d.chosen.filter((id) => c.offers.find((x) => x.id === id)?.theme !== o.theme);
        if (d.chosen.length >= MAX_PROMISES) {
          this.notify?.('warning', `${MAX_PROMISES} engagements au plus : retirez-en un d'abord.`);
          return;
        }
        d.chosen.push(o.id);
      }
      rerender?.();
    };
    const points = d.chosen.reduce((a, id) => a + (c.offers.find((o) => o.id === id)?.points ?? 0), 0) * cred;
    const factor = d.theme ? (p.factors ?? []).find((f) => f.id === THEMES[d.theme].factor) : null;
    const themePts = d.theme ? Math.max(-3, Math.min(3, (factor?.value ?? 0) * 0.35)) : 0;
    const rival = pol.rivalEdge(s);
    const base = (p.approval - 50) * 0.85;
    // v1.1 : cohérence du thème avec les priorités du mandat, liste dissidente d'un ancien adjoint
    const coherence = pol.coherenceFor(s, d.theme);
    const dissident = pol.dissidentPenalty(s);
    const est = Math.max(4, Math.min(96, 50 + base + points + themePts + coherence - dissident - rival));
    const saved = c.chosen.join() === d.chosen.join() && c.theme === d.theme;
    const lastPoll = [...(p.polls ?? [])].reverse().find((x) => x.vote !== undefined);
    return [
      this.#header(session),
      h('div.campaign-head',
        h('div', h('strong', `Face à vous : « ${p.rival.list} »`), h('small', ` menée par ${p.rival.leader}`)),
        c.attacks.length ? h('p', h('small', `Ses angles d'attaque : ${c.attacks.map((a) => `${a.label.toLowerCase()} (${pts(a.value)})`).join(', ')}.`)) : h('p', h('small', 'Votre bilan offre peu de prise à l\'opposition.')),
        h('p', h('small', `Scrutin en ${monthLong(p.nextElection)} (dans ${months(Math.max(0, p.nextElection - m))})${lastPoll ? ` · dernier sondage : ${Math.round(lastPoll.vote)} % pour votre liste` : ''}`))),
      h('div.vote-estimate', { class: est >= 50 ? 'pos' : 'neg' },
        h('strong', `Intentions de vote estimées : ${pc(est)}`),
        h('small', `popularité ${pts(base)} · programme ${pts(points)} · thème ${pts(themePts)}${coherence ? ` · cohérence avec vos priorités ${pts(coherence)}` : ''}${dissident ? ` · liste dissidente (${c.dissident.name}) ${pts(-dissident)}` : ''} · adversaire ${pts(-rival)} · aléa ±2,5`),
        h('div.vote-bar', h('span', { style: { width: `${est}%` } }), h('i', { style: { left: '50%' } }))),
      h('h3', `Programme : ${d.chosen.length} / ${MAX_PROMISES} engagements`),
      h('p.hint', `Un engagement par thème. Crédibilité actuelle : ${Math.round(cred * 100)} % (promesses tenues ${p.record.kept}, rompues ${p.record.broken}). Échéance : fin du prochain mandat.`),
      h('div.offers', [...byTheme].map(([theme, list]) => h('fieldset.offer-group',
        h('legend', THEMES[theme]?.label ?? theme),
        list.map((o) => h('label.offer', { class: d.chosen.includes(o.id) ? 'chosen' : '' },
          h('input', { type: 'checkbox', checked: d.chosen.includes(o.id), on: { change: () => toggle(o) } }),
          h('span', o.label),
          h('small', `${o.level === 'ambitious' ? 'ambitieux' : 'modeste'} · +${(o.points * cred).toFixed(1).replace('.', ',')} pt · ${o.kind === 'keep' ? 'à maintenir' : o.kind === 'deadline' ? 'jugé en fin de mandat' : 'à atteindre'} · aujourd'hui ${METRICS[o.metric].fmt(o.baseline)}`)))
      ))),
      h('h3', 'Thème de campagne'),
      h('div.theme-choice', [null, ...Object.keys(THEMES)].map((k) => {
        const f = k ? (p.factors ?? []).find((x) => x.id === THEMES[k].factor) : null;
        const v = k ? Math.max(-3, Math.min(3, (f?.value ?? 0) * 0.35)) : 0;
        return h('label.theme', { class: d.theme === k ? 'chosen' : '' },
          h('input', { type: 'radio', name: 'campaign-theme', checked: d.theme === k, on: { change: () => { d.theme = k; rerender?.(); } } }),
          h('span', k ? THEMES[k].label : 'Aucun'),
          k ? h('small', { class: v < 0 ? 'neg' : 'pos' }, pts(v)) : null);
      })),
      h('div.dialog-actions',
        h('button.btn.primary', {
          type: 'button',
          disabled: saved,
          on: {
            click: () => {
              const r = this.execute({ type: 'politics', op: 'programme', promises: d.chosen, theme: d.theme });
              if (!r?.ok) this.notify?.('warning', r?.reason ?? 'Programme refusé');
              else this.notify?.('success', `Programme déposé : ${d.chosen.length} engagement(s)${d.theme ? `, thème « ${THEMES[d.theme].label} »` : ''}.`);
              rerender?.();
            }
          }
        }, saved ? 'Programme enregistré' : 'Déposer ce programme'))
    ];
  }

  #results(session) {
    const p = session.state.politics;
    const list = [...(p.elections ?? [])].reverse();
    if (!list.length) return [this.#header(session), h('p.hint', 'Aucune élection pour l\'instant.')];
    return [this.#header(session), ...list.map((e, k) => electionCard(e, { detailed: k === 0 }))];
  }
}

/** Carte de résultat d'une élection (panneau et soirée électorale). */
export function electionCard(e, { detailed = true } = {}) {
  const b = e.breakdown ?? {};
  return h('section.election', { class: e.won ? 'won' : 'lost' },
    h('header', h('strong', `${monthLong(e.m)} — ${e.won ? 'Victoire' : 'Défaite'}${e.early ? ' (élections anticipées)' : ''}`), h('small', `participation ${Math.round(e.turnout)} %`)),
    h('div.vote-bar.result', h('span', { style: { width: `${e.share}%` } }), h('i', { style: { left: '50%' } })),
    h('div.vote-lists', h('span.mine', `Votre liste : ${pc(e.share)}`), h('span.rival', `« ${e.rival.list} » (${e.rival.leader}) : ${pc(e.rivalShare)}`)),
    detailed ? h('p', h('small', `Popularité ${Math.round(e.approval)} % (${pts(b.approval ?? 0)}) · programme ${pts(b.programme ?? 0)} · thème ${pts(b.theme ?? 0)}${b.coherence ? ` · cohérence ${pts(b.coherence)}` : ''}${b.dissident ? ` · liste dissidente ${pts(b.dissident)}` : ''} · adversaire ${pts(b.rival ?? 0)} · bilan du mandat : ${e.kept} promesse(s) tenue(s), ${e.broken} rompue(s)`)) : null,
    detailed && e.programme?.length ? h('p', h('small', `Programme : ${e.programme.join(' · ')}`)) : null,
    detailed && e.districts?.length
      ? h('table.fin',
        h('thead', h('tr', h('th', 'Quartier'), h('th.num', 'Habitants'), h('th.num', 'Satisfaction'), h('th.num', 'Votre liste'), h('th', 'En tête'))),
        h('tbody', e.districts.map((d) => h('tr',
          h('td', d.name),
          h('td.num', formatNumber(d.residents)),
          h('td.num', String(d.satisfaction)),
          h('td.num', { class: d.share >= 50 ? 'pos' : 'neg' }, pc(d.share)),
          h('td', d.share >= 50 ? 'Votre liste' : e.rival.list)))))
      : null
  );
}

/** Soirée électorale : résultats, puis suite de la partie (en cas de défaite : continuer sans élections ou menu). */
export function electionDialog(e, { onContinue, onFree, onMenu }) {
  const backdrop = h('div.dialog-backdrop', { role: 'presentation' });
  const close = (fn) => {
    backdrop.remove();
    fn?.();
  };
  const box = h('div.dialog.scenario-end.election-night', { role: 'dialog', 'aria-modal': 'true', class: e.won ? 'won' : 'lost' },
    h('div.scenario-medal', { 'aria-hidden': 'true' }, e.won ? '★' : '✕'),
    h('h3', e.won ? 'Réélu(e) !' : 'Battu(e) aux municipales'),
    h('p', e.won
      ? `Les habitants vous accordent un ${e.mandate + 1}e mandat avec ${pc(e.share)} des voix.`
      : `« ${e.rival.list} », menée par ${e.rival.leader}, l'emporte avec ${pc(e.rivalShare)} des voix.`),
    electionCard(e, { detailed: true }),
    h('div.dialog-actions',
      e.won
        ? h('button.btn.primary', { type: 'button', on: { click: () => close(onContinue) } }, 'Commencer le nouveau mandat')
        : [
          h('button.btn', { type: 'button', on: { click: () => close(onMenu) } }, 'Menu (charger, nouvelle partie)'),
          h('button.btn.primary', { type: 'button', on: { click: () => close(onFree) } }, 'Continuer sans élections')
        ])
  );
  backdrop.append(box);
  document.body.append(backdrop);
  box.querySelector('.btn.primary')?.focus();
}
