import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  transpilePackages: ['@pap/contracts', '@pap/domain', '@pap/ui'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Referrer-Policy',
            value: 'same-origin',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
