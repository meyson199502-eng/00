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
        // Browser fetches /reddit-api/r/ChatGPT/hot.json
        // Vercel transparently forwards to https://www.reddit.com/r/ChatGPT/hot.json
        // Origin header is stripped → Reddit sees a plain request → 200, no CORS issues
        source: '/reddit-api/:path*',
        destination: 'https://www.reddit.com/:path*',
      },
    ];
  },
};

export default nextConfig;
