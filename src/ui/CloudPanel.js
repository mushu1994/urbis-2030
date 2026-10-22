import { h, icon, setChildren } from './dom.js';
import { formatNumber } from '../util/money.js';
import { confirmDialog, contentDialog } from './Dialog.js';
import { encodeRecord, fileNameFor } from '../persistence/SaveCodec.js';
import { CloudAuthError } from '../cloud/GoogleDrive.js';
import { shareFileNative } from '../native/NativeApp.js';

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

/** Adresse du jeu (sans paramètres) : base des liens de partage. */
export const gameUrl = () => `${location.origin}${location.pathname}`;

/**
 * v1.6 — encart « Sauvegarde en ligne (Google Drive) » du panneau Sauvegardes et de l'écran d'accueil.
 * @param {{cloud:any, sync:any, getSession:()=>any, onLoad:(id:string)=>void, onShare:(source:any)=>void, notify:(level:string,msg:string)=>void, rerender:()=>void}} o
 */
export function cloudSection({ cloud, sync, getSession, onLoad, onShare, notify, rerender }) {
  const session = getSession?.();
  const head = h('h3.cloud-title', icon('cloud', 18), 'Sauvegarde en ligne (Google Drive)');
  if (!cloud.configured && cloud.nativeApp) {
    return h('section.cloud-box', head,
      h('p.hint', 'Dans l\'application (Android, iPhone, iPad), vos parties sont gardées dans l\'application (elles ne disparaissent qu\'en la désinstallant ou en effaçant ses données). Pour une copie de secours, utilisez « Partager la ville » → « Envoyer le fichier » et choisissez Google Drive dans la liste. La connexion Google directe reste disponible dans la version web du jeu.'));
  }
  if (!cloud.configured) {
    return h('section.cloud-box', head,
      h('p.hint', 'La sauvegarde Google n\'est pas encore activée sur cette version du jeu. En attendant, « Partager » et « Exporter » gardent une copie de vos parties hors du navigateur.'));
  }
  const fail = (err) => {
    notify(err instanceof CloudAuthError ? 'warning' : 'danger', err.message);
    rerender();
  };
  const connect = async () => {
    try {
      await cloud.connect();
      notify('success', `Connecté à Google${cloud.email ? ` (${cloud.email})` : ''} : vos sauvegardes seront aussi copiées en ligne.`);
      const s = getSession?.();
      if (s) await sync.uploadNow(s.state).catch(() => {});
    } catch (err) {
      notify('warning', err.message);
    }
    rerender();
  };
  if (!cloud.connected) {
    return h('section.cloud-box', head,
      h('p.hint', cloud.known
        ? `Connexion expirée pour ${cloud.email}. Reconnectez-vous pour reprendre la copie en ligne de vos parties.`
        : 'Connectez-vous avec votre compte Google : chaque sauvegarde sera aussi copiée dans un dossier « URBIS 2030 » de votre Google Drive. Vous retrouverez vos villes sur un autre appareil, ou si ce navigateur efface ses données. Le jeu ne voit que les fichiers qu\'il a créés.'),
      h('div.dialog-actions',
        h('button.btn.primary.google-btn', { type: 'button', on: { click: connect } }, h('span.g-logo', { 'aria-hidden': 'true' }, 'G'), cloud.known ? 'Se reconnecter' : 'Se connecter avec Google'),
        cloud.known ? h('button.btn', { type: 'button', on: { click: async () => { await cloud.disconnect(); rerender(); } } }, 'Oublier ce compte') : null));
  }
  const list = h('div.save-list', h('p.hint', 'Chargement des parties en ligne…'));
  cloud.list().then((items) => {
    if (!items.length) return setChildren(list, h('p.empty', 'Aucune partie en ligne pour le moment.'));
    setChildren(list, items.map((it) => h('div.save-item',
      h('div', h('strong', it.name), h('small', `${dateFmt.format(it.updatedAt)} · ${it.date} · ${formatNumber(it.population)} hab. · ${it.sizeKb} Ko`)),
      h('div.save-actions',
        h('button.btn.primary', { type: 'button', on: { click: async () => {
          try {
            notify('info', `Téléchargement de « ${it.name} »…`);
            onLoad(await sync.restore(it.fileId));
          } catch (err) {
            fail(err);
          }
        } } }, 'Charger'),
        h('button.btn', { type: 'button', title: 'Envoyer cette ville à un ami', on: { click: () => onShare({ cloudFileId: it.fileId, name: it.name }) } }, icon('share', 15), 'Partager'),
        h('button.btn.danger', { type: 'button', on: { click: async () => {
          if (!(await confirmDialog(`Supprimer « ${it.name} » de votre Google Drive ? (elle reste 30 jours dans la corbeille du Drive)`, { confirmLabel: 'Supprimer', danger: true }))) return;
          try {
            await cloud.remove(it.fileId);
            rerender();
          } catch (err) {
            fail(err);
          }
        } } }, 'Supprimer')))));
  }).catch((err) => {
    setChildren(list, h('p.empty.neg', `Parties en ligne indisponibles : ${err.message}`));
    if (err instanceof CloudAuthError) rerender();
  });
  const auto = h('input', { type: 'checkbox', checked: sync.auto, on: { change: (e) => { sync.auto = e.target.checked; } } });
  return h('section.cloud-box', head,
    h('p.cloud-account', h('span.cloud-dot', { 'aria-hidden': 'true' }), `Connecté : ${cloud.email ?? 'compte Google'}`, sync.lastSync ? h('small', ` · dernière copie ${dateFmt.format(sync.lastSync)}`) : null),
    h('label.setting.check', auto, h('span', 'Copier automatiquement chaque sauvegarde en ligne')),
    h('div.dialog-actions',
      session ? h('button.btn.primary', { type: 'button', on: { click: async (e) => {
        e.currentTarget.disabled = true;
        try {
          await sync.uploadNow(session.state);
          notify('success', `« ${session.state.meta.name} » est sauvegardée sur votre Google Drive.`);
        } catch (err) {
          notify('danger', err.message);
        }
        rerender();
      } } }, 'Sauvegarder en ligne maintenant') : null,
      h('button.btn', { type: 'button', on: { click: async () => { await cloud.disconnect(); rerender(); } } }, 'Se déconnecter')),
    h('h4', 'Vos villes en ligne'),
    list);
}

/**
 * Fenêtre « Partager la ville » : lien à envoyer (copie sur le Drive du joueur, lisible avec le lien) ou fichier
 * .urbis (application de messagerie, e-mail, AirDrop…). L'ami reprend la ville dans son propre navigateur.
 * @param {{getRecord:()=>Promise<any>, name:string, cloud:any, notify:(level:string,msg:string)=>void}} o
 */
export function shareDialog({ getRecord, name, cloud, notify }) {
  const status = h('p.hint', { 'aria-live': 'polite' });
  let dlg = null;
  const withRecord = async (btn, fn) => {
    btn.disabled = true;
    status.textContent = 'Préparation de la partie…';
    try {
      await fn(await getRecord());
    } catch (err) {
      if (err?.name !== 'AbortError') status.textContent = err.message;
      else status.textContent = '';
    } finally {
      btn.disabled = false;
    }
  };
  const text = `Je te passe ma ville « ${name} » sur URBIS 2030 : reprends-la où j'en suis !`;
  const linkBtn = h('button.btn.primary', { type: 'button', on: { click: async (e) => {
    const btn = e.currentTarget;
    // La fenêtre de connexion Google doit s'ouvrir dans le geste du joueur : avant toute préparation
    if (!cloud.connected) {
      try {
        await cloud.connect();
      } catch (err) {
        status.textContent = err.message;
        return;
      }
    }
    await withRecord(btn, async (rec) => {
    status.textContent = 'Envoi sur votre Google Drive…';
    const { url } = await cloud.share(rec, { gameUrl: gameUrl() });
    const out = h('input.share-url', { type: 'text', readOnly: true, value: url, on: { focus: (ev) => ev.target.select() } });
    status.replaceChildren('Lien prêt : toute personne qui l\'ouvre peut reprendre une copie de la ville (votre partie à vous ne change pas).', out);
    if (navigator.share) {
      await navigator.share({ title: `URBIS 2030 — ${name}`, text, url }).catch(() => {});
    } else {
      await navigator.clipboard?.writeText(url).then(() => notify('success', 'Lien copié dans le presse-papiers.')).catch(() => out.select());
    }
    });
  } } }, icon('share', 16), 'Créer un lien');
  const fileBtn = h('button.btn', { type: 'button', on: { click: (e) => withRecord(e.currentTarget, async (rec) => {
    const bytes = await encodeRecord(rec);
    const file = new File([bytes], fileNameFor(name), { type: 'application/octet-stream' });
    // v1.7 : application Android — feuille de partage du téléphone
    if (await shareFileNative(bytes, file.name, { title: `URBIS 2030 — ${name}`, text })) {
      status.textContent = 'Votre ami ouvre le fichier dans URBIS 2030 : Sauvegardes → « Ouvrir une partie reçue ». Choisir Google Drive dans la liste en garde une copie de secours.';
    } else if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `URBIS 2030 — ${name}`, text });
      status.textContent = 'Fichier envoyé. Votre ami l\'ouvre dans URBIS 2030 : Sauvegardes → « Ouvrir une partie reçue ».';
    } else {
      const url = URL.createObjectURL(file);
      h('a', { href: url, download: file.name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      status.textContent = `Fichier « ${file.name} » téléchargé : envoyez-le à votre ami (e-mail, messagerie). Il l'ouvre dans URBIS 2030 : Sauvegardes → « Ouvrir une partie reçue ».`;
    }
  }) } }, 'Envoyer le fichier');
  const canLink = cloud.configured && cloud.linkSharing;
  dlg = contentDialog(h('div.share-dialog',
    h('h3', `Partager « ${name} »`),
    h('p', 'Votre ami reçoit une copie de la ville telle qu\'elle est maintenant et la reprend dans son propre jeu. Votre partie ne change pas.'),
    h('div.share-options',
      canLink ? h('div.share-option', h('strong', 'Par lien'), h('small', 'Une copie est déposée sur votre Google Drive ; le lien ouvre directement la ville dans le jeu, sans compte.'), linkBtn) : null,
      h('div.share-option', h('strong', 'Par fichier'), h('small', 'Un petit fichier « .urbis » à envoyer par messagerie ou e-mail.'), fileBtn)),
    status,
    h('div.dialog-actions', h('button.btn', { type: 'button', on: { click: () => dlg?.close() } }, 'Fermer'))));
  return dlg;
}

/**
 * Une ville reçue par lien : résumé et confirmation avant de la reprendre.
 * @returns {Promise<boolean>}
 */
export function receivedGameDialog(rec) {
  const s = rec.summary ?? {};
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => {
      answered = true;
      resolve(v);
      dlg.close();
    };
    const dlg = contentDialog(h('div.share-dialog',
      h('p.en-kicker', 'Ville partagée'),
      h('h3', `« ${s.name ?? rec.name} »`),
      h('p', `${s.date ?? ''} · ${formatNumber(s.population ?? 0)} habitants${s.size ? ` · carte ${s.size}` : ''}`),
      h('p.hint', 'Un ami vous confie sa ville. Une copie est enregistrée dans ce navigateur : vous la reprenez là où il en était, sans toucher à sa partie.'),
      h('div.dialog-actions',
        h('button.btn', { type: 'button', on: { click: () => done(false) } }, 'Plus tard'),
        h('button.btn.primary', { type: 'button', on: { click: () => done(true) } }, 'Reprendre la ville'))), { onClose: () => !answered && resolve(false) });
  });
}
