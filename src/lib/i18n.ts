// The parts of translation that don't need the app's state (see i18n.svelte.ts).

export const LOCALES = [
  { id: 'en', name: 'English' },
  { id: 'es', name: 'Español' },
  { id: 'pt-BR', name: 'Português (Brasil)' },
  { id: 'fr', name: 'Français' },
  { id: 'de', name: 'Deutsch' },
  { id: 'ja', name: '日本語' },
] as const;
export type Locale = (typeof LOCALES)[number]['id'];

/** `text` from a catalog (English when it has none), with {name}-style placeholders filled. */
export function translate(catalog: Record<string, string>, text: string, vars?: Record<string, string | number>): string {
  let s = catalog[text] || text;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** The language the browser asks for, if moshpit has it. */
export function preferredLocale(langs: readonly string[] = typeof navigator !== 'undefined' ? navigator.languages : []): Locale {
  for (const l of langs) {
    const exact = LOCALES.find((x) => x.id.toLowerCase() === l.toLowerCase());
    if (exact) return exact.id;
    const base = LOCALES.find((x) => x.id.split('-')[0] === l.split('-')[0].toLowerCase());
    if (base) return base.id;
  }
  return 'en';
}
