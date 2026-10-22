import { Capacitor } from '@capacitor/core';

/**
 * v1.7 — application Android (Capacitor) ; v1.8 — iPhone et iPad (même code, le bouton Retour n'existe que sur Android).
 *
 * Le même jeu que la version web, emballé dans une application : la WebView affiche le build `dist/`. Ce module
 * ajoute ce qu'une application attend et qu'une page web ne fait pas :
 * - bouton Retour d'Android : ferme la fenêtre, le panneau ou l'outil en cours ; à l'écran de jeu, un second appui
 *   dans les deux secondes sauvegarde puis quitte ;
 * - passage en arrière-plan (appel, autre application) : pause et sauvegarde automatique ;
 * - plein écran : la barre d'état est masquée (le bouton plein écran du navigateur disparaît) ;
 * - partage d'un fichier de partie par la feuille de partage d'Android (messagerie, e-mail, Drive…).
 *
 * Les modules Capacitor sont chargés à la demande : la version web n'en télécharge aucun.
 */
export const isNative = (() => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
})();

/** Branche l'application sur les événements d'Android. @param {any} app GameApp */
export async function setupNative(app) {
  if (!isNative) return;
  document.documentElement.classList.add('native-app');
  const [{ App }, { StatusBar }] = await Promise.all([import('@capacitor/app'), import('@capacitor/status-bar')]);
  try {
    await StatusBar.hide();
  } catch {
    /* barre d'état non pilotable : sans importance */
  }

  let lastBack = 0;
  App.addListener('backButton', async () => {
    if (app.handleBack()) return;
    const now = Date.now();
    if (now - lastBack < 2000) {
      await app.saveBeforeExit();
      App.exitApp();
      return;
    }
    lastBack = now;
    app.notifications.push({ level: 'info', message: 'Appuyez encore sur Retour pour quitter (la partie est sauvegardée).', key: 'back-exit', sticky: false });
  });

  App.addListener('pause', () => app.onBackground());
  App.addListener('resume', async () => {
    // L'application revient au premier plan : la barre d'état peut être réapparue
    try {
      await StatusBar.hide();
    } catch {
      /* rien */
    }
  });
}

/**
 * Partage d'un fichier de partie (.urbis) par la feuille de partage d'Android.
 * @returns {Promise<boolean>} true si le partage natif a été proposé
 */
export async function shareFileNative(bytes, fileName, { title, text } = {}) {
  if (!isNative) return false;
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const written = await Filesystem.writeFile({ path: fileName, data: btoa(bin), directory: Directory.Cache });
  try {
    await Share.share({ title, text, files: [written.uri], dialogTitle: title });
  } catch (err) {
    // Le joueur a refermé la feuille de partage : ce n'est pas une erreur
    if (!/cancel/i.test(err?.message ?? '')) throw err;
  }
  return true;
}
