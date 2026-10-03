import en from './en.json' with { type: 'json' };
import id from './id.json' with { type: 'json' };

export type Locale = 'en' | 'id';
export type Dictionary = Readonly<Record<string, string>>;

export const LOCALES: readonly { id: Locale; label: string }[] = [
  { id: 'id', label: 'Bahasa Indonesia' },
  { id: 'en', label: 'English' },
];

export const DICTIONARIES: Readonly<Record<Locale, Dictionary>> = { en, id };

/** Picks the best supported locale from the host's preferred languages. */
export function pickLocale(preferred: readonly string[], fallback: Locale = 'en'): Locale {
  for (const lang of preferred) {
    const base = lang.toLowerCase().split('-')[0];
    if (base === 'id' || base === 'in' || base === 'ms') return 'id';
    if (base === 'en') return 'en';
  }
  return fallback;
}

export type Translator = (key: string, vars?: Readonly<Record<string, string | number>>) => string;

/** Tiny i18n: dictionary lookup with English fallback and `{name}` interpolation. */
export function createTranslator(locale: Locale): Translator {
  const dict = DICTIONARIES[locale];
  const fallback = DICTIONARIES.en;
  return (key, vars) => {
    const raw = dict[key] ?? fallback[key] ?? key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
  };
}
