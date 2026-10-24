import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import { callTool, messageOf } from './call-tool.ts';
import type { PageClient } from './client.ts';
import {
  type ConnectorRow,
  type ConnectorSelection,
  type MonitorRow,
  connectorIn,
  connectorsResult,
  monitorsResult,
} from './contract.ts';

// What every part of the Context Compiler page shares: its connection to the host, the
// connector and monitor rows it keeps current, the changes it makes, and
// which connector's or monitor's page is open.
type Page = {
  readonly app: PageClient | null;
  readonly rows: readonly ConnectorRow[] | null;
  readonly monitors: readonly MonitorRow[] | null | undefined;
  readonly removeMonitor: (name: string) => Promise<void>;
  readonly failure: string | null;
  // What a selection leaves out takes the defaults setup uses.
  readonly update: (
    connector: string,
    selection: Partial<ConnectorSelection> | null,
  ) => Promise<void>;
  // Keeps a connected connector current while the host is open, or not.
  readonly watch: (connector: string, watched: boolean) => Promise<void>;
  // Imports every connected connector again, or only the one named, and
  // settles once its passes have ended; a failure becomes the page's failure.
  readonly sync: (connector?: string) => Promise<void>;
  // Whether the page syncs every connector, and which it syncs alone.
  readonly syncing: boolean;
  readonly syncingConnectors: ReadonlySet<string>;
  readonly openedTranscription: boolean;
  readonly openTranscription: () => void;
  readonly opened: string | null;
  readonly open: (connector: string | null) => void;
  readonly openedMonitor: string | null;
  readonly openMonitor: (name: string) => void;
};

const PageContext = createContext<Page | null>(null);

export function usePage(): Page {
  const page = useContext(PageContext);
  if (page === null) throw new Error('usePage needs a PageProvider above it.');
  return page;
}

// The server cannot tell the page that an import moved on, so the page asks
// again: soon while a sync or an import runs, rarely once all are settled,
// and not at all while the host hides the page.
const busyDelay = 2_000;
const settledDelay = 15_000;
// A sync lasts as long as its slowest import; the server allows a tool call
// as long (tool_timeout_sec in plugins/context-compiler/.mcp.json).
const syncTimeout = 1_800_000;

export function PageProvider({
  app,
  children,
  link,
}: {
  app: PageClient | null;
  children: ReactNode;
  link: string | undefined;
}) {
  const [rows, setRows] = useState<readonly ConnectorRow[] | null>(null);
  const [monitors, setMonitors] = useState<readonly MonitorRow[] | null>();
  const [openedMonitor, setOpenedMonitor] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [reads, setReads] = useState(0);
  const [openedTranscription, setOpenedTranscription] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncingConnectors, setSyncingConnectors] = useState<
    ReadonlySet<string>
  >(new Set());

  const read = useCallback(async () => {
    if (app === null) return;
    try {
      const [{ connectors }, listed] = await Promise.all([
        callTool(app, 'connectors', {}, connectorsResult),
        callTool(app, 'monitors', {}, monitorsResult),
      ]);
      setRows(connectors);
      setMonitors(listed.monitors);
      setFailure(null);
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      setReads((count) => count + 1);
    }
  }, [app]);

  useEffect(() => {
    if (app === null) return;
    const busy =
      syncing ||
      syncingConnectors.size > 0 ||
      rows?.some(
        ({ status }) =>
          status.state === 'waiting' || status.state === 'running',
      );
    let delay = settledDelay;
    if (reads === 0) delay = 0;
    else if (busy === true) delay = busyDelay;
    const timer = setTimeout(() => {
      if (!document.hidden) void read();
    }, delay);
    return () => clearTimeout(timer);
  }, [app, reads, rows, read, syncing, syncingConnectors]);

  useEffect(() => {
    const shown = () => {
      if (!document.hidden) void read();
    };
    document.addEventListener('visibilitychange', shown);
    return () => document.removeEventListener('visibilitychange', shown);
  }, [read]);

  // A link to /connectors/<name> opens that connector; any other, the list.
  useEffect(() => {
    if (link !== undefined) {
      setOpened(connectorIn(link) ?? null);
      setOpenedMonitor(null);
      setOpenedTranscription(link === '/transcription');
    }
  }, [link]);

  const update = useCallback(
    async (
      connector: string,
      selection: Partial<ConnectorSelection> | null,
    ) => {
      if (app === null) return;
      const { connectors } = await callTool(
        app,
        'connector_update',
        { connector, selection },
        connectorsResult,
      );
      setRows(connectors);
      setFailure(null);
    },
    [app],
  );

  const watch = useCallback(
    async (connector: string, watched: boolean) => {
      if (app === null) return;
      const { connectors } = await callTool(
        app,
        'connector_watch',
        { connector, watched },
        connectorsResult,
      );
      setRows(connectors);
      setFailure(null);
    },
    [app],
  );

  const sync = useCallback(
    async (connector?: string) => {
      if (app === null) return;
      const mark = (running: boolean) => {
        if (connector === undefined) setSyncing(running);
        else
          setSyncingConnectors((names) =>
            running
              ? names.union(new Set([connector]))
              : names.difference(new Set([connector])),
          );
      };
      mark(true);
      try {
        const { connectors } = await callTool(
          app,
          'sync',
          connector === undefined ? {} : { connector },
          connectorsResult,
          { timeout: syncTimeout },
        );
        setRows(connectors);
        setFailure(null);
        // A sync checks the monitors too, so their last runs moved on.
        void read();
      } catch (error) {
        setFailure(messageOf(error));
      } finally {
        mark(false);
      }
    },
    [app, read],
  );

  const removeMonitor = useCallback(
    async (name: string) => {
      if (app === null) return;
      const listed = await callTool(
        app,
        'monitor_remove',
        { name },
        monitorsResult,
      );
      setMonitors(listed.monitors);
      setOpenedMonitor((opened) => (opened === name ? null : opened));
    },
    [app],
  );

  const open = useCallback((connector: string | null) => {
    setOpenedTranscription(false);
    setOpened(connector);
    setOpenedMonitor(null);
  }, []);

  const openMonitor = useCallback((name: string) => {
    setOpenedTranscription(false);
    setOpenedMonitor(name);
    setOpened(null);
  }, []);

  const openTranscription = useCallback(() => {
    setOpenedTranscription(true);
    setOpened(null);
    setOpenedMonitor(null);
  }, []);

  return (
    <PageContext
      value={{
        app,
        rows,
        monitors,
        removeMonitor,
        failure,
        update,
        watch,
        sync,
        syncing,
        syncingConnectors,
        openedTranscription,
        openTranscription,
        opened,
        open,
        openedMonitor,
        openMonitor,
      }}
    >
      {children}
    </PageContext>
  );
}
