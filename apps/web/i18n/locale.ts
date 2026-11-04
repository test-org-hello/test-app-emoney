'use server';

import { cookies } from 'next/headers';
import { LOCALE_COOKIE, locales } from './config';
import type { Locale } from './i18n.types';

/** Server action: remembers the UI language for a year. */
export async function setUserLocale(locale: Locale): Promise<void> {
  if (!(locales as readonly string[]).includes(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
}
