import type { locales } from './config';
import type messages from '../messages/ru.json';

export type Locale = (typeof locales)[number];

// Typed `useTranslations`: unknown keys and missing ICU arguments fail typecheck.
// ru.json is the source of truth; en.json must have the same keys.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
