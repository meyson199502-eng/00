import type { Metadata } from 'next';
import NewsAggregator from './components/NewsAggregator';

export const metadata: Metadata = {
  title: "AI News Aggregator — Reddit's AI Community Today",
  description:
    "Stay up to date with the latest AI news, discussions, and breakthroughs from Reddit's top AI communities: r/artificial, r/ChatGPT, r/LocalLLaMA, r/singularity, and r/OpenAI.",
};

export default function Home() {
  return <NewsAggregator />;
}
