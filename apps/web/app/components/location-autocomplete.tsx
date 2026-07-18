'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { readGraphQlResponse } from '../lib/graphql-client';

export interface LocationValue {
  id: string;
  name: string;
  code: string;
  kind: 'CITY' | 'STATION';
}

interface LocationAutocompleteProps {
  id: string;
  label: string;
  placeholder: string;
  value: LocationValue | null;
  onChange: (value: LocationValue | null) => void;
}

interface LocationSuggestionsResponse {
  data?: { locationSuggestions: LocationValue[] };
  errors?: Array<{ message: string }>;
}

export function LocationAutocomplete({
  id,
  label,
  placeholder,
  value,
  onChange,
}: LocationAutocompleteProps) {
  const listboxId = useId();
  const requestSequence = useRef(0);
  const [inputValue, setInputValue] = useState(value?.name ?? '');
  const [suggestions, setSuggestions] = useState<LocationValue[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInputValue(value?.name ?? '');
  }, [value]);

  useEffect(() => {
    const query = inputValue.trim();
    if (value?.name === inputValue || query.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/graphql', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            query:
              'query LocationSuggestions($query: String!, $limit: Int!) { locationSuggestions(query: $query, limit: $limit) { id code name kind } }',
            variables: { query, limit: 8 },
          }),
        });
        const body = await readGraphQlResponse<{ locationSuggestions: LocationValue[] }>(
          response,
          'Không thể tải địa điểm. Kiểm tra GraphQL Gateway đang chạy.',
        );
        if (!response.ok || body.errors?.length) {
          throw new Error(body.errors?.[0]?.message ?? 'Không thể tải địa điểm.');
        }
        if (sequence !== requestSequence.current) return;
        setSuggestions(body.data?.locationSuggestions ?? []);
        setActiveIndex(-1);
        setIsOpen(true);
      } catch (requestError) {
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        setSuggestions([]);
        setError(requestError instanceof Error ? requestError.message : 'Không thể tải địa điểm.');
        setIsOpen(true);
      } finally {
        if (sequence === requestSequence.current) setIsLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [inputValue, value?.name]);

  function selectSuggestion(suggestion: LocationValue) {
    onChange(suggestion);
    setInputValue(suggestion.name);
    setSuggestions([]);
    setActiveIndex(-1);
    setIsOpen(false);
    setError(null);
  }

  const showPanel = isOpen && inputValue.trim().length >= 2;
  const status = isLoading
    ? 'Đang tìm địa điểm...'
    : error
      ? error
      : suggestions.length === 0
        ? 'Không tìm thấy địa điểm phù hợp.'
        : null;

  return (
    <div className="field autocomplete-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showPanel}
        aria-controls={listboxId}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        value={inputValue}
        onChange={(event) => {
          setInputValue(event.target.value);
          onChange(null);
          setIsOpen(true);
        }}
        onFocus={() => inputValue.trim().length >= 2 && setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && suggestions.length) {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((index) => (index + 1) % suggestions.length);
          } else if (event.key === 'ArrowUp' && suggestions.length) {
            event.preventDefault();
            setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
          } else if (event.key === 'Enter' && activeIndex >= 0) {
            event.preventDefault();
            const suggestion = suggestions[activeIndex];
            if (suggestion) selectSuggestion(suggestion);
          } else if (event.key === 'Escape') {
            setIsOpen(false);
            setActiveIndex(-1);
          }
        }}
      />

      {showPanel ? (
        <div className="autocomplete-panel">
          {status ? (
            <p
              className={error ? 'autocomplete-status is-error' : 'autocomplete-status'}
              role="status"
            >
              {status}
            </p>
          ) : (
            <ul id={listboxId} role="listbox" aria-label={`Gợi ý ${label.toLowerCase()}`}>
              {suggestions.map((suggestion, index) => (
                <li key={suggestion.id} role="presentation">
                  <button
                    id={`${listboxId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={index === activeIndex ? 'is-active' : undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectSuggestion(suggestion)}
                  >
                    <span>{suggestion.name}</span>
                    <small>{suggestion.kind === 'CITY' ? 'Tỉnh / thành' : 'Bến xe'}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
