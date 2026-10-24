import type { App } from '@modelcontextprotocol/ext-apps';
import { useApp, useHostStyles } from '@modelcontextprotocol/ext-apps/react';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { Page } from '@workspace/ui/page';

function PluginPage() {
  const { app, error } = useApp({
    appInfo: { name: 'context-compiler-page', version: '1.0.0' },
    capabilities: {},
  });
  useHostStyles(app, app?.getHostContext());
  const link = useDeepLink(app);
  if (error !== null)
    return (
      <main className="page">
        <p role="alert" className="text-destructive">
          {error.message}
        </p>
      </main>
    );
  return <Page app={app} link={link} />;
}

// The deep link ChatGPT opened the page with, and each new one it sends while
// the page is open. Another host-context change, such as the theme, keeps the
// same link, so it does not move the page.
function useDeepLink(app: App | null): string | undefined {
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    if (app === null) return;
    // OpenAI's extensions also apply ChatGPT's interaction cursor to the page.
    const { deepLink } = new OpenAIExtensions(app);
    const read = () => setUrl(deepLink.getCurrent()?.url);
    read();
    app.addEventListener('hostcontextchanged', read);
    return () => app.removeEventListener('hostcontextchanged', read);
  }, [app]);
  return url;
}

const root = document.getElementById('root');
if (root === null) throw new Error('page.html has no #root element.');
createRoot(root).render(<PluginPage />);
