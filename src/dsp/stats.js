export function percentile(values, p) {
  const arr = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const idx = Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))));
  return arr[idx];
}

export const median = (values) => percentile(values, 0.5);

export function mean(values) {
  let s = 0;
  for (const v of values) s += v;
  return values.length ? s / values.length : 0;
}
