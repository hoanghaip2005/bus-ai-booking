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

  useEffect(() => setIsReady(true), []);

  return (
    <form
      className="search-board"
      id="search"
      data-ready={isReady}
      onSubmit={(event) => {
        event.preventDefault();
        if (!origin || !destination || !departureDate) return;
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
          value={departureDate}
          onChange={(event) => setDepartureDate(event.target.value)}
        />
      </div>
      <button
        className="search-button"
        type="submit"
        disabled={!origin || !destination || !departureDate}
      >
        Tìm chuyến
        <span aria-hidden="true">→</span>
      </button>
      <p className="form-note">Tìm bằng tên tỉnh, thành phố, bến xe hoặc tên gọi quen thuộc.</p>
    </form>
  );
}
