import { RESOURCES, RESOURCE_KEYS, NEEDS_PER_1000 } from '../simulation/ResourceSystem.js';
import { h } from './dom.js';
import { lineChart } from './charts.js';
import { formatMoney, formatNumber } from '../util/money.js';
import { EconomySystem, CATEGORY_LABELS, LOAN_TYPES, loanPreview, loanSchedule } from '../simulation/EconomySystem.js';
import { MARKET_EVENTS, CONTRACT_MONTHS, contractOffer, contractPenaltyCents, marketPrice } from '../simulation/MarketSystem.js';
import { districtList, TAX_DELTA_MAX, SECTORS, effectiveTaxes } from '../simulation/Districts.js';
import { WORLD_PARCELS, landOf } from '../world/Land.js';
import { confirmDialog } from './Dialog.js';
import { MONTH_NAMES, SIM } from '../simulation/config.js';
import { savingsRate, featureUnlocked } from '../simulation/Milestones.js';

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
/**
 * Taux d'épargne brute (v1.0) sur les 3 derniers mois : épargne brute / recettes. Repère vert entre 15 et 30 %,
 * comme pour l'analyse financière d'une commune.
 */
function savingsKpi(s) {
  const last = s.economy.periods.slice(-3).map((p) => EconomySystem.summarize(p));
  const rev = last.reduce((x, p) => x + p.revenues, 0);
  const rate = rev > 0 ? savingsRate({ revenues: rev, operatingResult: last.reduce((x, p) => x + p.operatingResult, 0) }) : null;
  const cls = rate === null ? '' : rate < 0.05 ? 'neg' : rate >= 0.15 && rate <= 0.3 ? 'pos' : '';
  const note = rate === null ? 'après 1 mois clos' : rate < 0.05 ? 'trop faible : peu de marge pour investir' : rate > 0.3 ? 'confortable' : rate >= 0.15 ? 'repère : 15 à 30 %' : 'un peu juste (repère : 15 à 30 %)';
  return h('div.kpi', { title: 'Épargne brute (recettes − charges de fonctionnement) rapportée aux recettes, sur les 3 derniers mois' },
    h('span', 'Taux d\'épargne brute'), h('strong', { class: cls }, rate === null ? '—' : `${Math.round(rate * 100)} %`), h('small', note));
}

export class FinancePanel {
  constructor({ execute, notify, onPanel }) {
    this.id = 'finance';
    this.onPanel = onPanel;
    this.title = 'Finances municipales';
    this.execute = execute;
    this.notify = notify;
    this.tabs = [
      { id: 'summary', label: 'Synthèse' },
      { id: 'loans', label: 'Emprunts' },
      { id: 'pnl', label: 'Compte de résultat' },
      { id: 'cash', label: 'Trésorerie' },
      { id: 'taxes', label: 'Fiscalité et tarifs' },
      { id: 'districts', label: 'Quartiers' },
      { id: 'trade', label: 'Échanges régionaux' },
      { id: 'resources', label: 'Ressources' },
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
      case 'districts':
        return this.#districts(session, rerender);
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
    // v1.4 : l'emprunt est proposé dès la synthèse (il était caché au bout des onglets)
    const maxLoan = session.sim.economy.maxLoanEuros(s);
    const loanCard = h('div.loan-cta',
      h('div',
        h('strong', 'Financer un projet'),
        h('p', maxLoan > 0
          ? `Vous pouvez emprunter jusqu'à ${formatMoney(maxLoan * 100)} (note ${session.sim.economy.creditRating(s).grade}, taux ${(session.sim.economy.loanRate(s, 'annuity') * 100).toFixed(2).replace('.', ',')} %).`
          : 'Capacité d\'emprunt épuisée : remboursez ou améliorez l\'épargne brute pour emprunter à nouveau.')),
      h('button.btn.primary', { type: 'button', disabled: !this.onPanel, on: { click: () => this.onPanel?.('finance', 'loans') } }, 'Emprunter'));
    return [
      loanCard,
      h('div.kpis',
        kpi('Trésorerie', formatMoney(eco.treasury), eco.monthsNegative ? `négative depuis ${eco.monthsNegative} mois` : null, eco.treasury < 0 ? 'neg' : ''),
        kpi('Recettes du dernier mois', last ? formatMoney(last.revenues) : '—'),
        kpi('Charges de fonctionnement', last ? formatMoney(last.opex) : '—'),
        kpi('Résultat opérationnel', last ? formatMoney(last.operatingResult) : '—', 'recettes − charges', last && last.operatingResult < 0 ? 'neg' : 'pos'),
        savingsKpi(s),
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
          all.some((p) => p.grants) ? line('Dotations de l\'État (nouveau statut)', all.map((p) => p.grants ?? 0)) : null,
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
    const eff = effectiveTaxes(s);
    const rows = Object.entries(TAX_LABELS).map(([k, [label, unit]]) => {
      const value = eco.taxes[k];
      // Bases imposées au taux de leur quartier (v0.8) quand des écarts existent
      const est = eff !== eco.taxes && eff[k] !== undefined && k !== 'property' ? (bases[k] * eff[k]) / 100 : (bases[k] * value) / 100;
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
      const effNote = eff !== eco.taxes && k !== 'property' && Math.abs((eff[k] ?? value) - value) >= 0.05 ? ` · taux moyen payé ${String(eff[k]).replace('.', ',')} %` : '';
      return h('div.slider-row', h('label', label, h('small', unit + effNote)), input, out, h('span.est', a.days ? `≈ ${formatMoney(Math.round(est * 100))}/mois` : '—'));
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
      h('p.hint', 'Chaque impôt s\'applique à une base taxable calculée par la simulation. Au-delà de 9 %, la fiscalité pèse sur la demande et sur la satisfaction des habitants. Taux différents selon les quartiers : onglet Quartiers.'),
      h('div.sliders', rows),
      h('h3', 'Tarifs des services publics'),
      h('div.sliders', tariffRows),
      h('p.hint', 'Estimations sur la base du mois en cours, à niveau d\'activité constant.')
    ];
  }

  /**
   * Échanges régionaux (v0.8 : marché à prix variables) : vente des excédents, achats en cas de pénurie, traitement
   * extérieur des déchets, cours du mois, événements régionaux et contrats à prix fixe.
   */
  #trade(session, rerender) {
    const s = session.state;
    const M = session.sim.market.ensure(s);
    const eur = (v) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
    const pw = s.utilities.power ?? {};
    const wa = s.utilities.water ?? {};
    const ws = s.waste.stats ?? {};
    const month = Math.floor(s.time.tick / SIM.DAYS_PER_MONTH);
    const toggle = (resource, side, label) =>
      h('label.check.trade-toggle',
        h('input', {
          type: 'checkbox',
          checked: !!s.trade[resource][side],
          on: { change: (e) => { this.execute({ type: 'trade', resource, side, enabled: e.target.checked }); rerender(); } }
        }),
        label);
    const price = (good, side) => marketPrice(s, good, side);
    const ref = (good, side) => SIM.TRADE[good][side];
    const priceLine = (good, side, label) => {
      const p = price(good, side);
      const d = p / ref(good, side) - 1;
      const c = M.contracts[`${good}:${side}`];
      return h('div.market-price',
        h('span', label),
        h('strong', `${eur(p)} / u.`),
        h('span.delta', { class: Math.abs(d) < 0.02 ? '' : (side === 'sell') === d > 0 ? 'pos' : 'neg' }, `${d >= 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)} % / référence`),
        c && month < c.until ? h('small', `prix du contrat (jusqu'en ${monthLabel(c.until)})`) : null);
    };
    const perMonth = (good, side, units) => `${formatMoney(Math.round(units * price(good, side) * 100))} / mois`;
    const contract = (good, side) => {
      const key = `${good}:${side}`;
      const c = M.contracts[key];
      const what = side === 'buy' ? 'd\'achat' : 'de vente';
      if (c && month < c.until) {
        const penalty = contractPenaltyCents(s, good, side);
        return h('div.contract-box',
          h('div.kv', h('span', `Contrat ${what} à prix fixe`), h('strong', `${eur(c.price)} / u. jusqu'en ${monthLabel(c.until)}`)),
          h('div.kv', h('span', 'Gain ou perte par rapport au marché'), h('strong', { class: (c.gainCents ?? 0) >= 0 ? 'pos' : 'neg' }, formatMoney(c.gainCents ?? 0))),
          h('button.btn.small.danger', {
            type: 'button',
            on: {
              click: async () => {
                if (!(await confirmDialog(`Résilier le contrat ? Indemnité : ${formatMoney(penalty)}.`, { confirmLabel: 'Résilier', danger: true }))) return;
                const r = this.execute({ type: 'contract', good, side, enabled: false });
                this.notify(r.ok ? 'info' : 'warning', r.ok ? `Contrat résilié (indemnité ${formatMoney(r.penalty)})` : r.reason);
                rerender();
              }
            }
          }, `Résilier (${formatMoney(penalty, { compact: true })})`));
      }
      const offer = contractOffer(s, good, side);
      const lock = featureUnlocked(s, 'fixedContracts');
      if (!lock.ok) return h('div.contract-box', h('small', lock.reason));
      return h('div.contract-box',
        h('div.kv', h('span', `Contrat ${what} sur ${CONTRACT_MONTHS} mois`), h('strong', `${eur(offer)} / u.`)),
        h('small', side === 'buy' ? 'Prix fixe, prime de 5 % : protège des flambées (vague de froid, sécheresse).' : 'Prix fixe, décote de 5 % : protège des chutes de prix (surproduction).'),
        h('button.btn.small', {
          type: 'button',
          on: { click: () => { const r = this.execute({ type: 'contract', good, side, enabled: true }); this.notify(r.ok ? 'success' : 'warning', r.ok ? `Contrat signé à ${eur(r.price)} / u. pour ${CONTRACT_MONTHS} mois` : r.reason); rerender(); } }
        }, 'Signer'));
    };
    const card = ({ title, situation, balance, toggles, prices, flows, contracts, connected }) =>
      h('section.trade-card',
        h('h3', title),
        h('div.kv', h('span', 'Situation'), h('strong', { class: balance < 0 ? 'neg' : 'pos' }, situation)),
        connected === false ? h('p.hint.neg', "Aucun réseau de la ville n'est relié à l'accès autoroutier : échanges impossibles.") : null,
        prices,
        h('div.trade-toggles', toggles),
        flows,
        h('details', h('summary', 'Contrats à prix fixe'), contracts));
    const pBalance = (pw.capacity ?? 0) - (pw.demand ?? 0);
    const wBalance = (wa.capacity ?? 0) - (wa.demand ?? 0);
    const ev = M.event ? MARKET_EVENTS[M.event.kind] : null;
    const hist = M.history.slice(-24);
    return [
      h('p.hint', "Les réseaux reliés à l'accès autoroutier peuvent échanger avec la région. Les prix suivent le marché régional : saison (électricité chère en hiver, eau chère en été), conjoncture et événements. Vendre beaucoup fait baisser le prix moyen obtenu, acheter beaucoup le fait monter. L'interconnexion couvre au plus 60 % des besoins."),
      ev ? h('p.demand-warn', `${ev.mult > 1 ? '⚠' : 'ℹ'} ${ev.label} en cours jusqu'en ${monthLabel(M.event.until)} : prix ${ev.good === 'water' ? 'de l\'eau' : 'de l\'électricité'} ×${String(ev.mult).replace('.', ',')}.`) : null,
      h('div.trade-grid',
        card({
          title: 'Électricité',
          situation: pBalance >= 0 ? `excédent de ${formatNumber(pBalance, 0)} u.` : `déficit de ${formatNumber(-pBalance, 0)} u.`,
          balance: pBalance,
          connected: pw.connected,
          prices: [priceLine('power', 'sell', 'Prix de vente'), priceLine('power', 'buy', 'Prix d\'achat')],
          toggles: [toggle('power', 'sell', 'Vendre les excédents'), toggle('power', 'buy', 'Acheter en cas de pénurie')],
          flows: [
            h('div.kv', h('span', 'Vendu à la région'), h('strong.pos', `${formatNumber(pw.exported ?? 0, 0)} u. · ${perMonth('power', 'sell', pw.exported ?? 0)}`)),
            h('div.kv', h('span', 'Acheté à la région'), h('strong', { class: pw.imported ? 'neg' : '' }, `${formatNumber(pw.imported ?? 0, 0)} u. · ${perMonth('power', 'buy', pw.imported ?? 0)}`)),
            h('p.small', `Les habitants paient ${eur(s.economy.tariffs.power)} / u. : chaque unité achetée à la région est revendue à perte.`)
          ],
          contracts: [contract('power', 'sell'), contract('power', 'buy')]
        }),
        card({
          title: 'Eau potable',
          situation: wBalance >= 0 ? `excédent de ${formatNumber(wBalance, 0)} u.` : `déficit de ${formatNumber(-wBalance, 0)} u.`,
          balance: wBalance,
          connected: wa.connected,
          prices: [priceLine('water', 'sell', 'Prix de vente'), priceLine('water', 'buy', 'Prix d\'achat')],
          toggles: [toggle('water', 'sell', 'Vendre les excédents'), toggle('water', 'buy', 'Acheter en cas de pénurie')],
          flows: [
            h('div.kv', h('span', 'Vendue à la région'), h('strong.pos', `${formatNumber(wa.exported ?? 0, 0)} u. · ${perMonth('water', 'sell', wa.exported ?? 0)}`)),
            h('div.kv', h('span', 'Achetée à la région'), h('strong', { class: wa.imported ? 'neg' : '' }, `${formatNumber(wa.imported ?? 0, 0)} u. · ${perMonth('water', 'buy', wa.imported ?? 0)}`))
          ],
          contracts: [contract('water', 'sell'), contract('water', 'buy')]
        }),
        card({
          title: 'Déchets',
          situation: ws.limitedBy === 'processing' ? 'capacité de traitement insuffisante' : ws.limitedBy === 'coverage' ? 'collecte incomplète' : ws.limitedBy === 'collection' ? 'bennes insuffisantes' : 'tout est traité',
          balance: ws.limitedBy ? -1 : 1,
          prices: [priceLine('waste', 'buy', 'Prix du traitement extérieur')],
          toggles: [toggle('waste', 'buy', 'Faire traiter le surplus hors de la ville')],
          flows: [
            h('div.kv', h('span', 'Envoyé hors de la ville'), h('strong', { class: ws.exportedPerDay ? 'neg' : '' }, `${formatNumber(ws.exportedPerDay ?? 0, 0)} u./j · ${formatMoney(Math.round((ws.exportedPerDay ?? 0) * 30 * price('waste', 'buy') * 100))} / mois`)),
            h('p.small', 'Il faut toujours des bennes (centre de collecte) pour ramasser les déchets.')
          ],
          contracts: [contract('waste', 'buy')]
        })
      ),
      h('h3', 'Cours du marché régional (prix d\'achat, € par unité)'),
      lineChart({
        labels: hist.map((x) => monthLabel(x.month)),
        series: [
          { label: 'Électricité', color: '#f2c230', values: hist.map((x) => x.power.buy) },
          { label: 'Eau', color: '#6ec6ff', values: hist.map((x) => x.water.buy) },
          { label: 'Traitement des déchets', color: '#a3d977', values: hist.map((x) => x.waste.buy) }
        ],
        format: (v) => eur(v)
      }),
      h('p.hint', `Cours de référence : électricité ${eur(SIM.TRADE.power.buy)} à l'achat et ${eur(SIM.TRADE.power.sell)} à la vente ; eau ${eur(SIM.TRADE.water.buy)} et ${eur(SIM.TRADE.water.sell)} ; déchets ${eur(SIM.TRADE.waste.buy)}. Nouveaux cours chaque mois.`)
    ];
  }

  #loans(session, rerender) {
    const s = session.state;
    const econ = session.sim.economy;
    const cap = econ.debtCapacity(s);
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
    // v1.0 : les profils in fine et à amortissement constant arrivent au statut « Bourg »
    const profiles = featureUnlocked(s, 'loanProfiles');
    const type = h('select', { 'aria-label': 'Profil de remboursement', title: profiles.ok ? '' : profiles.reason },
      Object.entries(LOAN_TYPES).map(([id, t]) => h('option', { value: id, disabled: !profiles.ok && id !== 'annuity' }, profiles.ok || id === 'annuity' ? t.label : `${t.label} (statut Bourg)`)));
    const preview = h('p.hint');
    const rateOut = h('strong');
    const updatePreview = () => {
      const P = Number(amount.value) * 100;
      const n = Number(months.value);
      const rate = econ.loanRate(s, type.value);
      rateOut.textContent = `${(rate * 100).toFixed(2)} %`;
      if (!(P > 0)) {
        preview.textContent = '';
        return;
      }
      const pv = loanPreview(Math.round(P), rate, n, type.value);
      const t = LOAN_TYPES[type.value];
      preview.textContent = `${t.desc} Première échéance : ${formatMoney(pv.first)}${type.value === 'annuity' ? '' : ` — dernière : ${formatMoney(pv.last)}`} — coût total des intérêts : ${formatMoney(pv.interest)}.`;
    };
    amount.addEventListener('input', updatePreview);
    months.addEventListener('change', updatePreview);
    type.addEventListener('change', updatePreview);
    updatePreview();
    const loans = s.economy.loans;
    // Échéancier agrégé des 12 prochains mois et profil d'extinction annuel
    const horizon = Math.max(0, ...loans.map((l) => l.monthsLeft));
    const byMonth = Array.from({ length: Math.min(12, horizon) }, () => ({ interest: 0, principal: 0 }));
    const years = Array.from({ length: Math.ceil(horizon / 12) }, () => ({ interest: 0, principal: 0, end: 0 }));
    for (const l of loans) {
      for (const row of loanSchedule(l)) {
        if (row.month <= 12) {
          byMonth[row.month - 1].interest += row.interest;
          byMonth[row.month - 1].principal += row.principal;
        }
        const y = years[Math.floor((row.month - 1) / 12)];
        y.interest += row.interest;
        y.principal += row.principal;
      }
    }
    let remaining = loans.reduce((a, l) => a + l.remaining, 0);
    for (const y of years) {
      remaining -= y.principal;
      y.end = remaining;
    }
    const startMonth = Math.floor(s.time.tick / SIM.DAYS_PER_MONTH) + 1;
    const repay = (l) => h('button.btn.small', {
      type: 'button',
      title: `Indemnité : ${formatMoney(econ.prepaymentPenalty(l))}`,
      disabled: s.economy.treasury < l.remaining + econ.prepaymentPenalty(l),
      on: {
        click: async () => {
          const pen = econ.prepaymentPenalty(l);
          if (!(await confirmDialog(`Rembourser par anticipation l'emprunt n°${l.id} : ${formatMoney(l.remaining)} de capital et ${formatMoney(pen)} d'indemnité ?`, { confirmLabel: 'Rembourser' }))) return;
          const r = this.execute({ type: 'repayLoan', loanId: l.id });
          this.notify(r.ok ? 'success' : 'warning', r.ok ? `Emprunt n°${l.id} remboursé (indemnité ${formatMoney(r.penalty)})` : r.reason);
          rerender();
        }
      }
    }, 'Rembourser');
    return [
      h('div.kpis',
        h('div.kpi', h('span', 'Capacité d\'emprunt'), h('strong', formatMoney(cap))),
        h('div.kpi', h('span', 'Taux proposé'), rateOut, h('small', 'taux fixe annuel, selon le profil')),
        h('div.kpi.credit', h('span', 'Note de la dette'), h('strong', { class: `grade grade-${gradeClass(rating.grade)}` }, rating.grade), h('small', rating.provisional ? 'note provisoire (aucun mois clos)' : `score ${rating.score}/100`))
      ),
      creditDetails(rating),
      h('form.loan-form', { on: { submit: (e) => {
        e.preventDefault();
        const r = this.execute({ type: 'loan', amountEuros: Number(amount.value), months: Number(months.value), loanType: type.value });
        this.notify(r.ok ? 'success' : 'warning', r.ok ? `Emprunt souscrit : ${formatMoney(r.loan.principal)} (${LOAN_TYPES[r.loan.type].short})` : r.reason);
        rerender();
      } } },
        h('label', 'Montant (€)', h('span.loan-amount', amount, maxBtn)), h('label', 'Durée', months), h('label', 'Remboursement', type), h('button.btn.primary', { type: 'submit', disabled: maxEuros <= 0 }, 'Emprunter')
      ),
      preview,
      loans.length
        ? h('div.table-wrap', h('table.fin',
          h('thead', h('tr', h('th', 'Emprunt'), h('th', 'Profil'), h('th.num', 'Capital initial'), h('th.num', 'Restant dû'), h('th.num', 'Taux'), h('th.num', 'Prochaine échéance'), h('th.num', 'Mois restants'), h('th', ''))),
          h('tbody', loans.map((l) => {
            const next = loanSchedule(l, 1)[0];
            return h('tr', h('td', `n°${l.id}`), h('td', LOAN_TYPES[l.type ?? 'annuity'].label), money(l.principal), money(l.remaining), h('td.num', `${(l.rateAnnual * 100).toFixed(2)} %`), money(next ? next.interest + next.principal : 0), h('td.num', String(l.monthsLeft)), h('td', h('div.loan-actions', repay(l))));
          }))))
        : h('p.empty', 'Aucun emprunt en cours.'),
      loans.length ? [
        h('h3', 'Échéancier des 12 prochains mois'),
        h('div.table-wrap', h('table.fin.compact.schedule-table',
          h('thead', h('tr', h('th', ''), byMonth.map((_, k) => h('th.num', monthLabel(startMonth + k))))),
          h('tbody',
            h('tr', h('td', 'Intérêts'), byMonth.map((m) => money(m.interest))),
            h('tr', h('td', 'Capital'), byMonth.map((m) => money(m.principal))),
            h('tr.total', h('td', 'Total'), byMonth.map((m) => money(m.interest + m.principal)))))),
        h('h3', 'Profil d\'extinction de la dette'),
        h('div.table-wrap', h('table.fin.compact.schedule-table',
          h('thead', h('tr', h('th', 'Année'), h('th.num', 'Intérêts'), h('th.num', 'Capital remboursé'), h('th.num', 'Dette en fin d\'année'))),
          h('tbody', years.map((y, k) => h('tr', h('td', `${SIM.START_YEAR + Math.floor((startMonth + k * 12) / 12)}`), money(y.interest), money(y.principal), money(y.end)))))),
        h('p.hint', 'Remboursement anticipé : indemnité de six mois d\'intérêts, au plus 3 % du capital remboursé. Un emprunt in fine demande de provisionner son capital : une alerte prévient trois mois avant l\'échéance.')
      ] : null
    ];
  }

  /** Fiscalité par quartier (v0.8) : carte des quartiers de la commune et écarts de taux. */
  #districts(session, rerender) {
    const s = session.state;
    const list = districtList(s);
    const land = landOf(s);
    if (!this.district || !list.some((d) => d.key === this.district)) this.district = list[0]?.key ?? null;
    const sel = list.find((d) => d.key === this.district);
    const byKey = new Map(list.map((d) => [d.key, d]));
    const x0 = land.box.x0;
    const y0 = land.box.y0;
    const nx = land.box.x1 - x0 + 1;
    const ny = land.box.y1 - y0 + 1;
    const cells = [];
    for (let gy = y0; gy < y0 + ny; gy++) {
      for (let gx = x0; gx < x0 + nx; gx++) {
        const d = byKey.get(`${gx},${gy}`);
        if (!d) {
          cells.push(h('div.district-cell.empty'));
          continue;
        }
        const avg = (d.tax.R + d.tax.C + d.tax.O + d.tax.I) / 4;
        cells.push(h('button.district-cell', {
          type: 'button',
          class: [d.key === this.district ? 'active' : '', avg < -0.05 ? 'lower' : avg > 0.05 ? 'higher' : ''].join(' '),
          title: `${d.name} — ${formatNumber(d.residents, 0)} habitants`,
          on: { click: () => { this.district = d.key; rerender(); } }
        }, h('span', d.name), h('small', d.residents ? `${formatNumber(d.residents, 0)} hab.` : '—')));
      }
    }
    const t = s.economy.taxes;
    const editor = sel ? h('section.district-editor',
      h('h3',
        h('input.line-name', { type: 'text', value: sel.name, maxLength: 32, 'aria-label': 'Nom du quartier', on: { change: (e) => { this.execute({ type: 'districtName', key: sel.key, name: e.target.value }); rerender(); } } }),
        h('small', `${formatNumber(sel.residents, 0)} habitants · ${formatNumber(sel.jobs, 0)} emplois · satisfaction ${sel.satisfaction ?? '—'}`)),
      h('div.sliders', SECTORS.map((k) => {
        const delta = sel.tax[k] ?? 0;
        const out = h('output', fmtDelta(delta, t[k]));
        return h('div.slider-row',
          h('label', TAX_LABELS[k][0], h('small', `taux de la commune ${String(t[k]).replace('.', ',')} %`)),
          h('input', {
            type: 'range', min: -TAX_DELTA_MAX, max: TAX_DELTA_MAX, step: 0.5, value: delta, 'aria-label': `${TAX_LABELS[k][0]} — écart du quartier`,
            on: {
              input: (e) => (out.textContent = fmtDelta(Number(e.target.value), t[k])),
              change: (e) => { this.execute({ type: 'districtTax', key: sel.key, sector: k, value: Number(e.target.value) }); rerender(); }
            }
          }),
          out);
      })),
      h('p.hint', 'Un quartier moins taxé attire les constructions de ce secteur (jusqu\'à +35 % à −5 points) et ses habitants sont plus satisfaits ; un quartier plus taxé rapporte davantage mais se développe moins vite. La demande et la popularité suivent le taux moyen effectivement payé.')
    ) : h('p.empty', 'Aucun quartier.');
    const lock = featureUnlocked(s, 'districtTax');
    return [
      lock.ok ? null : h('p.hint.neg', `${lock.reason}. Les écarts déjà fixés peuvent être remis à zéro.`),
      h('p.hint', `Chaque parcelle de 32 × 32 cases de la commune forme un quartier (${list.length} quartier${list.length > 1 ? 's' : ''}). Choisissez un quartier pour ajuster ses taux par rapport à ceux de la commune (de −${TAX_DELTA_MAX} à +${TAX_DELTA_MAX} points). La couche « Fiscalité par quartier » montre les écarts sur la carte.`),
      h('div.district-map', { style: { gridTemplateColumns: `repeat(${Math.min(WORLD_PARCELS, nx)}, minmax(0, 72px))` } }, cells),
      editor,
      h('div.table-wrap', h('table.fin.compact',
        h('thead', h('tr', h('th', 'Quartier'), h('th.num', 'Habitants'), h('th.num', 'Emplois'), h('th.num', 'Satisfaction'), ...SECTORS.map((k) => h('th.num', k === 'R' ? 'Hab.' : k === 'C' ? 'Com.' : k === 'O' ? 'Bur.' : 'Ind.')))),
        h('tbody', list.map((d) => h('tr', { class: d.key === this.district ? 'strong' : '' },
          h('td', d.name), h('td.num', formatNumber(d.residents, 0)), h('td.num', formatNumber(d.jobs, 0)), h('td.num', d.satisfaction ?? '—'),
          ...SECTORS.map((k) => h('td.num', { class: d.tax[k] > 0 ? 'neg' : d.tax[k] < 0 ? 'pos' : '' }, d.tax[k] ? `${d.tax[k] > 0 ? '+' : '−'}${String(Math.abs(d.tax[k])).replace('.', ',')}` : '0')))))))
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

/** Écart de taux d'un quartier, avec le taux résultant. */
function fmtDelta(delta, base) {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  return `${sign}${String(Math.abs(delta)).replace('.', ',')} pt → ${String(Math.max(0, Math.round((base + delta) * 10) / 10)).replace('.', ',')} %`;
}
