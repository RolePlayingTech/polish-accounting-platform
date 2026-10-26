import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@pap/contracts', '@pap/ui'],
};

export default nextConfig;
