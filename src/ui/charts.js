import { h } from './dom.js';

/**
 * Graphique linéaire minimal sur canevas (séries réelles, sans dépendance).
 * @param {{series: {label:string, color:string, values:(number|null)[], dashed?:boolean}[], labels?:string[], height?:number, format?:(v:number)=>string, zeroLine?:boolean}} opts
 */
export function lineChart({ series, labels = [], height = 160, format = (v) => String(Math.round(v)), zeroLine = false }) {
  const wrap = h('div.chart');
  const canvas = h('canvas', { height, 'aria-label': series.map((s) => s.label).join(', ') });
  const legend = h('div.chart-legend', series.map((s) => h('span', h('i', { style: { background: s.color, borderStyle: s.dashed ? 'dashed' : 'solid' } }), s.label)));
  wrap.append(canvas, legend);
  requestAnimationFrame(() => {
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth || 520;
    canvas.width = w * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const all = series.flatMap((s) => s.values.filter((v) => v !== null && Number.isFinite(v)));
    if (!all.length) {
      ctx.fillStyle = '#9fb0bd';
      ctx.font = '13px Barlow, sans-serif';
      ctx.fillText('Pas encore de données : un mois de jeu est nécessaire.', 12, height / 2);
      return;
    }
    let min = Math.min(...all, zeroLine ? 0 : Infinity);
    let max = Math.max(...all, zeroLine ? 0 : -Infinity);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = { l: 64, r: 10, t: 10, b: 20 };
    const n = Math.max(...series.map((s) => s.values.length));
    const X = (i) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (w - pad.l - pad.r));
    const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (height - pad.t - pad.b);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.fillStyle = '#9fb0bd';
    ctx.font = '11px Barlow, sans-serif';
    for (let k = 0; k <= 3; k++) {
      const v = min + ((max - min) * k) / 3;
      const y = Y(v);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillText(format(v), 4, y + 4);
    }
    if (zeroLine && min < 0 && max > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(pad.l, Y(0));
      ctx.lineTo(w - pad.r, Y(0));
      ctx.stroke();
    }
    const step = Math.max(1, Math.ceil(labels.length / 8));
    labels.forEach((l, i) => {
      if (i % step === 0) ctx.fillText(l, X(i) - 12, height - 4);
    });
    for (const s of series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.setLineDash(s.dashed ? [5, 4] : []);
      ctx.beginPath();
      let started = false;
      s.values.forEach((v, i) => {
        if (v === null || !Number.isFinite(v)) return;
        if (!started) ctx.moveTo(X(i), Y(v));
        else ctx.lineTo(X(i), Y(v));
        started = true;
      });
      ctx.stroke();
    }
  });
  return wrap;
}

/** Barre horizontale de valeur (0..1). */
export function meter(value, { color = 'var(--ok)', label = '' } = {}) {
  const v = Math.max(0, Math.min(1, value || 0));
  return h('div.meter', { title: label }, h('div.meter-fill', { style: { width: `${(v * 100).toFixed(1)}%`, background: color } }));
}
