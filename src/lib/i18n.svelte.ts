// Translations. The English text is the key: t('New project') shows the translation in the chosen
// language, or the English when there's none yet, so nothing is ever blank. Catalogs are JSON files
// in src/locales (English text → translation), loaded only when that language is picked.
// {name}-style placeholders are filled from `vars`.
import { localGet, localSet } from './storage';
import { LOCALES, translate, preferredLocale, type Locale } from './i18n';
export { LOCALES, preferredLocale, type Locale };

const catalogs = import.meta.glob<{ default: Record<string, string> }>('../locales/*.json');

export const i18n = $state({ locale: 'en' as Locale, catalog: {} as Record<string, string> });

/** The text in the chosen language. */
export const t = (text: string, vars?: Record<string, string | number>): string => translate(i18n.catalog, text, vars);

export async function setLocale(id: Locale, remember = true) {
  const load = catalogs[`../locales/${id}.json`];
  i18n.catalog = id === 'en' || !load ? {} : (await load()).default;
  i18n.locale = id;
  if (typeof document !== 'undefined') document.documentElement.lang = id;
  if (remember) localSet('locale', id);
}

/** At start-up: the language picked before, or the browser's. */
export function startI18n() {
  const saved = localGet<Locale | ''>('locale', '');
  const id = saved || preferredLocale();
  if (id !== 'en') void setLocale(id, !!saved);
}
