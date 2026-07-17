import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Danh mục vận hành',
  description: 'Quản lý tuyến, xe và điểm đón của Bến Việt.',
};

export default function AdminCatalogLayout({ children }: { children: ReactNode }) {
  return children;
}
