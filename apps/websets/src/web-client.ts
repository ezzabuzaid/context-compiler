import { join } from 'node:path';

import { WebClient } from '@eltjs/source-web-pages/web-client';

import directory from './directory.ts';

// The HTTP of the crawl and of each fetch: one HTTP cache, and one record of
// each website (its robots.txt, its delay and its block), so a page read on
// demand and the crawl ask a website as one polite crawler. The crawler's
// name is what robots.txt groups match (RFC 9309). main.ts closes it.
export default await WebClient.open(
  join(directory, 'web-http.sqlite'),
  'Websets/0.1 (+https://github.com/ezzabuzaid/context-compiler)',
  undefined,
  globalThis,
);
