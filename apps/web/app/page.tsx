import { TripSearchForm } from './components/trip-search-form';
import { AiTripChat } from './components/ai-trip-chat';

const foundationItems = [
  ['GraphQL Gateway', 'Public API cho web và subscription'],
  ['gRPC Catalog', 'Contract đồng bộ giữa gateway và service'],
  ['MCP Server', 'Cửa ngõ tool cho AI client bên ngoài'],
  ['Event backbone', 'RabbitMQ workflow · Kafka analytics'],
] as const;

export default function HomePage() {
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Bến Việt - về đầu trang">
          <span className="brand-mark" aria-hidden="true">
            BV
          </span>
          <span>
            <strong>Bến Việt</strong>
            <small>Đi xa, nhẹ đầu.</small>
          </span>
        </a>
        <nav aria-label="Điều hướng chính">
          <a href="#search">Tìm chuyến</a>
          <a href="#foundation">Hệ thống</a>
          <a href="/login">Đăng nhập</a>
          <a className="nav-cta" href="http://localhost:4000/graphql">
            GraphQL
          </a>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="route-line" aria-hidden="true">
          <span />
          <i />
          <span />
        </div>
        <div className="hero-copy">
          <p className="eyebrow">Nền tảng vé xe liên tỉnh thế hệ mới</p>
          <h1>Một hành trình rõ ràng, từ lúc tìm xe đến khi lên chuyến.</h1>
          <p className="lede">
            Tìm chuyến theo cách tự nhiên, giữ ghế an toàn và nhận vé điện tử trong một luồng duy
            nhất.
          </p>
        </div>

        <TripSearchForm />
      </section>

      <AiTripChat />

      <section className="foundation" id="foundation" aria-labelledby="foundation-title">
        <div className="section-heading">
          <p className="eyebrow">Milestone 0.1</p>
          <h2 id="foundation-title">Nền móng đang hoạt động</h2>
          <p>
            Monorepo được tổ chức theo contract-first. Mỗi đường giao tiếp có một vai trò rõ ràng,
            không chia sẻ database ngầm.
          </p>
        </div>
        <ol className="foundation-list">
          {foundationItems.map(([title, description], index) => (
            <li key={title}>
              <span className="item-number">0{index + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
              <span className="status-pill">READY</span>
            </li>
          ))}
        </ol>
      </section>

      <footer>
        <span>Bến Việt · Intercity Bus Booking Platform</span>
        <a href="http://localhost:8080/health">Kiểm tra hệ thống</a>
      </footer>
    </main>
  );
}
