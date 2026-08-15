import { formatMoney, percentageOf } from '../money';
import type {
  EbayCategoryRule,
  FeeLineItem,
  FeeSchedule,
  MarketplaceId,
  Money,
  TransactionInput,
} from '../types';
import type { ResolvedFeeProfile } from './resolver';

function formatRate(basisPoints: number): string {
  return `${basisPoints / 100}%`;
}

function percentageCalculation(base: Money, basisPoints: number): string {
  return `${formatRate(basisPoints)} × ${formatMoney(base)}`;
}

export interface MarketplaceFeeContext {
  input: TransactionInput;
  itemRevenue: Money;
  revenue: Money;
  schedule: FeeSchedule;
  profile: ResolvedFeeProfile;
}

export interface MarketplaceFeeResult {
  fees: FeeLineItem[];
  configuration: ResolvedFeeProfile['configuration'];
  issues: ResolvedFeeProfile['issues'];
}

export interface MarketplaceAdapter {
  id: MarketplaceId;
  calculate(context: MarketplaceFeeContext): MarketplaceFeeResult;
}

function etsyAdapter(): MarketplaceAdapter {
  return {
    id: 'etsy',
    calculate({ input, revenue, profile }): MarketplaceFeeResult {
      const fees: FeeLineItem[] = [];
      const etsyProfile = profile.etsy;
      const rates = etsyProfile?.rates;
      if (!rates || !etsyProfile) {
        return { fees, configuration: profile.configuration, issues: profile.issues };
      }

      if (input.settings.etsyIncludeListingFee) {
        fees.push({
          id: 'etsy-listing',
          label: 'Listing fee',
          amount: rates.listingFee,
          kind: 'listing',
          explanation: `One standard Etsy listing fee of $${(rates.listingFee / 100).toFixed(2)} USD.`,
          calculation: `1 listing × ${formatMoney(rates.listingFee)}`,
          rounding: 'Fixed fee; no percentage rounding.',
        });
      }

      fees.push({
        id: 'etsy-transaction',
        label: 'Transaction fee',
        amount: percentageOf(revenue, rates.transactionRateBps),
        kind: 'marketplace',
        explanation: `${rates.transactionRateBps / 100}% of item revenue plus shipping charged to the customer.`,
        calculation: percentageCalculation(revenue, rates.transactionRateBps),
        rounding: 'Rounded to the nearest cent for this estimate.',
      });

      const paymentBase = revenue + input.marketplaceCollectedTax;
      fees.push({
        id: 'etsy-payments',
        label: 'Etsy Payments',
        amount:
          percentageOf(paymentBase, rates.paymentProcessingRateBps) +
          rates.paymentProcessingFixedFee,
        kind: 'payment',
        explanation:
          `U.S. rate: ${rates.paymentProcessingRateBps / 100}% of the order payment, including applicable sales tax, plus $${(rates.paymentProcessingFixedFee / 100).toFixed(2)}.`,
        calculation:
          `${percentageCalculation(paymentBase, rates.paymentProcessingRateBps)} + ` +
          formatMoney(rates.paymentProcessingFixedFee),
        rounding: 'Percentage rounded to the nearest cent, then the fixed fee is added.',
      });

      if (input.settings.etsySaleSource === 'offsite' && etsyProfile.offsiteAdsRateBps > 0) {
        const rate = etsyProfile.offsiteAdsRateBps;
        fees.push({
          id: 'etsy-offsite-ads',
          label: `Offsite Ads (${rate / 100}%)`,
          amount: Math.min(rates.offsiteAdsCap, percentageOf(revenue, rate)),
          kind: 'advertising',
          explanation: `${rate / 100}% of the attributed order total, capped at $${(rates.offsiteAdsCap / 100).toFixed(0)}.`,
          calculation:
            `min(${percentageCalculation(revenue, rate)}, ${formatMoney(rates.offsiteAdsCap)} cap)`,
          rounding: 'Rounded to the nearest cent, then limited to the per-order cap.',
        });
      }

      return { fees, configuration: profile.configuration, issues: profile.issues };
    },
  };
}

function calculateEbayCategoryFee(
  base: Money,
  rule: EbayCategoryRule,
): Money {
  if (rule.mode === 'switch') {
    return percentageOf(base, base <= rule.breakpoint ? rule.firstRateBps : rule.secondRateBps);
  }

  const firstTier = Math.min(base, rule.breakpoint);
  const secondTier = Math.max(0, base - rule.breakpoint);
  return percentageOf(firstTier, rule.firstRateBps) + percentageOf(secondTier, rule.secondRateBps);
}

function ebayCategoryCalculation(
  base: Money,
  rule: EbayCategoryRule,
): string {
  if (rule.mode === 'switch') {
    const rate = base <= rule.breakpoint ? rule.firstRateBps : rule.secondRateBps;
    return percentageCalculation(base, rate);
  }

  if (base <= rule.breakpoint) return percentageCalculation(base, rule.firstRateBps);
  return (
    `${percentageCalculation(rule.breakpoint, rule.firstRateBps)} + ` +
    `${percentageCalculation(base - rule.breakpoint, rule.secondRateBps)}`
  );
}

function ebayAdapter(): MarketplaceAdapter {
  return {
    id: 'ebay',
    calculate({ input, revenue, schedule, profile }): MarketplaceFeeResult {
      const fees: FeeLineItem[] = [];
      if (!profile.ebay) {
        return { fees, configuration: profile.configuration, issues: profile.issues };
      }
      const feeBase = revenue + input.marketplaceCollectedTax;
      const rates = schedule.ebay;
      const { plan, category, performanceSurchargeBps } = profile.ebay;
      const orderFee =
        feeBase <= rates.orderFeeThreshold ? rates.orderFeeAtOrBelow : rates.orderFeeAbove;
      const insertionFee = category.id === 'guitars'
        ? 0
        : plan.id === 'no-store'
          ? rates.insertionFee
          : plan.insertionFee;

      if (input.settings.ebayIncludeInsertionFee && insertionFee > 0) {
        fees.push({
          id: 'ebay-insertion',
          label: 'Insertion fee after allowance',
          amount: insertionFee,
          kind: 'listing',
          explanation: `${plan.label} fixed-price fee after the monthly zero-insertion-fee allocation is used.`,
          calculation: `1 fixed-price listing × ${formatMoney(insertionFee)}`,
          rounding: 'Fixed fee; no percentage rounding.',
        });
      }

      fees.push({
        id: 'ebay-final-value',
        label: `${category.label} final value fee`,
        amount: calculateEbayCategoryFee(feeBase, category),
        kind: 'marketplace',
        explanation: `Category rate applied to item price, customer-paid shipping, and estimated sales tax.`,
        calculation: ebayCategoryCalculation(feeBase, category),
        rounding: 'Each modeled percentage tier is rounded to the nearest cent, then tiers are added.',
      });
      fees.push({
        id: 'ebay-per-order',
        label: 'Per-order fee',
        amount: orderFee,
        kind: 'payment',
        explanation:
          feeBase <= rates.orderFeeThreshold
            ? `$${(rates.orderFeeAtOrBelow / 100).toFixed(2)} for orders of $${(rates.orderFeeThreshold / 100).toFixed(0)} or less.`
            : `$${(rates.orderFeeAbove / 100).toFixed(2)} for orders over $${(rates.orderFeeThreshold / 100).toFixed(0)}.`,
        calculation: `1 order × ${formatMoney(orderFee)}`,
        rounding: 'Fixed per-order fee; no percentage rounding.',
      });

      if (performanceSurchargeBps > 0) {
        fees.push({
          id: 'ebay-performance-surcharge',
          label: `Seller-performance surcharge (${performanceSurchargeBps / 100}%)`,
          amount: percentageOf(feeBase, performanceSurchargeBps),
          kind: 'marketplace',
          explanation: 'Additional final value fee for the selected Seller Dashboard status, applied to the total amount of the sale.',
          calculation: percentageCalculation(feeBase, performanceSurchargeBps),
          rounding: 'Rounded to the nearest cent for this estimate.',
        });
      }

      if (
        input.settings.ebaySaleSource === 'promoted'
        && input.settings.ebayPromotedListingRateBps > 0
      ) {
        fees.push({
          id: 'ebay-promoted',
          label: `Promoted listing (${input.settings.ebayPromotedListingRateBps / 100}%)`,
          amount: percentageOf(feeBase, input.settings.ebayPromotedListingRateBps),
          kind: 'advertising',
          explanation:
            'General campaign ad rate applied to the total sale amount, including shipping and tax.',
          calculation: percentageCalculation(feeBase, input.settings.ebayPromotedListingRateBps),
          rounding: 'Rounded to the nearest cent for this estimate.',
        });
      }

      return {
        fees,
        configuration: profile.configuration,
        issues: profile.issues,
      };
    },
  };
}

function directAdapter(): MarketplaceAdapter {
  return {
    id: 'direct',
    calculate({ profile }): MarketplaceFeeResult {
      return { fees: [], configuration: profile.configuration, issues: profile.issues };
    },
  };
}

function customAdapter(): MarketplaceAdapter {
  return {
    id: 'custom',
    calculate({ input, revenue, profile }): MarketplaceFeeResult {
      const fees: FeeLineItem[] = [];
      if (input.settings.customPercentageRateBps > 0) {
        fees.push({
          id: 'custom-percentage',
          label: `Platform fee (${input.settings.customPercentageRateBps / 100}%)`,
          amount: percentageOf(revenue, input.settings.customPercentageRateBps),
          kind: 'marketplace',
          explanation: 'Your custom percentage applied to item revenue and customer-paid shipping.',
          calculation: percentageCalculation(revenue, input.settings.customPercentageRateBps),
          rounding: 'Rounded to the nearest cent for this estimate.',
        });
      }
      if (input.settings.customFixedFee > 0) {
        fees.push({
          id: 'custom-fixed',
          label: 'Fixed transaction fee',
          amount: input.settings.customFixedFee,
          kind: 'payment',
          explanation: 'Your custom fixed fee per transaction.',
          calculation: `1 transaction × ${formatMoney(input.settings.customFixedFee)}`,
          rounding: 'Fixed user-entered fee.',
        });
      }
      if (input.settings.customListingFee > 0) {
        fees.push({
          id: 'custom-listing',
          label: 'Listing fee',
          amount: input.settings.customListingFee,
          kind: 'listing',
          explanation: 'Your custom listing fee per item sold.',
          calculation: `1 listing × ${formatMoney(input.settings.customListingFee)}`,
          rounding: 'Fixed user-entered fee.',
        });
      }
      return { fees, configuration: profile.configuration, issues: profile.issues };
    },
  };
}

const adapters: Record<MarketplaceId, MarketplaceAdapter> = {
  etsy: etsyAdapter(),
  ebay: ebayAdapter(),
  direct: directAdapter(),
  custom: customAdapter(),
};

export function getMarketplaceAdapter(id: MarketplaceId): MarketplaceAdapter {
  return adapters[id];
}
