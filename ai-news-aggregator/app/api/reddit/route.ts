import { NextRequest, NextResponse } from 'next/server';
import { RedditPost } from '@/app/types/reddit';

const SUBREDDITS = ['artificial', 'ChatGPT', 'LocalLLaMA', 'singularity', 'OpenAI'] as const;

// Arctic Shift — real-time Reddit archive API, no auth required.
// Docs: https://github.com/ArthurHeitmann/arctic_shift/tree/master/api
const ARCTIC_BASE = 'https://arctic-shift.photon-reddit.com/api/posts/search';

const DAYS_BACK = 7;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ArcticPost {
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
      source: { url: string; width: number; height: number };
    }>;
  };
}

interface ArcticResponse {
  data: ArcticPost[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizePost(raw: ArcticPost): RedditPost {
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
    selftext: raw.selftext
      ? raw.selftext.replace(/\[removed\]/g, '').trim().slice(0, 200)
      : '',
    createdAt: raw.created_utc,
    flair: raw.link_flair_text ?? null,
    isImage,
    preview: previewUrl,
  };
}

function afterDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - DAYS_BACK);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

async function fetchSubreddit(
  subreddit: string,
  sort: string,
  limit: number
): Promise<RedditPost[]> {
  // Arctic Shift only sorts by created_utc.
  // For hot/top: fetch more posts and re-sort by score client-side.
  const fetchLimit = sort === 'new' ? limit : Math.min(limit * 4, 100);

  const params = new URLSearchParams({
    subreddit,
    limit: String(fetchLimit),
    sort: 'desc',
    after: afterDate(),
  });

  const response = await fetch(`${ARCTIC_BASE}?${params}`, {
    headers: { 'User-Agent': 'AINewsAggregator/3.0' },
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new Error(`Arctic Shift fetch failed for r/${subreddit}: ${response.status}`);
  }

  const json: ArcticResponse = await response.json();

  if (!Array.isArray(json.data)) {
    throw new Error(`Unexpected Arctic Shift response for r/${subreddit}`);
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
