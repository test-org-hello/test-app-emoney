'use client';

import { SegmentedControl } from '@mantine/core';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { localeLabels, locales } from '@/i18n/config';
import type { Locale } from '@/i18n/i18n.types';
import { setUserLocale } from '@/i18n/locale';

export function LocaleSwitcher() {
  const t = useTranslations('common');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  return (
    <SegmentedControl
      size="xs"
      aria-label={t('language')}
      value={locale}
      disabled={pending}
      // The server action sets the cookie; Next re-renders the layout with the new messages.
      onChange={(v) => startTransition(() => setUserLocale(v as Locale))}
      data={locales.map((l) => ({ value: l, label: localeLabels[l] }))}
    />
  );
}
