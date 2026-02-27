import { NextRequest, NextResponse } from 'next/server';
import { RedditPost } from '@/app/types/reddit';

const SUBREDDITS = ['artificial', 'ChatGPT', 'LocalLLaMA', 'singularity', 'OpenAI'] as const;
const USER_AGENT = 'AINewsAggregator/1.0';

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
  limit: number
): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&t=day`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
    },
    next: { revalidate: 60 }, // cache for 60 seconds
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch r/${subreddit}: ${response.status}`);
  }

  const json: RedditApiResponse = await response.json();
  return json.data.children.map(normalizePost);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const subredditParam = searchParams.get('subreddit') || 'all';
  const sort = searchParams.get('sort') || 'hot';
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);

  const validSorts = ['hot', 'new', 'top'];
  const safeSsort = validSorts.includes(sort) ? sort : 'hot';

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

  const perSubredditLimit = subredditParam === 'all' ? Math.ceil(limit / targetSubreddits.length) : limit;

  // Fetch all subreddits in parallel, handle partial failures gracefully
  const results = await Promise.allSettled(
    targetSubreddits.map((sub) => fetchSubreddit(sub, safeSsort, perSubredditLimit))
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
  if (safeSsort === 'new') {
    dedupedPosts.sort((a, b) => b.createdAt - a.createdAt);
  } else if (safeSsort === 'top') {
    dedupedPosts.sort((a, b) => b.score - a.score);
  } else {
    // hot: sort by score as a proxy
    dedupedPosts.sort((a, b) => b.score - a.score);
  }

  return NextResponse.json({
    posts: dedupedPosts.slice(0, limit),
    errors: errors.length > 0 ? errors : undefined,
    meta: {
      subreddits: targetSubreddits,
      sort: safeSsort,
      count: dedupedPosts.length,
    },
  });
}
