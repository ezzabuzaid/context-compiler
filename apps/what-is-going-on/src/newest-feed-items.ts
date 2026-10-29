import { ListingReader } from '@workspace/sdk-web-crawler';

// Feeds list their newest items first. A feed can hold a lab's whole
// archive (OpenAI's lists 1,332 posts), so a first crawl reads only its
// newest items, and the feed's pagination, sitemaps and robots.txt sitemaps
// are not followed. The crawler revisits a feed before its items roll off,
// so later crawls miss nothing while fewer than this many posts appear
// between two visits.
const newest = 20;

export class NewestFeedItems extends ListingReader {
  override async read(...args: Parameters<ListingReader['read']>) {
    const findings = await super.read(...args);
    return findings.filter(({ page }) => page).slice(0, newest);
  }
}
