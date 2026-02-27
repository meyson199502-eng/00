import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// Reddit blocks requests from cloud/server IPs when a generic User-Agent is used.
// We use a realistic browser-like User-Agent to avoid 403 responses.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const subreddit = searchParams.get('subreddit');
  const sort = searchParams.get('sort') ?? 'hot';
  const limit = searchParams.get('limit') ?? '25';
  const t = searchParams.get('t') ?? 'day';

  if (!subreddit) {
    return NextResponse.json({ error: 'Missing subreddit parameter' }, { status: 400 });
  }

  const redditUrl = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${encodeURIComponent(sort)}.json?limit=${limit}&t=${t}&raw_json=1`;

  try {
    const res = await fetch(redditUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        // Do NOT send Accept: application/json — it triggers a CORS preflight
        // that Reddit rejects from server IPs. Reddit returns JSON by default
        // for .json URLs regardless.
      },
      cache: 'no-store',
    });

    if (!res.ok) {
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
