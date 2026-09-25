'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, BarChart3, Kanban, ShieldCheck } from 'lucide-react';
import { DEMO_ACCOUNTS } from '@flowdesk/shared';
import { config } from '@/config';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { Button } from './ui/button';
import { Field, Input } from './ui/field';
import { ErrorNote } from './ui/misc';
import { DemoFooter } from './layout/demo-footer';
import { Logo } from './layout/logo';

type DemoRole = keyof typeof DEMO_ACCOUNTS;

export function LoginForm() {
  const { user, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState<string>(DEMO_ACCOUNTS.admin.email);
  const [password, setPassword] = useState<string>(DEMO_ACCOUNTS.admin.password);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (user) router.replace('/dashboard');
  }, [user, router]);

  const pickAccount = (role: DemoRole) => {
    setEmail(DEMO_ACCOUNTS[role].email);
    setPassword(DEMO_ACCOUNTS[role].password);
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(email, password);
      router.replace('/dashboard');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="grid flex-1 lg:grid-cols-2">
        <section className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-12 text-white lg:flex lg:flex-col">
          <div className="[&_rect]:fill-white [&_path]:stroke-indigo-700">
            <Logo />
          </div>
          <div className="my-auto max-w-md space-y-6">
            <h1 className="text-4xl leading-tight font-semibold tracking-tight">
              Keep every deal moving, from first call to signed contract.
            </h1>
            <ul className="space-y-3 text-indigo-100">
              <li className="flex items-center gap-3">
                <Kanban className="size-5" /> Drag-and-drop pipeline with a full activity trail
              </li>
              <li className="flex items-center gap-3">
                <BarChart3 className="size-5" /> Revenue, funnel and team analytics
              </li>
              <li className="flex items-center gap-3">
                <ShieldCheck className="size-5" /> Role-based access for admins and managers
              </li>
            </ul>
          </div>
          <p className="text-xs text-indigo-200">Portfolio demo · fictional brand and data</p>
          <div className="pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full bg-white/10 blur-3xl" />
        </section>

        <section className="flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-sm space-y-8">
            <div className="lg:hidden">
              <Logo />
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
              <p className="mt-1 text-sm text-muted">
                {config.apiMode === 'demo'
                  ? 'Demo credentials are prefilled. Pick a role to explore permissions.'
                  : 'Use one of the seeded demo accounts.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Demo accounts">
              {(Object.keys(DEMO_ACCOUNTS) as DemoRole[]).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => pickAccount(role)}
                  aria-pressed={email === DEMO_ACCOUNTS[role].email}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm transition hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent-soft"
                >
                  <span className="block font-medium capitalize">{role}</span>
                  <span className="block text-xs text-muted">
                    {role === 'admin' ? 'Full access' : 'Own deals only'}
                  </span>
                </button>
              ))}
            </div>

            <form className="space-y-4" onSubmit={submit} noValidate>
              <Field label="E-mail" htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Field>
              <Field label="Password" htmlFor="password">
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              {error && <ErrorNote>{error}</ErrorNote>}
              <Button type="submit" className="w-full" loading={pending}>
                Sign in <ArrowRight className="size-4" />
              </Button>
            </form>
          </div>
        </section>
      </div>
      <DemoFooter />
    </div>
  );
}
