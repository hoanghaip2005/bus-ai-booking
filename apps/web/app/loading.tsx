export default function AppLoading() {
  return (
    <main className="system-state-page" aria-busy="true">
      <div className="system-state-mark" aria-hidden="true">
        BV
      </div>
      <p className="eyebrow">Bến Việt</p>
      <h1>Đang chuẩn bị hành trình...</h1>
      <div className="system-state-progress" aria-hidden="true">
        <span />
      </div>
      <p>Thông tin chuyến xe sẽ xuất hiện trong giây lát.</p>
    </main>
  );
}
