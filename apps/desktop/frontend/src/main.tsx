import { DEFAULT_REQUEST_TIMEOUT_MSEC } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { PageClient } from '@workspace/ui/client';
import { Page } from '@workspace/ui/page';

import { type DesktopState, isPageTool } from '../../src/desktop-api.ts';

const client: PageClient = {
  async callServerTool(params, options) {
    if (!isPageTool(params.name))
      throw new Error('Tool is not available to this page.');
    options?.signal?.throwIfAborted();
    const id = crypto.randomUUID();
    const cancel = () => window.desktop.cancelTool(id);
    options?.signal?.addEventListener('abort', cancel, { once: true });
    try {
      return await window.desktop.callTool(
        id,
        {
          name: params.name,
          arguments: params.arguments,
        },
        options?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC,
      );
    } finally {
      options?.signal?.removeEventListener('abort', cancel);
    }
  },
};

function Desktop() {
  const [state, setState] = useState<DesktopState>();
  useEffect(() => {
    const unsubscribe = window.desktop.onState(setState);
    void window.desktop.state().then(setState);
    return unsubscribe;
  }, []);
  useLayoutEffect(() => {
    if (state !== undefined)
      document.documentElement.dataset.theme = state.theme;
  }, [state]);
  if (state?.status === 'ready') return <Page app={client} link={undefined} />;
  return (
    <main id="status">
      <p id="message" role={state?.status === 'failed' ? 'alert' : 'status'}>
        {state?.status === 'failed'
          ? state.message
          : 'Opening Context Compiler…'}
      </p>
      {state?.status === 'failed' && (
        <button onClick={() => void window.desktop.retry()}>Retry</button>
      )}
    </main>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root element.');
createRoot(root).render(<Desktop />);
