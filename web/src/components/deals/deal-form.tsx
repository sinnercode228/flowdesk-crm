'use client';

import { useState, type FormEvent } from 'react';
import { PRIORITIES, type Priority, type Stage, type User } from '@flowdesk/shared';
import { useContactOptions } from '@/hooks/queries';
import { Field, Input, Select } from '../ui/field';

export interface DealFormValues {
  title: string;
  value: string;
  priority: Priority;
  stageId: string;
  contactId: string;
  ownerId: string;
  expectedCloseDate: string;
}

export const toDateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

interface DealFormProps {
  id: string;
  initial: DealFormValues;
  stages: Stage[];
  users: User[];
  /** Hide the stage selector (moves in the drawer go through the move endpoint). */
  showStage?: boolean;
  canAssign: boolean;
  disabled?: boolean;
  onSubmit: (values: DealFormValues) => void;
}

/** Shared by the "New deal" dialog and the deal drawer. Submitted via `<button form={id}>`. */
export function DealForm({
  id,
  initial,
  stages,
  users,
  showStage = true,
  canAssign,
  disabled,
  onSubmit,
}: DealFormProps) {
  const [values, setValues] = useState(initial);
  const { data: contacts } = useContactOptions();
  const set = <K extends keyof DealFormValues>(key: K, value: DealFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  return (
    <form id={id} onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Title" htmlFor={`${id}-title`}>
          <Input
            id={`${id}-title`}
            value={values.title}
            onChange={(e) => set('title', e.target.value)}
            required
            minLength={2}
            maxLength={120}
            disabled={disabled}
          />
        </Field>
      </div>
      <Field label="Value, USD" htmlFor={`${id}-value`}>
        <Input
          id={`${id}-value`}
          type="number"
          inputMode="numeric"
          min={0}
          step={100}
          value={values.value}
          onChange={(e) => set('value', e.target.value)}
          required
          disabled={disabled}
        />
      </Field>
      <Field label="Priority" htmlFor={`${id}-priority`}>
        <Select
          id={`${id}-priority`}
          value={values.priority}
          onChange={(e) => set('priority', e.target.value as Priority)}
          disabled={disabled}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p[0]!.toUpperCase() + p.slice(1)}
            </option>
          ))}
        </Select>
      </Field>
      {showStage && (
        <Field label="Stage" htmlFor={`${id}-stage`}>
          <Select
            id={`${id}-stage`}
            value={values.stageId}
            onChange={(e) => set('stageId', e.target.value)}
            disabled={disabled}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Expected close" htmlFor={`${id}-close`}>
        <Input
          id={`${id}-close`}
          type="date"
          value={values.expectedCloseDate}
          onChange={(e) => set('expectedCloseDate', e.target.value)}
          disabled={disabled}
        />
      </Field>
      <Field label="Contact" htmlFor={`${id}-contact`}>
        <Select
          id={`${id}-contact`}
          value={values.contactId}
          onChange={(e) => set('contactId', e.target.value)}
          disabled={disabled}
        >
          <option value="">No contact</option>
          {contacts?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.firstName} {c.lastName}
              {c.company ? ` · ${c.company}` : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Owner"
        htmlFor={`${id}-owner`}
        hint={canAssign ? undefined : 'Only admins can reassign deals'}
      >
        <Select
          id={`${id}-owner`}
          value={values.ownerId}
          onChange={(e) => set('ownerId', e.target.value)}
          disabled={disabled || !canAssign}
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </Field>
    </form>
  );
}
