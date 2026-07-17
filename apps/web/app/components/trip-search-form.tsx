'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { LocationAutocomplete, type LocationValue } from './location-autocomplete';

export function TripSearchForm() {
  const router = useRouter();
  const [origin, setOrigin] = useState<LocationValue | null>(null);
  const [destination, setDestination] = useState<LocationValue | null>(null);
  const [departureDate, setDepartureDate] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [today, setToday] = useState('');

  useEffect(() => {
    setIsReady(true);
    setToday(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date()),
    );
  }, []);

  const sameLocation = Boolean(origin && destination && origin.id === destination.id);

  return (
    <form
      className="search-board"
      id="search"
      data-ready={isReady}
      onSubmit={(event) => {
        event.preventDefault();
        if (!origin || !destination || !departureDate || sameLocation) return;
        const parameters = new URLSearchParams({
          originId: origin.id,
          destinationId: destination.id,
          originCode: origin.code,
          destinationCode: destination.code,
          originKind: origin.kind,
          destinationKind: destination.kind,
          date: departureDate,
          origin: origin.name,
          destination: destination.name,
        });
        router.push(`/trips?${parameters.toString()}`);
      }}
    >
      <LocationAutocomplete
        id="origin"
        label="Điểm đi"
        placeholder="TP.HCM"
        value={origin}
        onChange={setOrigin}
      />
      <button
        className="swap"
        type="button"
        aria-label="Đổi điểm đi và điểm đến"
        onClick={() => {
          setOrigin(destination);
          setDestination(origin);
        }}
      >
        ⇄
      </button>
      <LocationAutocomplete
        id="destination"
        label="Điểm đến"
        placeholder="Đà Lạt"
        value={destination}
        onChange={setDestination}
      />
      <div className="field date-field">
        <label htmlFor="departureDate">Ngày đi</label>
        <input
          id="departureDate"
          name="departureDate"
          type="date"
          required
          min={today || undefined}
          value={departureDate}
          onChange={(event) => setDepartureDate(event.target.value)}
        />
      </div>
      <button
        className="search-button"
        type="submit"
        disabled={!origin || !destination || !departureDate || sameLocation}
      >
        Tìm chuyến
        <span aria-hidden="true">→</span>
      </button>
      <p className="form-note" role="status">
        {sameLocation
          ? 'Điểm đi và điểm đến cần khác nhau.'
          : 'Tìm bằng tên tỉnh, thành phố, bến xe hoặc tên gọi quen thuộc.'}
      </p>
    </form>
  );
}
