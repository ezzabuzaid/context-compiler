import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
import {
  external_exports
} from "../../chunks/chunk-GQVWDH3D.mjs";
import {
  byId
} from "../../chunks/chunk-KUQKM2Y4.mjs";
import {
  AppleConnector
} from "../../chunks/chunk-2LTQDBCX.mjs";
import {
  Catalog,
  ClosedWorld,
  Retention,
  Source,
  Stream,
  diffGroupedSnapshot,
  diffSnapshot,
  isTimestamp,
  validateRecords
} from "../../chunks/chunk-57KDDNKG.mjs";
import {
  __callDispose,
  __using
} from "../../chunks/chunk-ZGXE7NZW.mjs";

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/instagram-web-source.js
import { setInterval } from "node:timers/promises";

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sdks/chromium/cookies/dist/chromium-browser.js
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var ChromiumBrowser = class {
  name;
  folder;
  service;
  account;
  constructor(name, folder, service, account2) {
    this.name = name;
    this.folder = folder;
    this.service = service;
    this.account = account2;
  }
  // Read when asked, so a profile made after the module loaded is found.
  profiles() {
    const root = join(homedir(), "Library/Application Support", this.folder);
    if (!existsSync(root))
      return [];
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "Cookies"))).map((entry) => ({
      name: entry.name,
      cookies: join(root, entry.name, "Cookies")
    }));
  }
};
var chromiumBrowsers = [
  new ChromiumBrowser("Dia", "Dia/User Data", "Dia Safe Storage", "Dia"),
  new ChromiumBrowser("Google Chrome", "Google/Chrome", "Chrome Safe Storage", "Chrome"),
  new ChromiumBrowser("Arc", "Arc/User Data", "Arc Safe Storage", "Arc"),
  new ChromiumBrowser("Microsoft Edge", "Microsoft Edge", "Microsoft Edge Safe Storage", "Microsoft Edge"),
  new ChromiumBrowser("Brave", "BraveSoftware/Brave-Browser", "Brave Safe Storage", "Brave")
];

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sdks/chromium/cookies/dist/cookie-store.js
import { createDecipheriv, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sdks/chromium/cookies/dist/errors.js
var SafeStorageUnavailableError = class extends Error {
  browser;
  constructor(browser, service, options2) {
    super(`${service} could not be read from the login keychain. Allow access when macOS asks for "${service}", then sync again.`, options2);
    this.name = "SafeStorageUnavailableError";
    this.browser = browser;
  }
};
var CookieDecryptionError = class extends Error {
  constructor(browser, host, name, options2) {
    super(`${browser}'s ${name} cookie for ${host} could not be decrypted with its Safe Storage key`, options2);
    this.name = "CookieDecryptionError";
  }
};
var BrowserSessionNotFoundError = class extends Error {
  constructor(host, cookie, checked) {
    super(`No browser profile holds an unexpired ${cookie} cookie for ${host}. Sign in to ${host} in ${checked.length === 0 ? "Dia, Google Chrome, Arc, Microsoft Edge or Brave" : checked.join(", ")}, then sync again.`);
    this.name = "BrowserSessionNotFoundError";
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sdks/chromium/cookies/dist/cookie-store.js
var epochOffset = 11644473600000000n;
var CookieStore = class {
  #database;
  constructor(path) {
    this.#database = new DatabaseSync(path, { readOnly: true, timeout: 5e3 });
  }
  // When the named cookie that url is sent with expires, in Chromium's
  // microseconds; null when the profile has none that is still valid.
  expiry(url, name) {
    const hosts = hostKeys(url);
    const statement = this.#database.prepare(`SELECT max(expires_utc) AS expires FROM cookies
       WHERE name = ? AND host_key IN (${hosts.map(() => "?").join(", ")})
         AND (has_expires = 0 OR expires_utc > ?)`);
    statement.setReadBigInts(true);
    const row = statement.get(name, ...hosts, now());
    return typeof row?.expires === "bigint" ? row.expires : null;
  }
  // The cookies the browser sends with a request to url, by name; a cookie
  // set for the exact host overrides one set for its domain.
  cookies(url, key, browser) {
    const version = Number(this.#database.prepare(`SELECT value FROM meta WHERE key = 'version'`).get()?.value);
    if (!(version >= 24))
      throw new TypeError(`${browser}'s cookie store is version ${version}; this package reads version 24 and later`);
    const hosts = hostKeys(url);
    const rows = this.#database.prepare(`SELECT host_key, name, encrypted_value FROM cookies
         WHERE host_key IN (${hosts.map(() => "?").join(", ")})
           AND (has_expires = 0 OR expires_utc > ?)
         ORDER BY length(host_key), host_key`).all(...hosts, now());
    const cookies = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const host = String(row.host_key);
      const name = String(row.name);
      cookies.set(name, decrypt(row.encrypted_value, key, { browser, host, name }));
    }
    return cookies;
  }
  [Symbol.dispose]() {
    this.#database.close();
  }
};
function hostKeys(url) {
  const labels = url.hostname.split(".");
  const parents = labels.slice(0, -1).map((_, index) => `.${labels.slice(index).join(".")}`);
  return [url.hostname, ...parents];
}
function now() {
  return BigInt(Date.now()) * 1000n + epochOffset;
}
function decrypt(encrypted, key, cookie) {
  const failed = (cause) => new CookieDecryptionError(cookie.browser, cookie.host, cookie.name, {
    cause
  });
  if (!(encrypted instanceof Uint8Array))
    throw failed();
  const blob = Buffer.from(encrypted);
  if (blob.subarray(0, 3).toString("latin1") !== "v10")
    throw failed();
  let value;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
    value = Buffer.concat([
      decipher.update(blob.subarray(3)),
      decipher.final()
    ]);
  } catch (cause) {
    throw failed(cause);
  }
  const digest = createHash("sha256").update(cookie.host).digest();
  if (!value.subarray(0, 32).equals(digest))
    throw failed();
  return value.subarray(32).toString("utf8");
}

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sdks/chromium/cookies/dist/safe-storage.js
import { execFile } from "node:child_process";
import { pbkdf2Sync } from "node:crypto";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
import { promisify } from "node:util";
var run = promisify(execFile);
async function safeStorageKey(browser) {
  const keychain = join2(homedir2(), "Library/Keychains/login.keychain-db");
  let password;
  try {
    const { stdout } = await run("/usr/bin/security", [
      "find-generic-password",
      "-w",
      "-s",
      browser.service,
      "-a",
      browser.account,
      keychain
    ]);
    password = stdout.replace(/\n$/, "");
  } catch (cause) {
    throw new SafeStorageUnavailableError(browser.name, browser.service, {
      cause
    });
  }
  return pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
}

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sdks/chromium/cookies/dist/browser-session.js
var BrowserSession = class _BrowserSession {
  browser;
  profile;
  cookies;
  constructor(browser, profile, cookies) {
    this.browser = browser;
    this.profile = profile;
    this.cookies = cookies;
  }
  // The session of the profile, in any Chromium browser, whose sign-in
  // cookie for url expires last, so the session the user signed in to most
  // recently wins over an older one. Only that browser's key is read.
  static async newest(url, cookie) {
    var _stack2 = [];
    try {
      const target = new URL(url);
      let newest = null;
      for (const browser of chromiumBrowsers)
        for (const profile of browser.profiles()) {
          var _stack = [];
          try {
            const store2 = __using(_stack, new CookieStore(profile.cookies));
            const expires = store2.expiry(target, cookie);
            if (expires !== null && (newest === null || expires > newest.expires))
              newest = { browser, profile, expires };
          } catch (_) {
            var _error = _, _hasError = true;
          } finally {
            __callDispose(_stack, _error, _hasError);
          }
        }
      if (newest === null)
        throw new BrowserSessionNotFoundError(target.hostname, cookie, chromiumBrowsers.filter((browser) => browser.profiles().length > 0).map(({ name }) => name));
      const key = await safeStorageKey(newest.browser);
      const store = __using(_stack2, new CookieStore(newest.profile.cookies));
      return new _BrowserSession(newest.browser.name, newest.profile.name, store.cookies(target, key, newest.browser.name));
    } catch (_2) {
      var _error2 = _2, _hasError2 = true;
    } finally {
      __callDispose(_stack2, _error2, _hasError2);
    }
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sdks/instagram/web/dist/errors.js
var InstagramLoginError = class extends Error {
  constructor(what, options2) {
    super(`Instagram did not answer ${what} for a signed-in session: sign in to Instagram again in your browser, then sync again.`, options2);
    this.name = "InstagramLoginError";
  }
};
var InstagramRateLimitError = class extends Error {
  constructor(what) {
    super(`Instagram asked to wait before it answers ${what}. The next sync goes on from the last page this one loaded.`);
    this.name = "InstagramRateLimitError";
  }
};
var InstagramQueryError = class extends Error {
  constructor(what, detail, options2) {
    super(`Instagram's answer to ${what} is not what this package reads: ${detail}`, options2);
    this.name = "InstagramQueryError";
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sdks/instagram/web/dist/instagram-web.js
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sdks/instagram/web/dist/queries.js
var shortDrama = { PolarisShortDramaEnabled: true };
var storiesLabel = { PolarisCommunityNoteStoriesLabelEnabled: true };
var profileQuery = {
  name: "PolarisProfilePageContentQuery",
  docId: "28036671149327607",
  providers: {
    PolarisCannesGuardianExperienceEnabled: true,
    PolarisCASB976ProfileEnabled: false,
    PolarisWebSchoolsEnabled: false,
    PolarisRepostsConsumptionEnabled: true,
    PolarisShortDramaEnabled: true
  }
};
var postsQuery = {
  name: "PolarisProfilePostsTabContentQuery_connection",
  docId: "39229011733413759",
  providers: {
    PolarisMultiCaptionCarouselEnabled: true,
    PolarisShortDramaEnabled: true,
    PolarisThreadsStyleCommentsEnabled: false,
    PolarisReelsRecoDebugOverlayEnabled: false
  }
};
var reelsQuery = {
  name: "PolarisProfileReelsTabContentQuery_connection",
  docId: "28728438306809751",
  providers: shortDrama
};
var repostsQuery = {
  name: "PolarisProfileRepostsTabContentQuery",
  docId: "28594321130221951",
  providers: shortDrama
};
var moreRepostsQuery = {
  name: "PolarisProfileRepostsTabContentRefetchQuery",
  docId: "28844503865240264",
  providers: shortDrama
};
var taggedQuery = {
  name: "PolarisProfileTaggedTabContentQuery_connection",
  docId: "28712186505109571",
  providers: shortDrama
};
var highlightsQuery = {
  name: "PolarisProfileStoryHighlightsTrayContentQuery",
  docId: "26970053832668570",
  providers: {}
};
var storiesQuery = {
  name: "PolarisStoriesV3HighlightsPageQuery",
  docId: "39400183649572570",
  providers: storiesLabel
};
var highlightItemsQuery = {
  name: "PolarisStoriesV3HighlightsPagePaginationQuery",
  docId: "28808391232182823",
  providers: storiesLabel
};
function variablesOf(query, variables) {
  return {
    ...variables,
    ...Object.fromEntries(Object.entries(query.providers).map(([provider, value]) => [
      `__relay_internal__pv__${provider}relayprovider`,
      value
    ]))
  };
}

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sdks/instagram/web/dist/schemas.js
var image = external_exports.object({
  url: external_exports.string(),
  width: external_exports.number(),
  height: external_exports.number()
});
var images = external_exports.object({ candidates: external_exports.array(image) });
var owner = external_exports.object({ pk: external_exports.string(), username: external_exports.string() });
var caption = external_exports.object({ text: external_exports.string(), created_at: external_exports.number() });
var pageInfo = external_exports.object({
  end_cursor: external_exports.string().nullable(),
  has_next_page: external_exports.boolean()
});
var timelineSlide = external_exports.object({
  pk: external_exports.string(),
  media_type: external_exports.number(),
  image_versions2: images,
  accessibility_caption: external_exports.string().nullable()
});
var timelineMedia = timelineSlide.extend({
  code: external_exports.string(),
  taken_at: external_exports.number(),
  product_type: external_exports.string(),
  caption: caption.nullable(),
  caption_is_edited: external_exports.boolean(),
  like_count: external_exports.number(),
  comment_count: external_exports.number(),
  timeline_pinned_user_ids: external_exports.array(external_exports.string()),
  user: owner,
  coauthor_producers: external_exports.array(owner),
  usertags: external_exports.object({ in: external_exports.array(external_exports.object({ user: owner })) }).nullable(),
  // The place the post is tagged with. Its id comes as a JSON number, so one
  // past 2^53, which JSON.parse would round, fails instead of loading wrong.
  location: external_exports.object({
    pk: external_exports.int(),
    name: external_exports.string(),
    lat: external_exports.number(),
    lng: external_exports.number()
  }).transform(({ pk, ...place }) => ({ ...place, pk: String(pk) })).nullable(),
  carousel_media: external_exports.array(timelineSlide).nullable()
});
var listSlide = external_exports.object({
  id: external_exports.string().regex(/^\d+_\d+$/),
  media_type: external_exports.number().optional(),
  image_versions2: images
}).transform(({ id: id10, media_type, image_versions2 }) => ({
  pk: id10.slice(0, id10.indexOf("_")),
  media_type: media_type ?? null,
  image_versions2
}));
var listMedia = external_exports.object({
  pk: external_exports.string(),
  media_type: external_exports.number(),
  image_versions2: images,
  code: external_exports.string(),
  product_type: external_exports.string(),
  // These tabs send a caption's text without its date.
  caption: external_exports.object({ text: external_exports.string() }).nullable(),
  like_count: external_exports.number(),
  comment_count: external_exports.number(),
  user: owner,
  carousel_media: external_exports.array(listSlide).nullable()
});
var reelMedia = external_exports.object({
  pk: external_exports.string(),
  code: external_exports.string(),
  media_type: external_exports.number(),
  product_type: external_exports.string(),
  // Instagram leaves out the count of some reels.
  play_count: external_exports.number().nullable(),
  like_count: external_exports.number(),
  comment_count: external_exports.number(),
  // Instagram sends null in place of the list for some reels.
  clips_tab_pinned_user_ids: external_exports.array(external_exports.string()).nullable(),
  user: owner,
  image_versions2: images
});
var storyItem = external_exports.object({
  pk: external_exports.string(),
  taken_at: external_exports.number(),
  expiring_at: external_exports.number(),
  media_type: external_exports.number(),
  product_type: external_exports.string(),
  image_versions2: images,
  accessibility_caption: external_exports.string().nullable()
});
var comment = external_exports.object({
  pk: external_exports.string(),
  text: external_exports.string(),
  created_at: external_exports.number(),
  // Instagram sends one commenter's id as a number and another's as a string.
  user: external_exports.object({
    pk: external_exports.union([external_exports.string(), external_exports.number()]).transform(String),
    username: external_exports.string()
  }),
  comment_like_count: external_exports.number()
});
var followingResponse = external_exports.object({
  users: external_exports.array(external_exports.object({
    pk: external_exports.string(),
    username: external_exports.string(),
    full_name: external_exports.string(),
    is_private: external_exports.boolean(),
    is_verified: external_exports.boolean(),
    profile_pic_url: external_exports.string()
  })),
  has_more: external_exports.boolean(),
  next_max_id: external_exports.string().optional()
});
var profileResponse = external_exports.object({
  data: external_exports.object({
    user: external_exports.object({
      pk: external_exports.string(),
      username: external_exports.string(),
      full_name: external_exports.string(),
      biography: external_exports.string(),
      external_url: external_exports.string().nullable(),
      bio_links: external_exports.array(external_exports.object({ url: external_exports.string() })),
      category: external_exports.string().nullable(),
      is_private: external_exports.boolean(),
      is_verified: external_exports.boolean(),
      is_business: external_exports.boolean(),
      follower_count: external_exports.number(),
      following_count: external_exports.number(),
      media_count: external_exports.number(),
      total_clips_count: external_exports.number(),
      city_name: external_exports.string().nullable(),
      address_street: external_exports.string().nullable(),
      hd_profile_pic_url_info: external_exports.object({ url: external_exports.string() })
    })
  })
});
var postsResponse = external_exports.object({
  data: external_exports.object({
    xdt_api__v1__feed__user_timeline_graphql_connection: external_exports.object({
      edges: external_exports.array(external_exports.object({ node: timelineMedia })),
      page_info: pageInfo
    })
  })
});
var reelsResponse = external_exports.object({
  data: external_exports.object({
    fetch__XDTUserDict: external_exports.object({
      clips_connection: external_exports.object({
        edges: external_exports.array(external_exports.object({ node: external_exports.object({ media: reelMedia }) })),
        page_info: pageInfo
      })
    })
  })
});
var repostsResponse = external_exports.object({
  data: external_exports.object({
    fetch__XDTUserDict: external_exports.object({
      user_reposts_timeline: external_exports.object({
        repost_grid_items: external_exports.array(external_exports.object({ media: listMedia })),
        repost_more_available: external_exports.boolean(),
        repost_next_max_id: external_exports.string().nullable()
      })
    })
  })
});
var taggedResponse = external_exports.object({
  data: external_exports.object({
    xdt_api__v1__usertags__user_id__feed_connection: external_exports.object({
      edges: external_exports.array(external_exports.object({ node: listMedia })),
      page_info: pageInfo
    })
  })
});
var highlightsResponse = external_exports.object({
  data: external_exports.object({
    highlights: external_exports.object({
      edges: external_exports.array(external_exports.object({
        node: external_exports.object({
          id: external_exports.string(),
          title: external_exports.string(),
          cover_media: external_exports.object({
            cropped_image_version: external_exports.object({ url: external_exports.string() })
          })
        })
      }))
    })
  })
});
var reelsMediaResponse = external_exports.object({
  data: external_exports.object({
    xdt_api__v1__feed__reels_media__connection: external_exports.object({
      edges: external_exports.array(external_exports.object({
        node: external_exports.object({ id: external_exports.string(), items: external_exports.array(storyItem) })
      })),
      page_info: pageInfo
    })
  })
});
var commentsResponse = external_exports.object({
  comments: external_exports.array(comment.extend({ child_comment_count: external_exports.number() })),
  has_more_comments: external_exports.boolean(),
  next_min_id: external_exports.string().optional()
});
var repliesResponse = external_exports.object({
  child_comments: external_exports.array(comment),
  has_more_tail_child_comments: external_exports.boolean(),
  next_max_child_cursor: external_exports.string().optional()
});

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sdks/instagram/web/dist/instagram-web.js
var origin = "https://www.instagram.com";
var webAppId = "936619743392459";
var userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
var InstagramWeb = class _InstagramWeb {
  // The signed-in account's id.
  viewerId;
  #cookie;
  #csrf;
  #dtsg;
  #lsd;
  constructor(viewerId, cookie, csrf, tokens) {
    this.viewerId = viewerId;
    this.#cookie = cookie;
    this.#csrf = csrf;
    this.#dtsg = tokens.dtsg;
    this.#lsd = tokens.lsd;
  }
  // Reads the tokens a signed-in page carries; a page without them is the
  // page Instagram shows a browser that is not signed in.
  static async open({ cookies }, signal) {
    const viewerId = cookies.get("ds_user_id");
    const csrf = cookies.get("csrftoken");
    if (!cookies.has("sessionid") || viewerId === void 0 || csrf === void 0)
      throw new InstagramLoginError("the session");
    const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await send("its home page", "/", { headers: { cookie, "user-agent": userAgent, accept: "text/html" } }, signal);
    const html = await response.text();
    const dtsg = /\["DTSGInitialData",\[\],\{"token":"([^"]+)"/.exec(html)?.[1];
    const lsd = /\["LSD",\[\],\{"token":"([^"]+)"/.exec(html)?.[1];
    if (dtsg === void 0 || lsd === void 0)
      throw new InstagramLoginError("its home page");
    return new _InstagramWeb(viewerId, cookie, csrf, { dtsg, lsd });
  }
  // The accounts the signed-in account follows, 50 at a time.
  async following(maxId, signal) {
    const page = await this.#rest("the accounts it follows", `/api/v1/friendships/${this.viewerId}/following/?count=50${maxId === null ? "" : `&max_id=${encodeURIComponent(maxId)}`}`, followingResponse, signal);
    return {
      items: page.users,
      next: page.has_more ? page.next_max_id ?? null : null
    };
  }
  async profile(userId, signal) {
    const answer = await this.#graphql(profileQuery, { enable_integrity_filters: true, id: userId }, profileResponse, signal);
    return answer.data.user;
  }
  // The profile's grid, newest first after the pinned posts, 33 at a time,
  // the most Instagram gives for one page.
  async posts(username, after, signal) {
    const data = {
      count: 33,
      include_reel_media_seen_timestamp: true,
      include_relationship_info: true,
      latest_besties_reel_media: true,
      latest_reel_media: true
    };
    const answer = await this.#graphql(postsQuery, {
      after,
      before: null,
      data,
      first: 33,
      include_multi_captions: true,
      last: null,
      username
    }, postsResponse, signal);
    const { edges, page_info } = answer.data.xdt_api__v1__feed__user_timeline_graphql_connection;
    return { items: edges.map(({ node }) => node), next: nextOf(page_info) };
  }
  // The profile's reels tab, 12 at a time.
  async reels(userId, after, signal) {
    const answer = await this.#graphql(reelsQuery, {
      after,
      data: {
        include_feed_video: true,
        page_size: 12,
        target_user_id: userId
      },
      first: 12,
      id: userId
    }, reelsResponse, signal);
    const { edges, page_info } = answer.data.fetch__XDTUserDict.clips_connection;
    return {
      items: edges.map(({ node }) => node.media),
      next: nextOf(page_info)
    };
  }
  // The posts of other accounts the profile reposted, 12 at a time.
  async reposts(userId, maxId, signal) {
    const answer = maxId === null ? await this.#graphql(repostsQuery, { user_id: userId }, repostsResponse, signal) : await this.#graphql(moreRepostsQuery, { id: userId, max_id: maxId }, repostsResponse, signal);
    const timeline = answer.data.fetch__XDTUserDict.user_reposts_timeline;
    return {
      items: timeline.repost_grid_items.map(({ media }) => media),
      next: timeline.repost_more_available ? timeline.repost_next_max_id : null
    };
  }
  // Posts of other accounts that tag the profile, 12 at a time.
  async tagged(userId, after, signal) {
    const answer = await this.#graphql(taggedQuery, {
      after,
      before: null,
      count: 12,
      first: 12,
      last: null,
      user_id: userId
    }, taggedResponse, signal);
    const { edges, page_info } = answer.data.xdt_api__v1__usertags__user_id__feed_connection;
    return { items: edges.map(({ node }) => node), next: nextOf(page_info) };
  }
  async highlights(userId, signal) {
    const answer = await this.#graphql(highlightsQuery, { user_id: userId }, highlightsResponse, signal);
    return answer.data.highlights.edges.map(({ node }) => node);
  }
  // The stories the profile posted in the last day.
  async stories(userId, signal) {
    const answer = await this.#graphql(storiesQuery, { first: 1, initial_reel_id: userId, last: null, reel_ids: [userId] }, reelsMediaResponse, signal);
    return answer.data.xdt_api__v1__feed__reels_media__connection.edges.flatMap(({ node }) => node.items);
  }
  // The items of highlights, a few highlights at a time; ids as the tray
  // lists them, such as highlight:18396646255144344.
  async highlightItems(ids, after, signal) {
    const answer = await this.#graphql(highlightItemsQuery, {
      after,
      before: null,
      first: 5,
      initial_reel_id: ids[0],
      is_highlight: true,
      last: null,
      reel_ids: ids
    }, reelsMediaResponse, signal);
    const { edges, page_info } = answer.data.xdt_api__v1__feed__reels_media__connection;
    return { items: edges.map(({ node }) => node), next: nextOf(page_info) };
  }
  // A post's comments, a page at a time, with how many replies each has.
  async comments(mediaId, minId, signal) {
    const page = await this.#rest("the comments of a post", `/api/v1/media/${mediaId}/comments/?can_support_threading=true&permalink_enabled=false${minId === null ? "" : `&min_id=${encodeURIComponent(minId)}`}`, commentsResponse, signal);
    return {
      items: page.comments,
      next: page.has_more_comments ? page.next_min_id ?? null : null
    };
  }
  // The replies to a comment, a page at a time.
  async replies(mediaId, commentId, cursor, signal) {
    const page = await this.#rest("the replies to a comment", `/api/v1/media/${mediaId}/comments/${commentId}/child_comments/${cursor === null ? "" : `?max_id=${encodeURIComponent(cursor)}`}`, repliesResponse, signal);
    return {
      items: page.child_comments,
      next: page.has_more_tail_child_comments ? page.next_max_child_cursor ?? null : null
    };
  }
  // Saves an image or video from Instagram's CDN, whose URLs are signed and
  // need no session. False when the CDN answers 410 Gone: it no longer has
  // the file, though the answer that listed it is fresh. A connection that
  // fails, which fetch reports as a TypeError, or a 5xx the CDN answers is
  // tried once more: the GET is safe to repeat.
  async download(url, path, signal) {
    try {
      return await save(url, path, signal);
    } catch (error) {
      if (!(error instanceof TypeError || error instanceof CdnUnavailableError))
        throw error;
      return save(url, path, signal);
    }
  }
  async #rest(what, path, schema, signal) {
    const response = await send(what, path, { headers: this.#headers() }, signal);
    return parsed(what, schema, await json(what, response));
  }
  async #graphql(query, variables, schema, signal) {
    const response = await send(query.name, "/graphql/query", {
      method: "POST",
      headers: {
        ...this.#headers(),
        "content-type": "application/x-www-form-urlencoded",
        "x-fb-lsd": this.#lsd,
        "x-fb-friendly-name": query.name
      },
      body: new URLSearchParams({
        doc_id: query.docId,
        variables: JSON.stringify(variablesOf(query, variables)),
        lsd: this.#lsd,
        fb_dtsg: this.#dtsg,
        fb_api_req_friendly_name: query.name,
        server_timestamps: "true"
      })
    }, signal);
    return parsed(query.name, schema, await json(query.name, response));
  }
  #headers() {
    return {
      cookie: this.#cookie,
      "user-agent": userAgent,
      accept: "*/*",
      referer: `${origin}/`,
      "x-ig-app-id": webAppId,
      "x-csrftoken": this.#csrf,
      "x-requested-with": "XMLHttpRequest",
      // Instagram refuses some calls without the fetch metadata a browser
      // sends ("SecFetch Policy violation").
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty"
    };
  }
};
function nextOf(page) {
  return page.has_next_page ? page.end_cursor : null;
}
var CdnUnavailableError = class extends InstagramQueryError {
};
async function save(url, path, signal) {
  const response = await fetch(url, {
    headers: { "user-agent": userAgent },
    signal
  });
  if (response.status === 410)
    return false;
  if (response.status === 429)
    throw new InstagramRateLimitError("a download");
  if (response.status >= 500)
    throw new CdnUnavailableError("a download", `answered ${response.status}`);
  if (!response.ok || response.body === null)
    throw new InstagramQueryError("a download", `answered ${response.status}`);
  await pipeline(response.body, createWriteStream(path), { signal });
  return true;
}
async function send(what, path, init, signal) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    redirect: "manual",
    signal
  });
  if (response.status === 429)
    throw new InstagramRateLimitError(what);
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location") ?? "";
    if (/\/accounts\/login|\/challenge/.test(location))
      throw new InstagramLoginError(what);
    throw new InstagramQueryError(what, `redirected to ${location}`);
  }
  return response;
}
async function json(what, response) {
  const type = response.headers.get("content-type") ?? "";
  if (type.startsWith("text/html"))
    throw new InstagramLoginError(what);
  if (!type.startsWith("application/json") && !type.startsWith("text/javascript"))
    throw new InstagramQueryError(what, `answered ${response.status} ${type}`);
  const body = JSON.parse((await response.text()).replace(/^for \(;;\);/, ""));
  if (typeof body === "object" && body !== null) {
    if ("message" in body && typeof body.message === "string" && /wait a few minutes/i.test(body.message))
      throw new InstagramRateLimitError(what);
    if ("require_login" in body && body.require_login === true)
      throw new InstagramLoginError(what);
    const hasData = "data" in body && body.data !== null;
    if ("errors" in body && Array.isArray(body.errors) && body.errors.length > 0 && !hasData)
      throw new InstagramQueryError(what, describe(body.errors[0]));
  }
  if (!response.ok)
    throw new InstagramQueryError(what, `answered ${response.status}`);
  return body;
}
function describe(error) {
  if (typeof error !== "object" || error === null)
    return String(error);
  const parts = ["summary", "message", "description"].map((field) => field in error ? Reflect.get(error, field) : void 0).filter((part) => typeof part === "string");
  return parts.join(": ");
}
function parsed(what, schema, body) {
  const result = schema.safeParse(body);
  if (result.success)
    return result.data;
  const [issue] = result.error.issues;
  throw new InstagramQueryError(what, issue === void 0 ? result.error.message : `${issue.path.join(".")}: ${issue.message}`, { cause: result.error });
}

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/instagram-run.js
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join3 } from "node:path";

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/lane.js
var Lane = class {
  // Whether the profile pinned the item above its newer ones.
  pinned(_item, _profile) {
    return false;
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/lanes/posts-lane.js
var PostsLane = class extends Lane {
  name = "posts";
  fetch(web, profile, cursor, signal) {
    return web.posts(profile.username, cursor, signal);
  }
  id(item) {
    return item.pk;
  }
  pinned(item, profile) {
    return item.timeline_pinned_user_ids.includes(profile.pk);
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/lanes/reels-lane.js
var ReelsLane = class extends Lane {
  name = "reels";
  fetch(web, profile, cursor, signal) {
    return web.reels(profile.pk, cursor, signal);
  }
  id(item) {
    return item.pk;
  }
  // A reel without a pin list counts as unpinned: at worst the next run's
  // read from the top goes down to it.
  pinned(item, profile) {
    return item.clips_tab_pinned_user_ids?.includes(profile.pk) ?? false;
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/lanes/reposts-lane.js
var RepostsLane = class extends Lane {
  name = "reposts";
  fetch(web, profile, cursor, signal) {
    return web.reposts(profile.pk, cursor, signal);
  }
  id(item) {
    return item.pk;
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/lanes/tagged-lane.js
var TaggedLane = class extends Lane {
  name = "tagged";
  fetch(web, profile, cursor, signal) {
    return web.tagged(profile.pk, cursor, signal);
  }
  id(item) {
    return item.pk;
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/instagram-run.js
var pagesPerRun = 10;
var LaneReader = class {
  lane;
  #web;
  #pages = /* @__PURE__ */ new Map();
  #fetched = /* @__PURE__ */ new Map();
  constructor(lane, web) {
    this.lane = lane;
    this.#web = web;
  }
  // null once the run fetched pagesPerRun pages of this list of the profile.
  page(profile, cursor, signal) {
    const key = `${profile.pk}:${cursor ?? ""}`;
    const read = this.#pages.get(key);
    if (read !== void 0)
      return read;
    const fetched = this.#fetched.get(profile.pk) ?? 0;
    if (fetched >= pagesPerRun)
      return null;
    this.#fetched.set(profile.pk, fetched + 1);
    const page = this.lane.fetch(this.#web, profile, cursor, signal);
    this.#pages.set(key, page);
    return page;
  }
};
var InstagramRun = class _InstagramRun {
  web;
  posts;
  reels;
  reposts;
  tagged;
  #staging;
  #profiles = /* @__PURE__ */ new Map();
  #highlights = /* @__PURE__ */ new Map();
  #downloads = 0;
  constructor(web, staging) {
    this.web = web;
    this.#staging = staging;
    this.posts = new LaneReader(new PostsLane(), web);
    this.reels = new LaneReader(new ReelsLane(), web);
    this.reposts = new LaneReader(new RepostsLane(), web);
    this.tagged = new LaneReader(new TaggedLane(), web);
  }
  // Signs in with the session of the browser profile that signed in to
  // Instagram last.
  static async open(signal) {
    const session = await BrowserSession.newest("https://www.instagram.com/", "sessionid");
    const web = await InstagramWeb.open(session, signal);
    const staging = await mkdtemp(join3(tmpdir(), "context-compiler-instagram-"));
    return new _InstagramRun(web, staging);
  }
  profile(id10, signal) {
    const read = this.#profiles.get(id10);
    if (read !== void 0)
      return read;
    const profile = this.web.profile(id10, signal);
    this.#profiles.set(id10, profile);
    return profile;
  }
  highlights(profileId10, signal) {
    const read = this.#highlights.get(profileId10);
    if (read !== void 0)
      return read;
    const tray = this.web.highlights(profileId10, signal);
    this.#highlights.set(profileId10, tray);
    return tray;
  }
  // Saves an image under the run's staging folder; the caller removes it
  // once the record that carries it is loaded. Null when Instagram no longer
  // has the file: the record loads without it.
  async download(url, signal) {
    const path = join3(this.#staging, `${++this.#downloads}${extension(url)}`);
    return await this.web.download(url, path, signal) ? path : null;
  }
  async [Symbol.asyncDispose]() {
    await rm(this.#staging, { recursive: true, force: true });
  }
};
function extension(url) {
  const match = /\.(jpe?g|png|webp|heic|mp4)$/i.exec(new URL(url).pathname);
  return match === null ? "" : `.${match[1]?.toLowerCase()}`;
}

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/fields.js
var fields = {
  profileId: {
    type: "string",
    minLength: 1,
    description: "The Instagram user id of the profile the record was read from, as the profiles stream lists it."
  },
  id: { type: "string", minLength: 1 },
  text: { type: "string" },
  nullableText: { type: ["string", "null"] },
  count: { type: "integer", minimum: 0 },
  flag: { type: "boolean" },
  instant: { type: "string", format: "date-time" },
  textList: { type: "array", items: { type: "string" } },
  kind: {
    type: "string",
    enum: ["photo", "video", "carousel"]
  }
};
function instant(seconds) {
  return new Date(seconds * 1e3).toISOString();
}
var kinds = /* @__PURE__ */ new Map([
  [1, "photo"],
  [2, "video"],
  [8, "carousel"]
]);
function kindOf(mediaType) {
  const kind3 = kinds.get(mediaType);
  if (kind3 === void 0)
    throw new TypeError(`Instagram media type ${mediaType} is not known`);
  return kind3;
}
function largest(candidates) {
  const [first, ...rest] = candidates;
  if (first === void 0)
    throw new TypeError("Instagram listed media without an image");
  return rest.reduce((best, image2) => image2.width * image2.height > best.width * best.height ? image2 : best, first);
}
function postUrl(code) {
  return `https://www.instagram.com/p/${code}/`;
}
function reelUrl(code) {
  return `https://www.instagram.com/reel/${code}/`;
}

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/instagram-stream.js
import { rm as rm2 } from "node:fs/promises";
function within({ startAt, endAt }, instant2) {
  return (startAt === void 0 || instant2 >= startAt) && (endAt === void 0 || instant2 < endAt);
}
var InstagramStream = class {
  partitionKey = ["profileId"];
  // Most lists are longer than one run reads, so they are read only
  // incrementally, a part of the scan per run.
  supportedSyncModes = ["incremental"];
  sourceDefinedCursor = true;
  emitsDeletes = true;
  supportsFileTransfer = void 0;
  expiresBy = void 0;
  #stream;
  describe() {
    this.#stream ??= new Stream(this);
    return this.#stream;
  }
  validated(drafts) {
    return validateRecords(this, [...drafts], "Instagram");
  }
  // The JSON of a record's primary key values: how images are matched to
  // the records the diff emits.
  keyOf(record) {
    if (typeof record !== "object" || record === null)
      throw new TypeError(`Instagram ${this.name} record is not an object`);
    return JSON.stringify(this.primaryKey.map((field) => Reflect.get(record, field)));
  }
  // Gives each record the diff emits its image, saved while the record is
  // read and removed once it is loaded: only new and changed records are
  // downloaded.
  async *withImages(messages, images2, { run: run2, files, signal }) {
    for await (const message of messages) {
      if ("type" in message || !files) {
        yield message;
        continue;
      }
      const url = images2.get(this.keyOf(message.data));
      const file = url === void 0 ? null : await run2.download(url, signal);
      yield { ...message, file };
      if (file !== null)
        await rm2(file, { force: true });
    }
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/list-walk.js
var freshLane = { after: null, head: null, ended: false };
async function* walk(reader, profile, state, signal, olderThan) {
  const { lane } = reader;
  const unpinned = (items) => items.filter((item) => !lane.pinned(item, profile));
  const followed = /* @__PURE__ */ new Set();
  const follow = (cursor) => {
    if (cursor === null)
      return;
    if (followed.has(cursor))
      throw new TypeError(`Instagram gave the ${lane.name} page cursor ${cursor} twice in one read`);
    followed.add(cursor);
  };
  let current = state;
  if ((current.after !== null || current.ended) && current.head !== null) {
    let cursor = null;
    let newest = null;
    for (; ; ) {
      const read = reader.page(profile, cursor, signal);
      if (read === null)
        return;
      const page = await read;
      const top = unpinned(page.items);
      newest ??= top[0] === void 0 ? null : lane.id(top[0]);
      const reached = page.next === null || top.some((item) => lane.id(item) === current.head);
      yield {
        items: page.items,
        lane: reached ? { ...current, head: newest ?? current.head } : current,
        ends: false
      };
      if (reached) {
        current = { ...current, head: newest ?? current.head };
        break;
      }
      follow(page.next);
      cursor = page.next;
    }
  }
  if (current.ended)
    return;
  followed.clear();
  let { after, head } = current;
  for (; ; ) {
    const read = reader.page(profile, after, signal);
    if (read === null)
      return;
    const page = await read;
    if (after === null) {
      const [newest] = unpinned(page.items);
      head = newest === void 0 ? head : lane.id(newest);
    }
    const stop = olderThan === void 0 ? -1 : page.items.findIndex((item) => !lane.pinned(item, profile) && olderThan(item));
    const ends = page.next === null || stop !== -1;
    yield {
      items: stop === -1 ? page.items : page.items.slice(0, stop),
      lane: ends ? { after: null, head, ended: true } : { after: page.next, head, ended: false },
      ends
    };
    if (ends)
      return;
    follow(page.next);
    after = page.next;
  }
}

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/state.js
function isPlainObject(value) {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}
function foreign(stream) {
  return new TypeError(`Instagram's ${stream} stream has state it did not write`);
}
function readLane(stream, value) {
  if (value === void 0)
    return freshLane;
  if (!isPlainObject(value) || !(value.after === null || typeof value.after === "string") || !(value.head === null || typeof value.head === "string") || typeof value.ended !== "boolean")
    throw foreign(stream);
  return { after: value.after, head: value.head, ended: value.ended };
}
function readScan(stream, state) {
  if (state === null)
    return { lanes: {}, diff: null, extra: {} };
  if (!isPlainObject(state) || !isPlainObject(state.lanes) || !("diff" in state))
    throw foreign(stream);
  const { lanes, diff, ...extra } = state;
  return { lanes, diff, extra };
}

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/streams/comments-stream.js
var { profileId, id, text, nullableText, count, instant: at } = fields;
var properties = {
  profileId,
  postId: {
    ...id,
    description: "The posts stream\u2019s id of the post the comment is on."
  },
  id: { ...id, description: "Instagram\u2019s id of the comment." },
  parentId: {
    ...nullableText,
    description: "The id of the comment this one replies to; NULL for a comment on the post itself."
  },
  text: { ...text, description: "The comment\u2019s text." },
  author: {
    ...text,
    description: "The username of the account that wrote it."
  },
  authorId: {
    ...id,
    description: "The Instagram user id of the account that wrote it."
  },
  createdAt: { ...at, description: "When it was written." },
  likes: {
    ...count,
    description: "How many accounts liked the comment, when the post\u2019s comments were last read."
  },
  replies: {
    type: ["integer", "null"],
    minimum: 0,
    description: "How many replies the comment has; NULL for a reply."
  }
};
var CommentsStream = class extends InstagramStream {
  name = "comments";
  primaryKey = ["profileId", "postId", "id"];
  jsonSchema = {
    type: "object",
    description: "One record per comment, or reply to a comment, on a post on the grid of an Instagram profile the import reads. Primary key profileId, postId, id. Read with the posts stream\u2019s pages; a comment the post no longer shows is deleted when its post\u2019s comments are read again.",
    properties,
    required: Object.keys(properties)
  };
  async *read({ run: run2, state, configuration, profileId: owner2, range, signal }) {
    if (owner2 === null)
      throw new TypeError("Instagram comments are read by profile");
    const profile = await run2.profile(owner2, signal);
    const saved = readScan(this.name, state);
    const scanned = saved.extra.scan ?? 0;
    if (typeof scanned !== "number")
      throw foreign(this.name);
    let scan = scanned;
    let diff = saved.diff;
    const inRange = (item) => within(range, instant(item.taken_at));
    const { startAt } = range;
    for await (const part of walk(run2.posts, profile, readLane(this.name, saved.lanes.posts), signal, startAt === void 0 ? void 0 : (item) => instant(item.taken_at) < startAt)) {
      const posts = new Map(part.items.filter(inRange).map((post) => [post.pk, post]));
      const groups = [...posts.values()].map((post) => ({
        key: post.pk,
        fingerprint: `${post.comment_count}@${scan}`,
        records: () => this.#comments(run2.web, owner2, post, signal)
      }));
      const lane = part.ends ? { ...part.lane, ended: false } : part.lane;
      for await (const message of diffGroupedSnapshot(configuration, groups, diff, {
        policy: new ClosedWorld(),
        continues: !part.ends,
        signal
      }))
        if ("type" in message && message.type === "STATE") {
          diff = message.state;
          if (part.ends)
            scan += 1;
          yield {
            ...message,
            state: { lanes: { posts: lane }, diff, scan }
          };
        } else
          yield message;
    }
  }
  async *#comments(web, owner2, post, signal) {
    if (post.comment_count === 0)
      return;
    const comments = /* @__PURE__ */ new Map();
    let next = null;
    do {
      const page = await web.comments(post.pk, next, signal);
      for (const comment2 of page.items)
        comments.set(comment2.pk, comment2);
      next = page.next;
    } while (next !== null);
    for (const comment2 of comments.values()) {
      yield* this.validated([
        this.#record(owner2, post, comment2, null, comment2.child_comment_count)
      ]);
      if (comment2.child_comment_count === 0)
        continue;
      let cursor = null;
      do {
        const page = await web.replies(post.pk, comment2.pk, cursor, signal);
        yield* this.validated(page.items.map((reply) => this.#record(owner2, post, reply, comment2.pk, null)));
        cursor = page.next;
      } while (cursor !== null);
    }
  }
  #record(owner2, post, comment2, parentId, replies) {
    return {
      profileId: owner2,
      postId: post.pk,
      id: comment2.pk,
      parentId,
      text: comment2.text,
      author: comment2.user.username,
      authorId: comment2.user.pk,
      createdAt: instant(comment2.created_at),
      likes: comment2.comment_like_count,
      replies
    };
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/snapshot-stream.js
var SnapshotStream = class extends InstagramStream {
  policy() {
    return new ClosedWorld();
  }
  async *read(context) {
    const { records, images: images2 = /* @__PURE__ */ new Map() } = await this.scan(context);
    const valid = this.validated(records);
    yield* this.withImages(diffSnapshot(context.configuration, valid, context.state, {
      policy: this.policy(),
      signal: context.signal
    }), images2, context);
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/streams/following-stream.js
var { id: id2, text: text2, flag } = fields;
var properties2 = {
  id: { ...id2, description: "The account\u2019s Instagram user id." },
  username: {
    ...text2,
    description: "The account\u2019s username, as in instagram.com/<username>."
  },
  fullName: {
    ...text2,
    description: "The name the account shows; empty when it set none."
  },
  isPrivate: {
    ...flag,
    description: "Only the account\u2019s followers see its posts."
  },
  isVerified: { ...flag, description: "Instagram verified the account." }
};
var FollowingStream = class extends SnapshotStream {
  name = "following";
  partitionKey = void 0;
  // Setup lists the accounts with one full read.
  supportedSyncModes = [
    "full_refresh",
    "incremental"
  ];
  primaryKey = ["id"];
  jsonSchema = {
    type: "object",
    description: "One record per account the Instagram account signed in to in the browser follows. Primary key id. An account it unfollows is deleted.",
    properties: properties2,
    required: Object.keys(properties2)
  };
  async scan({ run: run2, signal }) {
    const accounts = /* @__PURE__ */ new Map();
    let next = null;
    do {
      const page = await run2.web.following(next, signal);
      for (const account2 of page.items)
        accounts.set(account2.pk, account2);
      next = page.next;
    } while (next !== null);
    return {
      records: [...accounts.values()].map((account2) => ({
        id: account2.pk,
        username: account2.username,
        fullName: account2.full_name,
        isPrivate: account2.is_private,
        isVerified: account2.is_verified
      }))
    };
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/streams/highlights-stream.js
var { profileId: profileId2, id: id3, text: text3 } = fields;
var properties3 = {
  profileId: profileId2,
  id: {
    ...id3,
    description: "Instagram\u2019s id of the highlight. The highlight_items stream\u2019s highlightId."
  },
  title: { ...text3, description: "The highlight\u2019s title under its circle." }
};
var HighlightsStream = class extends SnapshotStream {
  name = "highlights";
  primaryKey = ["profileId", "id"];
  jsonSchema = {
    type: "object",
    description: "One record per highlight on the page of an Instagram profile the import reads. Primary key profileId, id. A highlight the profile removes is deleted.",
    properties: properties3,
    required: Object.keys(properties3)
  };
  async scan({ run: run2, profileId: owner2, signal }) {
    if (owner2 === null)
      throw new TypeError("Instagram highlights are read by profile");
    return {
      records: (await run2.highlights(owner2, signal)).map((highlight) => ({
        profileId: owner2,
        id: highlightId(highlight.id),
        title: highlight.title
      }))
    };
  }
};
function highlightId(trayId) {
  return trayId.replace(/^highlight:/, "");
}

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/streams/highlight-items-stream.js
var { profileId: profileId3, id: id4, nullableText: nullableText2, instant: at2 } = fields;
var properties4 = {
  profileId: profileId3,
  highlightId: {
    ...id4,
    description: "The highlights stream\u2019s id of the highlight the story is in."
  },
  id: { ...id4, description: "Instagram\u2019s id of the story." },
  postedAt: { ...at2, description: "When the story was posted." },
  kind: {
    type: "string",
    enum: ["photo", "video"],
    description: "photo, or video, whose file is its cover frame."
  },
  description: {
    ...nullableText2,
    description: "The description Instagram wrote of the image, when it wrote one."
  }
};
var HighlightItemsStream = class extends InstagramStream {
  name = "highlight_items";
  primaryKey = ["profileId", "highlightId", "id"];
  supportsFileTransfer = true;
  jsonSchema = {
    type: "object",
    description: "One record per story in a highlight of an Instagram profile the import reads, with its image, whose text is in attachment_text. Primary key profileId, highlightId, id. A story the profile removes from its highlight is deleted.",
    properties: properties4,
    required: Object.keys(properties4)
  };
  async *read(context) {
    const { run: run2, profileId: owner2, range, signal } = context;
    if (owner2 === null)
      throw new TypeError("Instagram highlights are read by profile");
    const ids = (await run2.highlights(owner2, signal)).map(({ id: id10 }) => id10);
    let state = context.state;
    let after = null;
    do {
      const page = ids.length === 0 ? { items: [], next: null } : await run2.web.highlightItems(ids, after, signal);
      const { records, images: images2 } = this.#part(owner2, page.items, range);
      for await (const message of this.withImages(diffSnapshot(context.configuration, this.validated(records), state, {
        policy: new ClosedWorld(),
        continues: page.next !== null,
        signal
      }), images2, context)) {
        if ("type" in message && message.type === "STATE")
          state = message.state;
        yield message;
      }
      after = page.next;
    } while (after !== null);
  }
  #part(owner2, highlights, range) {
    const images2 = /* @__PURE__ */ new Map();
    const records = [];
    for (const highlight of highlights)
      for (const item of highlight.items) {
        const postedAt = instant(item.taken_at);
        if (!within(range, postedAt))
          continue;
        const record = {
          profileId: owner2,
          highlightId: highlightId(highlight.id),
          id: item.pk,
          postedAt,
          kind: kindOf(item.media_type),
          description: item.accessibility_caption
        };
        images2.set(this.keyOf(record), largest(item.image_versions2.candidates).url);
        records.push(record);
      }
    return { records, images: images2 };
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/streams/media-stream.js
var { profileId: profileId4, id: id5, count: count2, nullableText: nullableText3 } = fields;
var properties5 = {
  profileId: profileId4,
  list: {
    type: "string",
    enum: ["posts", "reels", "reposts", "tagged"],
    description: "The list the post is on: posts (the grid), reels (the reels tab), reposts or tagged. Join postId to the id of posts, reels, reposts or tagged_posts."
  },
  postId: {
    ...id5,
    description: "Instagram\u2019s id of the post the image or video belongs to."
  },
  position: { ...count2, description: "The slide\u2019s place in the post, from 0." },
  id: { ...id5, description: "Instagram\u2019s id of the image or video." },
  kind: {
    type: ["string", "null"],
    enum: ["photo", "video"],
    description: "photo, or video, whose file is its cover frame; NULL for a slide of a reposted carousel, which the reposts tab does not say."
  },
  width: { ...count2, description: "The width in pixels of the stored file." },
  height: { ...count2, description: "The height in pixels of the stored file." },
  description: {
    ...nullableText3,
    description: "The description Instagram wrote of the image, when it wrote one."
  }
};
var MediaStream = class extends InstagramStream {
  name = "media";
  primaryKey = ["profileId", "list", "postId", "id"];
  supportsFileTransfer = true;
  jsonSchema = {
    type: "object",
    description: "One record per image or video of a post on the grid, the reels tab, the reposts tab or the tagged tab of an Instagram profile the import reads, a carousel\u2019s slides one each; a reel is its cover frame. Primary key profileId, list, postId, id. The file is stored, and its text, such as a timetable posted as an image, is in attachment_text. A video\u2019s own file is not stored.",
    properties: properties5,
    required: Object.keys(properties5)
  };
  async *read(context) {
    const { run: run2, state, profileId: owner2, range, signal } = context;
    if (owner2 === null)
      throw new TypeError("Instagram media are read by profile");
    const saved = readScan(this.name, state);
    const scan = {
      owner: owner2,
      profile: await run2.profile(owner2, signal),
      lanes: {
        posts: readLane(this.name, saved.lanes.posts),
        reels: readLane(this.name, saved.lanes.reels),
        reposts: readLane(this.name, saved.lanes.reposts),
        tagged: readLane(this.name, saved.lanes.tagged)
      },
      diff: saved.diff
    };
    const { startAt } = range;
    yield* this.#lane(scan, run2.posts, gridSlides, context, {
      olderThan: startAt === void 0 ? void 0 : (item) => instant(item.taken_at) < startAt,
      inRange: (item) => within(range, instant(item.taken_at))
    });
    yield* this.#lane(scan, run2.reels, reelSlides, context);
    yield* this.#lane(scan, run2.reposts, listSlides, context);
    yield* this.#lane(scan, run2.tagged, listSlides, context);
  }
  // One list's parts of the scan; the scan ends with the part that ends the
  // last list still going.
  async *#lane(scan, reader, slides, context, { olderThan, inRange = () => true } = {}) {
    const name = reader.lane.name;
    for await (const part of walk(reader, scan.profile, scan.lanes[name], context.signal, olderThan)) {
      scan.lanes = { ...scan.lanes, [name]: part.lane };
      const ends = Object.values(scan.lanes).every(({ ended }) => ended);
      if (ends)
        scan.lanes = {
          posts: { ...scan.lanes.posts, ended: false },
          reels: { ...scan.lanes.reels, ended: false },
          reposts: { ...scan.lanes.reposts, ended: false },
          tagged: { ...scan.lanes.tagged, ended: false }
        };
      const images2 = /* @__PURE__ */ new Map();
      const drafts = /* @__PURE__ */ new Map();
      for (const item of part.items.filter(inRange))
        slides(item).forEach((slide, position) => {
          const draft = {
            profileId: scan.owner,
            list: name,
            postId: reader.lane.id(item),
            position,
            id: slide.id,
            kind: slide.kind,
            width: slide.image.width,
            height: slide.image.height,
            description: slide.description
          };
          const key = this.keyOf(draft);
          drafts.set(key, draft);
          images2.set(key, slide.image.url);
        });
      yield* this.withImages(this.#part(scan, context.configuration, [...drafts.values()], ends, context.signal), images2, context);
    }
  }
  async *#part(scan, configuration, drafts, ends, signal) {
    for await (const message of diffSnapshot(configuration, this.validated(drafts), scan.diff, { policy: new ClosedWorld(), continues: !ends, signal }))
      if ("type" in message && message.type === "STATE") {
        scan.diff = message.state;
        yield { ...message, state: { lanes: scan.lanes, diff: scan.diff } };
      } else
        yield message;
  }
};
function gridSlides(item) {
  return (item.carousel_media ?? [item]).map((slide) => ({
    id: slide.pk,
    kind: kindOf(slide.media_type),
    image: largest(slide.image_versions2.candidates),
    description: slide.accessibility_caption
  }));
}
function reelSlides(item) {
  return [
    {
      id: item.pk,
      kind: kindOf(item.media_type),
      image: largest(item.image_versions2.candidates),
      description: null
    }
  ];
}
function listSlides(item) {
  return (item.carousel_media ?? [item]).map((slide) => ({
    id: slide.pk,
    kind: slide.media_type === null ? null : kindOf(slide.media_type),
    image: largest(slide.image_versions2.candidates),
    description: null
  }));
}

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/list-stream.js
var ListStream = class extends InstagramStream {
  // Ends the list at the first unpinned item older than the range's start,
  // for a list whose items say when they were posted.
  olderThan(_range) {
    return void 0;
  }
  inRange(_item, _range) {
    return true;
  }
  async *read({ run: run2, state, configuration, profileId: profileId10, range, signal }) {
    if (profileId10 === null)
      throw new TypeError(`Instagram's ${this.name} stream reads a profile`);
    const profile = await run2.profile(profileId10, signal);
    const reader = this.reader(run2);
    const saved = readScan(this.name, state);
    let diff = saved.diff;
    for await (const part of walk(reader, profile, readLane(this.name, saved.lanes[reader.lane.name]), signal, this.olderThan(range))) {
      const items = new Map(part.items.filter((item) => this.inRange(item, range)).map((item) => [reader.lane.id(item), item]));
      const records = this.validated([...items.values()].map((item) => this.record(item, profileId10)));
      const lane = part.ends ? { ...part.lane, ended: false } : part.lane;
      for await (const message of diffSnapshot(configuration, records, diff, {
        policy: new ClosedWorld(),
        continues: !part.ends,
        signal
      }))
        if ("type" in message && message.type === "STATE") {
          diff = message.state;
          yield {
            ...message,
            state: { lanes: { [reader.lane.name]: lane }, diff }
          };
        } else
          yield message;
    }
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/streams/posts-stream.js
var { profileId: profileId5, id: id6, text: text4, nullableText: nullableText4, count: count3, flag: flag2, instant: at3, kind, textList } = fields;
var properties6 = {
  profileId: profileId5,
  id: {
    ...id6,
    description: "Instagram\u2019s id of the post. The media stream\u2019s postId."
  },
  code: {
    ...text4,
    description: "The post\u2019s short code, as in instagram.com/p/<code>/."
  },
  url: { ...text4, description: "The post\u2019s page." },
  postedAt: { ...at3, description: "When the post was published." },
  caption: {
    ...nullableText4,
    description: "The post\u2019s caption, hashtags included; NULL when it has none. Text inside its images is in attachment_text, through the media stream."
  },
  captionEdited: {
    ...flag2,
    description: "The caption was edited after posting."
  },
  kind: {
    ...kind,
    description: "photo, video, or carousel of several slides."
  },
  productType: {
    ...text4,
    description: "Instagram\u2019s product type, such as feed, carousel_container, or clips for a reel."
  },
  pinned: {
    ...flag2,
    description: "The profile pinned the post to the top of its grid."
  },
  locationId: {
    type: ["string", "null"],
    minLength: 1,
    description: "Instagram\u2019s id of the place the post is tagged with; NULL when it has none."
  },
  locationName: {
    ...nullableText4,
    description: "The name of the place the post is tagged with."
  },
  latitude: {
    type: ["number", "null"],
    description: "The place\u2019s latitude, in degrees."
  },
  longitude: {
    type: ["number", "null"],
    description: "The place\u2019s longitude, in degrees."
  },
  likes: {
    ...count3,
    description: "How many accounts liked the post, when its page was last read. 0 when the profile hides its counts."
  },
  comments: {
    ...count3,
    description: "How many comments the post has, replies included, when its page was last read."
  },
  slides: {
    ...count3,
    description: "How many images or videos the post holds; 1 unless it is a carousel."
  },
  coauthors: {
    ...textList,
    description: "The usernames of the accounts that posted it together with the profile."
  },
  tagged: {
    ...textList,
    description: "The usernames of the accounts tagged on the post."
  },
  description: {
    ...nullableText4,
    description: "The description Instagram wrote of the image, when it wrote one."
  }
};
var PostsStream = class extends ListStream {
  name = "posts";
  primaryKey = ["profileId", "id"];
  jsonSchema = {
    type: "object",
    description: "One record per post on the grid of an Instagram profile the import reads, reels shared to the grid among them. Primary key profileId, id. Each run reads the newest posts and the next pages of a scan of the whole grid; a post the profile deleted is deleted once the scan reaches the grid\u2019s end.",
    properties: properties6,
    required: Object.keys(properties6)
  };
  reader(run2) {
    return run2.posts;
  }
  olderThan({ startAt }) {
    if (startAt === void 0)
      return void 0;
    return (item) => instant(item.taken_at) < startAt;
  }
  inRange(item, range) {
    return within(range, instant(item.taken_at));
  }
  record(item, profile) {
    return {
      profileId: profile,
      id: item.pk,
      code: item.code,
      url: postUrl(item.code),
      postedAt: instant(item.taken_at),
      caption: item.caption?.text ?? null,
      captionEdited: item.caption_is_edited,
      kind: kindOf(item.media_type),
      productType: item.product_type,
      pinned: item.timeline_pinned_user_ids.includes(profile),
      locationId: item.location?.pk ?? null,
      locationName: item.location?.name ?? null,
      latitude: item.location?.lat ?? null,
      longitude: item.location?.lng ?? null,
      likes: item.like_count,
      comments: item.comment_count,
      slides: item.carousel_media?.length ?? 1,
      coauthors: item.coauthor_producers.map(({ username }) => username),
      tagged: (item.usertags?.in ?? []).map(({ user }) => user.username),
      description: item.accessibility_caption
    };
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/streams/profiles-stream.js
var { profileId: profileId6, text: text5, nullableText: nullableText5, count: count4, flag: flag3, textList: textList2 } = fields;
var properties7 = {
  profileId: profileId6,
  username: {
    ...text5,
    description: "The profile\u2019s username, as in instagram.com/<username>."
  },
  fullName: { ...text5, description: "The name the profile shows." },
  biography: { ...text5, description: "The profile\u2019s bio text." },
  externalUrl: { ...nullableText5, description: "The first link of the bio." },
  links: { ...textList2, description: "Every link of the bio, in order." },
  category: {
    ...nullableText5,
    description: "The business category the profile shows, such as Gym/Physical Fitness Center."
  },
  isPrivate: {
    ...flag3,
    description: "Only the profile\u2019s followers see its posts."
  },
  isVerified: { ...flag3, description: "Instagram verified the profile." },
  isBusiness: { ...flag3, description: "The profile is a business account." },
  followers: {
    ...count4,
    description: "How many accounts follow the profile, when read."
  },
  following: {
    ...count4,
    description: "How many accounts the profile follows, when read."
  },
  posts: {
    ...count4,
    description: "How many posts Instagram counts on the profile, when read."
  },
  reels: {
    ...count4,
    description: "How many reels Instagram counts on the profile, when read."
  },
  city: {
    ...nullableText5,
    description: "The city of the business address the profile shows."
  },
  street: {
    ...nullableText5,
    description: "The street of the business address the profile shows."
  }
};
var ProfilesStream = class extends SnapshotStream {
  name = "profiles";
  primaryKey = ["profileId"];
  jsonSchema = {
    type: "object",
    description: "One record per Instagram profile the import reads, as its page shows it now. Primary key profileId.",
    properties: properties7,
    required: Object.keys(properties7)
  };
  async scan({ run: run2, profileId: id10, signal }) {
    if (id10 === null)
      throw new TypeError("Instagram profiles are read by profile");
    const profile = await run2.profile(id10, signal);
    return {
      records: [
        {
          profileId: id10,
          username: profile.username,
          fullName: profile.full_name,
          biography: profile.biography,
          externalUrl: profile.external_url,
          links: profile.bio_links.map(({ url }) => url),
          category: profile.category,
          isPrivate: profile.is_private,
          isVerified: profile.is_verified,
          isBusiness: profile.is_business,
          followers: profile.follower_count,
          following: profile.following_count,
          posts: profile.media_count,
          reels: profile.total_clips_count,
          city: profile.city_name,
          street: profile.address_street
        }
      ]
    };
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/streams/reels-stream.js
var { profileId: profileId7, id: id7, text: text6, count: count5 } = fields;
var properties8 = {
  profileId: profileId7,
  id: {
    ...id7,
    description: "Instagram\u2019s id of the reel. The posts stream\u2019s id when the reel is on the grid too."
  },
  code: {
    ...text6,
    description: "The reel\u2019s short code, as in instagram.com/reel/<code>/."
  },
  url: { ...text6, description: "The reel\u2019s page." },
  plays: {
    type: ["integer", "null"],
    minimum: 0,
    description: "How many times the reel was played, when its page was last read; NULL when Instagram does not show the count."
  },
  likes: {
    ...count5,
    description: "How many accounts liked the reel, when its page was last read."
  },
  comments: {
    ...count5,
    description: "How many comments the reel has, when its page was last read."
  },
  pinned: {
    type: ["boolean", "null"],
    description: "The profile pinned the reel to the top of its reels tab; NULL when Instagram does not say."
  }
};
var ReelsStream = class extends ListStream {
  name = "reels";
  primaryKey = ["profileId", "id"];
  jsonSchema = {
    type: "object",
    description: "One record per reel on the reels tab of an Instagram profile the import reads, reels kept off the grid among them. Primary key profileId, id. Join id to posts.id for the caption and date of a reel that is on the grid too. Scanned as the posts stream is.",
    properties: properties8,
    required: Object.keys(properties8)
  };
  reader(run2) {
    return run2.reels;
  }
  record(item, profile) {
    return {
      profileId: profile,
      id: item.pk,
      code: item.code,
      url: reelUrl(item.code),
      plays: item.play_count,
      likes: item.like_count,
      comments: item.comment_count,
      pinned: item.clips_tab_pinned_user_ids?.includes(profile) ?? null
    };
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/others-posts-stream.js
var { profileId: profileId8, id: id8, text: text7, nullableText: nullableText6, count: count6, kind: kind2 } = fields;
var othersPostProperties = {
  profileId: profileId8,
  id: {
    ...id8,
    description: "Instagram\u2019s id of the post. The media stream\u2019s postId."
  },
  code: {
    ...text7,
    description: "The post\u2019s short code, as in instagram.com/p/<code>/."
  },
  url: { ...text7, description: "The post\u2019s page." },
  owner: {
    ...text7,
    description: "The username of the account that posted it."
  },
  caption: {
    ...nullableText6,
    description: "The post\u2019s caption; NULL when it has none."
  },
  kind: {
    ...kind2,
    description: "photo, video, or carousel of several slides."
  },
  productType: {
    ...text7,
    description: "Instagram\u2019s product type, such as feed, carousel_container, or clips for a reel."
  },
  likes: {
    ...count6,
    description: "How many accounts liked the post, when its page was last read."
  },
  comments: {
    ...count6,
    description: "How many comments the post has, when its page was last read."
  },
  slides: {
    ...count6,
    description: "How many images or videos the post holds; 1 unless it is a carousel."
  }
};
var OthersPostsStream = class extends ListStream {
  primaryKey = ["profileId", "id"];
  record(item, profile) {
    return {
      profileId: profile,
      id: item.pk,
      code: item.code,
      url: postUrl(item.code),
      owner: item.user.username,
      caption: item.caption?.text ?? null,
      kind: kindOf(item.media_type),
      productType: item.product_type,
      likes: item.like_count,
      comments: item.comment_count,
      slides: item.carousel_media?.length ?? 1
    };
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/streams/reposts-stream.js
var RepostsStream = class extends OthersPostsStream {
  name = "reposts";
  jsonSchema = {
    type: "object",
    description: "One record per post of another account that an Instagram profile the import reads reposted, the latest repost first on the profile\u2019s reposts tab. Primary key profileId, id. Scanned as the posts stream is.",
    properties: othersPostProperties,
    required: Object.keys(othersPostProperties)
  };
  reader(run2) {
    return run2.reposts;
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/streams/stories-stream.js
var { profileId: profileId9, id: id9, text: text8, nullableText: nullableText7, instant: at4 } = fields;
var properties9 = {
  profileId: profileId9,
  id: { ...id9, description: "Instagram\u2019s id of the story." },
  postedAt: { ...at4, description: "When the story was posted." },
  expiresAt: {
    ...at4,
    description: "When Instagram stops showing the story, a day after it was posted."
  },
  kind: {
    type: "string",
    enum: ["photo", "video"],
    description: "photo, or video, whose file is its cover frame."
  },
  productType: {
    ...text8,
    description: "Instagram\u2019s product type of the story, such as story."
  },
  description: {
    ...nullableText7,
    description: "The description Instagram wrote of the image, when it wrote one."
  }
};
var StoriesStream = class extends SnapshotStream {
  name = "stories";
  primaryKey = ["profileId", "id"];
  supportsFileTransfer = true;
  expiresBy = "expiresAt";
  jsonSchema = {
    type: "object",
    description: "One record per story an Instagram profile the import reads posted, with its image, whose text, such as a changed class time, is in attachment_text. Primary key profileId, id. A story stays after Instagram stops showing it; one the profile deleted earlier is deleted.",
    properties: properties9,
    required: Object.keys(properties9)
  };
  policy() {
    return new Retention((/* @__PURE__ */ new Date()).toISOString());
  }
  async scan({ run: run2, profileId: owner2, range, signal }) {
    if (owner2 === null)
      throw new TypeError("Instagram stories are read by profile");
    const images2 = /* @__PURE__ */ new Map();
    const records = (await run2.web.stories(owner2, signal)).filter((item) => within(range, instant(item.taken_at))).map((item) => {
      const record = {
        profileId: owner2,
        id: item.pk,
        postedAt: instant(item.taken_at),
        expiresAt: instant(item.expiring_at),
        kind: kindOf(item.media_type),
        productType: item.product_type,
        description: item.accessibility_caption
      };
      images2.set(this.keyOf(record), largest(item.image_versions2.candidates).url);
      return record;
    });
    return { records, images: images2 };
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/streams/tagged-posts-stream.js
var TaggedPostsStream = class extends OthersPostsStream {
  name = "tagged_posts";
  jsonSchema = {
    type: "object",
    description: "One record per post of another account that tags an Instagram profile the import reads, as the profile\u2019s tagged tab lists them. Primary key profileId, id. Scanned as the posts stream is.",
    properties: othersPostProperties,
    required: Object.keys(othersPostProperties)
  };
  reader(run2) {
    return run2.tagged;
  }
};

// ../../../../../../../../Users/ezzabuzaid/Desktop/experiments/context-compiler/packages/sources/instagram/web/dist/instagram-web-source.js
var readers = {
  following: new FollowingStream(),
  profiles: new ProfilesStream(),
  posts: new PostsStream(),
  media: new MediaStream(),
  comments: new CommentsStream(),
  reels: new ReelsStream(),
  reposts: new RepostsStream(),
  taggedPosts: new TaggedPostsStream(),
  stories: new StoriesStream(),
  highlights: new HighlightsStream(),
  highlightItems: new HighlightItemsStream()
};
var catalog = new Catalog(Object.values(readers).map((reader) => reader.describe()));
var readersByName = new Map(Object.values(readers).map((reader) => [reader.name, reader]));
var pollIntervalMs = 60 * 60 * 1e3;
var InstagramWebSource = class _InstagramWebSource extends Source {
  identity = "instagram-web";
  catalog = catalog;
  following = readers.following.describe();
  profiles = readers.profiles.describe();
  posts = readers.posts.describe();
  media = readers.media.describe();
  comments = readers.comments.describe();
  reels = readers.reels.describe();
  reposts = readers.reposts.describe();
  taggedPosts = readers.taggedPosts.describe();
  stories = readers.stories.describe();
  highlights = readers.highlights.describe();
  highlightItems = readers.highlightItems.describe();
  profileIds;
  range;
  // A source for the profiles the options name; with none, it reads only
  // the accounts the signed-in account follows, as setup lists them.
  constructor({ profileIds = [], startAt, endAt } = {}) {
    super();
    for (const instant2 of [startAt, endAt])
      if (instant2 !== void 0 && !isTimestamp(instant2))
        throw new TypeError(`Instagram date range ${instant2} is not a timestamp`);
    this.profileIds = Object.freeze([...new Set(profileIds)]);
    this.range = Object.freeze({
      ...startAt === void 0 ? {} : { startAt },
      ...endAt === void 0 ? {} : { endAt }
    });
    Object.freeze(this);
  }
  // A source for the profiles the options name, or, when they name none,
  // for every account the signed-in account follows now.
  static async connect(options2 = {}, signal) {
    var _stack = [];
    try {
      if (options2.profileIds !== void 0 && options2.profileIds.length > 0)
        return new _InstagramWebSource(options2);
      const run2 = __using(_stack, await InstagramRun.open(signal), true);
      const followed = [];
      let next = null;
      do {
        const page = await run2.web.following(next, signal);
        followed.push(...page.items.map(({ pk }) => pk));
        next = page.next;
      } while (next !== null);
      return new _InstagramWebSource({ ...options2, profileIds: followed });
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      var _promise = __callDispose(_stack, _error, _hasError);
      _promise && await _promise;
    }
  }
  open() {
    return InstagramRun.open();
  }
  partitions() {
    return this.profileIds.map((profileId10) => ({ profileId: profileId10 }));
  }
  failureType(error) {
    return error instanceof BrowserSessionNotFoundError || error instanceof SafeStorageUnavailableError || error instanceof InstagramLoginError ? "config" : "system";
  }
  coverage(_stream) {
    const selection = {
      profileIds: [...this.profileIds]
    };
    if (this.range.startAt !== void 0)
      selection.startAt = this.range.startAt;
    if (this.range.endAt !== void 0)
      selection.endAt = this.range.endAt;
    return {
      description: "What instagram.com shows the account signed in to Instagram in the browser, for the selected profiles: each run reads their newest posts and the next pages of a scan of each list, so a long list is complete after several runs, and their stories, highlights and comments. Posts outside the date range, when one is set, are left out; reels, reposts and tagged posts name no date and are not narrowed by it.",
      selection
    };
  }
  async currentAsOf() {
    return null;
  }
  async *observe({ streams, signal }) {
    if (signal.aborted)
      return;
    yield streams;
    try {
      for await (const _ of setInterval(pollIntervalMs, void 0, { signal }))
        yield streams;
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError"))
        throw error;
    }
  }
  async *extract(configuration, state, partition, run2, signal) {
    const reader = readersByName.get(configuration.stream.name);
    if (reader === void 0)
      throw new Error(`Instagram has no stream ${configuration.stream.name}`);
    yield* reader.read({
      run: run2,
      state,
      profileId: partition === null ? null : String(partition.profileId),
      range: this.range,
      configuration,
      files: configuration.fileReads.length > 0,
      signal
    });
  }
};

// packages/connectors/instagram/dist/instagram-connector.js
var account = ({ username, fullName }) => typeof fullName === "string" && fullName !== "" ? `${String(username)} (${fullName})` : String(username);
function options({ collectionIds, startAt, endAt }) {
  return {
    ...collectionIds === void 0 ? {} : { profileIds: collectionIds },
    ...startAt === void 0 ? {} : { startAt },
    ...endAt === void 0 ? {} : { endAt }
  };
}
var InstagramConnector = class extends AppleConnector {
  datedBy = "date posted";
  fullDiskAccess = false;
  note = "Instagram has no Mac app, so the import reads instagram.com with the session of the browser you signed in to Instagram with. Pick the profiles among the accounts you follow; follow a profile on Instagram to add it. A long profile is complete after several hourly syncs.";
  choices = [
    {
      stream: "following",
      scope: "collectionIds",
      title: "profiles",
      id: byId,
      label: account
    }
  ];
  unscoped = ["following"];
  storeCopies = [];
  access() {
    return "Sign in to Instagram in Dia, Google Chrome, Arc, Microsoft Edge or Brave. When macOS asks whether security may use the browser\u2019s Safe Storage key, click Always Allow.";
  }
  source(scope) {
    return new InstagramWebSource(options(scope));
  }
  // An import that selects no profile reads every account the signed-in
  // account follows.
  importSource(scope) {
    return InstagramWebSource.connect(options(scope));
  }
};
export {
  InstagramConnector as default
};
