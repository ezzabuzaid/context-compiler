import { Hono } from 'hono';

import type { Journal } from '../journal/journal.ts';
import feedPage from './feed-page.ts';

export default function app(journal: Journal) {
  const app = new Hono();
  app.get('/notifications', (context) => context.json(journal.notifications()));
  app.get('/decisions', (context) => context.json(journal.decisions()));
  app.get('/health', (context) =>
    context.json({ status: 'ready', model: 'gpt-6-luna' }),
  );
  app.get('/', (context) => context.html(feedPage));
  app.onError((error, context) => context.json({ error: error.message }, 400));
  return app;
}
