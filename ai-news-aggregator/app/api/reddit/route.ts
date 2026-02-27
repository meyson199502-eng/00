import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const subreddit = searchParams.get('subreddit');
  const sort = searchParams.get('sort') ?? 'hot';
  const limit = searchParams.get('limit') ?? '25';
  const t = searchParams.get('t') ?? 'day';

  if (!subreddit) {
    return NextResponse.json({ error: 'Missing subreddit parameter' }, { status: 400 });
  }

  const redditUrl = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${encodeURIComponent(sort)}.json?limit=${limit}&t=${t}`;

  try {
    const res = await fetch(redditUrl, {
      headers: {
        // Identify ourselves politely; Reddit requires a User-Agent
        'User-Agent': 'ai-news-aggregator/1.0 (https://github.com/user/ai-news-aggregator)',
        Accept: 'application/json',
      },
      // Don't cache on the edge so we always get fresh data
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Reddit returned ${res.status} for r/${subreddit}` },
        { status: res.status }
      );
    }

    const data = await res.json();

    return NextResponse.json(data, {
      headers: {
        // Allow the browser to cache for 60 s to avoid hammering Reddit
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
