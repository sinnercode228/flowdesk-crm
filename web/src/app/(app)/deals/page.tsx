import type { Metadata } from 'next';
import { DealsView } from '@/components/deals/deals-view';

export const metadata: Metadata = { title: 'Deals' };

export default function DealsPage() {
  return <DealsView />;
}
