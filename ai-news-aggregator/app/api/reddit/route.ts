import { NextRequest, NextResponse } from 'next/server';
import { RedditPost } from '@/app/types/reddit';

const SUBREDDITS = ['artificial', 'ChatGPT', 'LocalLLaMA', 'singularity', 'OpenAI'] as const;

// Reddit OAuth2 Application-Only (client credentials) flow.
// Required env vars: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET
// Optional: REDDIT_USER_AGENT (defaults to a reasonable value)
const CLIENT_ID = process.env.REDDIT_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET ?? '';
const USER_AGENT =
  process.env.REDDIT_USER_AGENT ?? 'web:ai-news-aggregator:v1.0 (by /u/your_reddit_username)';

// ── Token cache (module-level, survives warm serverless invocations) ──────────
let cachedToken: string | null = null;
let tokenExpiresAt = 0; // Unix ms

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  // Refresh 60 s before actual expiry to avoid edge-case races
  if (cachedToken && now < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      'Reddit OAuth credentials are not configured. ' +
        'Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET environment variables.'
    );
  }

  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
    // Do NOT use Next.js cache here — we manage the token cache ourselves
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to obtain Reddit access token (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in * 1_000;
  return cachedToken;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface RedditApiPost {
  data: {
    id: string;
    title: string;
    url: string;
    permalink: string;
    subreddit: string;
    score: number;
    num_comments: number;
    author: string;
    thumbnail: string;
    selftext: string;
    created_utc: number;
    link_flair_text: string | null;
    is_reddit_media_domain: boolean;
    post_hint?: string;
    preview?: {
      images: Array<{
        source: {
          url: string;
          width: number;
          height: number;
        };
      }>;
    };
  };
}

interface RedditApiResponse {
  data: {
    children: RedditApiPost[];
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizePost(rawPost: RedditApiPost): RedditPost {
  const d = rawPost.data;

  // Decode preview URL (Reddit escapes & as &amp; in JSON)
  let previewUrl: string | null = null;
  if (d.preview?.images?.[0]?.source?.url) {
    previewUrl = d.preview.images[0].source.url.replace(/&amp;/g, '&');
  }

  // Filter out non-image thumbnails
  const invalidThumbnails = ['self', 'default', 'nsfw', 'spoiler', '', 'image'];
  const thumbnail =
    d.thumbnail && !invalidThumbnails.includes(d.thumbnail) && d.thumbnail.startsWith('http')
      ? d.thumbnail
      : null;

  const isImage =
    d.post_hint === 'image' ||
    d.is_reddit_media_domain ||
    /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(d.url);

  return {
    id: d.id,
    title: d.title,
    url: d.url,
    permalink: `https://www.reddit.com${d.permalink}`,
    subreddit: d.subreddit,
    score: d.score,
    numComments: d.num_comments,
    author: d.author,
    thumbnail,
    selftext: d.selftext ? d.selftext.slice(0, 200) : '',
    createdAt: d.created_utc,
    flair: d.link_flair_text || null,
    isImage,
    preview: previewUrl,
  };
}

async function fetchSubreddit(
  subreddit: string,
  sort: string,
  limit: number,
  token: string
): Promise<RedditPost[]> {
  const url = `https://oauth.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&t=day`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
    // Cache at the Next.js layer for 60 seconds
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch r/${subreddit}: ${response.status}`);
  }

  const json: RedditApiResponse = await response.json();
  return json.data.children.map(normalizePost);
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const subredditParam = searchParams.get('subreddit') || 'all';
  const sort = searchParams.get('sort') || 'hot';
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);

  const validSorts = ['hot', 'new', 'top'];
  const safeSort = validSorts.includes(sort) ? sort : 'hot';

  let targetSubreddits: string[];

  if (subredditParam === 'all') {
    targetSubreddits = [...SUBREDDITS];
  } else {
    targetSubreddits = subredditParam
      .split(',')
      .map((s) => s.trim())
      .filter((s) => SUBREDDITS.includes(s as (typeof SUBREDDITS)[number]));

    if (targetSubreddits.length === 0) {
      return NextResponse.json(
        { error: 'Invalid subreddit(s) specified', posts: [] },
        { status: 400 }
      );
    }
  }

  // Obtain OAuth token (cached between warm invocations)
  let token: string;
  try {
    token = await getAccessToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, posts: [] }, { status: 500 });
  }

  const perSubredditLimit =
    subredditParam === 'all' ? Math.ceil(limit / targetSubreddits.length) : limit;

  // Fetch all subreddits in parallel, handle partial failures gracefully
  const results = await Promise.allSettled(
    targetSubreddits.map((sub) => fetchSubreddit(sub, safeSort, perSubredditLimit, token))
  );

  const posts: RedditPost[] = [];
  const errors: string[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      posts.push(...result.value);
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  // Deduplicate by id
  const seen = new Set<string>();
  const dedupedPosts = posts.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  // Sort merged results
  if (safeSort === 'new') {
    dedupedPosts.sort((a, b) => b.createdAt - a.createdAt);
  } else {
    // hot & top: sort by score
    dedupedPosts.sort((a, b) => b.score - a.score);
  }

  return NextResponse.json({
    posts: dedupedPosts.slice(0, limit),
    errors: errors.length > 0 ? errors : undefined,
    meta: {
      subreddits: targetSubreddits,
      sort: safeSort,
      count: dedupedPosts.length,
    },
  });
}
