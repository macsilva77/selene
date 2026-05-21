import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@selene/ui', '@selene/trpc', '@selene/providers'],
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react'],
    outputFileTracingRoot: path.join(__dirname, '../../'),
  },
};

export default nextConfig;
