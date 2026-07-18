import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  async redirects() {
    return [
      { source: '/account', destination: '/account/bookings', permanent: false },
      { source: '/staff', destination: '/staff/check-in', permanent: false },
      { source: '/admin', destination: '/admin/operations', permanent: false },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/graphql',
        destination: `${process.env.GRAPHQL_GATEWAY_URL ?? 'http://127.0.0.1:4000'}/graphql`,
      },
    ];
  },
};

export default nextConfig;
