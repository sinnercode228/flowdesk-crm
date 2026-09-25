'use client';

import { useState, type FormEvent } from 'react';
import { CONTACT_STATUSES, type Contact, type ContactStatus } from '@flowdesk/shared';
import { useSaveContact } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { Button } from '../ui/button';
import { Field, Input, Select } from '../ui/field';
import { ErrorNote } from '../ui/misc';
import { Modal } from '../ui/overlay';

const empty = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  company: '',
  title: '',
  status: 'lead' as ContactStatus,
};

function ContactForm({ contact, onDone }: { contact: Contact | null; onDone: () => void }) {
  const save = useSaveContact();
  const [values, setValues] = useState(
    contact
      ? {
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone ?? '',
          company: contact.company ?? '',
          title: contact.title ?? '',
          status: contact.status,
        }
      : empty,
  );
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ id: contact?.id, input: values }, { onSuccess: onDone });
  };

  return (
    <>
      <form id="contact-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="c-first">
          <Input
            id="c-first"
            value={values.firstName}
            onChange={set('firstName')}
            required
            maxLength={60}
          />
        </Field>
        <Field label="Last name" htmlFor="c-last">
          <Input
            id="c-last"
            value={values.lastName}
            onChange={set('lastName')}
            required
            maxLength={60}
          />
        </Field>
        <Field label="E-mail" htmlFor="c-email">
          <Input id="c-email" type="email" value={values.email} onChange={set('email')} required />
        </Field>
        <Field label="Phone" htmlFor="c-phone">
          <Input id="c-phone" value={values.phone} onChange={set('phone')} maxLength={40} />
        </Field>
        <Field label="Company" htmlFor="c-company">
          <Input id="c-company" value={values.company} onChange={set('company')} maxLength={120} />
        </Field>
        <Field label="Job title" htmlFor="c-title">
          <Input id="c-title" value={values.title} onChange={set('title')} maxLength={120} />
        </Field>
        <Field label="Status" htmlFor="c-status">
          <Select id="c-status" value={values.status} onChange={set('status')}>
            {CONTACT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0]!.toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
        </Field>
      </form>
      {save.error && (
        <div className="mt-4">
          <ErrorNote>{errorMessage(save.error)}</ErrorNote>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" form="contact-form" loading={save.isPending}>
          {contact ? 'Save changes' : 'Add contact'}
        </Button>
      </div>
    </>
  );
}

export function ContactDialog({
  open,
  contact,
  onClose,
}: {
  open: boolean;
  contact: Contact | null;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={contact ? 'Edit contact' : 'New contact'} wide>
      {open && <ContactForm key={contact?.id ?? 'new'} contact={contact} onDone={onClose} />}
    </Modal>
  );
}
