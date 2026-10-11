/** Disposition compacte (téléphone, portrait ou paysage). Doit correspondre aux media queries de mobile.css. */
export const COMPACT_QUERY = '(max-width: 760px), (max-height: 500px)';

export function isCompact() {
  return !!window.matchMedia?.(COMPACT_QUERY).matches;
}
