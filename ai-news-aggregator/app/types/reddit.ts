export interface RedditPost {
  id: string;
  title: string;
  url: string;
  permalink: string;
  /** HN category key (ai | chatgpt | localai | singularity | openai) */
  subreddit: string;
  score: number;
  numComments: number;
  author: string;
  thumbnail: string | null;
  selftext: string;
  createdAt: number;
  flair: string | null;
  isImage: boolean;
  preview: string | null;
}

export type SortType = 'hot' | 'new' | 'top';
export type SubredditFilter = 'all' | 'ai' | 'chatgpt' | 'localai' | 'singularity' | 'openai';
