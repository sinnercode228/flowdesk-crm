'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MonitorSmartphone } from 'lucide-react';
import { errorMessage } from '@/lib/api/errors';
import { Button } from '../ui/button';
import { ErrorNote } from '../ui/misc';
import { Modal } from '../ui/overlay';

/** Ends every session of the user after a confirmation. */
export function SignOutEverywhere({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const close = () => {
    if (pending) return;
    setOpen(false);
    setError(null);
  };

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink"
      >
        <MonitorSmartphone className="size-3.5" />
        Sign out everywhere
      </button>
      {open &&
        // The sidebar is sticky, which makes it a stacking context: a modal rendered inside it
        // would sit under the page content.
        createPortal(
          <Modal
            open
            onClose={close}
            title="Sign out everywhere?"
            footer={
              <>
                <Button variant="secondary" onClick={close} disabled={pending}>
                  Cancel
                </Button>
                <Button variant="danger" loading={pending} onClick={() => void confirm()}>
                  Sign out everywhere
                </Button>
              </>
            }
          >
            <div className="space-y-3 text-sm">
              <p>
                This ends your session here and in every other browser and device signed in to this
                account.
              </p>
              <p className="text-muted">
                A page already open elsewhere keeps working until its access token expires, at most
                15 minutes with the default settings, and then asks to sign in again.
              </p>
              {error !== null && <ErrorNote>{errorMessage(error)}</ErrorNote>}
            </div>
          </Modal>,
          document.body,
        )}
    </>
  );
}
