import { describe, expect, it } from 'vitest';
import { createTranslator, DICTIONARIES, pickLocale } from './index.ts';

describe('i18n', () => {
  it('Indonesian and English define exactly the same keys', () => {
    const en = Object.keys(DICTIONARIES.en).sort();
    const id = Object.keys(DICTIONARIES.id).sort();
    expect(id).toEqual(en);
    for (const value of Object.values(DICTIONARIES.id))
      expect(value.trim().length).toBeGreaterThan(0);
  });

  it('interpolates and falls back to the key', () => {
    const t = createTranslator('id');
    expect(t('interact.sit')).toBe('Duduk');
    expect(t('missing.key')).toBe('missing.key');
  });

  it('picks a locale from preferred languages', () => {
    expect(pickLocale(['id-ID', 'en-US'])).toBe('id');
    expect(pickLocale(['fr-FR', 'en-GB'])).toBe('en');
    expect(pickLocale(['fr-FR'])).toBe('en');
  });
});
