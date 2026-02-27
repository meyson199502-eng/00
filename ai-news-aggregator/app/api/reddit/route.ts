import { NextRequest, NextResponse } from 'next/server';
import { RedditPost } from '@/app/types/reddit';

// ── Hacker News topic configuration ──────────────────────────────────────────
// We map the legacy "subreddit" concept to HN search queries / tags.
// The "source" field in RedditPost is set to the category key.

const CATEGORIES = {
  ai: { label: 'AI', query: 'artificial intelligence OR machine learning OR LLM OR GPT OR Claude' },
  chatgpt: { label: 'ChatGPT', query: 'ChatGPT OR GPT-4 OR OpenAI chat' },
  localai: { label: 'Local AI', query: 'local LLM OR llama OR mistral OR ollama OR open-source LLM' },
  singularity: { label: 'Singularity', query: 'AGI OR singularity OR superintelligence' },
  openai: { label: 'OpenAI', query: 'OpenAI OR GPT OR DALL-E OR Sora' },
} as const;

type CategoryKey = keyof typeof CATEGORIES;
const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[];

// ── Algolia HN API types ──────────────────────────────────────────────────────

interface HNHit {
  objectID: string;
  title: string;
  url?: string;
  story_text?: string;
  author: string;
  points: number;
  num_comments: number;
  created_at_i: number; // unix seconds
  _tags: string[];
}

interface HNSearchResponse {
  hits: HNHit[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeHit(hit: HNHit, category: CategoryKey): RedditPost {
  const storyUrl = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;

  return {
    id: hit.objectID,
    title: hit.title ?? '(no title)',
    url: storyUrl,
    permalink: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    subreddit: category,
    score: hit.points ?? 0,
    numComments: hit.num_comments ?? 0,
    author: hit.author ?? '',
    thumbnail: null,
    selftext: hit.story_text ? hit.story_text.replace(/<[^>]+>/g, '').slice(0, 200) : '',
    createdAt: hit.created_at_i,
    flair: CATEGORIES[category].label,
    isImage: false,
    preview: null,
  };
}

async function fetchCategory(
  category: CategoryKey,
  sort: string,
  limit: number
): Promise<RedditPost[]> {
  const { query } = CATEGORIES[category];

  // Algolia HN has two endpoints:
  //   /search       → relevance + points (best for "hot" / "top")
  //   /search_by_date → newest first (best for "new")
  const endpoint = sort === 'new' ? 'search_by_date' : 'search';

  const params = new URLSearchParams({
    query,
    tags: 'story',
    hitsPerPage: String(limit),
  });

  const url = `https://hn.algolia.com/api/v1/${endpoint}?${params}`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'AINewsAggregator/2.0' },
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new Error(`HN Algolia fetch failed for category "${category}": ${response.status}`);
  }

  const json: HNSearchResponse = await response.json();
  return json.hits.map((hit) => normalizeHit(hit, category));
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // "subreddit" param kept for API compatibility with the client
  const subredditParam = searchParams.get('subreddit') || 'all';
  const sort = searchParams.get('sort') || 'hot';
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);

  const validSorts = ['hot', 'new', 'top'];
  const safeSort = validSorts.includes(sort) ? sort : 'hot';

  let targetCategories: CategoryKey[];

  if (subredditParam === 'all') {
    targetCategories = [...CATEGORY_KEYS];
  } else {
    targetCategories = subredditParam
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is CategoryKey => CATEGORY_KEYS.includes(s as CategoryKey));

    if (targetCategories.length === 0) {
      return NextResponse.json(
        { error: 'Invalid category specified', posts: [] },
        { status: 400 }
      );
    }
  }

  const perCategoryLimit =
    subredditParam === 'all' ? Math.ceil(limit / targetCategories.length) : limit;

  const results = await Promise.allSettled(
    targetCategories.map((cat) => fetchCategory(cat, safeSort, perCategoryLimit))
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

  // Deduplicate by id (same story can match multiple queries)
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
      subreddits: targetCategories,
      sort: safeSort,
      count: dedupedPosts.length,
    },
  });
}
