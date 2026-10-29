import events from '../events.ts';
import { unmatched } from '../matching.ts';
import settings from '../settings.ts';
import { Html, markup, separated } from './markup.ts';
import stylesheet from './stylesheet.ts';

// The theme toggle is the page's only script: the choice lives in the
// viewer's browser.
const theme = new Html(`(() => {
  const root = document.documentElement;
  const box = document.getElementById('theme');
  const show = (theme) => {
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    box.replaceChildren(...['system', 'light', 'dark'].flatMap((name, index) => {
      const item = document.createElement(name === theme ? 'b' : 'button');
      item.textContent = name;
      if (name !== theme) {
        item.type = 'button';
        item.onclick = () => { try { localStorage.setItem('theme', name); } catch {} show(name); };
      }
      return index === 0 ? [item] : [' | ', item];
    }));
  };
  let saved = 'system';
  try { saved = localStorage.getItem('theme') ?? 'system'; } catch {}
  show(saved);
})();`);

const updated = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'full',
  timeStyle: 'short',
});

export function layout(page: {
  readonly title: string;
  // The window of the Not matched count.
  readonly hours: number;
  readonly controls?: Html;
  readonly main: Html;
}) {
  const last = events.updatedAt();
  const views = [
    markup`<a href="/">Today</a>`,
    markup`<a href="/following">Following (${settings.follows().size})</a>`,
    markup`<a href="/not-matched?hours=${page.hours}">Not matched (${
      unmatched(settings.interests(), events.lines({ hours: page.hours }))
        .length
    })</a>`,
    markup`<a href="/interests">Interests</a>`,
    markup`<a href="/sources">Sources</a>`,
  ];
  return markup`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
<style>${new Html(stylesheet)}</style>
</head>
<body>
<header>
  <div class="banner"><h1><a href="/">What is going on</a></h1></div>
  <aside id="updated">${last === null ? '' : `Last updated ${updated.format(last)}.`}</aside>
  <div class="theme-toggle" id="theme"></div>
</header>
<br>
<nav id="views" aria-label="Views">${separated(views)}</nav>
<br>
<div id="controls">${page.controls}</div>
<br><br>
<main id="main">${page.main}</main>
<script>${theme}</script>
</body>
</html>`.text;
}
