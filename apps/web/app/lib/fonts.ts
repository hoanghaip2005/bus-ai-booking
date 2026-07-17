import localFont from 'next/font/local';

export const BeVietnamPro = localFont({
  src: [
    {
      path: '../../../../services/ticket-worker/assets/BeVietnamPro-Regular.ttf',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../../../services/ticket-worker/assets/BeVietnamPro-Bold.ttf',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-be-vietnam-pro',
  display: 'swap',
  fallback: ['Segoe UI', 'Tahoma', 'sans-serif'],
});
