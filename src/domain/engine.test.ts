import { describe, expect, it } from 'vitest';
import {
  calculateBreakEvenDiscountBps,
  calculateMaxDiscountForMarginBps,
  calculateTransaction,
  DEFAULT_INPUT,
  solvePriceForMargin,
  solvePriceForProfit,
} from './engine';
import { clampBasisPoints, dollarsToCents, percentageOf } from './money';
import { DEFAULT_FEE_SCHEDULE } from './fees/config';
import regressionData from './fixtures/marketplace-regressions.v1.json';
import {
  calculateSalesGoal,
  compareAdvertisingCost,
  compareDiscount,
  compareFreeShipping,
  compareSaleSource,
} from './scenarios';
import type { TransactionInput } from './types';

const regressionFixtures = regressionData as unknown as {
  version: string;
  fixtures: Array<{
    id: string;
    input: TransactionInput;
    expectedFees: Array<[string, number]>;
    expectedMarketplaceFees: number;
    expectedProfit: number;
  }>;
};

function input(overrides: Partial<TransactionInput> = {}): TransactionInput {
  const marketplace = overrides.marketplace ?? 'etsy';
  const resolvedSettings = {
    ...DEFAULT_INPUT.settings,
    ...(marketplace === 'ebay'
      ? {
          ebaySellerPlan: 'no-store' as const,
          ebayCategory: 'most' as const,
          ebaySellerStatus: 'meeting' as const,
          ebaySaleSource: 'organic' as const,
        }
      : {}),
    ...overrides.settings,
  };
  return {
    ...DEFAULT_INPUT,
    productName: 'Test product',
    sellingPrice: 3_500,
    customerShippingCharge: 0,
    marketplaceCollectedTax: 0,
    productCost: 900,
    packagingCost: 150,
    sellerShippingCost: 600,
    advertisingCost: 0,
    otherCosts: 0,
    discountBps: 0,
    ...overrides,
    marketplace,
    settings: resolvedSettings,
  };
}

describe('money helpers', () => {
  it('converts decimal currency to integer cents', () => {
    expect(dollarsToCents('35.019')).toBe(3_502);
    expect(dollarsToCents('not a number')).toBe(0);
  });

  it('rounds percentage fees to the nearest cent', () => {
    expect(percentageOf(3_500, 650)).toBe(228);
    expect(percentageOf(1, 650)).toBe(0);
  });

  it('clamps UI percentage input to deterministic basis-point boundaries', () => {
    expect(clampBasisPoints(12_500)).toBe(10_000);
    expect(clampBasisPoints(-50)).toBe(0);
    expect(clampBasisPoints(Number.NaN)).toBe(0);
  });
});

describe('core calculation engine', () => {
  it('calculates direct-sale contribution profit without assumed fees', () => {
    const result = calculateTransaction(input({ marketplace: 'direct' }));
    expect(result.revenue).toBe(3_500);
    expect(result.marketplaceFees).toBe(0);
    expect(result.totalCosts).toBe(1_650);
    expect(result.profit).toBe(1_850);
    expect(result.marginBps).toBe(5_286);
  });

  it('returns no margin when the selling price is zero', () => {
    const result = calculateTransaction(input({ marketplace: 'direct', sellingPrice: 0 }));
    expect(result.marginBps).toBeNull();
  });

  it('reports negative contribution profit when costs exceed revenue', () => {
    const result = calculateTransaction(
      input({ marketplace: 'direct', sellingPrice: 1_000, productCost: 1_200 }),
    );
    expect(result.profit).toBe(-950);
    expect(result.marginBps).toBe(-9_500);
  });

  it('blocks invalid numeric inputs instead of producing a financial estimate', () => {
    const result = calculateTransaction(input({ marketplace: 'direct', discountBps: 10_001 }));
    expect(result.status).toBe('blocked');
    expect(result.issues.some((issue) => issue.code === 'invalid-discount')).toBe(true);
  });

  it('reports the full cost loss for a 100% discounted sale', () => {
    const result = calculateTransaction(input({
      marketplace: 'direct',
      sellingPrice: 2_000,
      productCost: 2_500,
      packagingCost: 200,
      sellerShippingCost: 300,
      discountBps: 10_000,
    }));
    expect(result.revenue).toBe(0);
    expect(result.profit).toBe(-3_000);
    expect(result.marginBps).toBeNull();
  });
});

describe(`versioned marketplace regression fixtures: ${regressionFixtures.version}`, () => {
  it.each(regressionFixtures.fixtures)('$id', (fixture) => {
    const result = calculateTransaction(fixture.input);
    expect(result.status).toBe('ready');
    expect(result.fees.map((fee) => [fee.id, fee.amount])).toEqual(fixture.expectedFees);
    expect(result.marketplaceFees).toBe(fixture.expectedMarketplaceFees);
    expect(result.profit).toBe(fixture.expectedProfit);
  });
});

describe('Etsy U.S. adapter snapshot', () => {
  it('calculates listing, transaction, and payment fees', () => {
    const result = calculateTransaction(input());
    expect(result.fees.map((fee) => [fee.id, fee.amount])).toEqual([
      ['etsy-listing', 20],
      ['etsy-transaction', 228],
      ['etsy-payments', 130],
    ]);
    expect(result.marketplaceFees).toBe(378);
    expect(result.profit).toBe(1_472);
    expect(result.fees.map((fee) => fee.calculation)).toEqual([
      '1 listing × $0.20',
      '6.5% × $35.00',
      '3% × $35.00 + $0.25',
    ]);
  });

  it('charges transaction and payment fees on customer-paid shipping', () => {
    const result = calculateTransaction(input({ customerShippingCharge: 500 }));
    expect(result.revenue).toBe(4_000);
    expect(result.fees.map((fee) => fee.amount)).toEqual([20, 260, 145]);
  });

  it('includes marketplace-collected tax only in the payment-processing base', () => {
    const result = calculateTransaction(input({ marketplaceCollectedTax: 300 }));
    expect(result.fees.find((fee) => fee.id === 'etsy-transaction')?.amount).toBe(228);
    expect(result.fees.find((fee) => fee.id === 'etsy-payments')?.amount).toBe(139);
    expect(result.revenue).toBe(3_500);
  });

  it('caps Etsy Offsite Ads at $100 per attributed order', () => {
    const result = calculateTransaction(
      input({
        sellingPrice: 200_000,
        settings: {
          ...DEFAULT_INPUT.settings,
          etsySaleSource: 'offsite',
          etsyOffsiteAdsTier: 'standard',
        },
      }),
    );
    expect(result.fees.find((fee) => fee.id === 'etsy-offsite-ads')?.amount).toBe(10_000);
  });

  it('itemizes the $11.83 Etsy total for the default sale with 12% Offsite Ads', () => {
    const result = calculateTransaction({
      ...DEFAULT_INPUT,
      settings: {
        ...DEFAULT_INPUT.settings,
        etsySaleSource: 'offsite',
        etsyOffsiteAdsTier: 'reduced',
      },
    });
    expect(result.revenue).toBe(5_295);
    expect(result.fees.map((fee) => [fee.id, fee.amount])).toEqual([
      ['etsy-listing', 20],
      ['etsy-transaction', 344],
      ['etsy-payments', 184],
      ['etsy-offsite-ads', 635],
    ]);
    expect(result.marketplaceFees).toBe(1_183);
  });

  it('supports Etsy sales without assigning a listing fee to this transaction', () => {
    const result = calculateTransaction(
      input({ settings: { ...DEFAULT_INPUT.settings, etsyIncludeListingFee: false } }),
    );
    expect(result.fees.some((fee) => fee.id === 'etsy-listing')).toBe(false);
  });
});

describe('eBay U.S. adapter snapshot', () => {
  for (const [planId, plan] of Object.entries(DEFAULT_FEE_SCHEDULE.ebay.sellerPlans)) {
    const categories = plan.categorySchedule === 'store'
      ? DEFAULT_FEE_SCHEDULE.ebay.storeCategories
      : DEFAULT_FEE_SCHEDULE.ebay.categories;
    for (const [categoryId, rule] of Object.entries(categories)) {
      for (const feeBase of [rule.breakpoint, rule.breakpoint + 10_000]) {
        it(`${plan.label} / ${rule.label} resolves the verified fee path at ${feeBase === rule.breakpoint ? 'the threshold' : 'above the threshold'}`, () => {
          const result = calculateTransaction(input({
            marketplace: 'ebay',
            sellingPrice: feeBase,
            productCost: 0,
            packagingCost: 0,
            sellerShippingCost: 0,
            settings: {
              ...DEFAULT_INPUT.settings,
              ebaySellerPlan: planId as TransactionInput['settings']['ebaySellerPlan'],
              ebayCategory: categoryId as TransactionInput['settings']['ebayCategory'],
              ebaySellerStatus: 'meeting',
              ebaySaleSource: 'organic',
              ebayIncludeInsertionFee: false,
            },
          }));
          const expected = rule.mode === 'switch'
            ? percentageOf(feeBase, feeBase <= rule.breakpoint ? rule.firstRateBps : rule.secondRateBps)
            : percentageOf(Math.min(feeBase, rule.breakpoint), rule.firstRateBps)
              + percentageOf(Math.max(0, feeBase - rule.breakpoint), rule.secondRateBps);
          expect(result.status).toBe('ready');
          expect(result.fees.find((fee) => fee.id === 'ebay-final-value')?.amount).toBe(expected);
          expect(result.feeConfiguration.version).toBe(
            plan.id !== 'no-store'
              ? DEFAULT_FEE_SCHEDULE.profiles.ebayStore.version
              : DEFAULT_FEE_SCHEDULE.profiles.ebayStandard.version,
          );
        });
      }
    }
  }

  it('uses item, shipping, and marketplace tax as the final-value fee base', () => {
    const result = calculateTransaction(
      input({
        marketplace: 'ebay',
        customerShippingCharge: 500,
        marketplaceCollectedTax: 300,
      }),
    );
    expect(result.revenue).toBe(4_000);
    expect(result.fees.map((fee) => fee.amount)).toEqual([585, 40]);
    expect(result.marketplaceFees).toBe(625);
  });

  it('uses the $0.30 per-order fee at the $10 boundary', () => {
    const result = calculateTransaction(
      input({ marketplace: 'ebay', sellingPrice: 1_000, productCost: 0, packagingCost: 0, sellerShippingCost: 0 }),
    );
    expect(result.fees.find((fee) => fee.id === 'ebay-per-order')?.amount).toBe(30);
  });

  it('uses the $0.40 per-order fee above the $10 boundary', () => {
    const result = calculateTransaction(
      input({ marketplace: 'ebay', sellingPrice: 1_001, productCost: 0, packagingCost: 0, sellerShippingCost: 0 }),
    );
    expect(result.fees.find((fee) => fee.id === 'ebay-per-order')?.amount).toBe(40);
  });

  it('applies the lower second tier above $7,500 for most categories', () => {
    const result = calculateTransaction(
      input({ marketplace: 'ebay', sellingPrice: 800_000, productCost: 0, packagingCost: 0, sellerShippingCost: 0 }),
    );
    expect(result.fees.find((fee) => fee.id === 'ebay-final-value')?.amount).toBe(103_175);
  });

  it('adds optional insertion and promoted-listing fees', () => {
    const result = calculateTransaction(
      input({
        marketplace: 'ebay',
        settings: {
          ...DEFAULT_INPUT.settings,
          ebaySellerPlan: 'no-store',
          ebayCategory: 'most',
          ebaySellerStatus: 'meeting',
          ebaySaleSource: 'promoted',
          ebayIncludeInsertionFee: true,
          ebayPromotedListingRateBps: 500,
        },
      }),
    );
    expect(result.fees.find((fee) => fee.id === 'ebay-insertion')?.amount).toBe(35);
    expect(result.fees.find((fee) => fee.id === 'ebay-promoted')?.amount).toBe(175);
  });

  it('uses the selected Basic Store final-value and fixed-price insertion rates', () => {
    const result = calculateTransaction(
      input({
        marketplace: 'ebay',
        settings: {
          ...DEFAULT_INPUT.settings,
          ebaySellerPlan: 'basic',
          ebayCategory: 'most',
          ebaySellerStatus: 'meeting',
          ebayIncludeInsertionFee: true,
        },
      }),
    );
    expect(result.fees.map((fee) => [fee.id, fee.amount])).toEqual([
      ['ebay-insertion', 25],
      ['ebay-final-value', 445],
      ['ebay-per-order', 40],
    ]);
    expect(result.feeConfiguration.version).toBe('ebay-us-store-2026-07-v1');
  });

  it('does not add an insertion fee for Guitars & Basses', () => {
    const result = calculateTransaction(
      input({
        marketplace: 'ebay',
        settings: {
          ...DEFAULT_INPUT.settings,
          ebaySellerPlan: 'no-store',
          ebayCategory: 'guitars',
          ebaySellerStatus: 'meeting',
          ebayIncludeInsertionFee: true,
        },
      }),
    );
    expect(result.fees.some((fee) => fee.id === 'ebay-insertion')).toBe(false);
  });

  it('corrects the former $4.30 guitar total by applying the insertion-fee exemption', () => {
    const result = calculateTransaction({
      ...DEFAULT_INPUT,
      marketplace: 'ebay',
      settings: {
        ...DEFAULT_INPUT.settings,
        ebaySellerPlan: 'no-store',
        ebayCategory: 'guitars',
        ebaySellerStatus: 'meeting',
        ebayIncludeInsertionFee: true,
      },
    });
    expect(result.fees.map((fee) => [fee.id, fee.amount])).toEqual([
      ['ebay-final-value', 355],
      ['ebay-per-order', 40],
    ]);
    expect(result.marketplaceFees).toBe(395);
  });

  it('shows rate, fee base, and fixed charge for every eBay fee row', () => {
    const result = calculateTransaction(
      input({ marketplace: 'ebay', sellingPrice: 2_868 }),
    );
    expect(result.marketplaceFees).toBe(430);
    expect(result.fees.map((fee) => [fee.calculation, fee.amount])).toEqual([
      ['13.6% × $28.68', 390],
      ['1 order × $0.40', 40],
    ]);
    expect(result.fees.reduce((sum, fee) => sum + fee.amount, 0)).toBe(
      result.marketplaceFees,
    );
  });

  it.each([
    ['below-standard', 600, 210],
    ['below-standard-long-term', 700, 245],
    ['very-high-inad', 500, 175],
    ['very-high-inad-long-term', 600, 210],
  ] as const)('applies the selected %s seller-performance surcharge', (status, rate, amount) => {
    const result = calculateTransaction(input({
      marketplace: 'ebay',
      settings: {
        ...DEFAULT_INPUT.settings,
        ebaySellerPlan: 'no-store',
        ebayCategory: 'most',
        ebaySellerStatus: status,
        ebaySaleSource: 'organic',
      },
    }));
    const surcharge = result.fees.find((fee) => fee.id === 'ebay-performance-surcharge');
    expect(surcharge?.label).toContain(`${rate / 100}%`);
    expect(surcharge?.amount).toBe(amount);
  });

  it('blocks eBay arithmetic instead of guessing a plan, category, or status', () => {
    const result = calculateTransaction({ ...DEFAULT_INPUT, marketplace: 'ebay' });
    expect(result.status).toBe('blocked');
    expect(result.marketplaceFees).toBe(0);
    expect(result.issues.filter((issue) => issue.severity === 'blocking').map((issue) => issue.code)).toEqual([
      'ebay-plan-required',
      'ebay-category-required',
      'ebay-status-required',
    ]);
    expect(solvePriceForMargin({ ...DEFAULT_INPUT, marketplace: 'ebay' }, 4_000)).toBeNull();
  });

  it('blocks unsupported eBay categories and non-U.S. marketplace profiles', () => {
    const unsupportedCategory = calculateTransaction(input({
      marketplace: 'ebay',
      settings: {
        ...DEFAULT_INPUT.settings,
        ebaySellerPlan: 'no-store',
        ebayCategory: 'unsupported',
        ebaySellerStatus: 'meeting',
        ebaySaleSource: 'organic',
      },
    }));
    expect(unsupportedCategory.status).toBe('blocked');
    expect(unsupportedCategory.issues.some((issue) => issue.code === 'ebay-category-unsupported')).toBe(true);

    const unsupportedRegion = calculateTransaction(input({
      settings: { ...DEFAULT_INPUT.settings, sellerRegion: 'OTHER' },
    }));
    expect(unsupportedRegion.status).toBe('blocked');
    expect(unsupportedRegion.issues.some((issue) => issue.code === 'unsupported-region')).toBe(true);
  });
});

describe('custom marketplace adapter', () => {
  it('uses seller-entered percentage, fixed, and listing fees', () => {
    const result = calculateTransaction(
      input({
        marketplace: 'custom',
        sellingPrice: 10_000,
        settings: {
          ...DEFAULT_INPUT.settings,
          customPercentageRateBps: 500,
          customFixedFee: 30,
          customListingFee: 50,
        },
      }),
    );
    expect(result.fees.map((fee) => fee.amount)).toEqual([500, 30, 50]);
  });
});

describe('reverse pricing', () => {
  it('finds the minimum cent price that reaches a target margin', () => {
    const base = input({ marketplace: 'etsy' });
    const price = solvePriceForMargin(base, 4_000);
    expect(price).not.toBeNull();
    const result = calculateTransaction({ ...base, sellingPrice: price! });
    const previous = calculateTransaction({ ...base, sellingPrice: price! - 1 });
    expect(result.marginBps).toBeGreaterThanOrEqual(4_000);
    expect(previous.marginBps).toBeLessThan(4_000);
  });

  it('finds the minimum cent price that reaches a dollar-profit target', () => {
    const base = input({ marketplace: 'direct' });
    const price = solvePriceForProfit(base, 2_000);
    expect(price).toBe(3_650);
  });

  it('returns null for an impossible 100% margin target', () => {
    expect(solvePriceForMargin(input(), 10_000)).toBeNull();
  });
});

describe('scenario engine', () => {
  it('compares discount economics and required sales lift', () => {
    const comparison = compareDiscount(
      input({
        marketplace: 'direct',
        sellingPrice: 10_000,
        productCost: 5_000,
        packagingCost: 0,
        sellerShippingCost: 0,
        discountBps: 2_000,
      }),
    );
    expect(comparison.regular.profit).toBe(5_000);
    expect(comparison.discounted.profit).toBe(3_000);
    expect(comparison.profitReduction).toBe(2_000);
    expect(comparison.requiredSalesIncreasePercent).toBeCloseTo(66.667, 2);
  });

  it('calculates the greatest break-even discount', () => {
    const breakEven = calculateBreakEvenDiscountBps(
      input({
        marketplace: 'direct',
        sellingPrice: 10_000,
        productCost: 5_000,
        packagingCost: 0,
        sellerShippingCost: 0,
      }),
    );
    expect(breakEven).toBe(5_000);
  });

  it('calculates the greatest discount that preserves a target margin', () => {
    const maximum = calculateMaxDiscountForMarginBps(
      input({
        marketplace: 'direct',
        sellingPrice: 10_000,
        productCost: 5_000,
        packagingCost: 0,
        sellerShippingCost: 0,
      }),
      4_000,
    );
    expect(maximum).toBe(1_666);
  });

  it('solves the free-shipping price that preserves the current margin', () => {
    const comparison = compareFreeShipping(
      input({
        marketplace: 'direct',
        sellingPrice: 10_000,
        customerShippingCharge: 1_000,
        productCost: 3_000,
        packagingCost: 0,
        sellerShippingCost: 0,
      }),
    );
    expect(comparison.current.profit).toBe(8_000);
    expect(comparison.freeSamePrice.profit).toBe(7_000);
    expect(comparison.preserveMarginPrice).toBe(11_000);
    expect(comparison.preserveMarginResult?.profit).toBe(8_000);
    expect(comparison.preserveMarginResult?.marginBps).toBe(comparison.current.marginBps);
  });

  it('compares Etsy organic and Offsite Ads economics from one engine', () => {
    const comparison = compareSaleSource(input({
      settings: { ...DEFAULT_INPUT.settings, etsyOffsiteAdsTier: 'standard' },
    }));
    expect(comparison).not.toBeNull();
    expect(comparison?.organic.status).toBe('ready');
    expect(comparison?.attributed.status).toBe('ready');
    expect(comparison?.marketplaceFeeIncrease).toBe(525);
    expect(comparison?.profitReduction).toBe(525);
  });

  it('requires the Etsy Offsite Ads tier for an attributed comparison', () => {
    const comparison = compareSaleSource(input());
    expect(comparison?.attributed.status).toBe('blocked');
    expect(comparison?.attributed.issues.some((issue) => issue.code === 'etsy-offsite-tier-required')).toBe(true);
  });

  it('compares entered advertising cost before and after the same transaction', () => {
    const comparison = compareAdvertisingCost(input({ marketplace: 'direct', advertisingCost: 425 }));
    expect(comparison.profitReduction).toBe(425);
    expect(comparison.beforeAdvertising.profit - comparison.afterAdvertising.profit).toBe(425);
  });

  it('turns a monthly income target into monthly, weekly, and daily units', () => {
    expect(calculateSalesGoal(2_500, 100_000)).toEqual({
      monthlyUnits: 40,
      weeklyUnits: 10,
      dailyUnits: 2,
    });
    expect(calculateSalesGoal(-100, 100_000).monthlyUnits).toBeNull();
  });
});
