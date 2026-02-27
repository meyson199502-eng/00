import { NextRequest, NextResponse } from 'next/server';
import { RedditPost } from '@/app/types/reddit';

const SUBREDDITS = ['artificial', 'ChatGPT', 'LocalLLaMA', 'singularity', 'OpenAI'] as const;

// PullPush.io — open Reddit archive API, no auth required.
// Docs: https://pullpush.io/
const PULLPUSH_BASE = 'https://api.pullpush.io/reddit/search/submission/';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PullPushSubmission {
  id: string;
  title: string;
  url: string;
  permalink: string;
  subreddit: string;
  score: number;
  num_comments: number;
  author: string;
  thumbnail?: string;
  selftext?: string;
  created_utc: number;
  link_flair_text?: string | null;
  is_reddit_media_domain?: boolean;
  post_hint?: string;
  preview?: {
    images: Array<{
      source: { url: string };
    }>;
  };
}

interface PullPushResponse {
  data: PullPushSubmission[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizePost(raw: PullPushSubmission): RedditPost {
  let previewUrl: string | null = null;
  if (raw.preview?.images?.[0]?.source?.url) {
    previewUrl = raw.preview.images[0].source.url.replace(/&amp;/g, '&');
  }

  const invalidThumbnails = ['self', 'default', 'nsfw', 'spoiler', '', 'image'];
  const thumbnail =
    raw.thumbnail &&
    !invalidThumbnails.includes(raw.thumbnail) &&
    raw.thumbnail.startsWith('http')
      ? raw.thumbnail
      : null;

  const isImage =
    raw.post_hint === 'image' ||
    !!raw.is_reddit_media_domain ||
    /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(raw.url);

  return {
    id: raw.id,
    title: raw.title,
    url: raw.url,
    permalink: `https://www.reddit.com${raw.permalink}`,
    subreddit: raw.subreddit,
    score: raw.score ?? 0,
    numComments: raw.num_comments ?? 0,
    author: raw.author ?? '',
    thumbnail,
    selftext: raw.selftext ? raw.selftext.replace(/\[removed\]/g, '').trim().slice(0, 200) : '',
    createdAt: raw.created_utc,
    flair: raw.link_flair_text ?? null,
    isImage,
    preview: previewUrl,
  };
}

// Map sort type to PullPush sort_type parameter
function toSortType(sort: string): string {
  if (sort === 'new') return 'created_utc';
  if (sort === 'top') return 'score';
  // hot — no native equivalent, use score as proxy
  return 'score';
}

async function fetchSubreddit(
  subreddit: string,
  sort: string,
  limit: number
): Promise<RedditPost[]> {
  const params = new URLSearchParams({
    subreddit,
    sort: 'desc',
    sort_type: toSortType(sort),
    size: String(limit),
    // Restrict to posts from the last 7 days so results stay fresh
    after: String(Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60),
  });

  const url = `${PULLPUSH_BASE}?${params}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'AINewsAggregator/2.0' },
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new Error(`PullPush fetch failed for r/${subreddit}: ${response.status}`);
  }

  const json: PullPushResponse = await response.json();

  if (!Array.isArray(json.data)) {
    throw new Error(`Unexpected PullPush response for r/${subreddit}`);
  }

  return json.data.map(normalizePost);
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
