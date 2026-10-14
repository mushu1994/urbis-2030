import { RESOURCES, RESOURCE_KEYS, NEEDS_PER_1000 } from '../simulation/ResourceSystem.js';
import { h } from './dom.js';
import { lineChart } from './charts.js';
import { formatMoney, formatNumber } from '../util/money.js';
import { EconomySystem, CATEGORY_LABELS } from '../simulation/EconomySystem.js';
import { MONTH_NAMES, SIM } from '../simulation/config.js';

const monthLabel = (mi) => `${MONTH_NAMES[mi % 12]} ${String(SIM.START_YEAR + Math.floor(mi / 12)).slice(2)}`;
const money = (c, cls) => h('td.num', { class: cls ?? (c < 0 ? 'neg' : '') }, formatMoney(c));
const TAX_LABELS = {
  R: ['Impôt résidentiel', '% des revenus des actifs'],
  C: ['Fiscalité commerciale', '% de la valeur ajoutée'],
  O: ['Fiscalité des bureaux', '% de la valeur ajoutée'],
  I: ['Fiscalité industrielle', '% de la valeur ajoutée'],
  property: ['Taxe foncière', '% par an de la valeur cadastrale']
};

/**
 * Tableau de bord financier : synthèse, compte de résultat, trésorerie, fiscalité, emprunts, journal.
 * Le résultat comptable (avec amortissements) est présenté séparément des flux de trésorerie.
 */
export class FinancePanel {
  constructor({ execute, notify }) {
    this.id = 'finance';
    this.title = 'Finances municipales';
    this.execute = execute;
    this.notify = notify;
    this.tabs = [
      { id: 'summary', label: 'Synthèse' },
      { id: 'pnl', label: 'Compte de résultat' },
      { id: 'cash', label: 'Trésorerie' },
      { id: 'taxes', label: 'Fiscalité et tarifs' },
      { id: 'trade', label: 'Échanges régionaux' },
      { id: 'resources', label: 'Ressources' },
      { id: 'loans', label: 'Emprunts' },
      { id: 'ledger', label: 'Journal' }
    ];
  }

  render(session, tab, rerender) {
    const s = session.state;
    switch (tab) {
      case 'pnl':
        return this.#pnl(s);
      case 'cash':
        return this.#cash(s);
      case 'taxes':
        return this.#taxes(session, rerender);
      case 'loans':
        return this.#loans(session, rerender);
      case 'trade':
        return this.#trade(session, rerender);
      case 'resources':
        return this.#resources(session);
      case 'ledger':
        return this.#ledger(s);
      default:
        return this.#summary(session);
    }
  }

  #summary(session) {
    const s = session.state;
    const eco = s.economy;
    const last = EconomySystem.summarize(eco.periods.at(-1));
    const cur = EconomySystem.summarize(eco.current);
    const fc = session.sim.economy.forecast(s, 12);
    const hist = eco.periods.slice(-24);
    const labels = [...hist.map((p) => monthLabel(p.monthIndex)), ...fc.months.map((m) => monthLabel(m.monthIndex))];
    const past = hist.map((p) => p.cashEnd / 100);
    const future = fc.months.map((m) => m.treasury / 100);
    const debt = eco.loans.reduce((x, l) => x + l.remaining, 0);
    const kpi = (label, value, sub, cls = '') => h('div.kpi', h('span', label), h('strong', { class: cls }, value), sub ? h('small', sub) : null);
    return [
      h('div.kpis',
        kpi('Trésorerie', formatMoney(eco.treasury), eco.monthsNegative ? `négative depuis ${eco.monthsNegative} mois` : null, eco.treasury < 0 ? 'neg' : ''),
        kpi('Recettes du dernier mois', last ? formatMoney(last.revenues) : '—'),
        kpi('Charges de fonctionnement', last ? formatMoney(last.opex) : '—'),
        kpi('Résultat opérationnel', last ? formatMoney(last.operatingResult) : '—', 'recettes − charges', last && last.operatingResult < 0 ? 'neg' : 'pos'),
        kpi('Résultat net', last ? formatMoney(last.netResult) : '—', 'après amortissements et intérêts', last && last.netResult < 0 ? 'neg' : ''),
        kpi('Investissements du mois en cours', formatMoney(cur?.capex ?? 0)),
        kpi('Dette', formatMoney(debt), `note ${session.sim.economy.creditRating(s).grade} · capacité restante ${formatMoney(session.sim.economy.debtCapacity(s), { compact: true })}`)
      ),
      h('h3', 'Trésorerie : historique et prévision à 12 mois'),
      lineChart({
        labels,
        series: [
          { label: 'Trésorerie constatée', color: '#f2c230', values: [...past, ...future.map(() => null)] },
          { label: 'Prévision (tendance des 3 derniers mois, hors investissements)', color: '#6ec6ff', dashed: true, values: [...past.map((v, i) => (i === past.length - 1 ? v : null)), ...future] }
        ],
        format: (v) => formatMoney(v * 100, { compact: true }),
        zeroLine: true
      }),
      h('p.hint', fc.months.length && eco.periods.length
        ? `Tendance des recettes retenue : ${(fc.trend * 100).toFixed(1)} % par mois. Les remboursements d'emprunts sont intégrés selon leur échéancier.`
        : 'La prévision s\'affichera après la clôture du premier mois.')
    ];
  }

  #pnl(s) {
    const periods = s.economy.periods.slice(-6);
    if (!periods.length) return h('p.empty', 'Aucun mois clôturé pour le moment. Le premier compte de résultat sera disponible à la fin du mois en cours.');
    const sums = periods.map((p) => EconomySystem.summarize(p));
    const revCats = [...new Set(periods.flatMap((p) => Object.keys(p.revenue)))];
    const opexCats = [...new Set(periods.flatMap((p) => Object.keys(p.opex)))];
    const head = h('tr', h('th', ''), periods.map((p) => h('th.num', monthLabel(p.monthIndex))));
    const line = (label, vals, cls) => h('tr', { class: cls }, h('td', label), vals.map((v) => money(v)));
    return h('div.table-wrap', h('table.fin',
      h('thead', head),
      h('tbody',
        h('tr.section', h('td', { colSpan: periods.length + 1 }, 'Recettes')),
        revCats.map((c) => line(CATEGORY_LABELS[c] ?? c, periods.map((p) => p.revenue[c] ?? 0))),
        line('Total des recettes', sums.map((x) => x.revenues), 'total'),
        h('tr.section', h('td', { colSpan: periods.length + 1 }, 'Charges de fonctionnement')),
        opexCats.map((c) => line(CATEGORY_LABELS[c] ?? c, periods.map((p) => -(p.opex[c] ?? 0)))),
        line('Total des charges', sums.map((x) => -x.opex), 'total'),
        line('Résultat opérationnel', sums.map((x) => x.operatingResult), 'total strong'),
        line('Dotations aux amortissements', sums.map((x) => -x.depreciation)),
        line('Sorties d\'actifs (démolitions)', sums.map((x) => -x.writeOffs)),
        line('Charges d\'intérêts', sums.map((x) => -x.interest)),
        line('Résultat net', sums.map((x) => x.netResult), 'total strong')
      )
    ), h('p.hint', 'Le résultat net intègre les amortissements (charges sans décaissement). Les investissements n\'y figurent pas : ils sont suivis dans l\'onglet Trésorerie.'));
  }

  #cash(s) {
    const periods = s.economy.periods.slice(-6);
    const cur = s.economy.current;
    const all = [...periods, cur].filter(Boolean);
    const sums = all.map((p) => EconomySystem.summarize(p));
    const capexCats = [...new Set(all.flatMap((p) => Object.keys(p.capex)))];
    const head = h('tr', h('th', ''), all.map((p, i) => h('th.num', i === all.length - 1 ? `${monthLabel(p.monthIndex)} (en cours)` : monthLabel(p.monthIndex))));
    const line = (label, vals, cls) => h('tr', { class: cls }, h('td', label), vals.map((v) => money(v)));
    return [
      h('div.table-wrap', h('table.fin',
        h('thead', head),
        h('tbody',
          line('Trésorerie d\'ouverture', all.map((p) => p.cashStart)),
          line('Flux opérationnel', sums.map((x) => x.cashOperating), 'strong'),
          h('tr.section', h('td', { colSpan: all.length + 1 }, 'Investissements')),
          capexCats.map((c) => line(CATEGORY_LABELS[c] ?? c, all.map((p) => -(p.capex[c] ?? 0)))),
          line('Flux d\'investissement', sums.map((x) => x.cashInvesting), 'strong'),
          line('Emprunts souscrits', all.map((p) => p.financingIn)),
          line('Remboursements de capital', all.map((p) => -p.principal)),
          line('Flux de financement', sums.map((x) => x.cashFinancing), 'strong'),
          line('Variation de trésorerie', sums.map((x) => x.cashChange), 'total strong'),
          line('Trésorerie de clôture', all.map((p) => p.cashEnd), 'total')
        )
      )),
      h('p.hint', 'Les recettes fiscales et les charges d\'entretien sont constatées à la clôture mensuelle ; les investissements sont décaissés immédiatement.')
    ];
  }

  #taxes(session, rerender) {
    const s = session.state;
    const eco = s.economy;
    const a = eco.accrual;
    const days = Math.max(1, a.days);
    const bases = { R: a.taxR / days, C: a.taxC / days, O: a.taxO / days, I: a.taxI / days, property: a.property / days / 12 };
    const rows = Object.entries(TAX_LABELS).map(([k, [label, unit]]) => {
      const value = eco.taxes[k];
      const est = (bases[k] * value) / 100;
      const out = h('output', `${value.toFixed(1)} %`);
      const input = h('input', {
        type: 'range',
        min: 0,
        max: k === 'property' ? 5 : 25,
        step: k === 'property' ? 0.1 : 0.5,
        value,
        'aria-label': label,
        on: {
          input: (e) => (out.textContent = `${Number(e.target.value).toFixed(1)} %`),
          change: (e) => {
            this.execute({ type: 'tax', key: k, value: Number(e.target.value) });
            rerender();
          }
        }
      });
      return h('div.slider-row', h('label', label, h('small', unit)), input, out, h('span.est', a.days ? `≈ ${formatMoney(Math.round(est * 100))}/mois` : '—'));
    });
    const tariffRows = [
      ['water', 'Prix de l\'eau', '€ par unité consommée et par mois'],
      ['power', 'Prix de l\'électricité', '€ par unité consommée et par mois'],
      ['transit', 'Billet de transport en commun', '€ par trajet ; un billet cher fait baisser la fréquentation']
    ].map(([k, label, unit]) => {
      const value = eco.tariffs[k];
      const out = h('output', `${value.toFixed(2)} €`);
      return h('div.slider-row', h('label', label, h('small', unit)),
        h('input', { type: 'range', min: 0, max: 3, step: 0.05, value, 'aria-label': label, on: { input: (e) => (out.textContent = `${Number(e.target.value).toFixed(2)} €`), change: (e) => { this.execute({ type: 'tariff', key: k, value: Number(e.target.value) }); rerender(); } } }),
        out,
        h('span.est', `≈ ${formatMoney(Math.round((k === 'transit' ? (a.transit ?? 0) * (30 / days) * value * (s.modifiers['transit.fareMult'] ?? 1) : (a[k] / days) * value) * 100))}/mois`));
    });
    return [
      h('p.hint', 'Chaque impôt s\'applique à une base taxable calculée par la simulation. Au-delà de 9 %, la fiscalité pèse sur la demande et sur la satisfaction des habitants.'),
      h('div.sliders', rows),
      h('h3', 'Tarifs des services publics'),
      h('div.sliders', tariffRows),
      h('p.hint', 'Estimations sur la base du mois en cours, à niveau d\'activité constant.')
    ];
  }

  /** Vente des excédents d'électricité et d'eau, achats en cas de pénurie, traitement extérieur des déchets. */
  #trade(session, rerender) {
    const s = session.state;
    const T = SIM.TRADE;
    const eur = (v) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
    const pw = s.utilities.power ?? {};
    const wa = s.utilities.water ?? {};
    const ws = s.waste.stats ?? {};
    const toggle = (resource, side, label) =>
      h('label.check.trade-toggle',
        h('input', {
          type: 'checkbox',
          checked: !!s.trade[resource][side],
          on: { change: (e) => { this.execute({ type: 'trade', resource, side, enabled: e.target.checked }); rerender(); } }
        }),
        label);
    const perMonth = (units, price) => `${formatMoney(Math.round(units * price * 100))} / mois`;
    const card = ({ title, situation, balance, toggles, flows, connected }) =>
      h('section.trade-card',
        h('h3', title),
        h('div.kv', h('span', 'Situation'), h('strong', { class: balance < 0 ? 'neg' : 'pos' }, situation)),
        connected === false ? h('p.hint.neg', "Aucun réseau de la ville n'est relié à l'accès autoroutier : échanges impossibles.") : null,
        h('div.trade-toggles', toggles),
        flows);
    const pBalance = (pw.capacity ?? 0) - (pw.demand ?? 0);
    const wBalance = (wa.capacity ?? 0) - (wa.demand ?? 0);
    return [
      h('p.hint', "Les réseaux reliés à l'accès autoroutier peuvent échanger avec la région. Vendre un excédent rapporte peu ; acheter coûte très cher : c'est un dépannage, pas une solution durable. L'interconnexion couvre au plus 60 % des besoins."),
      h('div.trade-grid',
        card({
          title: 'Électricité',
          situation: pBalance >= 0 ? `excédent de ${formatNumber(pBalance, 0)} u.` : `déficit de ${formatNumber(-pBalance, 0)} u.`,
          balance: pBalance,
          connected: pw.connected,
          toggles: [
            toggle('power', 'sell', `Vendre les excédents (${eur(T.power.sell)} / u. / mois)`),
            toggle('power', 'buy', `Acheter en cas de pénurie (${eur(T.power.buy)} / u. / mois)`)
          ],
          flows: [
            h('div.kv', h('span', 'Vendu à la région'), h('strong.pos', `${formatNumber(pw.exported ?? 0, 0)} u. · ${perMonth(pw.exported ?? 0, T.power.sell)}`)),
            h('div.kv', h('span', 'Acheté à la région'), h('strong', { class: pw.imported ? 'neg' : '' }, `${formatNumber(pw.imported ?? 0, 0)} u. · ${perMonth(pw.imported ?? 0, T.power.buy)}`)),
            h('p.small', `Les habitants paient ${eur(s.economy.tariffs.power)} / u. : chaque unité achetée à la région est revendue à perte.`)
          ]
        }),
        card({
          title: 'Eau potable',
          situation: wBalance >= 0 ? `excédent de ${formatNumber(wBalance, 0)} u.` : `déficit de ${formatNumber(-wBalance, 0)} u.`,
          balance: wBalance,
          connected: wa.connected,
          toggles: [
            toggle('water', 'sell', `Vendre les excédents (${eur(T.water.sell)} / u. / mois)`),
            toggle('water', 'buy', `Acheter en cas de pénurie (${eur(T.water.buy)} / u. / mois)`)
          ],
          flows: [
            h('div.kv', h('span', 'Vendue à la région'), h('strong.pos', `${formatNumber(wa.exported ?? 0, 0)} u. · ${perMonth(wa.exported ?? 0, T.water.sell)}`)),
            h('div.kv', h('span', 'Achetée à la région'), h('strong', { class: wa.imported ? 'neg' : '' }, `${formatNumber(wa.imported ?? 0, 0)} u. · ${perMonth(wa.imported ?? 0, T.water.buy)}`))
          ]
        }),
        card({
          title: 'Déchets',
          situation: ws.limitedBy === 'processing' ? 'capacité de traitement insuffisante' : ws.limitedBy === 'coverage' ? 'collecte incomplète' : ws.limitedBy === 'collection' ? 'bennes insuffisantes' : 'tout est traité',
          balance: ws.limitedBy ? -1 : 1,
          toggles: [toggle('waste', 'buy', `Faire traiter le surplus hors de la ville (${eur(T.waste.buy)} / unité)`)],
          flows: [
            h('div.kv', h('span', 'Envoyé hors de la ville'), h('strong', { class: ws.exportedPerDay ? 'neg' : '' }, `${formatNumber(ws.exportedPerDay ?? 0, 0)} u./j · ${formatMoney(Math.round((ws.exportedPerDay ?? 0) * 30 * T.waste.buy * 100))} / mois`)),
            h('p.small', 'Il faut toujours des bennes (centre de collecte) pour ramasser les déchets.')
          ]
        })
      )
    ];
  }

  #loans(session, rerender) {
    const s = session.state;
    const econ = session.sim.economy;
    const cap = econ.debtCapacity(s);
    const rate = econ.loanRate(s);
    const rating = econ.creditRating(s);
    const maxEuros = econ.maxLoanEuros(s);
    const amount = h('input', { type: 'number', min: 1000, max: maxEuros, step: 1000, value: Math.min(100000, Math.floor(maxEuros / 10000) * 10000), 'aria-label': 'Montant en euros' });
    const maxBtn = h('button.btn.small.loan-max', {
      type: 'button',
      title: `Emprunter le maximum autorisé : ${formatMoney(maxEuros * 100)}`,
      disabled: maxEuros <= 0,
      on: { click: () => { amount.value = String(maxEuros); updatePreview(); } }
    }, 'Max');
    const months = h('select', { 'aria-label': 'Durée' }, [24, 60, 120, 240].map((m) => h('option', { value: m, selected: m === 120 }, `${m / 12} ans`)));
    const preview = h('p.hint');
    const updatePreview = () => {
      const P = Number(amount.value) * 100;
      const n = Number(months.value);
      const r = rate / 12;
      const pay = (P * r) / (1 - Math.pow(1 + r, -n));
      preview.textContent = Number.isFinite(pay) && P > 0 ? `Annuité mensuelle : ${formatMoney(Math.ceil(pay))} — coût total des intérêts : ${formatMoney(Math.round(pay * n - P))}` : '';
    };
    amount.addEventListener('input', updatePreview);
    months.addEventListener('change', updatePreview);
    updatePreview();
    return [
      h('div.kpis',
        h('div.kpi', h('span', 'Capacité d\'emprunt'), h('strong', formatMoney(cap))),
        h('div.kpi', h('span', 'Taux proposé'), h('strong', `${(rate * 100).toFixed(2)} %`), h('small', 'taux fixe annuel')),
        h('div.kpi.credit', h('span', 'Note de la dette'), h('strong', { class: `grade grade-${gradeClass(rating.grade)}` }, rating.grade), h('small', rating.provisional ? 'note provisoire (aucun mois clos)' : `score ${rating.score}/100`))
      ),
      creditDetails(rating),
      h('form.loan-form', { on: { submit: (e) => {
        e.preventDefault();
        const r = this.execute({ type: 'loan', amountEuros: Number(amount.value), months: Number(months.value) });
        this.notify(r.ok ? 'success' : 'warning', r.ok ? `Emprunt souscrit : ${formatMoney(r.loan.principal)}` : r.reason);
        rerender();
      } } },
        h('label', 'Montant (€)', h('span.loan-amount', amount, maxBtn)), h('label', 'Durée', months), h('button.btn.primary', { type: 'submit', disabled: maxEuros <= 0 }, 'Emprunter')
      ),
      preview,
      s.economy.loans.length
        ? h('table.fin', h('thead', h('tr', h('th', 'Emprunt'), h('th.num', 'Capital initial'), h('th.num', 'Restant dû'), h('th.num', 'Taux'), h('th.num', 'Annuité'), h('th.num', 'Mois restants'))),
          h('tbody', s.economy.loans.map((l) => h('tr', h('td', `n°${l.id}`), money(l.principal), money(l.remaining), h('td.num', `${(l.rateAnnual * 100).toFixed(2)} %`), money(l.payment), h('td.num', String(l.monthsLeft))))))
        : h('p.empty', 'Aucun emprunt en cours.')
    ];
  }

  #ledger(s) {
    const tx = s.economy.ledger.slice(-80).reverse();
    if (!tx.length) return h('p.empty', 'Aucune opération enregistrée.');
    const KIND = { revenue: 'Recette', opex: 'Fonctionnement', capex: 'Investissement', interest: 'Intérêts', loan: 'Emprunt', principal: 'Remboursement' };
    return h('div.table-wrap', h('table.fin',
      h('thead', h('tr', h('th', 'N°'), h('th', 'Jour'), h('th', 'Nature'), h('th', 'Libellé'), h('th.num', 'Montant'))),
      h('tbody', tx.map((t) => h('tr', h('td', String(t.id)), h('td', `${monthLabel(Math.floor(t.tick / 30))} j${(t.tick % 30) + 1}`), h('td', KIND[t.kind] ?? t.kind), h('td', t.label), money(t.amount, t.amount < 0 ? 'neg' : 'pos'))))
    ), h('p.hint', `${formatNumber(s.economy.ledger.length)} opérations conservées.`));
  }

  /** Ressources (v0.7) : production locale, besoins, solde, cours et effet sur le budget. */
  #resources(session) {
    const s = session.state;
    const live = session.sim.resources.balance(s);
    const st = s.resources?.stats;
    const rows = st?.rows ?? live.rows;
    const shock = s.resources?.shock;
    const t = (v) => `${formatNumber(Math.round(v))} t`;
    return [
      h('div.kpis',
        h('div.kpi', h('span', 'Redevances du dernier mois'), h('strong', { class: 'pos' }, st ? formatMoney(st.exportCents) : '—'), h('small', 'ventes des excédents à la région')),
        h('div.kpi', h('span', 'Surcoût des importations'), h('strong', { class: st?.importCents ? 'neg' : '' }, st ? formatMoney(st.importCents) : '—'), h('small', 'déficits couverts par la région')),
        h('div.kpi', h('span', 'Autonomie alimentaire'), h('strong', st ? `${Math.round((st.foodSelf ?? 0) * 100)} %` : '—'), h('small', 'circuits courts : satisfaction + au-delà de 50 %'))),
      shock ? h('p.demand-warn', `⛽ Choc ${shock.resource === 'oil' ? 'pétrolier' : 'gazier'} en cours : cours ×${String(shock.mult).replace('.', ',')}.`) : null,
      h('table.fin',
        h('thead', h('tr', h('th', 'Ressource'), h('th.num', 'Production'), h('th.num', 'Besoins'), h('th.num', 'Solde'), h('th.num', 'Cours'), h('th.num', 'Effet sur le budget'))),
        h('tbody', RESOURCE_KEYS.map((k) => {
          const r = rows[k];
          const lr = live.rows[k];
          return h('tr',
            h('td', RESOURCES[k].label, h('small', ` · ${lr.producers} site${lr.producers > 1 ? 's' : ''}`)),
            h('td.num', t(lr.production)),
            h('td.num', t(lr.need)),
            h('td.num', { class: lr.balance < 0 ? 'neg' : 'pos' }, `${lr.balance >= 0 ? '+' : '−'}${t(Math.abs(lr.balance))}`),
            h('td.num', `${Math.round(r.price * 100)} %`),
            h('td.num', { class: r.importCents ? 'neg' : r.exportCents ? 'pos' : '' }, r.importCents ? `−${formatMoney(r.importCents)}` : r.exportCents ? `+${formatMoney(r.exportCents)}` : '—'));
        }))),
      h('ul.demand-advice',
        h('li', 'Cultures et élevage : zones agricoles (fermes maraîchères, d\'élevage, exploitations, fermes verticales). Elles nourrissent la ville ; l\'excédent est vendu.'),
        h('li', 'Pétrole et gaz : zones d\'extraction sur la roche (puits de pétrole, de gaz, forages automatisés). Le méthaniseur produit aussi du biogaz à partir des déchets.'),
        h('li', `Besoins : ${NEEDS_PER_1000.grain} t de cultures, ${NEEDS_PER_1000.livestock} t d'élevage, ${NEEDS_PER_1000.oil} t de pétrole et ${NEEDS_PER_1000.gas} t de gaz (chauffage, ×1,8 en hiver) par millier d'habitants et par mois, plus le pétrole de l'industrie (${live.detail.industryJobs} emplois) et le gaz des centrales (${formatNumber(live.detail.gasPower)} u. produites).`),
        h('li', 'Les déficits sont importés : la ville paie un surcoût logistique. Les excédents rapportent des redevances, avec des rendements décroissants au-delà de ce que le marché régional absorbe.')),
      h('p.hint', 'Les cours varient chaque mois (de 75 % à 135 % du cours de référence) ; un choc pétrolier ou gazier peut survenir. Valeurs en tonnes par mois.')
    ];
  }
}

/** Classe de couleur d'une note : bonne (A…), moyenne (BBB/BB), risquée (B et moins). */
function gradeClass(grade) {
  if (grade.startsWith('A')) return 'good';
  if (grade === 'BBB' || grade === 'BB') return 'mid';
  return 'bad';
}

/** Détail des critères de la note de crédit. */
function creditDetails(rating) {
  const SCALE = 'AAA · AA · A · BBB · BB · B · CCC · D';
  return h('details.credit-details',
    h('summary', `Pourquoi la note ${rating.grade} ? (prime de risque ${rating.spread >= 0 ? '+' : ''}${(rating.spread * 100).toFixed(1).replace('.', ',')} pt)`),
    h('table.fin',
      h('thead', h('tr', h('th', 'Critère'), h('th.num', 'Valeur'), h('th.num', 'Pénalité'))),
      h('tbody', rating.factors.map((f) => h('tr', h('td', f.label), h('td.num', f.value), h('td.num', { class: f.penalty ? 'neg' : '' }, f.penalty ? `−${f.penalty}` : '0'))))
    ),
    h('p.hint', `Échelle : ${SCALE}. Une bonne note abaisse le taux des nouveaux emprunts ; au-delà de 12 ans de capacité de désendettement, la note se dégrade fortement.`)
  );

}
