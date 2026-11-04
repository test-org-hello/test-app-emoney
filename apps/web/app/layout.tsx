import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

import { ColorSchemeScript, mantineHtmlProps } from '@mantine/core';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { Providers } from './providers';
import type { WithChildren } from './app.types';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t('common.appName'), description: t('meta.description') };
}

export default async function RootLayout({ children }: WithChildren) {
  const locale = await getLocale();
  return (
    <html lang={locale} {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
      </head>
      <body>
        {/* v4: locale and messages are passed to client components automatically. */}
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
