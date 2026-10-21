/**
 * v1.6 — format des parties envoyées hors du navigateur (Google Drive, partage par fichier ou par lien).
 *
 * Un fichier « .urbis » contient l'enregistrement de sauvegarde (le même que dans IndexedDB : payload, somme de
 * contrôle, résumé) en JSON compressé gzip quand le navigateur sait compresser (CompressionStream), en JSON brut
 * sinon. La lecture reconnaît les deux, ainsi que les exports « .urbis.json » des versions précédentes.
 */
export const SHARE_MIME = 'application/x-urbis';
export const SHARE_EXT = '.urbis';

const canGzip = () => typeof CompressionStream !== 'undefined' && typeof Response !== 'undefined';

/** Enregistrement → octets (gzip si possible). @returns {Promise<Uint8Array>} */
export async function encodeRecord(record) {
  const text = typeof record === 'string' ? record : JSON.stringify(record);
  const raw = new TextEncoder().encode(text);
  if (!canGzip()) return raw;
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Octets (gzip ou JSON) → texte JSON. */
export async function decodeToText(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Ce navigateur ne sait pas lire les parties compressées : mettez-le à jour');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}

/** Octets → enregistrement de sauvegarde (objet). */
export async function decodeRecord(input) {
  const text = await decodeToText(input);
  let rec;
  try {
    rec = JSON.parse(text);
  } catch {
    throw new Error('Fichier de partie illisible');
  }
  if (!rec || typeof rec.payload !== 'string') throw new Error('Ce fichier n\'est pas une partie d\'URBIS 2030');
  return rec;
}

/** Nom de fichier sûr pour une ville. */
export function fileNameFor(name, suffix = '') {
  const base = String(name ?? 'Ma ville').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'ville';
  return `${base}${suffix}${SHARE_EXT}`;
}
