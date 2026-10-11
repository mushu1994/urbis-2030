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
    const demand = h(
      'div.hud-demand',
      { title: 'Demande par secteur' },
      DEMANDS.map(([k, label, color]) => {
        const bar = h('div.demand-fill', { style: { background: color } });
        this.demandBars[k] = bar;
        return h('div.demand-col', { title: label }, h('div.demand-track', bar), h('span', k === 'O' ? 'B' : k));
      })
    );
    this.alerts = h('button.hud-alerts', { on: { click: () => actions.onOpenPanel('city') }, title: 'Alertes — ouvrir le tableau de bord de la ville' });
    this.undo = h('button.hud-icon', { title: 'Annuler la dernière action (Ctrl+Z)', 'aria-label': 'Annuler', on: { click: actions.onUndo } }, icon('undo', 17));
    this.mute = h('button.hud-icon.hud-mute', { title: 'Couper le son (N)', 'aria-label': 'Couper le son', 'aria-pressed': 'false', on: { click: () => actions.onMute?.() } }, icon('sound', 17));
    this.fullscreen = h('button.hud-icon.hud-fullscreen', { title: 'Plein écran (F)', 'aria-label': 'Plein écran', 'aria-pressed': 'false', on: { click: actions.onFullscreen } }, icon('expand', 17));

    root.append(
      this.cityName,
      h('div.hud-group.hud-time', h('div.hud-dateline', this.date, this.weather), h('div.hud-speeds', this.speedBtns)),
      h('button.hud-group.hud-money', { on: { click: () => actions.onOpenPanel('finance') }, title: 'Finances (B)' }, h('span.hud-label', 'Trésorerie'), this.treasury, this.net),
      h('div.hud-break', { 'aria-hidden': 'true' }),
      h('button.hud-group.hud-pop', { on: { click: () => actions.onOpenPanel('city') }, title: 'Ville (C)' }, h('span.hud-label', 'Habitants'), this.population, this.popSub),
      demand,
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
    this.mute.title = muted ? 'Rétablir le son (N)' : 'Couper le son (N)';
    this.mute.setAttribute('aria-label', this.mute.title);
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
    const s = state.stats;
    this.population.textContent = formatNumber(s.population);
    this.popSub.textContent = `chômage ${(s.unemploymentRate * 100).toFixed(1)} %`;
    for (const [k] of DEMANDS) {
      const v = state.demand[k];
      const bar = this.demandBars[k];
      const pct = Math.min(50, Math.abs(v) / 2);
      bar.style.height = `${pct}%`;
      bar.style.bottom = v >= 0 ? '50%' : `${50 - pct}%`;
      bar.style.opacity = v >= 0 ? '1' : '0.45';
      bar.parentElement.parentElement.title = `${bar.parentElement.parentElement.title.split(' :')[0]} : ${v.toFixed(0)}`;
    }
    const alerts = [];
    const p = state.utilities.power;
    const w = state.utilities.water;
    if (p.unpoweredBuildings) alerts.push(`${p.unpoweredBuildings} sans électricité`);
    if (w.unwateredBuildings) alerts.push(`${w.unwateredBuildings} sans eau`);
    if (s.abandoned) alerts.push(`${s.abandoned} abandonnés`);
    if (eco.treasury < 0) alerts.push('trésorerie négative');
    for (const c of state.crises?.active ?? []) alerts.unshift(`${CRISIS_TYPES[c.kind]?.icon ?? ''} ${CRISIS_TYPES[c.kind]?.name ?? c.kind}`);
    this.alerts.textContent = alerts.length ? `⚠ ${alerts[0]}${alerts.length > 1 ? ` (+${alerts.length - 1})` : ''}` : 'Aucune alerte';
    this.alerts.classList.toggle('warn', alerts.length > 0);
    this.undo.disabled = !canUndo;
  }
}
