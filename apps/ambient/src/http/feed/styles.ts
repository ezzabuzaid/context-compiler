// Grid at 1440: a 1152px column = list 384 + gap 12 + open item 756 on Notifications,
// and table 760 + gap 12 + selected change 380 on Decisions.
export default `
:root {
  --ground: #f2f4f7;
  --surface: #ffffff;
  --raised: #f5f6f8;
  --active: #e8eaee;
  --border: #e1e4e8;
  --rule: #edeff2;
  --control: #d4d7dc;
  --text: #0a0a0a;
  --muted: #5d6168;
  --said: #1d5fbf;
  --negative: #c4242a;
  --positive: #2e7d32;
  --pill-neutral-bg: #eceef1;
  --pill-neutral-ink: #3d3f43;
  --pill-negative-bg: #ffedea;
  --pill-negative-ink: #831c1e;
  --radius-card: 8px;
  --radius-control: 6px;
  --gap: 12px;
  --column: 1152px;
  --bar: 48px;
  --font: system-ui, -apple-system, "Helvetica Neue", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, monospace;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--ground);
  color: var(--text);
  font: 14px/20px var(--font);
  -webkit-font-smoothing: antialiased;
}
button { font: inherit; color: inherit; }
a { color: inherit; }
:focus-visible { outline: 2px solid var(--said); outline-offset: 2px; }
.num { font-variant-numeric: tabular-nums; }
.code { font-family: var(--mono); font-size: 13px; }

.bar {
  position: sticky; top: 0; z-index: 2;
  height: var(--bar);
  background: var(--ground);
  border-bottom: 1px solid transparent;
  transition: border-color 150ms;
}
.bar.scrolled { border-bottom-color: var(--border); }
.bar-inner {
  max-width: var(--column); height: 100%; margin: 0 auto;
  display: flex; align-items: center; gap: 28px;
}
.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 15px; text-decoration: none; }
.brand svg { display: block; }
.nav { display: flex; gap: 4px; }
.nav a {
  display: inline-flex; align-items: center; gap: 6px;
  height: 32px; padding: 0 10px; border-radius: var(--radius-control);
  font-weight: 500; color: var(--muted); text-decoration: none;
  transition: background-color 150ms, color 150ms;
}
.nav a:hover { color: var(--text); }
.nav a[aria-current="page"] { background: var(--active); color: var(--text); }
.count { font-variant-numeric: tabular-nums; color: var(--said); font-weight: 600; }
.status { margin-left: auto; display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }
.status .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--positive); flex: none; }
.status.down .dot { background: var(--negative); }
.status.down { color: var(--text); }
.link-button {
  border: 0; background: none; padding: 0; cursor: pointer;
  font-weight: 500; text-decoration: underline; text-underline-offset: 3px;
}

main {
  max-width: var(--column); margin: 0 auto; padding: 20px 0 24px;
  display: flex; flex-direction: column;
  height: calc(100dvh - var(--bar)); min-height: 560px;
}
.title-row { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
h1 { font-size: 24px; line-height: 32px; font-weight: 600; letter-spacing: -0.01em; margin: 0; }
.subline { color: var(--muted); font-size: 15px; }

.split { display: grid; grid-template-rows: minmax(0, 1fr); gap: var(--gap); flex: 1; min-height: 0; }
.split.inbox { grid-template-columns: 384px 1fr; }
.split.audit { grid-template-columns: 760px 1fr; }
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  min-width: 0;
}
.scroll { overflow: auto; overscroll-behavior: contain; }

.rows { list-style: none; margin: 0; padding: 6px; }
.row {
  position: relative; display: block; width: 100%;
  padding: 12px 14px 12px 24px; border: 0; border-radius: 6px;
  background: none; text-align: left; cursor: pointer;
  transition: background-color 150ms;
}
.row:hover { background: var(--raised); }
.row[aria-current="true"] { background: var(--active); }
.row:active { transform: scale(0.995); }
.row .unread {
  position: absolute; left: 9px; top: 19px;
  width: 6px; height: 6px; border-radius: 50%; background: var(--said);
}
.row .message {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; unicode-bidi: plaintext;
}
.row.is-unread .message { font-weight: 500; }
.row .meta { display: flex; justify-content: space-between; gap: 12px; margin-top: 4px; font-size: 12px; color: var(--muted); }
.row + .row { margin-top: 2px; }
.row.arrived { animation: arrive 360ms var(--ease); }
@keyframes arrive { from { opacity: 0; transform: translateY(-6px); } }

.open { padding: 24px 28px 28px; }
.open-meta { color: var(--muted); font-size: 13px; }
.open-message {
  margin: 8px 0 0; max-width: 64ch;
  font-size: 18px; line-height: 28px; letter-spacing: -0.005em;
  white-space: pre-wrap; unicode-bidi: plaintext;
}
.open-message.said { font-size: 16px; line-height: 24px; }
.section-title { font-size: 13px; font-weight: 600; margin: 28px 0 10px; }
.back { display: none; }

.change { border: 1px solid var(--border); border-radius: var(--radius-card); overflow: hidden; container-type: inline-size; }
.change + .change { margin-top: var(--gap); }
.change-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 14px; background: var(--raised);
}
.change-head .source { font-weight: 600; }
.change-head .key {
  margin-left: auto; min-width: 0; max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted);
}
.pill {
  flex: none; white-space: nowrap;
  display: inline-flex; align-items: center; height: 20px; padding: 0 8px;
  border-radius: 999px; font-size: 12px; font-weight: 500;
  background: var(--pill-neutral-bg); color: var(--pill-neutral-ink);
}
.pill.failed { background: var(--pill-negative-bg); color: var(--pill-negative-ink); }
.pill.notified { background: none; color: var(--text); padding: 0; gap: 6px; }
.pill.notified::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--said); }
.fields { margin: 0; }
.field { display: grid; grid-template-columns: 180px 1fr; gap: 16px; padding: 8px 14px; border-top: 1px solid var(--rule); }
.field dt { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.field dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; unicode-bidi: plaintext; }
@container (max-width: 560px) {
  .field { grid-template-columns: 1fr; gap: 2px; }
}
.field .changed { display: block; font-family: var(--font); font-size: 12px; color: var(--muted); }
.field.is-changed dt { color: var(--text); }
.dash { color: var(--muted); }
.more { border-top: 1px solid var(--rule); }
.more summary { padding: 10px 14px; cursor: pointer; color: var(--muted); font-weight: 500; }
.more summary:hover { color: var(--text); }
.more[open] summary { color: var(--text); }

.outcomes { padding: 16px 20px 20px; margin-bottom: var(--gap); }
.tabs { display: grid; grid-template-columns: repeat(4, 1fr); }
.tab {
  border: 0; background: none; text-align: left; cursor: pointer;
  padding: 4px 0 12px; border-bottom: 2px solid transparent;
  transition: border-color 150ms;
}
.tab + .tab { padding-left: 20px; border-left: 1px solid var(--rule); }
.tab .label { display: block; color: var(--muted); font-size: 13px; }
.tab .value { display: block; font-size: 30px; line-height: 38px; font-weight: 400; color: var(--text); }
.tab[aria-selected="true"] .label { color: var(--text); font-weight: 500; }
.tab[aria-selected="true"] { border-bottom-color: var(--text); }
.tab:hover .label { color: var(--text); }
.split-bar { display: flex; gap: 2px; height: 10px; margin-top: 16px; border-radius: 999px; overflow: hidden; background: var(--rule); }
.split-bar span { display: block; height: 100%; }
.split-bar .notified { background: var(--said); }
.split-bar .silent { background: #9a9ea6; }
.split-bar .failed { background: var(--negative); }

table { width: 100%; border-collapse: collapse; }
th { font-size: 12px; font-weight: 400; color: var(--muted); text-align: left; padding: 10px 14px 8px; }
td { padding: 10px 14px; border-top: 1px solid var(--rule); vertical-align: top; }
th.num, td.num { text-align: right; }
tbody tr { cursor: pointer; transition: background-color 150ms; }
tbody tr:hover { background: var(--raised); }
tbody tr[aria-current="true"] { background: var(--active); }
td .sub { display: block; color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 380px; }
thead th { position: sticky; top: 0; background: var(--surface); z-index: 1; }

.placeholder { display: block; height: 12px; border-radius: 3px; background: var(--rule); }
.empty { padding: 28px; color: var(--muted); }
.empty strong { display: block; color: var(--text); font-weight: 500; margin-bottom: 4px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

@media (max-width: 1200px) {
  .bar-inner, main { margin: 0 24px; max-width: none; }
  .split.inbox { grid-template-columns: 320px 1fr; }
  .split.audit { grid-template-columns: 1fr 340px; }
  th.when, td.when, th.turn, td.turn { display: none; }
  td .sub { max-width: 260px; }
}
@media (max-width: 760px) {
  .bar-inner { margin: 0 16px; gap: 16px; }
  main { margin: 0 16px; padding-top: 16px; height: auto; min-height: 0; }
  .status .label { display: none; }
  .split.inbox, .split.audit { grid-template-columns: 1fr; grid-template-rows: auto; }
  .split.showing-item > :first-child { display: none; }
  .split:not(.showing-item) > :last-child { display: none; }
  .back { display: inline-flex; margin-bottom: 12px; }
  .scroll { overflow: visible; }
  .open { padding: 18px 16px 20px; }
  .open-message { font-size: 17px; line-height: 26px; }
  .tabs { grid-template-columns: repeat(2, 1fr); row-gap: 8px; }
  .tab:nth-child(3) { padding-left: 0; border-left: 0; }
  .tab .value { font-size: 24px; line-height: 30px; }
  td .sub { max-width: 220px; }
  .row { padding-top: 14px; padding-bottom: 14px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;
