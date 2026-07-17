'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { SeatMap } from '../../lib/catalog-api';
import type { GuestBooking } from './booking-client';
import { getCheckoutSessionId } from './checkout-session';
import { GuestBookingForm } from './guest-booking-form';
import {
  createSeatHold,
  fetchSeatHold,
  fetchSeatMap,
  releaseSeatHold,
  SeatHoldClientError,
  subscribeToSeatStatus,
  type SeatHold,
} from './seat-hold-client';
import { SeatSelectorView } from './seat-selector-view';

interface SeatSelectorProps {
  tripId: string;
  initialSeatMap: SeatMap;
  unitPriceVnd: number;
}

export function SeatSelector({ tripId, initialSeatMap, unitPriceVnd }: SeatSelectorProps) {
  const [seatMap, setSeatMap] = useState(initialSeatMap);
  const [interactive, setInteractive] = useState(false);
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [hold, setHold] = useState<SeatHold | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [booking, setBooking] = useState<GuestBooking | null>(null);
  const holdTokenRef = useRef<string | undefined>(undefined);
  const latestRefreshRef = useRef(0);
  const lastEventVersionRef = useRef<number | undefined>(undefined);
  const holdStorageKey = `bus:seat-hold:v1:${tripId}`;
  const bookingStorageKey = `bus:booking:v1:${tripId}`;
  holdTokenRef.current = hold?.token;

  useEffect(() => setInteractive(true), []);

  const refreshSeatMap = useCallback(
    async (checkoutSessionId: string, holdToken?: string) => {
      const refreshId = ++latestRefreshRef.current;
      const nextSeatMap = await fetchSeatMap(tripId, checkoutSessionId, holdToken);
      if (refreshId === latestRefreshRef.current) setSeatMap(nextSeatMap);
    },
    [tripId],
  );

  useEffect(() => {
    const serialized = sessionStorage.getItem(bookingStorageKey);
    if (!serialized) return;
    try {
      const saved = JSON.parse(serialized) as { booking?: GuestBooking };
      if (saved.booking) setBooking(saved.booking);
    } catch {
      sessionStorage.removeItem(bookingStorageKey);
    }
  }, [bookingStorageKey]);

  useEffect(() => {
    const checkoutSessionId = getCheckoutSessionId();
    const refetchAuthoritativeMap = () => {
      void refreshSeatMap(checkoutSessionId, holdTokenRef.current).catch(
        (refreshError: unknown) => {
          setError(messageForError(refreshError));
        },
      );
    };
    return subscribeToSeatStatus(tripId, {
      onConnected: () => {
        lastEventVersionRef.current = undefined;
        refetchAuthoritativeMap();
      },
      onEvent: (event) => {
        const previousVersion = lastEventVersionRef.current;
        if (previousVersion !== undefined && event.version <= previousVersion) return;
        lastEventVersionRef.current = event.version;
        refetchAuthoritativeMap();
      },
      onError: () => {
        // HTTP reads remain authoritative; graphql-ws retries and refetches after reconnect.
      },
    });
  }, [refreshSeatMap, tripId]);

  useEffect(() => {
    const checkoutSessionId = getCheckoutSessionId();
    const savedToken = sessionStorage.getItem(holdStorageKey);
    if (!savedToken) return;
    setBusy(true);
    void fetchSeatHold(savedToken, checkoutSessionId)
      .then(async (restoredHold) => {
        holdTokenRef.current = restoredHold.token;
        setHold(restoredHold);
        setSelectedSeatIds(restoredHold.seatIds);
        await refreshSeatMap(checkoutSessionId, restoredHold.token);
      })
      .catch(async (restoreError: unknown) => {
        sessionStorage.removeItem(holdStorageKey);
        holdTokenRef.current = undefined;
        if (
          restoreError instanceof SeatHoldClientError &&
          !['HOLD_EXPIRED', 'FORBIDDEN'].includes(restoreError.code ?? '')
        ) {
          setError(restoreError.message);
        }
        await refreshSeatMap(checkoutSessionId);
      })
      .finally(() => setBusy(false));
  }, [holdStorageKey, refreshSeatMap]);

  useEffect(() => {
    if (!hold) {
      setRemainingSeconds(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((Date.parse(hold.expiresAt) - Date.now()) / 1_000));
      setRemainingSeconds(remaining);
      if (remaining === 0) {
        sessionStorage.removeItem(holdStorageKey);
        holdTokenRef.current = undefined;
        setHold(null);
        setSelectedSeatIds([]);
        void refreshSeatMap(getCheckoutSessionId());
      }
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [hold, holdStorageKey, refreshSeatMap]);

  const selectedTotal = selectedSeatIds.length * unitPriceVnd;

  const updateBooking = useCallback(
    (nextBooking: GuestBooking) => {
      const currentHoldToken = holdTokenRef.current ?? '';
      sessionStorage.setItem(
        bookingStorageKey,
        JSON.stringify({ holdToken: currentHoldToken, booking: nextBooking }),
      );
      setBooking(nextBooking);
      if (nextBooking.status === 'PAID') {
        sessionStorage.removeItem(holdStorageKey);
        holdTokenRef.current = undefined;
        setHold(null);
        setSelectedSeatIds([]);
        void refreshSeatMap(getCheckoutSessionId());
      }
    },
    [bookingStorageKey, holdStorageKey, refreshSeatMap],
  );

  const startNewBooking = useCallback(() => {
    sessionStorage.removeItem(bookingStorageKey);
    sessionStorage.removeItem(holdStorageKey);
    holdTokenRef.current = undefined;
    setBooking(null);
    setHold(null);
    setSelectedSeatIds([]);
    setError(undefined);
    void refreshSeatMap(getCheckoutSessionId());
  }, [bookingStorageKey, holdStorageKey, refreshSeatMap]);

  function toggleSeat(seatId: string): void {
    if (hold || busy) return;
    setError(undefined);
    setSelectedSeatIds((current) =>
      current.includes(seatId)
        ? current.filter((selected) => selected !== seatId)
        : [...current, seatId].slice(0, 10),
    );
  }

  async function holdSelectedSeats(): Promise<void> {
    if (selectedSeatIds.length === 0) return;
    const checkoutSessionId = getCheckoutSessionId();
    setBusy(true);
    setError(undefined);
    try {
      const nextHold = await createSeatHold(tripId, selectedSeatIds, checkoutSessionId);
      sessionStorage.setItem(holdStorageKey, nextHold.token);
      holdTokenRef.current = nextHold.token;
      setHold(nextHold);
      setSelectedSeatIds(nextHold.seatIds);
      await refreshSeatMap(checkoutSessionId, nextHold.token);
    } catch (holdError) {
      setError(messageForError(holdError));
      await refreshSeatMap(checkoutSessionId);
    } finally {
      setBusy(false);
    }
  }

  async function releaseCurrentHold(): Promise<void> {
    if (!hold) return;
    const checkoutSessionId = getCheckoutSessionId();
    setBusy(true);
    setError(undefined);
    try {
      await releaseSeatHold(hold.token, checkoutSessionId);
      sessionStorage.removeItem(holdStorageKey);
      holdTokenRef.current = undefined;
      setHold(null);
      setSelectedSeatIds([]);
      await refreshSeatMap(checkoutSessionId);
    } catch (releaseError) {
      setError(messageForError(releaseError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SeatSelectorView
        seatMap={seatMap}
        selectedSeatIds={selectedSeatIds}
        hold={hold}
        bookingCreated={Boolean(booking)}
        remainingSeconds={remainingSeconds}
        totalPriceVnd={hold?.totalPriceVnd ?? selectedTotal}
        busy={busy || !interactive}
        error={error}
        onToggleSeat={toggleSeat}
        onAction={() => void (hold ? releaseCurrentHold() : holdSelectedSeats())}
      />
      {hold || booking ? (
        <GuestBookingForm
          hold={hold}
          booking={booking}
          onBookingUpdated={updateBooking}
          onStartNewBooking={startNewBooking}
        />
      ) : null}
    </>
  );
}

function messageForError(error: unknown): string {
  if (error instanceof SeatHoldClientError && error.code === 'SEAT_UNAVAILABLE') {
    return 'Một ghế vừa được người khác giữ. Sơ đồ đã được cập nhật.';
  }
  return error instanceof Error ? error.message : 'Không thể cập nhật trạng thái ghế.';
}
