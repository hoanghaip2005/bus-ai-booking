'use client';

import { useEffect, useState } from 'react';

import { getStoredAuthSession, type StoredAuthSession } from '../../lib/auth-session';

type CredentialKind = 'BOOKING_CODE' | 'TICKET_CODE' | 'QR_PAYLOAD';

interface StaffTicket {
  ticketId: string;
  ticketCode: string;
  bookingId: string;
  bookingCode: string;
  bookingStatus: string;
  passengerName: string;
  seatId: string;
  tripId: string;
  routeLabel: string;
  departureAt: string;
  checkedInAt?: string;
}

export function CheckInConsole() {
  const [session, setSession] = useState<StoredAuthSession | null>(null);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [kind, setKind] = useState<CredentialKind>('BOOKING_CODE');
  const [credential, setCredential] = useState('');
  const [tickets, setTickets] = useState<StaffTicket[]>([]);
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [message, setMessage] = useState('Đăng nhập bằng tài khoản nhân viên để bắt đầu.');

  useEffect(() => {
    const stored = getStoredAuthSession();
    if (stored?.user.role === 'STAFF' || stored?.user.role === 'ADMIN') {
      setSession(stored);
      setMessage(`Xin chào ${stored.user.displayName}.`);
    }
    setSessionResolved(true);
  }, []);

  async function handleLookup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    setBusyTicketId('lookup');
    setMessage('Đang tra cứu thông tin vé…');
    try {
      const result = await staffGraphql<StaffTicket[]>(
        `query StaffTicketLookup($input: StaffTicketLookupInput!) {
          staffTicketLookup(input: $input) {
            ticketId ticketCode bookingId bookingCode bookingStatus passengerName
            seatId tripId routeLabel departureAt checkedInAt
          }
        }`,
        { input: { kind, credential: credential.trim() } },
        'staffTicketLookup',
        session.accessToken,
      );
      setTickets(result);
      setMessage(
        result.length === 0
          ? 'Không tìm thấy vé phù hợp.'
          : `Tìm thấy ${result.length} vé. Chọn đúng hành khách để check-in.`,
      );
    } catch (error) {
      setTickets([]);
      setMessage(operationMessage(error));
    } finally {
      setBusyTicketId(null);
    }
  }

  async function handleCheckIn(ticket: StaffTicket) {
    if (!session) return;
    setBusyTicketId(ticket.ticketId);
    try {
      const result = await staffGraphql<{ ticket: StaffTicket; transitioned: boolean }>(
        `mutation CheckInTicket($input: CheckInTicketInput!) {
          checkInTicket(input: $input) {
            transitioned
            ticket {
              ticketId ticketCode bookingId bookingCode bookingStatus passengerName
              seatId tripId routeLabel departureAt checkedInAt
            }
          }
        }`,
        {
          input: {
            kind: 'TICKET_CODE',
            credential: ticket.ticketCode,
            tripId: ticket.tripId,
            idempotencyKey: `ticket-check-in-${crypto.randomUUID()}`,
          },
        },
        'checkInTicket',
        session.accessToken,
      );
      setTickets((current) =>
        current.map((item) => (item.ticketId === result.ticket.ticketId ? result.ticket : item)),
      );
      setMessage(
        result.transitioned
          ? `Đã check-in ghế ${result.ticket.seatId} cho ${result.ticket.passengerName}.`
          : 'Vé này đã được check-in trước đó; trạng thái được giữ nguyên.',
      );
    } catch (error) {
      setMessage(operationMessage(error));
    } finally {
      setBusyTicketId(null);
    }
  }

  return (
    <section
      className="operations-shell"
      data-hydrated={sessionResolved && session ? 'true' : 'false'}
      aria-labelledby="check-in-title"
    >
      <div className="operations-heading">
        <div>
          <p className="eyebrow">Check-in hành khách</p>
          <h1 id="check-in-title">Xác nhận lên xe nhanh và chính xác.</h1>
        </div>
        <span>{session ? session.user.displayName : 'Chưa đăng nhập'}</span>
      </div>

      <div className="operations-grid">
        <form className="ticket-lookup" onSubmit={handleLookup}>
          <span className="operations-index">TRA CỨU</span>
          <h2>Tra cứu vé</h2>
          <label>
            Loại mã
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as CredentialKind)}
            >
              <option value="BOOKING_CODE">Mã đặt vé</option>
              <option value="TICKET_CODE">Mã vé</option>
              <option value="QR_PAYLOAD">Mã QR</option>
            </select>
          </label>
          <label>
            Mã cần tra cứu
            <input
              autoComplete="off"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              placeholder={kind === 'BOOKING_CODE' ? 'BV-2030-…' : 'VT-… hoặc nội dung QR'}
            />
          </label>
          <button
            type="submit"
            disabled={!sessionResolved || !session || !credential.trim() || busyTicketId !== null}
          >
            {busyTicketId === 'lookup' ? 'Đang tra cứu…' : 'Tra cứu vé'}
          </button>
          {sessionResolved && !session && <a href="/login">Đăng nhập tài khoản vận hành</a>}
        </form>

        <div className="ticket-results" aria-live="polite">
          <p className="operations-message" role="status">
            {message}
          </p>
          {tickets.map((ticket) => (
            <article className="ticket-check-in-card" key={ticket.ticketId}>
              <div>
                <span>{ticket.ticketCode}</span>
                <h2>{ticket.passengerName}</h2>
                <p>{ticket.routeLabel}</p>
                <small>
                  Mã đặt vé {ticket.bookingCode} · Khởi hành{' '}
                  {new Intl.DateTimeFormat('vi-VN', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                    timeZone: 'Asia/Ho_Chi_Minh',
                  }).format(new Date(ticket.departureAt))}
                </small>
              </div>
              <div className="ticket-seat">
                <small>Ghế</small>
                <strong>{ticket.seatId}</strong>
                <span>
                  {ticket.checkedInAt ? 'ĐÃ LÊN XE' : bookingStatusLabel(ticket.bookingStatus)}
                </span>
              </div>
              <button
                type="button"
                disabled={Boolean(ticket.checkedInAt) || busyTicketId !== null}
                onClick={() => handleCheckIn(ticket)}
              >
                {ticket.checkedInAt
                  ? 'Đã check-in'
                  : busyTicketId === ticket.ticketId
                    ? 'Đang xác nhận…'
                    : 'Xác nhận lên xe'}
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

async function staffGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
  field: string,
  accessToken: string,
): Promise<T> {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as {
    data?: Record<string, T>;
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };
  const error = body.errors?.[0];
  const data = body.data?.[field];
  if (!response.ok || error || data === undefined) {
    const failure = new Error(error?.message ?? 'Không thể hoàn tất thao tác vận hành.');
    failure.name = error?.extensions?.code ?? 'OPERATIONS_ERROR';
    throw failure;
  }
  return data;
}

function operationMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Không thể hoàn tất thao tác vận hành.';
  if (error.name === 'FORBIDDEN') return 'Tài khoản hiện tại không có quyền check-in.';
  if (error.name === 'WRONG_TRIP') return 'Vé không thuộc chuyến xe đang check-in.';
  if (error.name === 'INVALID_STATE_TRANSITION')
    return 'Trạng thái đặt vé hiện tại không cho phép check-in.';
  return error.message;
}

function bookingStatusLabel(status: string): string {
  if (status === 'TICKET_ISSUED') return 'ĐÃ CÓ VÉ';
  if (status === 'CHECKED_IN') return 'ĐÃ LÊN XE';
  if (status === 'PAID') return 'ĐÃ THANH TOÁN';
  if (status === 'CANCELLED') return 'ĐÃ HỦY';
  return status;
}
