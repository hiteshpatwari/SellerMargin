import type { Money } from './types';

export const ZERO = 0 as Money;

export function dollarsToCents(value: string | number): Money {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed * 100));
}

export function centsToInput(cents: Money): string {
  return (cents / 100).toFixed(2);
}

export function formatMoney(cents: Money, showSign = false): string {
  const sign = showSign && cents > 0 ? '+' : '';
  return `${sign}${new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)}`;
}

export function formatPercent(basisPoints: number | null, digits = 1): string {
  if (basisPoints === null || !Number.isFinite(basisPoints)) return '—';
  return `${(basisPoints / 100).toFixed(digits)}%`;
}

export function percentageOf(amount: Money, basisPoints: number): Money {
  return Math.round((amount * basisPoints) / 10_000);
}

export function clampBasisPoints(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(10_000, Math.max(0, Math.round(value)));
}
