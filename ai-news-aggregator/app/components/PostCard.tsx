'use client';

import Image from 'next/image';
import { RedditPost } from '@/app/types/reddit';

const SUBREDDIT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  artificial: { bg: 'rgba(245,158,11,0.15)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
  ChatGPT: { bg: 'rgba(16,185,129,0.15)', text: '#10b981', border: 'rgba(16,185,129,0.3)' },
  LocalLLaMA: { bg: 'rgba(59,130,246,0.15)', text: '#3b82f6', border: 'rgba(59,130,246,0.3)' },
  singularity: { bg: 'rgba(236,72,153,0.15)', text: '#ec4899', border: 'rgba(236,72,153,0.3)' },
  OpenAI: { bg: 'rgba(99,102,241,0.15)', text: '#6366f1', border: 'rgba(99,102,241,0.3)' },
};

function formatScore(score: number): string {
  if (score >= 1000) {
    return `${(score / 1000).toFixed(1)}k`;
  }
  return score.toString();
}

function timeAgo(createdAt: number): string {
  const seconds = Math.floor(Date.now() / 1000 - createdAt);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins} min ago`;
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  }
  const days = Math.floor(seconds / 86400);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

interface PostCardProps {
  post: RedditPost;
  index: number;
}

export default function PostCard({ post, index }: PostCardProps) {
  const colors = SUBREDDIT_COLORS[post.subreddit] ?? {
    bg: 'rgba(99,102,241,0.15)',
    text: '#6366f1',
    border: 'rgba(99,102,241,0.3)',
  };

  const isTrending = post.score > 5000;

  return (
    <article
      className="card-glow card-enter group relative flex flex-col rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden cursor-pointer"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Preview image */}
      {post.preview && (
        <a
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="relative block overflow-hidden"
          style={{ aspectRatio: '16/9' }}
          tabIndex={-1}
          aria-hidden="true"
        >
          <Image
            src={post.preview}
            alt={post.title}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            unoptimized
          />
          <div className="image-overlay absolute inset-0" />
          {isTrending && (
            <div className="trending-badge absolute top-3 left-3 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-orange-400 backdrop-blur-sm border border-orange-500/30">
              🔥 Trending
            </div>
          )}
        </a>
      )}

      {/* Card content */}
      <div className="flex flex-col flex-1 p-4 gap-3">
        {/* Badges row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Subreddit badge */}
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border"
            style={{
              backgroundColor: colors.bg,
              color: colors.text,
              borderColor: colors.border,
            }}
          >
            r/{post.subreddit}
          </span>

          {/* Flair badge */}
          {post.flair && (
            <span className="inline-flex items-center rounded-full bg-[#1e1e2e] px-2.5 py-0.5 text-xs text-[#94a3b8] border border-[#2d2d3f] truncate max-w-[140px]">
              {post.flair}
            </span>
          )}

          {/* Trending badge (when no image) */}
          {isTrending && !post.preview && (
            <span className="trending-badge inline-flex items-center gap-1 rounded-full bg-orange-500/10 border border-orange-500/30 px-2.5 py-0.5 text-xs font-semibold text-orange-400">
              🔥 Trending
            </span>
          )}
        </div>

        {/* Title */}
        <a
          href={post.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-sm font-semibold leading-snug text-[#e2e8f0] hover:text-white line-clamp-3 transition-colors duration-150"
        >
          {post.title}
        </a>

        {/* Selftext preview */}
        {post.selftext && (
          <p className="text-xs text-[#94a3b8] line-clamp-2 leading-relaxed">
            {post.selftext}
          </p>
        )}

        {/* Meta row */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-3 border-t border-[#1e1e2e]">
          <div className="flex items-center gap-3">
            {/* Score */}
            <span className="score-pill flex items-center gap-1 text-xs font-semibold text-[#e2e8f0]">
              <span className="text-[#f59e0b]">▲</span>
              {formatScore(post.score)}
            </span>

            {/* Comments */}
            <a
              href={post.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-[#94a3b8] hover:text-[#e2e8f0] transition-colors"
            >
              <span>💬</span>
              <span>{formatScore(post.numComments)}</span>
            </a>
          </div>

          <div className="flex flex-col items-end gap-0.5">
            {/* Author */}
            <span className="text-xs text-[#6366f1] font-medium truncate max-w-[100px]">
              u/{post.author}
            </span>
            {/* Time */}
            <span className="text-xs text-[#4a5568]">{timeAgo(post.createdAt)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}
