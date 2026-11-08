import script from './script.ts';
import styles from './styles.ts';

// The mark: a point with the arc of a wave around it, an observer that answers when something moves.
const mark = `<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="2.5" fill="currentColor"/><path d="M3.7 12.5a6.5 6.5 0 0 1 0-7M14.3 5.5a6.5 6.5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

export default `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ambient</title>
<style>${styles}</style>
</head>
<body>
<header class="bar">
  <div class="bar-inner">
    <a class="brand" href="#/notifications">${mark}Ambient</a>
    <nav class="nav" aria-label="Screens">
      <a href="#/notifications" data-view="notifications">Notifications <span id="unread" class="count"></span></a>
      <a href="#/decisions" data-view="decisions">Decisions</a>
    </nav>
    <div class="status"><span class="dot"></span><span class="label">Connecting</span></div>
  </div>
</header>
<main></main>
<div id="announce" class="sr" role="status" aria-atomic="true"></div>
<script type="module">${script}</script>
</body>
</html>`;
