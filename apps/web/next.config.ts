import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@circle-wallet/shared'],
  experimental: {
    optimizePackageImports: ['@mantine/core', '@mantine/hooks', '@tabler/icons-react'],
  },
};

export default nextConfig;
