import { SiteHeader } from '../../components/site-header';

export default function TripDetailLoading() {
  return (
    <main className="trip-detail-page" aria-busy="true">
      <SiteHeader />
      <section className="results-state" role="status">
        <strong>Đang mở chi tiết chuyến...</strong>
        <span>Đang tải lịch trình, sơ đồ ghế và chính sách.</span>
      </section>
    </main>
  );
}
