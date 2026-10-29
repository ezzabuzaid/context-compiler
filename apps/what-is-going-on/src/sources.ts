// The sites the reader reads. A lab publishes primary reports; an outlet
// covers them. A source with a feed is read through its feed; a source
// without one through its blog page and the posts that page links to.
// Probed 2026-10-28 (backlog #3205): robots.txt allows all of them, and the
// outlets were free to read then.
export type Source = {
  readonly name: string;
  readonly kind: 'lab' | 'outlet';
  readonly site: string;
  readonly feed: string | null;
  // The URLPattern of the posts: a crawl of the blog page reads the links
  // that match it. Most blogs keep their posts under the blog page itself.
  readonly posts: string;
};

// The URLPattern of every address under url's path.
export function under(url: string) {
  const { origin, pathname } = new URL(url);
  return `${origin}${pathname.replace(/\/$/, '').replace(/[\\:*?+(){}]/g, '\\$&')}/*`;
}

const lab = (
  name: string,
  site: string,
  feed: string | null = null,
  posts = under(site),
): Source => ({ name, kind: 'lab', site, feed, posts });
const outlet = (name: string, site: string, feed: string): Source => ({
  name,
  kind: 'outlet',
  site,
  feed,
  posts: under(site),
});

export default [
  // One path segment: /research/team/economics is a team page, not a post.
  lab(
    'Anthropic',
    'https://www.anthropic.com/news',
    null,
    'https://www.anthropic.com/news/:slug',
  ),
  lab(
    'Anthropic',
    'https://www.anthropic.com/research',
    null,
    'https://www.anthropic.com/research/:slug',
  ),
  lab(
    'Anthropic',
    'https://www.anthropic.com/engineering',
    null,
    'https://www.anthropic.com/engineering/:slug',
  ),
  lab('OpenAI', 'https://openai.com/news/', 'https://openai.com/news/rss.xml'),
  // The blog page moved to /news (2026-10-29); the posts stay under /blog.
  lab(
    'Liquid AI',
    'https://www.liquid.ai/news',
    null,
    'https://www.liquid.ai/blog/*',
  ),
  lab(
    'Google DeepMind',
    'https://deepmind.google/discover/blog/',
    'https://deepmind.google/blog/rss.xml',
  ),
  lab('Google Research', 'https://research.google/blog/'),
  lab('Meta AI', 'https://ai.meta.com/blog/'),
  lab('xAI', 'https://x.ai/news'),
  lab('Mistral', 'https://mistral.ai/news', 'https://mistral.ai/news/rss'),
  lab('Cohere', 'https://cohere.com/blog'),
  lab('AI21', 'https://www.ai21.com/blog/'),
  lab(
    'Hugging Face',
    'https://huggingface.co/blog',
    'https://huggingface.co/blog/feed.xml',
  ),
  lab('Ai2', 'https://allenai.org/blog', 'https://allenai.org/rss.xml'),
  lab(
    'Apple ML Research',
    'https://machinelearning.apple.com/research',
    'https://machinelearning.apple.com/rss.xml',
  ),
  lab(
    'Microsoft Research',
    'https://www.microsoft.com/en-us/research/blog/',
    'https://www.microsoft.com/en-us/research/feed/',
  ),
  lab(
    'NVIDIA',
    'https://developer.nvidia.com/blog/',
    'https://developer.nvidia.com/blog/feed',
  ),
  lab('Amazon Science', 'https://www.amazon.science/blog'),
  lab(
    'Thinking Machines',
    'https://thinkingmachines.ai/blog/',
    'https://thinkingmachines.ai/blog/index.xml',
  ),
  lab('Sakana AI', 'https://sakana.ai/blog/', 'https://sakana.ai/feed.xml'),
  lab('Qwen', 'https://qwenlm.github.io/blog/'),
  lab('DeepSeek', 'https://api-docs.deepseek.com/news/'),
  lab('MiniMax', 'https://www.minimax.io/news'),
  lab('Perplexity', 'https://www.perplexity.ai/hub/blog'),
  lab(
    'Together AI',
    'https://www.together.ai/blog',
    'https://www.together.ai/blog/rss.xml',
  ),
  lab('Reka', 'https://reka.ai/news'),
  lab(
    'Stability AI',
    'https://stability.ai/news',
    'https://stability.ai/news-updates?format=rss',
  ),
  lab('Runway', 'https://runway.com/research'),
  lab(
    'ElevenLabs',
    'https://elevenlabs.io/blog',
    'https://elevenlabs.io/blog/rss.xml',
  ),
  lab('Physical Intelligence', 'https://www.pi.website/blog'),
  lab('Prime Intellect', 'https://www.primeintellect.ai/blog'),
  lab('Nous Research', 'https://nousresearch.com/blog/'),
  lab('Cartesia', 'https://www.cartesia.ai/blog'),
  lab('Cerebras', 'https://www.cerebras.ai/blog'),
  lab('Groq', 'https://groq.com/blog'),
  outlet(
    'TechCrunch',
    'https://techcrunch.com/',
    'https://techcrunch.com/category/artificial-intelligence/feed/',
  ),
  outlet(
    'Ars Technica',
    'https://arstechnica.com/',
    'https://arstechnica.com/ai/feed/',
  ),
  outlet(
    'SiliconANGLE',
    'https://siliconangle.com/',
    'https://siliconangle.com/feed/',
  ),
  outlet(
    'Engadget',
    'https://www.engadget.com/',
    'https://www.engadget.com/rss.xml',
  ),
  outlet(
    'ZDNET',
    'https://www.zdnet.com/',
    'https://www.zdnet.com/topic/artificial-intelligence/rss.xml',
  ),
  outlet(
    '404 Media',
    'https://www.404media.co/',
    'https://www.404media.co/rss/',
  ),
  outlet(
    'Semafor',
    'https://www.semafor.com/',
    'https://www.semafor.com/rss.xml',
  ),
  outlet(
    '9to5Google',
    'https://9to5google.com/',
    'https://9to5google.com/feed/',
  ),
  outlet('Unite.AI', 'https://www.unite.ai/', 'https://www.unite.ai/feed/'),
  outlet(
    'MarkTechPost',
    'https://www.marktechpost.com/',
    'https://www.marktechpost.com/feed/',
  ),
] satisfies readonly Source[];

// Outlets the reader does not read, and why (probe of 2026-10-28). Paywall
// status changes, so this list is a record of that probe, not a rule.
export const leftOut: readonly { name: string; reason: string }[] = [
  { name: 'The Decoder', reason: 'paywall on some articles' },
  { name: 'The Verge', reason: 'paywall' },
  { name: 'Fortune', reason: 'paywall' },
  { name: 'Axios', reason: 'paywall' },
  { name: 'The Information', reason: 'paywall' },
  { name: 'Business Insider', reason: 'paywall' },
  { name: 'Wired', reason: 'metered' },
  { name: 'MIT Technology Review', reason: 'metered' },
  { name: 'The Register', reason: 'robots.txt refuses this reader' },
  { name: 'VentureBeat', reason: 'feed answered 429' },
  { name: 'The Next Web', reason: 'feed answered 404' },
  { name: 'Z.ai (GLM)', reason: 'blog page answered 404' },
];
