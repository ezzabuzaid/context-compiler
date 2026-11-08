// The page's own script. It builds every node through h(), never innerHTML,
// because messages and rows are the user's data. String.raw keeps its escapes.
export default String.raw`
const POLL_MS = 5000;
const SHOWN_TEXT_COLUMNS = 8;
const CONTEXT_COLUMNS = 4;
const wide = matchMedia('(min-width: 761px)');

const state = {
  notifications: null,
  decisions: null,
  model: null,
  lastGood: null,
  down: false,
  filter: 'all',
  read: loadRead(),
  arrived: new Set(),
};

function loadRead() {
  try { return new Set(JSON.parse(localStorage.getItem('ambient.read') ?? '[]')); }
  catch { return new Set(); }
}
function saveRead() {
  try { localStorage.setItem('ambient.read', JSON.stringify([...state.read].slice(-500))); }
  catch {}
}

function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'class') node.className = value;
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

function sourceName(id) {
  if (id === 'whatsapp') return 'WhatsApp';
  return id.split('-').map((word, index) => index === 0 ? word[0].toUpperCase() + word.slice(1) : word).join(' ');
}
function modelName(id) {
  return id.split('-').map((part) => part === 'gpt' ? 'GPT' : part[0].toUpperCase() + part.slice(1)).join('-');
}
const OPS = { insert: 'Inserted', update: 'Updated', delete: 'Deleted', read: 'Read', truncate: 'Emptied' };

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const full = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
function sameDay(a, b) { return a.toDateString() === b.toDateString(); }
function ago(iso) {
  const then = new Date(iso);
  const now = new Date();
  const minutes = Math.floor((now - then) / 60000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return minutes + ' min';
  if (sameDay(then, now)) return clock.format(then);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(then, yesterday)) return 'Yesterday ' + clock.format(then);
  return day.format(then) + ' ' + clock.format(then);
}
function seconds(ms) { return (ms / 1000).toFixed(1) + ' s'; }

function route() {
  const [view, id] = location.hash.replace(/^#\/?/, '').split('/');
  return { view: view === 'decisions' ? 'decisions' : 'notifications', id: id ? decodeURIComponent(id) : null };
}

function outcome(decision) {
  if (decision.failure) return 'failed';
  if (!decision.decision) return 'waiting';
  return decision.decision.kind === 'notify' ? 'notified' : 'silent';
}
const OUTCOMES = { notified: 'Notified', silent: 'Silent', failed: 'Failed', waiting: 'Waiting' };

function isText(value) {
  return typeof value === 'string' && value.trim() !== '' && !/^-?\d+(\.\d+)?$/.test(value);
}
function value(raw) {
  if (raw === null || raw === undefined || raw === '') return h('span', { class: 'dash', 'aria-label': 'empty' }, '—');
  return typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
}
function field(name, raw, changed) {
  return h('div', { class: changed ? 'field is-changed' : 'field' },
    h('dt', { class: 'code', title: name }, name, changed && h('span', { class: 'changed' }, 'changed')),
    h('dd', { dir: 'auto' }, value(raw)));
}

function keyText(key) {
  return Object.entries(key).map(([name, id]) => name + ' ' + id).join(', ');
}

function changeRecord(evidence) {
  const change = evidence.data;
  const key = change.key ? keyText(change.key) : null;
  const head = h('div', { class: 'change-head' },
    h('span', { class: 'source' }, sourceName(evidence.source)),
    h('span', { class: 'code' }, change.table),
    h('span', { class: 'pill' }, OPS[change.op] ?? change.op),
    key && h('span', { class: 'key code' }, key));
  if (change.op === 'truncate')
    return h('section', { class: 'change' }, head, h('p', { class: 'empty' }, 'Every row of this table was removed.'));
  if (change.op === 'delete')
    return h('section', { class: 'change' }, head, h('p', { class: 'empty' }, 'This row was deleted.'));

  const columns = Object.entries(change.after);
  const changed = new Set(change.changed ?? []);
  const shown = columns.filter(([name]) => changed.has(name));
  const textColumns = columns.filter(([name, raw]) => !changed.has(name) && isText(raw));
  shown.push(...textColumns.slice(0, changed.size > 0 ? CONTEXT_COLUMNS : SHOWN_TEXT_COLUMNS));
  const shownNames = new Set(shown.map(([name]) => name));
  const rest = columns.filter(([name]) => !shownNames.has(name));
  return h('section', { class: 'change' }, head,
    h('dl', { class: 'fields' }, shown.map(([name, raw]) => field(name, raw, changed.has(name)))),
    rest.length > 0 && h('details', { class: 'more' },
      h('summary', null, 'The other ' + rest.length + ' columns'),
      h('dl', { class: 'fields' }, rest.map(([name, raw]) => field(name, raw, false)))));
}

function placeholderRows(count) {
  return h('ul', { class: 'rows', 'aria-busy': 'true' }, Array.from({ length: count }, () =>
    h('li', { class: 'row' },
      h('span', { class: 'placeholder', style: 'width: 92%' }),
      h('span', { class: 'placeholder', style: 'width: 60%; margin-top: 8px' }),
      h('span', { class: 'placeholder', style: 'width: 30%; margin-top: 10px; height: 10px' }))));
}

function unreachable() {
  return h('div', { class: 'panel empty', role: 'alert' },
    h('strong', null, 'Ambient is not answering.'),
    'It does not answer while it takes a baseline of a new source, which can take a few minutes. ',
    h('button', { class: 'link-button', onclick: poll }, 'Retry'));
}

function notificationsView(id) {
  const list = state.notifications;
  const title = h('div', { class: 'title-row' }, h('h1', null, 'Notifications'));
  if (list === null && state.down) return [title, unreachable()];
  if (list === null) return [title, h('div', { class: 'split inbox' }, h('div', { class: 'panel' }, placeholderRows(5)), h('div', { class: 'panel open' }))];
  if (list.length === 0) {
    title.append(h('span', { class: 'subline' }, 'Nothing worth telling you yet'));
    return [title, h('div', { class: 'panel empty' },
      h('strong', null, 'Ambient has not found a change worth a notification.'),
      'Every change it looked at is in ', h('a', { href: '#/decisions' }, 'Decisions'), ', with what it did and why.')];
  }
  const latest = list[0];
  const when = ago(latest.createdAt);
  title.append(h('span', { class: 'subline' },
    list.length + (list.length === 1 ? ' notification' : ' notifications') + ' · the latest from ' + sourceName(latest.evidence[0].source) + ', ' + (when === 'Now' ? 'just now' : when.replace('Yesterday', 'yesterday'))));
  const selected = list.find((item) => item.id === id) ?? (wide.matches ? latest : null);
  if (selected && (id || wide.matches)) { state.read.add(selected.id); saveRead(); }
  const rows = h('ul', { class: 'rows', role: 'list' }, list.map((item) => {
    const unread = !state.read.has(item.id);
    return h('li', null, h('button', {
      class: 'row' + (unread ? ' is-unread' : '') + (state.arrived.has(item.id) ? ' arrived' : ''),
      'aria-current': item === selected ? 'true' : null,
      'data-id': item.id,
      onclick: () => { location.hash = '#/notifications/' + encodeURIComponent(item.id); },
      onkeydown: moveFocus,
    },
      unread && h('span', { class: 'unread', 'aria-label': 'unread' }),
      h('span', { class: 'message', dir: 'auto' }, item.message),
      h('span', { class: 'meta' },
        h('span', null, [...new Set(item.evidence.map((evidence) => sourceName(evidence.source)))].join(', ')),
        h('span', { class: 'num' }, ago(item.createdAt)))));
  }));
  const open = selected ? h('article', { class: 'panel open scroll', 'aria-label': 'Notification' },
    h('a', { class: 'back link-button', href: '#/notifications' }, 'All notifications'),
    h('div', { class: 'open-meta' }, h('time', { datetime: selected.createdAt }, full.format(new Date(selected.createdAt)))),
    h('p', { class: 'open-message', dir: 'auto' }, selected.message),
    h('h2', { class: 'section-title' }, selected.evidence.length === 1 ? 'The change it cites' : 'The ' + selected.evidence.length + ' changes it cites'),
    selected.evidence.map(changeRecord)) : h('div', { class: 'panel open' });
  return [title, h('div', { class: 'split inbox' + (id ? ' showing-item' : '') },
    h('nav', { class: 'panel scroll', 'aria-label': 'Notifications' }, rows), open)];
}

function decisionsView(id) {
  const list = state.decisions;
  const title = h('div', { class: 'title-row' }, h('h1', null, 'Decisions'));
  if (list === null && state.down) return [title, unreachable()];
  if (list === null) return [title, h('div', { class: 'panel outcomes' }, placeholderRows(1)), h('div', { class: 'panel' }, placeholderRows(6))];
  const counts = { all: list.length, notified: 0, silent: 0, failed: 0, waiting: 0 };
  for (const item of list) counts[outcome(item)] += 1;
  title.append(h('span', { class: 'subline' },
    list.length === 0 ? 'Ambient has not received a change yet'
      : 'The last ' + list.length + ' changes Ambient received' + (counts.waiting > 0 ? ' · ' + counts.waiting + ' waiting for a turn' : '')));
  const tab = (name, label) => h('button', {
    class: 'tab', role: 'tab', 'aria-selected': String(state.filter === name),
    onclick: () => { state.filter = name; render(); },
  }, h('span', { class: 'label' }, label), h('span', { class: 'value num' }, counts[name]));
  const share = (name) => counts.all === 0 ? 0 : (counts[name] / counts.all) * 100;
  const outcomes = h('section', { class: 'panel outcomes', 'aria-label': 'Outcomes' },
    h('div', { class: 'tabs', role: 'tablist' }, tab('all', 'All changes'), tab('notified', 'Notified'), tab('silent', 'Silent'), tab('failed', 'Failed')),
    h('div', { class: 'split-bar', role: 'img', 'aria-label': counts.notified + ' notified, ' + counts.silent + ' silent, ' + counts.failed + ' failed' },
      ['notified', 'silent', 'failed'].filter((name) => counts[name] > 0).map((name) => h('span', { class: name, style: 'width: ' + share(name) + '%' }))));
  const shown = list.filter((item) => state.filter === 'all' || outcome(item) === state.filter);
  const selected = shown.find((item) => item.id === id) ?? (wide.matches ? shown[0] : null);
  const body = shown.length === 0
    ? h('tbody', null, h('tr', null, h('td', { colspan: '4', class: 'empty' }, 'No ' + OUTCOMES[state.filter].toLowerCase() + ' changes among the last ' + list.length + '.')))
    : h('tbody', null, shown.map((item) => {
      const kind = outcome(item);
      const change = item.event.data;
      let note;
      if (kind === 'failed') note = item.failure;
      else if (kind === 'notified') note = item.decision.message;
      else note = (OPS[change.op] ?? change.op) + (change.key ? ' ' + keyText(change.key) : '');
      return h('tr', {
        tabindex: '0', 'aria-current': item === selected ? 'true' : null,
        onclick: () => { location.hash = '#/decisions/' + encodeURIComponent(item.id); },
        onkeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); } else moveFocus(event); },
      },
        h('td', { class: 'when num' }, ago(item.received_at)),
        h('td', null, sourceName(item.event.source) + ' · ', h('span', { class: 'code' }, change.table), h('span', { class: 'sub', dir: 'auto' }, note)),
        h('td', null, h('span', { class: 'pill ' + kind }, OUTCOMES[kind])),
        h('td', { class: 'turn num' }, item.duration_ms === null ? h('span', { class: 'dash' }, '—') : seconds(item.duration_ms)));
    }));
  const table = h('div', { class: 'panel scroll' }, h('table', null,
    h('thead', null, h('tr', null, h('th', { class: 'when' }, 'Received'), h('th', null, 'Change'), h('th', null, 'Outcome'), h('th', { class: 'num turn' }, 'Turn'))),
    body));
  let detail = h('div', { class: 'panel open' });
  if (selected) {
    const kind = outcome(selected);
    const said = selected.failure ?? (selected.decision?.kind === 'notify' ? selected.decision.message : selected.decision?.reason);
    detail = h('article', { class: 'panel open scroll', 'aria-label': 'Decision' },
      h('a', { class: 'back link-button', href: '#/decisions' }, 'All decisions'),
      h('div', { class: 'open-meta' }, h('span', { class: 'pill ' + kind }, OUTCOMES[kind]), ' ',
        h('time', { datetime: selected.received_at }, full.format(new Date(selected.received_at))),
        selected.duration_ms !== null && ' · turn ' + seconds(selected.duration_ms)),
      said && h('p', { class: 'open-message said', dir: 'auto' }, said),
      h('h2', { class: 'section-title' }, 'The change it received'),
      changeRecord(selected.event));
  }
  return [title, outcomes, h('div', { class: 'split audit' + (id ? ' showing-item' : '') }, table, detail)];
}

function moveFocus(event) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const items = [...event.currentTarget.closest('ul, tbody').querySelectorAll('button.row, tr[tabindex]')];
  const next = items[items.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)];
  if (next) { event.preventDefault(); next.focus(); }
}

function renderBar() {
  const { view } = route();
  for (const link of document.querySelectorAll('.nav a')) {
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const unread = (state.notifications ?? []).filter((item) => !state.read.has(item.id)).length;
  const count = document.querySelector('#unread');
  count.textContent = unread > 0 ? String(unread) : '';
  count.setAttribute('aria-label', unread > 0 ? unread + ' unread' : '');
  const status = document.querySelector('.status');
  status.classList.toggle('down', state.down);
  const label = status.querySelector('.label');
  const stamp = state.lastGood ? clock.format(state.lastGood) : null;
  if (state.down) {
    label.replaceChildren('Cannot reach Ambient' + (stamp ? ' · showing ' + stamp + ' ' : ' '),
      h('button', { class: 'link-button', onclick: poll }, 'Retry'));
  } else {
    label.replaceChildren((state.model ? 'Watching with ' + modelName(state.model) : 'Connecting') + (stamp ? ' · updated ' + stamp : ''));
  }
}

function render() {
  const { view, id } = route();
  const main = document.querySelector('main');
  const keep = [...main.querySelectorAll('.scroll, details')].map((node) => node.tagName === 'DETAILS' ? node.open : node.scrollTop);
  main.replaceChildren(...(view === 'decisions' ? decisionsView(id) : notificationsView(id)));
  [...main.querySelectorAll('.scroll, details')].forEach((node, index) => {
    if (keep[index] === undefined) return;
    if (node.tagName === 'DETAILS') node.open = keep[index]; else node.scrollTop = keep[index];
  });
  renderBar();
}

async function json(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(path + ' answered ' + response.status);
  return response.json();
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const wantDecisions = route().view === 'decisions';
    const [health, notifications, decisions] = await Promise.all([
      json('/health'), json('/notifications'), wantDecisions ? json('/decisions') : null]);
    const known = new Set((state.notifications ?? []).map((item) => item.id));
    const fresh = state.notifications === null ? [] : notifications.filter((item) => !known.has(item.id));
    state.arrived = new Set(fresh.map((item) => item.id));
    const changed = JSON.stringify(notifications) !== JSON.stringify(state.notifications)
      || (decisions !== null && JSON.stringify(decisions) !== JSON.stringify(state.decisions));
    state.model = health.model;
    state.notifications = notifications;
    if (decisions !== null) state.decisions = decisions;
    state.lastGood = new Date();
    const wasDown = state.down;
    state.down = false;
    if (fresh.length > 0)
      document.querySelector('#announce').textContent = fresh.length === 1 ? 'One new notification' : fresh.length + ' new notifications';
    if (changed || wasDown) render(); else renderBar();
    state.arrived = new Set();
  } catch {
    const wasDown = state.down;
    state.down = true;
    if (!wasDown) render(); else renderBar();
  } finally {
    polling = false;
  }
}

addEventListener('hashchange', () => { if (route().view === 'decisions') poll(); render(); });
addEventListener('scroll', () => document.querySelector('.bar').classList.toggle('scrolled', scrollY > 0), { passive: true });
wide.addEventListener('change', render);
render();
poll();
setInterval(poll, POLL_MS);
`;
