import { Shutdown } from '@zukhruf/shutdown';

import { CrawlLog } from './crawl-log.ts';
import pipeline from './pipeline.ts';

using shutdown = new Shutdown();
using _log = new CrawlLog();
// One pass: the crawl of the input to its end, or to the stop.
await pipeline.run({ signal: shutdown.signal });
