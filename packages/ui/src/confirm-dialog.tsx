import { useEffect, useRef } from 'react';

// A modal question before a change that deletes imported data.
export function ConfirmDialog({
  title,
  body,
  confirm,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);
  return (
    <dialog ref={dialogRef} className="dialog card" onCancel={onCancel}>
      <h3>{title}</h3>
      <p className="text-muted">{body}</p>
      <div className="actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>
          {confirm}
        </button>
      </div>
    </dialog>
  );
}
