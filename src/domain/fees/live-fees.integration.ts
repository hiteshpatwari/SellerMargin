import { describe, expect, it } from 'vitest';
import { fetchCurrentFeeSchedule } from '../../../worker/fee-sources';

describe('live official marketplace fee sources', () => {
  it('fetches and parses Etsy, eBay standard, and eBay Store rates', async () => {
    const schedule = await fetchCurrentFeeSchedule(fetch);

    expect(schedule.sourceStatus).toEqual({
      etsy: 'live',
      ebay: 'live',
      ebayStore: 'live',
    });
    expect(schedule.etsy).toEqual({
      listingFee: 20,
      transactionRateBps: 650,
      paymentProcessingRateBps: 300,
      paymentProcessingFixedFee: 25,
      offsiteAdsStandardRateBps: 1500,
      offsiteAdsReducedRateBps: 1200,
      offsiteAdsCap: 10_000,
    });
    expect(schedule.ebay).toMatchObject({
      insertionFee: 35,
      orderFeeThreshold: 1_000,
      orderFeeAtOrBelow: 30,
      orderFeeAbove: 40,
      performanceSurcharges: {
        meeting: 0,
        'below-standard': 600,
        'below-standard-long-term': 700,
        'very-high-inad': 500,
        'very-high-inad-long-term': 600,
      },
    });
    expect(schedule.ebay.categories).toMatchObject({
      most: { firstRateBps: 1360, breakpoint: 750_000, secondRateBps: 235 },
      'books-media': { firstRateBps: 1530, breakpoint: 750_000, secondRateBps: 235 },
      collectibles: { firstRateBps: 1325, breakpoint: 750_000, secondRateBps: 235 },
      jewelry: { firstRateBps: 1500, breakpoint: 500_000, secondRateBps: 900 },
      guitars: { firstRateBps: 670, breakpoint: 750_000, secondRateBps: 235 },
    });
    expect(schedule.ebay.storeCategories).toMatchObject({
      most: { firstRateBps: 1270, breakpoint: 250_000, secondRateBps: 235 },
      'books-media': { firstRateBps: 1530, breakpoint: 250_000, secondRateBps: 235 },
      collectibles: { firstRateBps: 1235, breakpoint: 250_000, secondRateBps: 235 },
      jewelry: { firstRateBps: 1300, breakpoint: 500_000, secondRateBps: 700 },
      guitars: { firstRateBps: 670, breakpoint: 250_000, secondRateBps: 235 },
    });
    expect(Object.fromEntries(
      Object.entries(schedule.ebay.sellerPlans).map(([id, plan]) => [id, plan.insertionFee]),
    )).toEqual({
      'no-store': 35,
      starter: 30,
      basic: 25,
      premium: 10,
      anchor: 5,
      enterprise: 5,
    });
  });
});
