import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'preview.redd.it' },
      { protocol: 'https', hostname: 'i.redd.it' },
      { protocol: 'https', hostname: 'external-preview.redd.it' },
    ],
  },
  async rewrites() {
    return [
      {
        // /reddit-proxy/r/artificial/hot.json?limit=25&t=day
        // → https://www.reddit.com/r/artificial/hot.json?limit=25&t=day
        source: '/reddit-proxy/:path*',
        destination: 'https://www.reddit.com/:path*',
      },
    ];
  },
};

export default nextConfig;
