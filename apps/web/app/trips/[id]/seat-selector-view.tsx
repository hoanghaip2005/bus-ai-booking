import type { SeatMap } from '../../lib/catalog-api';
import type { SeatHold } from './seat-hold-client';

interface SeatSelectorViewProps {
  seatMap: SeatMap;
  selectedSeatIds: string[];
  hold: SeatHold | null;
  bookingCreated: boolean;
  remainingSeconds: number;
  totalPriceVnd: number;
  busy: boolean;
  error?: string;
  onToggleSeat: (seatId: string) => void;
  onAction: () => void;
}

export function SeatSelectorView({
  seatMap,
  selectedSeatIds,
  hold,
  bookingCreated,
  remainingSeconds,
  totalPriceVnd,
  busy,
  error,
  onToggleSeat,
  onAction,
}: SeatSelectorViewProps) {
  const availableCount = seatMap.seats.filter((seat) => seat.status === 'AVAILABLE').length;
  const ownHoldCount = seatMap.seats.filter((seat) => seat.heldByRequester).length;
  const decks = Array.from({ length: seatMap.deckCount }, (_, index) => index + 1);

  return (
    <div className="seat-selector" aria-busy={busy}>
      <div className="seat-legend" aria-label="Chú thích trạng thái ghế">
        <span data-status="AVAILABLE">Còn trống · {availableCount}</span>
        <span data-status="HELD">Đang được giữ</span>
        <span data-status="OWNED">Bạn đang giữ · {ownHoldCount}</span>
        <span data-status="BOOKED">Đã bán</span>
        <span data-status="BLOCKED">Tạm khóa</span>
      </div>
      <div className="seat-preview">
        {decks.map((deck) => (
          <div key={deck} className="seat-deck">
            <h3>{seatMap.deckCount > 1 ? `Tầng ${deck}` : 'Khoang hành khách'}</h3>
            <div className="seat-grid" aria-label={`Danh sách ghế tầng ${deck}`}>
              {seatMap.seats
                .filter((seat) => seat.deck === deck)
                .map((seat) => {
                  const selected = selectedSeatIds.includes(seat.id) && !hold;
                  return (
                    <button
                      key={seat.id}
                      type="button"
                      data-seat
                      data-status={seat.status}
                      data-owned={seat.heldByRequester}
                      data-selected={selected}
                      aria-pressed={selected}
                      aria-label={`Ghế ${seat.label}: ${seatStatusLabel(seat.status, seat.heldByRequester)}${selected ? ', đã chọn' : ''}`}
                      disabled={seat.status !== 'AVAILABLE' || Boolean(hold) || busy}
                      onClick={() => onToggleSeat(seat.id)}
                      style={{ gridColumn: seat.column, gridRow: seat.row }}
                    >
                      {seat.label}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
      <div className="seat-hold-bar" aria-live="polite">
        <div>
          <span>{hold ? 'Ghế đang giữ' : 'Ghế đã chọn'}</span>
          <strong>{selectedSeatIds.length ? selectedSeatIds.join(', ') : 'Chưa chọn ghế'}</strong>
          <small>{formatMoney(totalPriceVnd)}</small>
        </div>
        {hold ? (
          <div className="hold-countdown">
            <span>Thời gian còn lại</span>
            <strong>{formatCountdown(remainingSeconds)}</strong>
          </div>
        ) : null}
        <button
          type="button"
          disabled={busy || bookingCreated || (!hold && selectedSeatIds.length === 0)}
          onClick={onAction}
        >
          {busy
            ? 'Đang xử lý…'
            : bookingCreated
              ? 'Booking đã tạo'
              : hold
                ? 'Bỏ giữ ghế'
                : 'Giữ ghế trong 5 phút'}
        </button>
      </div>
      {error ? (
        <p className="seat-hold-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function seatStatusLabel(status: SeatMap['seats'][number]['status'], owned: boolean): string {
  if (owned) return 'bạn đang giữ';
  if (status === 'AVAILABLE') return 'còn trống';
  if (status === 'HELD') return 'đang được giữ';
  if (status === 'BOOKED') return 'đã bán';
  return 'tạm khóa';
}

function formatCountdown(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

const moneyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});

function formatMoney(value: number): string {
  return moneyFormatter.format(value);
}
