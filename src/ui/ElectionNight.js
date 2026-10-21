import { h } from './dom.js';

/** Couleur de chaque liste dans le dépouillement. */
const COLORS = { mayor: 'var(--sign)', rival: '#5aa6e6', green: '#49b37a', citizen: '#c58be8', dissident: '#e0884a' };

const pc = (v) => `${(Math.round(v * 10) / 10).toFixed(1).replace('.', ',')} %`;

/** Commentaires de la soirée, selon l'avancée du dépouillement (le dernier tient le suspense). */
const STEPS = [
  [0, 'Les bureaux ferment, le dépouillement commence…'],
  [0.15, 'Premiers bureaux dépouillés : les quartiers périphériques ont voté.'],
  [0.4, 'Le centre-ville tombe : l\'écart se resserre.'],
  [0.65, 'Les gros bureaux arrivent… tout reste possible.'],
  [0.88, 'Derniers bureaux. Le silence se fait dans la salle.']
];

/**
 * v1.6 : dépouillement animé. Les barres partent d'un ordre trompeur (le futur vainqueur commence derrière) et
 * convergent vers le résultat réel ; un compteur de bureaux dépouillés et des commentaires tiennent le suspense.
 * Le résultat affiché à la fin est exactement celui de la simulation (l'animation ne décide de rien).
 *
 * @param {{lists:{id:string,label:string,share:number}[], title:string, fraud?:any, seed?:number, reduced?:boolean,
 *   onBeat?:(kind:string)=>void, onDone:()=>void}} opts
 * @returns {{el:HTMLElement, skip:()=>void}}
 */
export function countAnimation({ lists, title, fraud = null, seed = 1, reduced = false, onBeat, onDone }) {
  const sorted = [...lists].sort((a, b) => b.share - a.share);
  // Écart de départ : le vainqueur démarre en retrait, les suivants en avance (bruit déterministe)
  const rnd = (k) => {
    const x = Math.sin((seed + 1) * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const start = sorted.map((l, k) => {
    const spread = k === 0 ? -(4 + rnd(k) * 6) : (k === 1 ? 3 + rnd(k) * 6 : rnd(k) * 3 - 1);
    return Math.max(1, l.share + spread);
  });
  const rows = sorted.map((l) => {
    const bar = h('span.en-fill', { style: { background: COLORS[l.id] ?? 'var(--ink-faint)' } });
    const val = h('strong.en-val', '—');
    const row = h('div.en-row', { class: l.id === 'mayor' ? 'mine' : '' },
      h('span.en-name', l.id === 'mayor' ? 'Votre liste' : l.label),
      h('div.en-bar', bar, h('i.en-half', { 'aria-hidden': 'true' })),
      val);
    return { l, bar, val, row };
  });
  const counted = h('strong.en-counted', '0 %');
  const comment = h('p.en-comment', STEPS[0][1]);
  const skipBtn = h('button.btn.small', { type: 'button', on: { click: () => finish() } }, 'Passer');
  const el = h('section.election-count', { 'aria-live': 'polite' },
    h('p.en-kicker', 'Soirée électorale'),
    h('h3', title),
    h('div.en-rows', rows.map((r) => r.row)),
    h('div.en-foot', h('span', 'Bureaux dépouillés : ', counted), skipBtn),
    comment);
  const duration = reduced ? 1200 : 7600;
  let t0 = null;
  let raf = 0;
  let done = false;
  let step = 0;
  let fraudShown = false;
  const draw = (t) => {
    // Avancée non linéaire : rapide au début, lente à la fin (le suspense)
    const e = 1 - Math.pow(1 - t, 2.2);
    const raw = rows.map((r, k) => {
      const wobble = Math.sin(t * 11 + k * 2.1) * 1.4 * (1 - t);
      return start[k] + (r.l.share - start[k]) * e + wobble;
    });
    const sum = raw.reduce((a, v) => a + v, 0) || 1;
    const total = sorted.reduce((a, l) => a + l.share, 0) || 100;
    rows.forEach((r, k) => {
      const v = t >= 1 ? r.l.share : (raw[k] / sum) * total;
      r.bar.style.width = `${Math.max(0, Math.min(100, v))}%`;
      r.val.textContent = pc(v);
    });
    counted.textContent = `${Math.min(100, Math.floor(t * 100))} %`;
    while (step + 1 < STEPS.length && t >= STEPS[step + 1][0]) {
      step++;
      comment.textContent = STEPS[step][1];
      onBeat?.('step');
    }
    if (fraud && !fraudShown && t >= 0.55) {
      fraudShown = true;
      comment.textContent = fraud.caught
        ? 'Incident : des assesseurs signalent des paquets de bulletins suspects !'
        : 'Dans un bureau, un assesseur fronce les sourcils… puis reprend le comptage.';
      onBeat?.('step');
    }
  };
  const frame = (now) => {
    if (done) return;
    if (t0 === null) t0 = now;
    const t = Math.min(1, (now - t0) / duration);
    draw(t);
    if (t < 1) raf = requestAnimationFrame(frame);
    else {
      comment.textContent = 'Tous les bureaux sont dépouillés. Résultat…';
      onBeat?.('drum');
      setTimeout(() => finish(), reduced ? 200 : 1300);
    }
  };
  function finish() {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    draw(1);
    counted.textContent = '100 %';
    skipBtn.remove();
    onDone();
  }
  raf = requestAnimationFrame(frame);
  return { el, skip: finish };
}

/** L'utilisateur a-t-il demandé de réduire les animations ? */
export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
