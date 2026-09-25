'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/misc';
import { useAuth } from '@/hooks/use-auth';

export default function Home() {
  const { user } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (user !== undefined) router.replace(user ? '/dashboard' : '/login');
  }, [user, router]);
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner />
    </div>
  );
}
