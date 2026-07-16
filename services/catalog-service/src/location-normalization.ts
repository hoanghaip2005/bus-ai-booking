export function normalizeLocationQuery(value: string): string {
  return value
    .replaceAll('Đ', 'D')
    .replaceAll('đ', 'd')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
