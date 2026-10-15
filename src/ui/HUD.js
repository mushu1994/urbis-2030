import { h, icon } from './dom.js';
import { formatMoney, formatNumber } from '../util/money.js';
import { formatDate } from '../simulation/config.js';
import { SPEEDS } from '../simulation/SimulationClock.js';
import { EconomySystem } from '../simulation/EconomySystem.js';
import { WEATHER, SEASONS } from '../simulation/WeatherSystem.js';
import { CRISIS_TYPES } from '../simulation/CrisisSystem.js';

const DEMANDS = [
  ['R', 'Résidentiel', 'var(--zone-r)'],
  ['C', 'Commerce', 'var(--zone-c)'],
  ['O', 'Bureaux', 'var(--zone-o)'],
  ['I', 'Industrie', 'var(--zone-i)']
];

/**
 * Barre supérieure permanente : trésorerie, résultat, population, demande par secteur, temps, alertes.
 * Lecture seule : les actions passent par les callbacks fournis par GameApp.
 */
export class HUD {
  /**
   * @param {HTMLElement} root
   * @param {{onSpeed:(i:number)=>void, onMenu:()=>void, onUndo:()=>void, onOpenPanel:(id:string)=>void, onFullscreen:()=>void}} actions
   */
  constructor(root, actions) {
    this.actions = actions;
    this.cityName = h('button.hud-city', { on: { click: actions.onMenu }, title: 'Menu (M)' }, icon('menu', 16), h('span'));
    this.date = h('div.hud-date');
    this.weather = h('button.hud-weather', { type: 'button', title: 'Météo — ouvrir les risques et la météo', on: { click: () => actions.onWeather?.() } });
    this.speedBtns = SPEEDS.map((s, i) =>
      h('button.hud-speed', { title: `${s.label} (${i === 0 ? 'Espace' : i})`, 'aria-label': s.label, on: { click: () => actions.onSpeed(i) } }, icon(['pause', 'play', 'fast', 'ultra'][i], 15))
    );
    this.treasury = h('strong.hud-value');
    this.net = h('span.hud-sub');
    this.population = h('strong.hud-value');
    this.popSub = h('span.hud-sub');
    this.demandBars = {};
    this.demandNums = {};
    // Jauges de demande (v0.4 : plus grandes, cliquables → panneau « Besoins de la ville »)
    const demand = h(
      'div.hud-demand',
      { title: 'Besoins de la ville — cliquer pour le détail' },
      DEMANDS.map(([k, label, color]) => {
        const bar = h('div.demand-fill', { style: { background: color } });
        this.demandBars[k] = bar;
        const num = h('b.demand-num');
        this.demandNums[k] = num;
        return h('button.demand-col', {
          type: 'button',
          title: label,
          'aria-label': `Demande ${label} : détail`,
          dataset: { label },
          on: { click: () => actions.onDemand?.(k) }
        }, h('span', k === 'O' ? 'B' : k), h('div.demand-track', bar), num);
      })
    );
    // v0.7 : popularité du maire et compte à rebours des municipales → panneau « Mairie et élections »
    this.approval = h('strong.hud-value');
    this.approvalSub = h('span.hud-sub');
    this.approvalBtn = h('button.hud-group.hud-approval', { type: 'button', title: 'Mairie et élections (E)', on: { click: () => actions.onOpenPanel('politics') } }, h('span.hud-label', 'Popularité'), this.approval, this.approvalSub);
    /** Type de la première alerte affichée : le bouton mène directement au problème. */
    this.alertKind = null;
    this.alerts = h('button.hud-alerts', {
      on: { click: () => (actions.onAlert ? actions.onAlert(this.alertKind) : actions.onOpenPanel('city')) },
      title: 'Alertes — cliquer pour aller au problème le plus proche'
    });
    this.undo = h('button.hud-icon', { title: 'Annuler la dernière action (Ctrl+Z)', 'aria-label': 'Annuler', on: { click: actions.onUndo } }, icon('undo', 17));
    this.mute = h('button.hud-icon.hud-mute', { title: 'Réglages du son (N : couper)', 'aria-label': 'Réglages du son', 'aria-pressed': 'false', on: { click: () => actions.onMute?.() } }, icon('sound', 17));
    this.fullscreen = h('button.hud-icon.hud-fullscreen', { title: 'Plein écran (F)', 'aria-label': 'Plein écran', 'aria-pressed': 'false', on: { click: actions.onFullscreen } }, icon('expand', 17));

    root.append(
      this.cityName,
      h('div.hud-group.hud-time', h('div.hud-dateline', this.date, this.weather), h('div.hud-speeds', this.speedBtns)),
      h('button.hud-group.hud-money', { on: { click: () => actions.onOpenPanel('finance') }, title: 'Finances (B)' }, h('span.hud-label', 'Trésorerie'), this.treasury, this.net),
      h('div.hud-break', { 'aria-hidden': 'true' }),
      h('button.hud-group.hud-pop', { on: { click: () => actions.onOpenPanel('city') }, title: 'Ville (C)' }, h('span.hud-label', 'Habitants'), this.population, this.popSub),
      demand,
      this.approvalBtn,
      h('div.hud-spacer'),
      this.alerts,
      this.undo,
      this.mute,
      this.fullscreen
    );
  }

  setMuted(muted) {
    this.mute.replaceChildren(icon(muted ? 'mute' : 'sound', 17));
    this.mute.setAttribute('aria-pressed', String(muted));
    this.mute.title = muted ? 'Réglages du son — son coupé (N : rétablir)' : 'Réglages du son (N : couper)';
  }

  /** Met à jour l'icône du bouton plein écran. */
  setFullscreen(active) {
    this.fullscreen.replaceChildren(icon(active ? 'shrink' : 'expand', 17));
    this.fullscreen.setAttribute('aria-pressed', String(active));
    this.fullscreen.title = active ? 'Quitter le plein écran (F)' : 'Plein écran (F)';
    this.fullscreen.setAttribute('aria-label', this.fullscreen.title);
  }

  /** @param {import('../app/GameState.js').GameState} state */
  update(state, { speedIndex, canUndo }) {
    this.cityName.lastChild.textContent = state.meta.name;
    this.date.textContent = formatDate(state.time.tick);
    const wx = state.weather;
    if (wx) {
      const info = WEATHER[wx.kind] ?? WEATHER.clear;
      const month = Math.floor(state.time.tick / 30) % 12;
      const text = `${info.icon} ${Math.round(wx.temp)}°`;
      if (this.weather.textContent !== text) this.weather.textContent = text;
      this.weather.title = `${info.label}, ${String(wx.temp).replace('.', ',')} °C — ${SEASONS[month]}. Cliquer pour les effets sur la ville.`;
      this.weather.setAttribute('aria-label', `Météo : ${info.label}, ${Math.round(wx.temp)} degrés`);
    }
    this.speedBtns.forEach((b, i) => b.classList.toggle('active', i === speedIndex));
    const eco = state.economy;
    this.treasury.textContent = formatMoney(eco.treasury, { compact: true });
    this.treasury.classList.toggle('neg', eco.treasury < 0);
    const last = EconomySystem.summarize(eco.periods.at(-1));
    if (last) {
      this.net.textContent = `${formatMoney(last.cashChange, { compact: true, sign: true })} / mois`;
      this.net.className = `hud-sub ${last.cashChange < 0 ? 'neg' : 'pos'}`;
    } else {
      this.net.textContent = 'premier mois en cours';
      this.net.className = 'hud-sub';
    }
    const pol = state.politics;
    if (pol) {
      const a = `${Math.round(pol.approval)} %`;
      if (this.approval.textContent !== a) this.approval.textContent = a;
      this.approval.classList.toggle('neg', pol.approval < 45);
      this.approval.classList.toggle('pos', pol.approval >= 55);
      const left = pol.nextElection - Math.floor(state.time.tick / 30);
      const sub = !pol.enabled ? 'sans élections' : pol.defeated ? 'battu(e)' : pol.campaign ? `🗳 vote dans ${Math.max(0, left)} mois` : left <= 24 ? `élection dans ${left} mois` : `${pol.mandate}${pol.mandate === 1 ? 'er' : 'e'} mandat`;
      if (this.approvalSub.textContent !== sub) this.approvalSub.textContent = sub;
      this.approvalBtn.classList.toggle('campaign', !!pol.campaign);
    }
    const s = state.stats;
    this.population.textContent = formatNumber(s.population);
    this.popSub.textContent = `chômage ${(s.unemploymentRate * 100).toFixed(1)} %`;
    for (const [k] of DEMANDS) {
      const v = state.demand[k];
      const bar = this.demandBars[k];
      // Jauge horizontale centrée sur zéro : à droite la demande, à gauche le recul
      const pct = Math.min(50, Math.abs(v) / 2);
      bar.style.width = `${pct}%`;
      bar.style.left = v >= 0 ? '50%' : `${50 - pct}%`;
      bar.style.opacity = v >= 0 ? '1' : '0.45';
      const n = `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}`;
      if (this.demandNums[k].textContent !== n) this.demandNums[k].textContent = n;
      this.demandNums[k].classList.toggle('neg', v < 0);
      const col = bar.parentElement.parentElement;
      const title = `${col.dataset.label} : ${v >= 0 ? '+' : ''}${v.toFixed(0)} — cliquer pour le détail`;
      if (col.title !== title) col.title = title;
    }
    const alerts = [];
    const p = state.utilities.power;
    const w = state.utilities.water;
    if (p.unpoweredBuildings) alerts.push(['power', `${p.unpoweredBuildings} sans électricité`]);
    if (w.unwateredBuildings) alerts.push(['water', `${w.unwateredBuildings} sans eau`]);
    if (s.abandoned) alerts.push(['abandoned', `${s.abandoned} abandonnés`]);
    if (eco.treasury < 0) alerts.push(['treasury', 'trésorerie négative']);
    for (const c of state.crises?.active ?? []) alerts.unshift(['crisis', `${CRISIS_TYPES[c.kind]?.icon ?? ''} ${CRISIS_TYPES[c.kind]?.name ?? c.kind}`]);
    this.alertKind = alerts[0]?.[0] ?? null;
    const text = alerts.length ? `⚠ ${alerts[0][1]}${alerts.length > 1 ? ` (+${alerts.length - 1})` : ''}` : 'Aucune alerte';
    const short = alerts.length ? `⚠ ${alerts.length}` : '';
    if (this.alerts.dataset.text !== text) {
      this.alerts.dataset.text = text;
      this.alerts.replaceChildren(h('span.alert-long', text), h('span.alert-short', short));
    }
    this.alerts.title = alerts.length
      ? `${alerts.map((a) => a[1]).join(' · ')}\n${{ power: 'Cliquer : aller au bâtiment sans électricité le plus proche (cliquer encore pour le suivant)', water: 'Cliquer : aller au bâtiment sans eau le plus proche (cliquer encore pour le suivant)', abandoned: 'Cliquer : aller au bâtiment abandonné le plus proche', treasury: 'Cliquer : ouvrir les finances', crisis: 'Cliquer : aller à la crise' }[this.alertKind]}`
      : 'Aucune alerte — ouvrir le tableau de bord de la ville';
    this.alerts.classList.toggle('warn', alerts.length > 0);
    this.undo.disabled = !canUndo;
  }
}
