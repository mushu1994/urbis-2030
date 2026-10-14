import { h } from './dom.js';
import { lineChart, meter } from './charts.js';
import { formatNumber } from '../util/money.js';
import { MONTH_NAMES, SIM } from '../simulation/config.js';
import { THEMES, MAX_PROMISES, METRICS, CAMPAIGN_MONTHS } from '../simulation/PoliticsSystem.js';

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
  wear: 'L\'usure du pouvoir s\'installe au fil des mandats : un programme ambitieux et tenu la compense.'
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
    const est = Math.max(4, Math.min(96, 50 + base + points + themePts - rival));
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
        h('small', `popularité ${pts(base)} · programme ${pts(points)} · thème ${pts(themePts)} · adversaire ${pts(-rival)} · aléa ±2,5`),
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
    detailed ? h('p', h('small', `Popularité ${Math.round(e.approval)} % (${pts(b.approval ?? 0)}) · programme ${pts(b.programme ?? 0)} · thème ${pts(b.theme ?? 0)} · adversaire ${pts(b.rival ?? 0)} · bilan du mandat : ${e.kept} promesse(s) tenue(s), ${e.broken} rompue(s)`)) : null,
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
