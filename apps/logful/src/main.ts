import { Shutdown } from '@zukhruf/shutdown';

import { GotLog } from './got-log.ts';
import pipeline from './pipeline.ts';

using shutdown = new Shutdown();
using _log = new GotLog();
// One pass: the crawl of the input to its end, or to the stop.
await pipeline.run({ signal: shutdown.signal });
