import { TripSearchForm } from './components/trip-search-form';
import { AiTripChat } from './components/ai-trip-chat';
import { HomeFeaturedTrips } from './components/home-featured-trips';
import { SiteFooter } from './components/site-footer';
import { SiteHeader } from './components/site-header';

const travelNotes = [
  ['Giữ ghế 5 phút', 'Bạn có đủ thời gian nhập thông tin và hoàn tất thanh toán.'],
  ['Vé gửi ngay', 'Vé điện tử có mã QR được gửi sau khi thanh toán thành công.'],
  ['Hỗ trợ tận tâm', 'Cần đổi lịch hay tra cứu vé? Đội ngũ luôn sẵn sàng hỗ trợ.'],
] as const;

export default function HomePage() {
  return (
    <main className="home-page">
      <SiteHeader />

      <section className="hero" id="top">
        <div className="hero-orbit" aria-hidden="true">
          <span className="hero-orbit-line" />
          <span className="hero-orbit-dot hero-orbit-dot-start" />
          <span className="hero-orbit-dot hero-orbit-dot-end" />
          <span className="hero-orbit-label">BV / 01</span>
        </div>
        <div className="hero-copy">
          <p className="eyebrow">Đi đâu cũng có cách nhẹ nhàng hơn</p>
          <h1>Đặt chuyến đi tiếp theo trong vài phút.</h1>
          <p className="lede">
            Tìm chuyến, chọn đúng chỗ ngồi và nhận vé điện tử — tất cả trong một trải nghiệm rõ
            ràng, không bước thừa.
          </p>
        </div>

        <TripSearchForm />
      </section>

      <AiTripChat />

      <section className="travel-notes" id="travel-notes" aria-labelledby="travel-notes-title">
        <div className="section-heading">
          <p className="eyebrow">Đi cùng sự an tâm</p>
          <h2 id="travel-notes-title">Mọi thứ bạn cần cho một chuyến đi êm.</h2>
          <p>Thông tin rõ ràng từ lúc tìm xe đến lúc bước xuống bến.</p>
        </div>
        <div className="travel-notes-grid">
          {travelNotes.map(([title, description], index) => (
            <article key={title} className="travel-note-card">
              <span className="item-number">0{index + 1}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <HomeFeaturedTrips />

      <section className="support-strip" id="support" aria-label="Hỗ trợ đặt vé">
        <strong>Cần một gợi ý?</strong>
        <span>Hãy hỏi trợ lý Bến Việt hoặc bắt đầu bằng điểm đi và điểm đến của bạn.</span>
        <a href="#search">
          Tìm chuyến ngay <span aria-hidden="true">↗</span>
        </a>
      </section>

      <SiteFooter />
    </main>
  );
}
