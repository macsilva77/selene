import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@selene/ui', '@selene/trpc', '@selene/providers'],
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react'],
  },
};

export default nextConfig;
