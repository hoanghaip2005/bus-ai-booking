import Link from 'next/link';

export default function TripNotFound() {
  return (
    <main className="trip-detail-page">
      <section className="results-state" role="status">
        <strong>Chuyến xe không còn mở bán</strong>
        <span>Chuyến có thể đã ngừng hoạt động hoặc mã chuyến không tồn tại.</span>
        <Link href="/">Tìm chuyến khác</Link>
      </section>
    </main>
  );
}
