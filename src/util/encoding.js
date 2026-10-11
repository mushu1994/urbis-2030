/**
 * Encodage compact des tableaux typés (sauvegardes) et somme de contrôle.
 */

const CHUNK = 0x8000;

/** @param {ArrayBufferView} view */
export function typedToBase64(view) {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * @template {new (buffer: ArrayBuffer) => any} T
 * @param {string} b64
 * @param {T} Ctor constructeur de tableau typé
 * @returns {InstanceType<T>}
 */
export function base64ToTyped(b64, Ctor) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Ctor(bytes.buffer);
}

/** Somme de contrôle FNV-1a 32 bits sur une chaîne. */
export function checksum(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
