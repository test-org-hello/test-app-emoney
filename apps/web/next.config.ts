import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
  transpilePackages: ['@circle-wallet/shared'],
  experimental: {
    optimizePackageImports: ['@mantine/core', '@mantine/hooks', '@tabler/icons-react'],
  },
};

export default withNextIntl(nextConfig);
