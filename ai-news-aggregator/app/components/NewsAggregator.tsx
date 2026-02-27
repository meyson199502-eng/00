'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { RedditPost, SortType, SubredditFilter } from '@/app/types/reddit';
import PostCard from './PostCard';
import SkeletonCard from './SkeletonCard';

const SUBREDDITS: { value: SubredditFilter; label: string; color: string }[] = [
  { value: 'all', label: 'All', color: '#6366f1' },
  { value: 'artificial', label: 'r/artificial', color: '#f59e0b' },
  { value: 'ChatGPT', label: 'r/ChatGPT', color: '#10b981' },
  { value: 'LocalLLaMA', label: 'r/LocalLLaMA', color: '#3b82f6' },
  { value: 'singularity', label: 'r/singularity', color: '#ec4899' },
  { value: 'OpenAI', label: 'r/OpenAI', color: '#6366f1' },
];

const SUBREDDIT_NAMES = ['artificial', 'ChatGPT', 'LocalLLaMA', 'singularity', 'OpenAI'] as const;

const SORT_OPTIONS: { value: SortType; label: string; icon: string }[] = [
  { value: 'hot', label: 'Hot', icon: '🔥' },
  { value: 'new', label: 'New', icon: '✨' },
  { value: 'top', label: 'Top', icon: '🏆' },
];

const AUTO_REFRESH_INTERVAL = 5 * 60;

// ── Reddit JSON fetch (runs in the user's browser — no server-side blocking) ──

interface RawRedditPost {
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
    preview?: { images: Array<{ source: { url: string } }> };
  };
}

function normalizePost(raw: RawRedditPost): RedditPost {
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

async function fetchSubreddit(subreddit: string, sort: SortType): Promise<RedditPost[]> {
  // Call our own server-side API route which proxies to Reddit.
  // Running on the server means no Origin header is sent to Reddit,
  // so Reddit returns 200 with no CORS issues.
  const params = new URLSearchParams({ subreddit, sort, limit: '25', t: 'day' });
  const res = await fetch(`/api/reddit?${params}`);
  if (!res.ok) throw new Error(`r/${subreddit}: ${res.status}`);
  const json = await res.json();
  return (json.data.children as RawRedditPost[]).map(normalizePost);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatLastUpdated(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewsAggregator() {
  const [selectedSubreddit, setSelectedSubreddit] = useState<SubredditFilter>('all');
  const [sortType, setSortType] = useState<SortType>('hot');
  const [posts, setPosts] = useState<RedditPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshCountdown, setRefreshCountdown] = useState(AUTO_REFRESH_INTERVAL);
  const [subredditCounts, setSubredditCounts] = useState<Record<string, number>>({});

  const autoRefreshRef = useRef(autoRefresh);
  autoRefreshRef.current = autoRefresh;

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const targets =
        selectedSubreddit === 'all'
          ? [...SUBREDDIT_NAMES]
          : [selectedSubreddit];

      // Fetch all subreddits in parallel directly from reddit.com (browser-side)
      const results = await Promise.allSettled(
        targets.map((sub) => fetchSubreddit(sub, sortType))
      );

      const all: RedditPost[] = [];
      const errors: string[] = [];

      for (const r of results) {
        if (r.status === 'fulfilled') all.push(...r.value);
        else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      }

      if (all.length === 0 && errors.length > 0) {
        throw new Error(errors.join(' | '));
      }

      // Deduplicate by id
      const seen = new Set<string>();
      const deduped = all.filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });

      // Sort
      if (sortType === 'new') {
        deduped.sort((a, b) => b.createdAt - a.createdAt);
      } else {
        deduped.sort((a, b) => b.score - a.score);
      }

      setPosts(deduped);

      const counts: Record<string, number> = {};
      for (const post of deduped) {
        counts[post.subreddit] = (counts[post.subreddit] ?? 0) + 1;
      }
      setSubredditCounts(counts);
      setLastUpdated(new Date());
      setRefreshCountdown(AUTO_REFRESH_INTERVAL);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch posts');
    } finally {
      setLoading(false);
    }
  }, [selectedSubreddit, sortType]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (autoRefreshRef.current) fetchPosts();
    }, AUTO_REFRESH_INTERVAL * 1000);
    return () => clearInterval(interval);
  }, [fetchPosts]);

  useEffect(() => {
    if (!autoRefresh) { setRefreshCountdown(AUTO_REFRESH_INTERVAL); return; }
    const tick = setInterval(() => {
      setRefreshCountdown((prev) => (prev <= 1 ? AUTO_REFRESH_INTERVAL : prev - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, [autoRefresh]);

  const totalSubredditCount = (sub: SubredditFilter) =>
    sub === 'all' ? posts.length : (subredditCounts[sub] ?? 0);

  const progressPercent =
    ((AUTO_REFRESH_INTERVAL - refreshCountdown) / AUTO_REFRESH_INTERVAL) * 100;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-[#e2e8f0]">
      {/* Sticky header */}
      <header className="sticky top-0 z-50 border-b border-[#1e1e2e] bg-[#0a0a0f]/90 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-3.5 gap-4">
            {/* Logo */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600 text-lg shadow-lg shadow-indigo-500/20">
                🤖
              </div>
              <div>
                <h1 className="gradient-text text-lg font-black leading-none tracking-tight">
                  AI News
                </h1>
                <p className="text-xs text-[#94a3b8] leading-none mt-0.5 hidden sm:block">
                  What AI community talks about today
                </p>
              </div>
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-3">
              {lastUpdated && (
                <span className="hidden sm:flex items-center gap-1.5 text-xs text-[#4a5568]">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Updated {formatLastUpdated(lastUpdated)}
                </span>
              )}

              <button
                onClick={() => setAutoRefresh((v) => !v)}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border transition-all duration-200 ${
                  autoRefresh
                    ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/25'
                    : 'bg-[#1e1e2e] border-[#2d2d3f] text-[#94a3b8] hover:border-[#3d3d5f]'
                }`}
                title={autoRefresh ? 'Disable auto-refresh' : 'Enable auto-refresh'}
              >
                {autoRefresh ? (
                  <>
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
                    </span>
                    <span className="hidden sm:inline">Auto</span>
                    <span className="font-mono text-indigo-300">{formatCountdown(refreshCountdown)}</span>
                  </>
                ) : (
                  <>
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 4v6h6M23 20v-6h-6" />
                      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
                    </svg>
                    <span className="hidden sm:inline">Paused</span>
                  </>
                )}
              </button>

              <button
                onClick={fetchPosts}
                disabled={loading}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[#1e1e2e] bg-[#111118] text-[#94a3b8] hover:text-white hover:border-[#6366f1] transition-all disabled:opacity-40"
                title="Refresh now"
              >
                <svg
                  className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M1 4v6h6M23 20v-6h-6" />
                  <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
                </svg>
              </button>
            </div>
          </div>

          {autoRefresh && (
            <div className="h-px bg-[#1e1e2e]">
              <div
                className="h-full bg-gradient-to-r from-indigo-600 to-purple-600 transition-all duration-1000 ease-linear"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </div>
      </header>

      {/* Filter bar */}
      <div className="sticky top-[calc(3.5rem+1px)] z-40 border-b border-[#1e1e2e] bg-[#0a0a0f]/95 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 py-3 overflow-x-auto scrollbar-none">
            <div className="flex items-center gap-1.5 shrink-0">
              {SUBREDDITS.map((sub) => {
                const count = totalSubredditCount(sub.value);
                const isActive = selectedSubreddit === sub.value;
                return (
                  <button
                    key={sub.value}
                    onClick={() => setSelectedSubreddit(sub.value)}
                    className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                      isActive
                        ? 'text-white shadow-sm'
                        : 'text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#1e1e2e]'
                    }`}
                    style={
                      isActive
                        ? {
                            backgroundColor: `${sub.color}20`,
                            color: sub.color,
                            boxShadow: `0 0 0 1px ${sub.color}40`,
                          }
                        : undefined
                    }
                  >
                    {sub.label}
                    {count > 0 && (
                      <span
                        className="inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-bold leading-none min-w-[1.25rem]"
                        style={
                          isActive
                            ? { backgroundColor: `${sub.color}30`, color: sub.color }
                            : { backgroundColor: '#1e1e2e', color: '#94a3b8' }
                        }
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="h-5 w-px bg-[#1e1e2e] mx-1 shrink-0" />

            <div className="flex items-center gap-1 shrink-0">
              {SORT_OPTIONS.map((opt) => {
                const isActive = sortType === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setSortType(opt.value)}
                    className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                      isActive
                        ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-sm shadow-indigo-500/20'
                        : 'text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#1e1e2e]'
                    }`}
                  >
                    <span>{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        {!loading && !error && posts.length > 0 && (
          <div className="mb-5 flex items-center justify-between">
            <p className="text-sm text-[#94a3b8]">
              <span className="font-semibold text-[#e2e8f0]">{posts.length}</span>{' '}
              posts from{' '}
              <span className="font-semibold text-[#e2e8f0]">
                {selectedSubreddit === 'all' ? '5 subreddits' : `r/${selectedSubreddit}`}
              </span>
            </p>
            <div className="flex items-center gap-2 text-xs text-[#4a5568]">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span>Live data</span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <div className="h-16 w-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-3xl">
              ⚠️
            </div>
            <div>
              <p className="text-[#e2e8f0] font-semibold text-lg">Failed to load posts</p>
              <p className="text-[#94a3b8] text-sm mt-1">{error}</p>
            </div>
            <button
              onClick={fetchPosts}
              className="rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-2 text-sm font-semibold text-white hover:opacity-90 transition-opacity shadow-lg shadow-indigo-500/20"
            >
              Try again
            </button>
          </div>
        )}

        {loading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {!loading && !error && posts.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post, index) => (
              <PostCard key={post.id} post={post} index={index} />
            ))}
          </div>
        )}

        {!loading && !error && posts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <div className="h-16 w-16 rounded-2xl bg-[#111118] border border-[#1e1e2e] flex items-center justify-center text-3xl">
              🤖
            </div>
            <div>
              <p className="text-[#e2e8f0] font-semibold text-lg">No posts found</p>
              <p className="text-[#94a3b8] text-sm mt-1">
                Try a different subreddit or sort option
              </p>
            </div>
            <button
              onClick={fetchPosts}
              className="rounded-lg bg-[#1e1e2e] border border-[#2d2d3f] px-5 py-2 text-sm font-medium text-[#e2e8f0] hover:bg-[#2d2d3f] transition-colors"
            >
              Refresh
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1e1e2e] mt-12 py-6 text-center">
        <p className="text-xs text-[#4a5568]">
          Data from Reddit · Not affiliated with Reddit ·{' '}
          <span className="gradient-text font-semibold">AI News Aggregator</span>
          {' '}·{' '}
          <span className="font-mono text-[#2d2d3f] bg-[#1a1a2e] px-1.5 py-0.5 rounded text-[10px]">v3.2.0</span>
        </p>
      </footer>
    </div>
  );
}
