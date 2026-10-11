import { h } from './dom.js';

/**
 * Boîtes de dialogue intégrées à la page (pas de confirm()/alert() natifs, bloqués dans certains
 * environnements d'intégration).
 */
function open(content, { onClose } = {}) {
  const backdrop = h('div.dialog-backdrop', { role: 'presentation' });
  const box = h('div.dialog', { role: 'dialog', 'aria-modal': 'true' }, content);
  backdrop.append(box);
  document.body.append(backdrop);
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });
  return { box, close };
}

/** @returns {Promise<boolean>} */
export function confirmDialog(message, { confirmLabel = 'Confirmer', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => {
      answered = true;
      resolve(v);
      d.close();
    };
    const ok = h('button.btn', { class: danger ? 'danger-fill' : 'primary', on: { click: () => done(true) } }, confirmLabel);
    const d = open(
      [
        h('p.dialog-msg', message),
        h('div.dialog-actions', h('button.btn', { on: { click: () => done(false) } }, 'Annuler'), ok)
      ],
      { onClose: () => !answered && resolve(false) }
    );
    ok.focus();
  });
}

/** Affiche un texte à copier (export de partie), avec téléchargement quand l'environnement l'autorise. */
export function textDialog(title, text, filename) {
  const area = h('textarea.dialog-text', { readOnly: true, rows: 8, 'aria-label': title }, text);
  const status = h('span.hint');
  const copy = h('button.btn.primary', {
    on: {
      click: async () => {
        try {
          await navigator.clipboard.writeText(text);
          status.textContent = 'Copié dans le presse-papiers.';
        } catch {
          area.focus();
          area.select();
          status.textContent = 'Texte sélectionné : utilisez Ctrl+C.';
        }
      }
    }
  }, 'Copier');
  const download = h('button.btn', {
    on: {
      click: () => {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = h('a', { href: url, download: filename });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status.textContent = 'Si rien ne se télécharge, copiez le texte puis collez-le dans un fichier .json.';
      }
    }
  }, 'Télécharger');
  // Le téléchargement n'est proposé que hors cadre intégré (les cadres d'intégration bloquent souvent les téléchargements).
  const standalone = (() => {
    try {
      return window.self === window.top;
    } catch {
      return false;
    }
  })();
  const d = open([h('h3', title), area, h('div.dialog-actions', status, standalone ? download : null, copy, h('button.btn', { on: { click: () => d.close() } }, 'Fermer'))]);
}

/** Saisie d'un texte collé (import de partie). @returns {Promise<string|null>} */
export function pasteDialog(title) {
  return new Promise((resolve) => {
    let answered = false;
    const area = h('textarea.dialog-text', { rows: 8, placeholder: 'Collez ici le contenu d\'une partie exportée', 'aria-label': title });
    const file = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Choisir un fichier', on: { change: async (e) => { const f = e.target.files?.[0]; if (f) area.value = await f.text(); } } });
    const done = (v) => {
      answered = true;
      resolve(v);
      d.close();
    };
    const d = open(
      [h('h3', title), file, area, h('div.dialog-actions', h('button.btn', { on: { click: () => done(null) } }, 'Annuler'), h('button.btn.primary', { on: { click: () => done(area.value.trim() || null) } }, 'Importer'))],
      { onClose: () => !answered && resolve(null) }
    );
    area.focus();
  });
}
