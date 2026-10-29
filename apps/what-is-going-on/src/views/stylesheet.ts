// brutalist.report's own stylesheet with theme tokens, and the app's action
// buttons.
export default `:root {
  --bg: #ffffff;
  --fg: #000000;
  --title: #000000;
  --link: #0000ff;
  --visited: #800080;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #000000;
    --fg: #e8e6e3;
    --title: #ffffff;
    --link: #3391ff;
    --visited: #ba55d3;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #000000;
  --fg: #e8e6e3;
  --title: #ffffff;
  --link: #3391ff;
  --visited: #ba55d3;
  color-scheme: dark;
}
body {
  background: var(--bg);
  color: var(--fg);
  font-family: Charter, "Bitstream Charter", "Sitka Text", Cambria, serif;
  font-size: 17px;
  line-height: 1.4;
  overflow-wrap: break-word;
  word-break: break-word;
  position: relative;
  padding-block: 8px;
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
}
a:link { text-decoration: none; color: var(--link); }
a:visited { text-decoration: none; color: var(--visited); }
div.banner a:link, div.banner a:visited, a.source:link, a.source:visited { color: var(--title); }
.brutal-grid {
  display: grid;
  grid-auto-flow: row;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
div.about { max-width: 50%; margin-right: auto; }
li { padding-bottom: 0.5rem; }
.theme-toggle {
  position: absolute;
  top: 0;
  right: max(16px, env(safe-area-inset-right, 0px));
  margin: 1em 0;
  font-size: 0.85em;
}
.theme-toggle button {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  cursor: pointer;
  color: var(--link);
}
input[type="text"], input[type="url"], textarea { font: inherit; width: 100%; box-sizing: border-box; }
:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
@media (max-width: 800px) {
  .brutal-grid { grid-template-columns: minmax(0, 1fr); }
  div.about { max-width: 100%; margin: auto; }
  .banner { padding-top: 3em; }
}
/* The app's own: an action is a POST form whose button looks like a link. */
form.act { display: inline; }
form.act button,
form.draft li button {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  cursor: pointer;
  color: var(--link);
}
`;
