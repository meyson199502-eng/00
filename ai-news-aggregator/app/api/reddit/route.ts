import { NextRequest, NextResponse } from 'next/server';
import https from 'https';
import http from 'http';

// Reddit blocks Node.js fetch (undici/HTTP2) but allows Node.js https module (HTTP/1.1).
// We use the native https module to avoid the 403 block.

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

function getRandomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function httpsGet(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers,
      timeout: 10000,
    };

    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const subreddit = searchParams.get('subreddit');
  const sort = searchParams.get('sort') ?? 'hot';
  const limit = searchParams.get('limit') ?? '25';
  const t = searchParams.get('t') ?? 'day';

  if (!subreddit) {
    return NextResponse.json({ error: 'Missing subreddit parameter' }, { status: 400 });
  }

  const path = `r/${encodeURIComponent(subreddit)}/${encodeURIComponent(sort)}.json?limit=${limit}&t=${t}&raw_json=1`;
  const headers = {
    'User-Agent': getRandomUA(),
    'Accept': 'application/json, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection': 'keep-alive',
  };

  // Try multiple Reddit endpoints
  const urls = [
    `https://www.reddit.com/${path}`,
    `https://api.reddit.com/${path}`,
  ];

  let lastStatus = 500;
  let lastError = '';

  for (const url of urls) {
    try {
      const { status, body } = await httpsGet(url, headers);

      if (status === 200) {
        const data = JSON.parse(body);
        return NextResponse.json(data, {
          headers: {
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      lastStatus = status;
      lastError = body.slice(0, 200);

      // Only retry on 403/429
      if (status !== 403 && status !== 429) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Network error';
    }
  }

  return NextResponse.json(
    { error: `Reddit returned ${lastStatus} for r/${subreddit}`, detail: lastError },
    { status: lastStatus || 500 }
  );
}
