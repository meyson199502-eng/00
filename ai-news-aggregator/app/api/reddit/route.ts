import { NextRequest, NextResponse } from 'next/server';
import { RedditPost } from '@/app/types/reddit';

// Edge Runtime uses a different TLS stack (not Node.js) which bypasses
// Cloudflare's server-IP blocking that affects regular serverless functions.
export const runtime = 'edge';

const SUBREDDITS = ['artificial', 'ChatGPT', 'LocalLLaMA', 'singularity', 'OpenAI'] as const;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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
        source: { url: string; width: number; height: number };
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

function normalizePost(raw: RedditApiPost): RedditPost {
  const d = raw.data;

  let previewUrl: string | null = null;
  if (d.preview?.images?.[0]?.source?.url) {
    previewUrl = d.preview.images[0].source.url.replace(/&amp;/g, '&');
  }

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
  limit: number
): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&t=day`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    },
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

  const perSubredditLimit =
    subredditParam === 'all' ? Math.ceil(limit / targetSubreddits.length) : limit;

  const results = await Promise.allSettled(
    targetSubreddits.map((sub) => fetchSubreddit(sub, safeSort, perSubredditLimit))
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
