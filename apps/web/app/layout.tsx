import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

import { ColorSchemeScript, mantineHtmlProps } from '@mantine/core';
import type { Metadata } from 'next';
import { Providers } from './providers';
import type { WithChildren } from './app.types';

export const metadata: Metadata = {
  title: 'Circle Wallet',
  description: 'Тестовый криптокошелёк на Circle Developer-Controlled Wallets (Base Sepolia)',
};

export default function RootLayout({ children }: WithChildren) {
  return (
    <html lang="ru" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
