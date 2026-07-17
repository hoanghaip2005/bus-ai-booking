import type { Metadata } from 'next';

import { AiTripChat } from '../components/ai-trip-chat';
import { SiteFooter } from '../components/site-footer';
import { SiteHeader } from '../components/site-header';

export const metadata: Metadata = {
  title: 'Trợ lý hành trình',
  description: 'Tìm chuyến, đọc chính sách và tra cứu trạng thái vé cùng trợ lý Bến Việt.',
};

export default function AssistantPage() {
  return (
    <main className="assistant-page">
      <SiteHeader />
      <AiTripChat standalone />
      <SiteFooter />
    </main>
  );
}
