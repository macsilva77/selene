import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: ['@selene/ui', '@selene/trpc', '@selene/providers'],
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react'],
  },
};

export default nextConfig;
