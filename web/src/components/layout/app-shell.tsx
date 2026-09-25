'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { BarChart3, Kanban, LogOut, Menu, Moon, RotateCcw, Sun, Users, X } from 'lucide-react';
import { config } from '@/config';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { getDemoServer } from '@/lib/api';
import { Avatar, Spinner } from '../ui/misc';
import { DemoFooter } from './demo-footer';
import { Logo } from './logo';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: BarChart3 },
  { href: '/deals', label: 'Deals', icon: Kanban },
  { href: '/contacts', label: 'Contacts', icon: Users },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (user === null) router.replace('/login');
  }, [user, router]);
  useEffect(() => setMenuOpen(false), [pathname]);

  if (!user) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }

  const resetDemo = () => {
    if (!window.confirm('Reset all demo data to its initial state? You will be signed out.'))
      return;
    getDemoServer()?.reset();
    queryClient.clear();
    void logout();
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const nav = (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? 'page' : undefined}
          className={clsx(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
            isActive(href)
              ? 'bg-accent-soft text-accent'
              : 'text-muted hover:bg-surface-2 hover:text-ink',
          )}
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );

  const userBox = (
    <div className="flex items-center gap-3 rounded-lg border border-line p-2.5">
      <Avatar name={user.name} color={user.avatarColor} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="text-xs text-muted capitalize">{user.role}</p>
      </div>
      <button
        type="button"
        onClick={() => void logout()}
        className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r border-line bg-surface p-4 lg:flex">
        <Logo />
        {nav}
        <div className="mt-auto">{userBox}</div>
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <aside className="animate-fade-in absolute inset-y-0 left-0 flex w-64 flex-col gap-6 border-r border-line bg-surface p-4">
            <div className="flex items-center justify-between">
              <Logo />
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
                className="p-1.5 text-muted"
              >
                <X className="size-5" />
              </button>
            </div>
            {nav}
            <div className="mt-auto">{userBox}</div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur lg:px-6">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
            className="-ml-1 rounded-lg p-1.5 text-muted hover:bg-surface-2 lg:hidden"
          >
            <Menu className="size-5" />
          </button>
          <span className="lg:hidden">
            <Logo compact />
          </span>
          {config.apiMode === 'demo' && (
            <span className="hidden items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent sm:inline-flex">
              <span className="size-1.5 rounded-full bg-accent" />
              Demo mode · in-browser API
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {config.apiMode === 'demo' && (
              <button
                type="button"
                onClick={resetDemo}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-ink"
                title="Reset demo data"
              >
                <RotateCcw className="size-3.5" />
                <span className="hidden sm:inline">Reset data</span>
              </button>
            )}
            <button
              type="button"
              onClick={toggle}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink"
            >
              {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-6">{children}</main>
        <DemoFooter />
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
