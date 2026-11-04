import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  transpilePackages: ['@pap/contracts', '@pap/domain', '@pap/ui'],
};

export default nextConfig;
