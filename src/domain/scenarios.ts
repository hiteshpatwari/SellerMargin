import {
  calculateTransaction,
  solvePriceForMargin,
  solvePriceForMarginRatio,
} from './engine';
import { DEFAULT_FEE_SCHEDULE } from './fees/config';
import type { CalculationResult, FeeSchedule, Money, TransactionInput } from './types';

export interface DiscountComparison {
  regular: CalculationResult;
  discounted: CalculationResult;
  profitReduction: Money;
  requiredSalesIncreasePercent: number | null;
}

export function compareDiscount(
  input: TransactionInput,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): DiscountComparison {
  const regular = calculateTransaction({ ...input, discountBps: 0 }, schedule);
  const discounted = calculateTransaction(input, schedule);
  const requiredSalesIncreasePercent =
    regular.profit > 0 && discounted.profit > 0
      ? Math.max(0, (regular.profit / discounted.profit - 1) * 100)
      : null;

  return {
    regular,
    discounted,
    profitReduction: regular.profit - discounted.profit,
    requiredSalesIncreasePercent,
  };
}

export interface FreeShippingComparison {
  current: CalculationResult;
  freeSamePrice: CalculationResult;
  preserveMarginPrice: Money | null;
  preserveMarginResult: CalculationResult | null;
  preservedMarginBps: number | null;
}

export function compareFreeShipping(
  input: TransactionInput,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
  targetMarginBps?: number,
): FreeShippingComparison {
  const current = calculateTransaction(input, schedule);
  const freeSamePriceInput = { ...input, customerShippingCharge: 0 };
  const freeSamePrice = calculateTransaction(freeSamePriceInput, schedule);
  const preservedMarginBps = targetMarginBps ?? current.marginBps;
  const preserveMarginPrice = current.status === 'blocked' || preservedMarginBps === null
    ? null
    : targetMarginBps === undefined
      ? solvePriceForMarginRatio(
          freeSamePriceInput,
          current.profit,
          current.revenue,
          schedule,
          { resetDiscount: false },
        )
      : solvePriceForMargin(freeSamePriceInput, targetMarginBps, schedule, {
          resetDiscount: false,
        });
  const preserveMarginResult =
    preserveMarginPrice === null
      ? null
      : calculateTransaction({ ...freeSamePriceInput, sellingPrice: preserveMarginPrice }, schedule);

  return {
    current,
    freeSamePrice,
    preserveMarginPrice,
    preserveMarginResult,
    preservedMarginBps,
  };
}

export interface SaleSourceComparison {
  organic: CalculationResult;
  attributed: CalculationResult;
  marketplaceFeeIncrease: Money;
  profitReduction: Money;
}

export function compareSaleSource(
  input: TransactionInput,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): SaleSourceComparison | null {
  if (input.marketplace === 'etsy') {
    const organic = calculateTransaction(
      { ...input, settings: { ...input.settings, etsySaleSource: 'organic' } },
      schedule,
    );
    const attributed = calculateTransaction(
      { ...input, settings: { ...input.settings, etsySaleSource: 'offsite' } },
      schedule,
    );
    return {
      organic,
      attributed,
      marketplaceFeeIncrease: attributed.marketplaceFees - organic.marketplaceFees,
      profitReduction: organic.profit - attributed.profit,
    };
  }

  if (input.marketplace === 'ebay') {
    const organic = calculateTransaction(
      { ...input, settings: { ...input.settings, ebaySaleSource: 'organic' } },
      schedule,
    );
    const attributed = calculateTransaction(
      { ...input, settings: { ...input.settings, ebaySaleSource: 'promoted' } },
      schedule,
    );
    return {
      organic,
      attributed,
      marketplaceFeeIncrease: attributed.marketplaceFees - organic.marketplaceFees,
      profitReduction: organic.profit - attributed.profit,
    };
  }

  return null;
}

export interface AdvertisingCostComparison {
  beforeAdvertising: CalculationResult;
  afterAdvertising: CalculationResult;
  profitReduction: Money;
}

export function compareAdvertisingCost(
  input: TransactionInput,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): AdvertisingCostComparison {
  const beforeAdvertising = calculateTransaction({ ...input, advertisingCost: 0 }, schedule);
  const afterAdvertising = calculateTransaction(input, schedule);
  return {
    beforeAdvertising,
    afterAdvertising,
    profitReduction: beforeAdvertising.profit - afterAdvertising.profit,
  };
}

export interface SalesGoal {
  monthlyUnits: number | null;
  weeklyUnits: number | null;
  dailyUnits: number | null;
}

export function calculateSalesGoal(profitPerSale: Money, monthlyTarget: Money): SalesGoal {
  if (profitPerSale <= 0 || monthlyTarget <= 0) {
    return { monthlyUnits: null, weeklyUnits: null, dailyUnits: null };
  }
  const monthlyUnits = Math.ceil(monthlyTarget / profitPerSale);
  return {
    monthlyUnits,
    weeklyUnits: Math.ceil(monthlyUnits / 4.345),
    dailyUnits: Math.ceil(monthlyUnits / 30.437),
  };
}
