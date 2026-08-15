import type {
  EbayCategoryId,
  EbaySellerPlan,
  FeeConfiguration,
  FeeSourceStatus,
  FeeSchedule,
  MarketplaceId,
  SellerRegion,
} from '../types';
import { ACTIVE_FEE_SCHEDULE_VERSION, getFeeScheduleVersion } from './versions';

export const DEFAULT_FEE_SCHEDULE = getFeeScheduleVersion(ACTIVE_FEE_SCHEDULE_VERSION);

export const FEE_SOURCES = {
  etsy: [
    {
      label: 'Etsy Fee Basics',
      url: 'https://help.etsy.com/hc/en-us/articles/360035902374-Etsy-Fee-Basics',
    },
    {
      label: 'Etsy payment processing fees',
      url: 'https://help.etsy.com/hc/en-gb/articles/115015628847-What-are-Payment-Processing-Fees-for-Selling-on-Etsy',
    },
    {
      label: 'Etsy fees and taxes',
      url: 'https://help.etsy.com/hc/en-us/articles/115014483627-What-are-the-Fees-and-Taxes-for-Selling-on-Etsy',
    },
  ],
  ebay: [
    {
      label: 'eBay selling fees',
      url: 'https://www.ebay.com/help/selling-fees/selling/selling-fees?id=4822',
    },
    {
      label: 'eBay Store selling fees',
      url: 'https://www.ebay.com/help/selling/selling-fees/store-fees?id=4809',
    },
    {
      label: 'eBay promoted listings',
      url: 'https://www.ebay.com/help/selling/promoted-listings/promoted-listings-standard?id=4164',
    },
  ],
} as const;

function combineSourceStatus(...statuses: FeeSourceStatus[]): FeeSourceStatus {
  if (statuses.includes('review')) return 'review';
  return statuses.every((status) => status === 'live') ? 'live' : 'verified';
}

export function getFeeConfiguration(
  marketplace: MarketplaceId,
  schedule: FeeSchedule,
  context: {
    region?: SellerRegion;
    ebaySellerPlan?: EbaySellerPlan;
    conditions?: string[];
  } = {},
): FeeConfiguration {
  const region = context.region ?? 'US';
  const conditions = context.conditions ?? [];

  if (marketplace === 'etsy') {
    const rates = schedule.etsy;
    const profile = schedule.profiles.etsy;
    return {
      marketplace,
      region,
      currency: schedule.currency,
      version: profile.version,
      effectiveDate: profile.effectiveDate,
      lastVerifiedDate: profile.lastVerifiedDate,
      sourceStatus: schedule.sourceStatus.etsy,
      summary:
        `U.S. seller rates: $${(rates.listingFee / 100).toFixed(2)} listing, ` +
        `${rates.transactionRateBps / 100}% transaction, ` +
        `${rates.paymentProcessingRateBps / 100}% + $${(rates.paymentProcessingFixedFee / 100).toFixed(2)} Etsy Payments, plus optional Offsite Ads.`,
      conditions,
      sources: [...FEE_SOURCES.etsy],
    };
  }

  if (marketplace === 'ebay') {
    const planId = context.ebaySellerPlan;
    const plan = planId ? getEbaySellerPlanRule(schedule, planId) : undefined;
    const usesStorePage = Boolean(plan && plan.id !== 'no-store');
    const profile = usesStorePage ? schedule.profiles.ebayStore : schedule.profiles.ebayStandard;
    const sourceStatus = usesStorePage
      ? combineSourceStatus(schedule.sourceStatus.ebay, schedule.sourceStatus.ebayStore)
      : schedule.sourceStatus.ebay;
    return {
      marketplace,
      region,
      currency: schedule.currency,
      version: profile.version,
      effectiveDate: profile.effectiveDate,
      lastVerifiedDate: profile.lastVerifiedDate,
      sourceStatus,
      summary:
        `U.S. ${plan?.label ?? 'seller'}: category-based final value fee plus a per-order fee. ` +
        'Seller-performance surcharges, optional fixed-price insertion fees, and attributed Promoted Listings General fees are modeled separately; the monthly Store subscription is not allocated to this sale.',
      conditions,
      sources: [...FEE_SOURCES.ebay],
    };
  }

  if (marketplace === 'direct') {
    return {
      marketplace,
      region,
      currency: 'USD',
      version: 'direct-sale-v1',
      effectiveDate: '2026-08-14',
      lastVerifiedDate: '2026-08-14',
      summary:
        'No platform or payment fee is assumed. Add card processing or venue fees under Other costs when they apply.',
      conditions,
      sources: [],
    };
  }

  return {
    marketplace,
    region,
    currency: 'USD',
    version: 'custom-marketplace-v1',
    effectiveDate: '2026-08-14',
    lastVerifiedDate: '2026-08-14',
    summary: 'Uses the percentage, fixed transaction fee, and listing fee entered below.',
    conditions,
    sources: [],
  };
}

export function getEbaySellerPlanRule(schedule: FeeSchedule, planId: EbaySellerPlan) {
  return schedule.ebay.sellerPlans[planId];
}

export function getEbayCategories(schedule: FeeSchedule, planId: EbaySellerPlan) {
  const plan = getEbaySellerPlanRule(schedule, planId);
  if (!plan) return undefined;
  return plan.categorySchedule === 'store'
    ? schedule.ebay.storeCategories
    : schedule.ebay.categories;
}

export function getEbayCategoryRule(
  schedule: FeeSchedule,
  categoryId: EbayCategoryId,
  planId: EbaySellerPlan = 'no-store',
) {
  return getEbayCategories(schedule, planId)?.[categoryId];
}

export function getEbayInsertionFee(
  schedule: FeeSchedule,
  planId: EbaySellerPlan,
  categoryId: EbayCategoryId,
) {
  if (categoryId === 'guitars') return 0;
  const plan = getEbaySellerPlanRule(schedule, planId);
  if (!plan) return undefined;
  return plan.id === 'no-store' ? schedule.ebay.insertionFee : plan.insertionFee;
}
