'use client';

export const adminPageSize = 8;

export function AdminSearch({
  label,
  value,
  onChange,
  resultCount,
  placeholder = 'Nhập từ khóa…',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  resultCount: number;
  placeholder?: string;
}) {
  return (
    <div className="admin-list-toolbar">
      <label>
        <span>{label}</span>
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      </label>
      <strong>{resultCount.toLocaleString('vi-VN')} kết quả</strong>
    </div>
  );
}

export function AdminPagination({
  page,
  totalItems,
  onChange,
}: {
  page: number;
  totalItems: number;
  onChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(totalItems / adminPageSize));
  if (totalItems <= adminPageSize) return null;
  return (
    <nav className="admin-pagination" aria-label="Phân trang dữ liệu quản trị">
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Trang trước
      </button>
      <span>
        Trang {page} / {pageCount}
      </span>
      <button type="button" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
        Trang sau
      </button>
    </nav>
  );
}

export function pageItems<T>(items: T[], page: number): T[] {
  const start = (page - 1) * adminPageSize;
  return items.slice(start, start + adminPageSize);
}

export function normalizeAdminSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi-VN')
    .trim();
}
