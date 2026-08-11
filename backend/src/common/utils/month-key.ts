/**
 * Business month key (YYYY-MM) in Asia/Shanghai.
 * Avoid UTC `toISOString().slice(0, 7)` which shifts late-night China times into the previous month.
 */
export function monthKeyShanghai(date: Date | string | null | undefined = new Date()): string {
  const d = date instanceof Date ? date : date ? new Date(date) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  return safe.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 7);
}
