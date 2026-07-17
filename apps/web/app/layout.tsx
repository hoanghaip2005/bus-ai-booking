import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import './production.css';

import { BeVietnamPro } from './lib/fonts';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:8080'),
  title: {
    default: 'Bến Việt | Vé xe liên tỉnh',
    template: '%s | Bến Việt',
  },
  description: 'Nền tảng tìm chuyến, chọn ghế và nhận vé xe khách liên tỉnh.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi" data-scroll-behavior="smooth">
      <body className={BeVietnamPro.variable}>{children}</body>
    </html>
  );
}
