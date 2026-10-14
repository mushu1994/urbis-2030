import { policyMonthlyCents } from '../simulation/EconomySystem.js';
import { h } from './dom.js';
import { meter } from './charts.js';
import { formatMoney, formatNumber } from '../util/money.js';
import { computeBalance, isInOutage } from '../simulation/Modifiers.js';
import { isUnlocked } from '../systems/ConstructionService.js';
import { formatDate } from '../simulation/config.js';

const FAMILY = { municipal: 'IA municipale', mobility: 'Mobilité autonome', logistics: 'Livraison autonome' };

const effectList = (effects) =>
  h('ul.effects', effects.map((e) => h('li', { class: e.side ? 'side' : 'gain' }, e.side ? '⚠ ' : '✓ ', e.label ?? `${e.key} ${e.value}`)));

/**
 * Technologies de 2030 et politiques publiques : coûts, effets attendus, risques, indicateurs mesurés.
 */
export class TechPanel {
  constructor({ execute, notify }) {
    this.id = 'ai';
    this.title = 'IA urbaine et politiques publiques';
    this.execute = execute;
    this.notify = notify;
    this.tabs = [
      { id: 'tech', label: 'Technologies' },
      { id: 'policies', label: 'Politiques' },
      { id: 'logistics', label: 'Logistique autonome' }
    ];
  }

  render(session, tab, rerender) {
    if (tab === 'policies') return this.#policies(session, rerender);
    if (tab === 'logistics') return this.#logistics(session);
    return this.#tech(session, rerender);
  }

  #tech(session, rerender) {
    const s = session.state;
    const cat = session.catalog;
    const compute = computeBalance(s, cat);
    const kpis = session.sim.ai.techKpis(s);
    const byFamily = new Map();
    for (const t of cat.technologies) {
      if (!byFamily.has(t.family)) byFamily.set(t.family, []);
      byFamily.get(t.family).push(t);
    }
    return [
      h('div.compute',
        h('div', h('strong', 'Ressources de calcul'), h('span', ` ${formatNumber(compute.demand)} utilisées / ${formatNumber(compute.supply)} disponibles`)),
        meter(compute.demand ? Math.min(1, compute.demand / Math.max(1, compute.supply)) : 0, { color: compute.ratio < 1 ? 'var(--bad)' : 'var(--ok)' }),
        h('p.hint', compute.ratio < 1
          ? `Capacité insuffisante : les gains des technologies sont réduits à ${Math.round(compute.ratio * 100)} %. Construisez un centre de données.`
          : 'Les centres de données alimentés et pourvus en personnel augmentent la capacité de calcul.')
      ),
      [...byFamily.entries()].map(([fam, techs]) => [
        h('h3', FAMILY[fam] ?? fam),
        h('div.cards', techs.map((t) => {
          const deployed = !!s.tech.researched[t.id];
          const outage = isInOutage(s, t.id);
          const check = session.sim.ai.canResearch(s, t.id);
          const status = outage ? h('span.badge.bad', `Incident jusqu'au ${formatDate(s.tech.outages[t.id])}`) : deployed ? h('span.badge.ok', 'Déployée') : null;
          return h('article.card', { class: deployed ? 'deployed' : '' },
            h('header', h('h4', t.name), status),
            h('p', t.description),
            h('div.card-costs',
              h('span', `Déploiement ${formatMoney(t.costCents)}`),
              h('span', `Exploitation ${formatMoney(t.upkeepCents)}/mois`),
              h('span', `Calcul ${t.compute} u.`)
            ),
            effectList(t.effects),
            t.unlocksBuildings?.length ? h('p.small', `Débloque : ${t.unlocksBuildings.map((id) => cat.building(id).name).join(', ')}`) : null,
            t.risks.length ? h('ul.effects', t.risks.map((r) => h('li.risk', `Risque : ${r.label} (${(r.monthlyChance * 100).toFixed(1)} % par mois, ${r.durationDays} j)`))) : null,
            deployed && kpis[t.id] ? h('dl.kpi-list', kpis[t.id].map((k) => [h('dt', k.label), h('dd', String(k.value))])) : null,
            h('footer',
              deployed
                ? h('button.btn', { on: { click: () => { this.execute({ type: 'decommission', techId: t.id }); rerender(); } } }, 'Désactiver')
                : h('button.btn.primary', { disabled: !check.ok, title: check.reasons.join(' · '), on: { click: () => { const r = this.execute({ type: 'research', techId: t.id }); if (!r.ok) this.notify('warning', r.reasons.join(', ')); rerender(); } } }, check.ok ? 'Déployer' : check.reasons[0])
            )
          );
        }))
      ])
    ];
  }

  #policies(session, rerender) {
    const s = session.state;
    return [
      h('p.hint', 'Les politiques ont un coût mensuel (une part fixe et une part par habitant) et des effets durables sur la ville. Elles peuvent être modifiées à tout moment, mais l\'opinion n\'aime pas les revirements : abroger une politique adoptée depuis moins d\'un an coûte un peu de popularité.'),
      h('div.cards', session.catalog.policies.map((p) => {
        const on = !!s.policies.active[p.id];
        const u = isUnlocked(s, p.unlock);
        return h('article.card', { class: on ? 'deployed' : '' },
          h('header', h('h4', p.name), on ? h('span.badge.ok', 'Active') : null),
          h('p', p.description),
          h('div.card-costs', h('span', `${formatMoney(policyMonthlyCents(p, s.stats.population))}/mois`), p.costPer1000Cents ? h('small', ` (${formatMoney(p.monthlyCostCents)} + ${formatMoney(p.costPer1000Cents)} par millier d'habitants)`) : null),
          effectList(p.effects.map((e) => ({ ...e, side: (e.op === 'add' && e.value < 0 && e.key.startsWith('satisfaction')) || e.key.startsWith('demand') || e.key.startsWith('growth') || (e.key === 'noise.traffic' && e.value > 0) }))),
          h('footer', h('button.btn', { class: on ? '' : 'primary', disabled: !u.ok, on: { click: () => { const r = this.execute({ type: 'policy', policyId: p.id, enabled: !on }); if (!r.ok) this.notify('warning', r.reason); rerender(); } } }, !u.ok ? u.reason : on ? 'Abroger' : 'Adopter'))
        );
      }))
    ];
  }

  #logistics(session) {
    const lg = session.state.logistics.stats ?? {};
    const sb = lg.servedBy ?? {};
    const total = lg.parcelsPerDay || 0;
    const share = (v) => (total ? `${Math.round((v / total) * 100)} %` : '—');
    const row = (label, v, sub) => h('tr', h('td', label), h('td.num', formatNumber(v ?? 0, 0)), h('td.num', sub ?? ''));
    return [
      h('div.kpis',
        h('div.kpi', h('span', 'Colis par jour'), h('strong', formatNumber(total, 0))),
        h('div.kpi', h('span', 'Part automatisée'), h('strong', `${Math.round((lg.automatedShare ?? 0) * 100)} %`)),
        h('div.kpi', h('span', 'Tournées routières évitées'), h('strong', formatNumber(lg.roadTripsAvoided ?? 0, 1)), h('small', 'par jour, net des navettes vers les hubs')),
        h('div.kpi', h('span', 'Délai moyen de livraison'), h('strong', `${(lg.avgDelayHours ?? 0).toFixed(1)} h`)),
        h('div.kpi', h('span', 'Hubs actifs'), h('strong', String(lg.hubs ?? 0)), h('small', `utilisation moyenne ${Math.round((lg.hubUtilization ?? 0) * 100)} %`)),
        h('div.kpi', h('span', 'Consommation des hubs'), h('strong', `${formatNumber(lg.hubPower ?? 0, 0)} u.`), h('small', 'électricité'))
      ),
      h('table.fin', h('thead', h('tr', h('th', 'Mode de livraison'), h('th.num', 'Colis/jour'), h('th.num', 'Part'))),
        h('tbody',
          row('Camionnettes depuis une plateforme locale', sb.van, share(sb.van)),
          row('Importé depuis l\'extérieur', sb.outside, share(sb.outside)),
          row('Vélos-cargos (micro-hubs)', sb.cargo, share(sb.cargo)),
          row('Robots terrestres', sb.robot, share(sb.robot)),
          row('Drones', sb.drone, share(sb.drone))
        )
      ),
      h('p.hint', 'Les plateformes logistiques locales réduisent les trajets depuis l\'extérieur. Les hubs suppriment des tournées de dernier kilomètre mais concentrent les camions d\'approvisionnement autour d\'eux, consomment de l\'électricité et, pour les drones, génèrent du bruit dans les zones de desserte.')
    ];
  }
}
