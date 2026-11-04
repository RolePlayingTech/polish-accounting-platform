import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@pap/contracts', '@pap/domain', '@pap/ui'],
};

export default nextConfig;
