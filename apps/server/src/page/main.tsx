import type { App } from '@modelcontextprotocol/ext-apps';
import {
  useApp,
  useDocumentTheme,
  useHostStyles,
} from '@modelcontextprotocol/ext-apps/react';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import {
  useCallback,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { createRoot } from 'react-dom/client';

import { Page } from '@workspace/ui/page';

function PluginPage() {
  const [extensions, setExtensions] = useState<OpenAIExtensions | null>(null);
  const { app, error } = useApp({
    appInfo: { name: 'context-compiler-page', version: '1.0.0' },
    capabilities: {},
    // OpenAI's extensions read the deep link and also apply ChatGPT's
    // interaction cursor to the page.
    onAppCreated: (created) => setExtensions(new OpenAIExtensions(created)),
  });
  useHostStyles(app, app?.getHostContext());
  // The @zukhruf/shadcn menus take their dark variant from .dark, and
  // ChatGPT's theme sets data-theme.
  const theme = useDocumentTheme();
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  const link = useDeepLink(app, extensions);
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
function useDeepLink(
  app: App | null,
  extensions: OpenAIExtensions | null,
): string | undefined {
  const subscribe = useCallback(
    (changed: () => void) => {
      app?.addEventListener('hostcontextchanged', changed);
      return () => app?.removeEventListener('hostcontextchanged', changed);
    },
    [app],
  );
  return useSyncExternalStore(
    subscribe,
    () => extensions?.deepLink.getCurrent()?.url,
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('page.html has no #root element.');
createRoot(root).render(<PluginPage />);
