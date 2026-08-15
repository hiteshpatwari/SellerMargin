export type Money = number;

export type MarketplaceId = 'etsy' | 'ebay' | 'direct' | 'custom';
export type SellerRegion = 'US' | 'OTHER';
export type CurrencyCode = 'USD';

export type EbayCategoryId =
  | 'most'
  | 'books-media'
  | 'collectibles'
  | 'jewelry'
  | 'guitars';

export type EbaySellerPlan =
  | 'no-store'
  | 'starter'
  | 'basic'
  | 'premium'
  | 'anchor'
  | 'enterprise';

export type EbaySellerPlanSelection = EbaySellerPlan | 'unselected';
export type EbayCategorySelection = EbayCategoryId | 'unselected' | 'unsupported';
export type EbaySellerStatus =
  | 'unselected'
  | 'meeting'
  | 'below-standard'
  | 'below-standard-long-term'
  | 'very-high-inad'
  | 'very-high-inad-long-term';
export type EbayResolvedSellerStatus = Exclude<EbaySellerStatus, 'unselected'>;
export type EtsySaleSource = 'organic' | 'offsite';
export type EtsyOffsiteAdsTier = 'unselected' | 'standard' | 'reduced';
export type EbaySaleSource = 'organic' | 'promoted';

export interface MarketplaceSettings {
  sellerRegion: SellerRegion;
  etsyIncludeListingFee: boolean;
  etsySaleSource: EtsySaleSource;
  etsyOffsiteAdsTier: EtsyOffsiteAdsTier;
  ebaySellerPlan: EbaySellerPlanSelection;
  ebayCategory: EbayCategorySelection;
  ebaySellerStatus: EbaySellerStatus;
  ebaySaleSource: EbaySaleSource;
  ebayPromotedListingRateBps: number;
  ebayIncludeInsertionFee: boolean;
  customPercentageRateBps: number;
  customFixedFee: Money;
  customListingFee: Money;
}

export interface TransactionInput {
  productName: string;
  sellingPrice: Money;
  marketplace: MarketplaceId;
  customerShippingCharge: Money;
  marketplaceCollectedTax: Money;
  productCost: Money;
  packagingCost: Money;
  sellerShippingCost: Money;
  advertisingCost: Money;
  otherCosts: Money;
  discountBps: number;
  settings: MarketplaceSettings;
}

export type FeeKind = 'listing' | 'marketplace' | 'payment' | 'advertising';

export interface FeeLineItem {
  id: string;
  label: string;
  amount: Money;
  kind: FeeKind;
  explanation: string;
  calculation: string;
  rounding: string;
}

export interface FeeSource {
  label: string;
  url: string;
}

export interface FeeConfiguration {
  marketplace: MarketplaceId;
  region: SellerRegion;
  currency: CurrencyCode;
  version: string;
  effectiveDate: string;
  lastVerifiedDate: string;
  summary: string;
  conditions: string[];
  sources: FeeSource[];
  sourceStatus?: FeeSourceStatus;
}

export type FeeSourceStatus = 'live' | 'verified' | 'review';

export interface FeeProfileMetadata {
  marketplace: 'etsy' | 'ebay';
  region: 'US';
  currency: 'USD';
  version: string;
  effectiveDate: string;
  lastVerifiedDate: string;
  reviewIntervalDays: number;
}

export interface EtsyFeeRates {
  listingFee: Money;
  transactionRateBps: number;
  paymentProcessingRateBps: number;
  paymentProcessingFixedFee: Money;
  offsiteAdsStandardRateBps: number;
  offsiteAdsReducedRateBps: number;
  offsiteAdsCap: Money;
}

export interface EbayCategoryRule {
  id: EbayCategoryId;
  label: string;
  firstRateBps: number;
  breakpoint: Money;
  secondRateBps: number;
  mode: 'tiered' | 'switch';
}

export interface EbayFeeRates {
  insertionFee: Money;
  orderFeeThreshold: Money;
  orderFeeAtOrBelow: Money;
  orderFeeAbove: Money;
  categories: Record<EbayCategoryId, EbayCategoryRule>;
  storeCategories: Record<EbayCategoryId, EbayCategoryRule>;
  sellerPlans: Record<EbaySellerPlan, EbaySellerPlanRule>;
  performanceSurcharges: Record<EbayResolvedSellerStatus, number>;
}

export interface EbaySellerPlanRule {
  id: EbaySellerPlan;
  label: string;
  insertionFee: Money;
  categorySchedule: 'standard' | 'store';
}

export interface FeeSchedule {
  schemaVersion: 2;
  region: 'US';
  currency: 'USD';
  profiles: Record<'etsy' | 'ebayStandard' | 'ebayStore', FeeProfileMetadata>;
  checkedAt: string;
  sourceCheckedAt: Record<'etsy' | 'ebay' | 'ebayStore', string>;
  sourceStatus: Record<'etsy' | 'ebay' | 'ebayStore', FeeSourceStatus>;
  sourceMessages: Record<'etsy' | 'ebay' | 'ebayStore', string | null>;
  etsy: EtsyFeeRates;
  ebay: EbayFeeRates;
}

export interface CalculationIssue {
  code: string;
  severity: 'warning' | 'blocking';
  message: string;
}

export interface CostLineItem {
  id: string;
  label: string;
  amount: Money;
}

export interface CalculationResult {
  input: TransactionInput;
  itemRevenue: Money;
  revenue: Money;
  grossProfit: Money;
  marketplaceFees: Money;
  variableCosts: Money;
  totalCosts: Money;
  profit: Money;
  marginBps: number | null;
  fees: FeeLineItem[];
  costs: CostLineItem[];
  feeConfiguration: FeeConfiguration;
  status: 'ready' | 'blocked';
  issues: CalculationIssue[];
}

export interface SavedCalculation {
  id: string;
  savedAt: string;
  input: TransactionInput;
}
