import { Switch } from '@zukhruf/shadcn';
import { useId, useState } from 'react';

import { messageOf } from './call-tool.ts';
import type { ConnectorRow } from './contract.ts';
import { usePage } from './page-context.tsx';

export function KeepCurrent({ row }: { row: ConnectorRow }) {
  const { watch } = usePage();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const id = useId();

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
      <div className="toggle">
        <label htmlFor={id}>Keep current</label>
        <Switch
          id={id}
          checked={row.watched}
          disabled={busy}
          onCheckedChange={(checked) => void change(checked)}
        />
      </div>
      {failure !== null && (
        <p role="alert" className="text-small text-destructive">
          {failure}
        </p>
      )}
    </section>
  );
}
