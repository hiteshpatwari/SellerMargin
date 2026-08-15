import type {
  CalculationIssue,
  EbayCategoryRule,
  EbaySellerPlanRule,
  EtsyFeeRates,
  FeeConfiguration,
  FeeSchedule,
  TransactionInput,
} from '../types';
import {
  getEbayCategoryRule,
  getEbaySellerPlanRule,
  getFeeConfiguration,
} from './config';

export interface ResolvedFeeProfile {
  marketplace: TransactionInput['marketplace'];
  configuration: FeeConfiguration;
  issues: CalculationIssue[];
  etsy?: {
    rates: EtsyFeeRates;
    offsiteAdsRateBps: number;
  };
  ebay?: {
    plan: EbaySellerPlanRule;
    category: EbayCategoryRule;
    performanceSurchargeBps: number;
  };
}

function profileAgeIssue(
  profile: FeeSchedule['profiles'][keyof FeeSchedule['profiles']],
  checkedAt: string,
): CalculationIssue | null {
  const verified = new Date(`${profile.lastVerifiedDate}T00:00:00Z`).getTime();
  const checked = new Date(checkedAt).getTime();
  if (!Number.isFinite(verified) || !Number.isFinite(checked)) return null;
  const ageDays = (checked - verified) / 86_400_000;
  return ageDays > profile.reviewIntervalDays
    ? {
        code: 'profile-review-overdue',
        severity: 'warning',
        message: `This fee profile is older than its ${profile.reviewIntervalDays}-day review interval. Verify the marketplace statement before relying on it.`,
      }
    : null;
}

function sourceIssues(
  schedule: FeeSchedule,
  sources: Array<'etsy' | 'ebay' | 'ebayStore'>,
): CalculationIssue[] {
  return sources.flatMap((source) => {
    if (schedule.sourceStatus[source] === 'review') {
      return [{
        code: `source-review-${source}`,
        severity: 'warning' as const,
        message: schedule.sourceMessages[source]
          ?? 'The official source no longer matches the active versioned profile. The pinned verified profile remains in use pending review.',
      }];
    }
    const message = schedule.sourceMessages[source];
    return message
      ? [{ code: `source-unavailable-${source}`, severity: 'warning' as const, message }]
      : [];
  });
}

export function resolveFeeProfile(
  input: TransactionInput,
  schedule: FeeSchedule,
): ResolvedFeeProfile {
  const issues: CalculationIssue[] = [];
  const conditions: string[] = [];
  const moneyInputs = [
    input.sellingPrice,
    input.customerShippingCharge,
    input.marketplaceCollectedTax,
    input.productCost,
    input.packagingCost,
    input.sellerShippingCost,
    input.advertisingCost,
    input.otherCosts,
  ];
  if (moneyInputs.some((value) => !Number.isFinite(value) || value < 0)) {
    issues.push({
      code: 'invalid-money-input',
      severity: 'blocking',
      message: 'Prices, shipping, tax, and costs must be valid non-negative amounts.',
    });
  }
  if (!Number.isFinite(input.discountBps) || input.discountBps < 0 || input.discountBps > 10_000) {
    issues.push({
      code: 'invalid-discount',
      severity: 'blocking',
      message: 'Enter a discount between 0% and 100%.',
    });
  }

  if (input.marketplace === 'direct' || input.marketplace === 'custom') {
    if (
      input.marketplace === 'custom'
      && (
        !Number.isFinite(input.settings.customPercentageRateBps)
        || input.settings.customPercentageRateBps < 0
        || input.settings.customPercentageRateBps > 10_000
      )
    ) {
      issues.push({
        code: 'custom-rate-invalid',
        severity: 'blocking',
        message: 'Enter a custom platform percentage between 0% and 100%.',
      });
    }
    return {
      marketplace: input.marketplace,
      configuration: getFeeConfiguration(input.marketplace, schedule, {
        region: input.settings.sellerRegion,
        conditions,
      }),
      issues,
    };
  }

  conditions.push(`Seller country: ${input.settings.sellerRegion === 'US' ? 'United States' : 'Unsupported country'}`);
  if (input.settings.sellerRegion !== 'US') {
    issues.push({
      code: 'unsupported-region',
      severity: 'blocking',
      message: `${input.marketplace === 'etsy' ? 'Etsy' : 'eBay'} production fee profiles are currently verified only for United States sellers using USD.`,
    });
  }

  if (input.marketplace === 'etsy') {
    const profile = schedule.profiles.etsy;
    const offsiteRate = input.settings.etsyOffsiteAdsTier === 'standard'
      ? schedule.etsy.offsiteAdsStandardRateBps
      : input.settings.etsyOffsiteAdsTier === 'reduced'
        ? schedule.etsy.offsiteAdsReducedRateBps
        : 0;

    conditions.push(`Sale source: ${input.settings.etsySaleSource === 'organic' ? 'Organic / not attributed' : 'Offsite Ads attributed'}`);
    conditions.push(`Listing fee assigned to sale: ${input.settings.etsyIncludeListingFee ? 'Yes' : 'No'}`);
    if (input.settings.etsySaleSource === 'offsite') {
      if (input.settings.etsyOffsiteAdsTier === 'unselected') {
        issues.push({
          code: 'etsy-offsite-tier-required',
          severity: 'blocking',
          message: 'Choose the Etsy Offsite Ads shop-revenue tier to calculate an attributed sale.',
        });
      } else {
        conditions.push(
          input.settings.etsyOffsiteAdsTier === 'standard'
            ? 'Offsite Ads tier: shop made under $10,000 on Etsy in the past 365 days'
            : 'Offsite Ads tier: shop made at least $10,000 on Etsy in the past 365 days',
        );
      }
    }
    issues.push(...sourceIssues(schedule, ['etsy']));
    const ageIssue = profileAgeIssue(profile, schedule.checkedAt);
    if (ageIssue) issues.push(ageIssue);

    return {
      marketplace: 'etsy',
      configuration: getFeeConfiguration('etsy', schedule, {
        region: input.settings.sellerRegion,
        conditions,
      }),
      issues,
      etsy: { rates: schedule.etsy, offsiteAdsRateBps: offsiteRate },
    };
  }

  const planId = input.settings.ebaySellerPlan;
  const categoryId = input.settings.ebayCategory;
  const status = input.settings.ebaySellerStatus;
  const plan = planId === 'unselected' ? undefined : getEbaySellerPlanRule(schedule, planId);
  const category = plan && categoryId !== 'unselected' && categoryId !== 'unsupported'
    ? getEbayCategoryRule(schedule, categoryId, plan.id)
    : undefined;

  if (!plan) {
    issues.push({
      code: 'ebay-plan-required',
      severity: 'blocking',
      message: 'Choose your eBay Store subscription tier or No Store before calculating fees.',
    });
  } else {
    conditions.push(`Store plan: ${plan.label}`);
  }
  if (categoryId === 'unsupported') {
    issues.push({
      code: 'ebay-category-unsupported',
      severity: 'blocking',
      message: 'That eBay category is not yet covered by SellerMargin. Choose an exact supported fee group or use Custom fees.',
    });
  } else if (!category) {
    issues.push({
      code: 'ebay-category-required',
      severity: 'blocking',
      message: 'Choose the eBay category fee group that exactly matches your listing.',
    });
  } else {
    conditions.push(`Category fee group: ${category.label}`);
  }
  if (status === 'unselected') {
    issues.push({
      code: 'ebay-status-required',
      severity: 'blocking',
      message: 'Choose the seller-performance status shown in your eBay Seller Dashboard.',
    });
  } else {
    const statusLabels: Record<typeof status, string> = {
      meeting: 'Above Standard / Top Rated or no surcharge',
      'below-standard': 'Below Standard',
      'below-standard-long-term': 'Below Standard for 4+ consecutive months',
      'very-high-inad': 'Very High Item Not as Described rate',
      'very-high-inad-long-term': 'Very High Item Not as Described rate for 4+ consecutive months',
    };
    conditions.push(`Seller performance: ${statusLabels[status]}`);
  }

  conditions.push(`Sale source: ${input.settings.ebaySaleSource === 'organic' ? 'Organic / not attributed' : 'Promoted Listings General attributed'}`);
  if (input.settings.ebaySaleSource === 'promoted') {
    if (
      !Number.isFinite(input.settings.ebayPromotedListingRateBps)
      || input.settings.ebayPromotedListingRateBps < 200
      || input.settings.ebayPromotedListingRateBps > 10_000
    ) {
      issues.push({
        code: 'ebay-promoted-rate-invalid',
        severity: 'blocking',
        message: 'Enter the attributed General campaign ad rate between 2% and 100%.',
      });
    } else {
      conditions.push(`Promoted Listings ad rate: ${input.settings.ebayPromotedListingRateBps / 100}%`);
    }
    if (status !== 'meeting' && status !== 'unselected') {
      issues.push({
        code: 'ebay-promoted-eligibility',
        severity: 'warning',
        message: 'eBay states General campaign access is for eligible Above Standard or Top Rated sellers. Confirm that this sale was actually attributed before including the ad fee.',
      });
    }
  }

  const usesStorePage = Boolean(plan && plan.id !== 'no-store');
  issues.push(...sourceIssues(schedule, usesStorePage ? ['ebay', 'ebayStore'] : ['ebay']));
  const profile = usesStorePage ? schedule.profiles.ebayStore : schedule.profiles.ebayStandard;
  const ageIssue = profileAgeIssue(profile, schedule.checkedAt);
  if (ageIssue) issues.push(ageIssue);

  const resolvedStatus = status === 'unselected' ? undefined : status;
  return {
    marketplace: 'ebay',
    configuration: getFeeConfiguration('ebay', schedule, {
      region: input.settings.sellerRegion,
      ebaySellerPlan: plan?.id,
      conditions,
    }),
    issues,
    ebay: plan && category && resolvedStatus
      ? {
          plan,
          category,
          performanceSurchargeBps: schedule.ebay.performanceSurcharges[resolvedStatus],
        }
      : undefined,
  };
}
