import {
  type FetchFnOptions,
  type FetchFnResponse,
  discoverFeeds,
} from 'feedscout';
import { defaultExtractFn } from 'feedscout/feeds';

import { userAgent } from './pipeline.ts';
import { type Source, under } from './sources.ts';

// What the user reads about a site that cannot be added.
export class SiteError extends Error {}

// Asks as the crawler does, under its own name.
async function fetchFn(
  url: string,
  options?: FetchFnOptions,
): Promise<FetchFnResponse> {
  const response = await fetch(url, {
    method: options?.method,
    body: options?.body,
    headers: { ...options?.headers, 'user-agent': userAgent },
    signal: AbortSignal.timeout(15_000),
  });
  return {
    headers: response.headers,
    body: await response.text(),
    url: response.url,
    status: response.status,
  };
}

// How to read an address, as sources.ts lays the sources out: a feed is
// read as itself; a page that advertises a feed (<link rel="alternate">, or a
// Link header) through that feed; any other page through the posts it links
// to under its own path. Redirects are followed once here, so the source
// names the final addresses.
export async function discoverSite(
  address: string,
  kind: Source['kind'],
): Promise<Source> {
  const answer = await fetchFn(address).catch((error: unknown) => {
    throw new SiteError(
      `${address} did not answer (${Error.isError(error) ? error.message : String(error)}).`,
    );
  });
  if (answer.status !== 200)
    throw new SiteError(`${address} answered ${answer.status}.`);
  const url = answer.url;
  const content = String(answer.body);
  const host = new URL(url).host.replace(/^www\./, '');
  const own = await defaultExtractFn({
    url,
    content,
    headers: answer.headers,
    status: answer.status,
  });
  if (own.isValid) {
    const site = own.siteUrl ?? `${new URL(url).origin}/`;
    return {
      name: own.title?.trim() || host,
      kind,
      site,
      feed: url,
      posts: under(site),
    };
  }
  const advertised = (
    await discoverFeeds(
      { url, content, headers: answer.headers, status: answer.status },
      { methods: ['html', 'headers'], fetchFn, stopOnFirstResult: true },
    )
  ).find((feed) => feed.isValid);
  return advertised?.isValid
    ? {
        name: advertised.title?.trim() || host,
        kind,
        site: url,
        feed: advertised.url,
        posts: under(url),
      }
    : { name: host, kind, site: url, feed: null, posts: under(url) };
}
