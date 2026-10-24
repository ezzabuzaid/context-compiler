import type { PageClient } from './client.ts';
import { ConnectorDetail } from './connector-detail.tsx';
import { MonitorDetail } from './monitor-detail.tsx';
import { PageProvider, usePage } from './page-context.tsx';
import { Sidebar } from './sidebar.tsx';
import { TranscriptionDetail } from './transcription-detail.tsx';

// The Context Compiler page ChatGPT lists in its sidebar: its own sidebar, beside the
// page of the connector or monitor it opened.
export function Page({
  app,
  link,
}: {
  app: PageClient | null;
  link: string | undefined;
}) {
  return (
    <PageProvider app={app} link={link}>
      <div className="shell">
        <Sidebar />
        <OpenedConnector />
        <OpenedMonitor />
        <OpenedTranscription />
      </div>
    </PageProvider>
  );
}

function OpenedConnector() {
  const { rows, opened } = usePage();
  const row = rows?.find(({ name }) => name === opened);
  return row === undefined ? null : (
    <ConnectorDetail key={row.name} row={row} />
  );
}

function OpenedMonitor() {
  const { monitors, openedMonitor } = usePage();
  const monitor = monitors?.find(({ name }) => name === openedMonitor);
  return monitor === undefined ? null : <MonitorDetail monitor={monitor} />;
}

function OpenedTranscription() {
  const { openedTranscription } = usePage();
  return openedTranscription ? <TranscriptionDetail /> : null;
}
