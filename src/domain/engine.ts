import { clampBasisPoints, percentageOf } from './money';
import { getMarketplaceAdapter } from './fees/adapters';
import { DEFAULT_FEE_SCHEDULE } from './fees/config';
import { resolveFeeProfile } from './fees/resolver';
import type { CalculationResult, CostLineItem, FeeSchedule, Money, TransactionInput } from './types';

export const DEFAULT_INPUT: TransactionInput = {
  productName: 'Handmade candle',
  sellingPrice: 4_800,
  marketplace: 'etsy',
  customerShippingCharge: 495,
  marketplaceCollectedTax: 0,
  productCost: 1_250,
  packagingCost: 125,
  sellerShippingCost: 575,
  advertisingCost: 0,
  otherCosts: 0,
  discountBps: 0,
  settings: {
    sellerRegion: 'US',
    etsyIncludeListingFee: true,
    etsySaleSource: 'organic',
    etsyOffsiteAdsTier: 'unselected',
    ebaySellerPlan: 'unselected',
    ebayCategory: 'unselected',
    ebaySellerStatus: 'unselected',
    ebaySaleSource: 'organic',
    ebayPromotedListingRateBps: 0,
    ebayIncludeInsertionFee: false,
    customPercentageRateBps: 500,
    customFixedFee: 30,
    customListingFee: 0,
  },
};

export function calculateTransaction(
  input: TransactionInput,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): CalculationResult {
  const normalizedDiscount = clampBasisPoints(input.discountBps);
  const itemRevenue = percentageOf(input.sellingPrice, 10_000 - normalizedDiscount);
  const revenue = itemRevenue + input.customerShippingCharge;
  const profile = resolveFeeProfile(input, schedule);
  const adapter = getMarketplaceAdapter(input.marketplace);
  const feeResult = profile.issues.some((issue) => issue.severity === 'blocking')
    ? { fees: [], configuration: profile.configuration, issues: profile.issues }
    : adapter.calculate({ input, itemRevenue, revenue, schedule, profile });
  const marketplaceFees = feeResult.fees.reduce((sum, fee) => sum + fee.amount, 0);

  const costs: CostLineItem[] = [
    {
      id: 'product',
      label:
        input.marketplace === 'etsy'
          ? 'Materials & labor'
          : input.marketplace === 'ebay'
            ? 'Inventory / product'
            : 'Product cost',
      amount: input.productCost,
    },
    { id: 'packaging', label: 'Packaging', amount: input.packagingCost },
    { id: 'shipping', label: 'Seller shipping', amount: input.sellerShippingCost },
    { id: 'advertising', label: 'Other advertising', amount: input.advertisingCost },
    { id: 'other', label: 'Other costs', amount: input.otherCosts },
  ];
  const variableCosts = costs.reduce((sum, cost) => sum + cost.amount, 0);
  const totalCosts = marketplaceFees + variableCosts;
  const profit = revenue - totalCosts;
  const marginBps = revenue > 0 ? Math.round((profit / revenue) * 10_000) : null;

  return {
    input,
    itemRevenue,
    revenue,
    grossProfit: revenue - input.productCost,
    marketplaceFees,
    variableCosts,
    totalCosts,
    profit,
    marginBps,
    fees: feeResult.fees,
    costs,
    feeConfiguration: feeResult.configuration,
    status: feeResult.issues.some((issue) => issue.severity === 'blocking') ? 'blocked' : 'ready',
    issues: feeResult.issues,
  };
}

interface SolveOptions {
  maxPrice?: Money;
  resetDiscount?: boolean;
}

function solveMinimumPrice(
  input: TransactionInput,
  isSatisfied: (result: CalculationResult) => boolean,
  schedule: FeeSchedule,
  options: SolveOptions = {},
): Money | null {
  const maxPrice = options.maxPrice ?? 100_000_000;
  const pricingInput: TransactionInput = {
    ...input,
    discountBps: options.resetDiscount === false ? input.discountBps : 0,
  };
  if (calculateTransaction(pricingInput, schedule).status === 'blocked') return null;
  let low = 0;
  let high = Math.max(100, input.sellingPrice);

  while (
    high < maxPrice &&
    !isSatisfied(calculateTransaction({ ...pricingInput, sellingPrice: high }, schedule))
  ) {
    high = Math.min(maxPrice, high * 2);
  }

  if (!isSatisfied(calculateTransaction({ ...pricingInput, sellingPrice: high }, schedule))) return null;

  while (low < high) {
    const midpoint = Math.floor((low + high) / 2);
    if (isSatisfied(calculateTransaction({ ...pricingInput, sellingPrice: midpoint }, schedule))) {
      high = midpoint;
    } else {
      low = midpoint + 1;
    }
  }

  return low;
}

export function solvePriceForMargin(
  input: TransactionInput,
  targetMarginBps: number,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
  options: SolveOptions = {},
): Money | null {
  if (targetMarginBps >= 10_000) return null;
  return solveMinimumPrice(
    input,
    (result) =>
      result.revenue > 0
      && result.profit * 10_000 >= targetMarginBps * result.revenue,
    schedule,
    options,
  );
}

export function solvePriceForProfit(
  input: TransactionInput,
  targetProfit: Money,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): Money | null {
  return solveMinimumPrice(input, (result) => result.profit >= targetProfit, schedule);
}

export function solvePriceForMarginRatio(
  input: TransactionInput,
  targetProfit: Money,
  targetRevenue: Money,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
  options: SolveOptions = {},
): Money | null {
  if (targetRevenue <= 0) return null;
  return solveMinimumPrice(
    input,
    (result) =>
      result.revenue > 0
      && result.profit * targetRevenue >= targetProfit * result.revenue,
    schedule,
    options,
  );
}

export function calculateBreakEvenDiscountBps(
  input: TransactionInput,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): number | null {
  const baseInput = { ...input, discountBps: 0 };
  const baseResult = calculateTransaction(baseInput, schedule);
  if (baseResult.status === 'blocked') return null;
  if (baseResult.profit <= 0) return 0;

  let low = 0;
  let high = 10_000;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    const profit = calculateTransaction({ ...baseInput, discountBps: midpoint }, schedule).profit;
    if (profit >= 0) low = midpoint;
    else high = midpoint - 1;
  }
  return low;
}

export function calculateMaxDiscountForMarginBps(
  input: TransactionInput,
  targetMarginBps: number,
  schedule: FeeSchedule = DEFAULT_FEE_SCHEDULE,
): number | null {
  const baseInput = { ...input, discountBps: 0 };
  const baseResult = calculateTransaction(baseInput, schedule);
  if (baseResult.status === 'blocked') return null;
  if (
    baseResult.revenue <= 0
    || baseResult.profit * 10_000 < targetMarginBps * baseResult.revenue
  ) return 0;

  let low = 0;
  let high = 10_000;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    const result = calculateTransaction({ ...baseInput, discountBps: midpoint }, schedule);
    if (
      result.status === 'ready'
      && result.revenue > 0
      && result.profit * 10_000 >= targetMarginBps * result.revenue
    ) {
      low = midpoint;
    } else {
      high = midpoint - 1;
    }
  }
  return low;
}
