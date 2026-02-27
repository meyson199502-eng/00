export default function SkeletonCard() {
  return (
    <div
      className="rounded-xl border border-[#1e1e2e] bg-[#111118] overflow-hidden"
      aria-hidden="true"
    >
      {/* Image placeholder */}
      <div className="skeleton-pulse h-44 bg-[#1a1a2e]" />

      <div className="p-4 space-y-3">
        {/* Subreddit badge */}
        <div className="flex items-center gap-2">
          <div className="skeleton-pulse h-5 w-20 rounded-full bg-[#1e1e2e]" />
          <div className="skeleton-pulse h-5 w-16 rounded-full bg-[#1e1e2e]" />
        </div>

        {/* Title lines */}
        <div className="space-y-2">
          <div className="skeleton-pulse h-4 w-full rounded bg-[#1e1e2e]" />
          <div className="skeleton-pulse h-4 w-5/6 rounded bg-[#1e1e2e]" />
          <div className="skeleton-pulse h-4 w-4/6 rounded bg-[#1e1e2e]" />
        </div>

        {/* Meta row */}
        <div className="flex items-center justify-between pt-2 border-t border-[#1e1e2e]">
          <div className="flex items-center gap-3">
            <div className="skeleton-pulse h-5 w-14 rounded bg-[#1e1e2e]" />
            <div className="skeleton-pulse h-5 w-14 rounded bg-[#1e1e2e]" />
          </div>
          <div className="skeleton-pulse h-4 w-20 rounded bg-[#1e1e2e]" />
        </div>
      </div>
    </div>
  );
}
