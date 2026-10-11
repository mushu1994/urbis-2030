import { h } from './dom.js';
import { formatMoney, formatNumber } from '../util/money.js';
import { formatMonths } from '../simulation/ScenarioSystem.js';

/**
 * Bilan de fin de scénario (victoire ou échec), avec le choix de continuer la ville en partie libre.
 * @param {any} sc état du scénario terminé
 */
export function scenarioEndDialog(sc, { onContinue, onMenu }) {
  const won = sc.status === 'won';
  const backdrop = h('div.dialog-backdrop', { role: 'presentation' });
  const close = (fn) => {
    backdrop.remove();
    fn?.();
  };
  const r = sc.result ?? {};
  const box = h('div.dialog.scenario-end', { role: 'dialog', 'aria-modal': 'true', class: won ? 'won' : 'lost' },
    h('div.scenario-medal', { 'aria-hidden': 'true' }, won ? '★' : '✕'),
    h('h3', won ? 'Mission accomplie' : 'Mission échouée'),
    h('p.scenario-name', sc.name),
    h('p', won ? `Tous les objectifs sont atteints en ${formatMonths(r.months ?? 0)}.` : sc.reason ?? 'Les objectifs n\'ont pas été atteints à temps.'),
    h('dl.scenario-stats',
      h('dt', 'Habitants'), h('dd', `${formatNumber(sc.initial?.population ?? 0)} → ${formatNumber(r.population ?? 0)}`),
      h('dt', 'Trésorerie'), h('dd', `${formatMoney(sc.initial?.treasury ?? 0, { compact: true })} → ${formatMoney(r.treasury ?? 0, { compact: true })}`),
      h('dt', 'Satisfaction'), h('dd', `${sc.initial?.satisfaction ?? '–'} → ${r.satisfaction ?? '–'}`)
    ),
    h('div.dialog-actions',
      h('button.btn', { type: 'button', on: { click: () => close(onMenu) } }, 'Menu principal'),
      h('button.btn.primary', { type: 'button', on: { click: () => close(onContinue) } }, won ? 'Continuer en partie libre' : 'Continuer quand même')
    )
  );
  backdrop.append(box);
  document.body.append(backdrop);
  box.querySelector('.btn.primary')?.focus();
}
