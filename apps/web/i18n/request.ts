import { cookies, headers } from 'next/headers';
import type { Messages } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, LOCALE_COOKIE, locales } from './config';
import type { Locale } from './i18n.types';

const isLocale = (v: string | undefined): v is Locale => !!v && (locales as readonly string[]).includes(v);

/** Cookie first, then the browser's Accept-Language, then the default (ru). */
async function resolveLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) {
    return fromCookie;
  }

  const accept = (await headers()).get('accept-language') ?? '';
  for (const part of accept.split(',')) {
    const lang = part.trim().slice(0, 2).toLowerCase();
    if (isLocale(lang)) {
      return lang;
    }
  }
  return defaultLocale;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: ((await import(`../messages/${locale}.json`)) as { default: Messages }).default,
  };
});
