import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
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
