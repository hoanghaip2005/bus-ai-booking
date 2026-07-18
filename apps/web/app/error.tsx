'use client';

import { useEffect } from 'react';

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.info('web_route_error', { name: error.name });
  }, [error]);

  return (
    <main className="system-state-page" role="alert">
      <div className="system-state-mark" aria-hidden="true">
        !
      </div>
      <p className="eyebrow">Kết nối bị gián đoạn</p>
      <h1>Chưa thể mở trang này.</h1>
      <p>Thông tin của bạn vẫn được giữ nguyên. Hãy thử tải lại hoặc quay về trang chủ.</p>
      <div className="system-state-actions">
        <button className="system-primary-action" type="button" onClick={reset}>
          Thử lại
        </button>
        <a href="/">Về trang chủ</a>
      </div>
    </main>
  );
}
