import { NextRequest, NextResponse } from 'next/server';

// NOTE: Do NOT use `export const runtime = 'edge'` here.
// Edge runtime does not support the Node.js global `Buffer` used for Basic auth encoding,
// and more importantly we need in-process token caching which only works in Node runtime.

// ── OAuth2 token cache (in-process, Node runtime only) ────────────────────────
interface TokenCache {
  token: string;
  expiresAt: number; // ms since epoch
}

let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();

  // Return cached token if still valid (with 60s buffer)
  if (tokenCache && tokenCache.expiresAt - now > 60_000) {
    return tokenCache.token;
  }

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Reddit OAuth credentials not configured. ' +
      'Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET in .env.local. ' +
      'Get free credentials at https://www.reddit.com/prefs/apps'
    );
  }

  // Reddit OAuth2 "client_credentials" grant — works from any IP, no user login needed
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Reddit requires a descriptive User-Agent for API access
      'User-Agent': 'web:ai-news-aggregator:v1.0 (by /u/ai_news_bot)',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Reddit token request failed: ${res.status} — ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };

  tokenCache = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  return tokenCache.token;
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const subreddit = searchParams.get('subreddit');
  const sort = searchParams.get('sort') ?? 'hot';
  const limit = searchParams.get('limit') ?? '25';
  const t = searchParams.get('t') ?? 'day';

  if (!subreddit) {
    return NextResponse.json({ error: 'Missing subreddit parameter' }, { status: 400 });
  }

  try {
    const token = await getAccessToken();

    // oauth.reddit.com is the authenticated API endpoint — not blocked by IP
    const redditUrl = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/${encodeURIComponent(sort)}.json?limit=${limit}&t=${t}&raw_json=1`;

    const res = await fetch(redditUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'web:ai-news-aggregator:v1.0 (by /u/ai_news_bot)',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      // If token expired mid-flight, clear cache so next request re-fetches
      if (res.status === 401) {
        tokenCache = null;
      }
      const body = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Reddit returned ${res.status} for r/${subreddit}`, detail: body.slice(0, 200) },
        { status: res.status }
      );
    }

    const data = await res.json();

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
