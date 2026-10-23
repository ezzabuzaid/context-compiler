import { useState } from 'react';

import { messageOf } from './call-tool.ts';
import type { ConnectorRow } from './contract.ts';
import { usePage } from './page-context.tsx';

export function KeepCurrent({ row }: { row: ConnectorRow }) {
  const { watch } = usePage();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const change = async (watched: boolean) => {
    setBusy(true);
    try {
      await watch(row.name, watched);
      setFailure(null);
    } catch (error) {
      setFailure(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card scope">
      <label className="toggle">
        <span>Keep current</span>
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={row.watched}
          disabled={busy}
          onChange={(event) => void change(event.target.checked)}
        />
      </label>
      {failure !== null && (
        <p role="alert" className="text-small text-destructive">
          {failure}
        </p>
      )}
    </section>
  );
}
