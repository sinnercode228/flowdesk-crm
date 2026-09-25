'use client';

import { useState } from 'react';
import type { Stage, User } from '@flowdesk/shared';
import { useCreateDeal } from '@/hooks/queries';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { ErrorNote } from '../ui/misc';
import { Modal } from '../ui/overlay';
import { DealForm } from './deal-form';

export function NewDealDialog({
  open,
  onClose,
  stages,
  users,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  stages: Stage[];
  users: User[];
  onCreated: (id: string) => void;
}) {
  const { user, can } = useAuth();
  const create = useCreateDeal();
  const [key, setKey] = useState(0);

  const close = () => {
    create.reset();
    setKey((k) => k + 1);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="New deal"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="new-deal" loading={create.isPending}>
            Create deal
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <DealForm
          key={key}
          id="new-deal"
          stages={stages.filter((s) => s.kind === 'open')}
          users={users}
          canAssign={can('deal:assign')}
          initial={{
            title: '',
            value: '5000',
            priority: 'medium',
            stageId: stages[0]?.id ?? '',
            contactId: '',
            ownerId: user?.id ?? '',
            expectedCloseDate: '',
          }}
          onSubmit={(v) =>
            create.mutate(
              {
                title: v.title,
                value: Math.round(Number(v.value) || 0),
                priority: v.priority,
                stageId: v.stageId,
                contactId: v.contactId || null,
                ownerId: v.ownerId || undefined,
                expectedCloseDate: v.expectedCloseDate || null,
              },
              {
                onSuccess: (deal) => {
                  close();
                  onCreated(deal.id);
                },
              },
            )
          }
        />
        {create.error && <ErrorNote>{errorMessage(create.error)}</ErrorNote>}
      </div>
    </Modal>
  );
}
