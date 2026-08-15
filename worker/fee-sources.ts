import { DEFAULT_FEE_SCHEDULE } from '../src/domain/fees/config';
import type {
  EbayCategoryId,
  EbayCategoryRule,
  EbayFeeRates,
  EbaySellerPlan,
  EtsyFeeRates,
  FeeSchedule,
} from '../src/domain/types';

const ETSY_BASICS_API =
  'https://help.etsy.com/api/v2/help_center/en-us/articles/360035902374.json';
const ETSY_PAYMENTS_API =
  'https://help.etsy.com/api/v2/help_center/en-gb/articles/115015628847.json';
const ETSY_FEES_API =
  'https://help.etsy.com/api/v2/help_center/en-us/articles/115014483627.json';
const EBAY_FEES_PAGE =
  'https://www.ebay.com/help/selling-fees/selling/selling-fees?id=4822';
const EBAY_STORE_FEES_PAGE =
  'https://www.ebay.com/help/selling/selling-fees/store-fees?id=4809';

interface EtsyArticleResponse {
  article?: {
    body?: string;
  };
}

type EbayStandardFeeRates = Omit<EbayFeeRates, 'storeCategories' | 'sellerPlans'>;
type EbayStoreFeeRates = Pick<EbayFeeRates, 'storeCategories' | 'sellerPlans'>;

function decodeHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function dollarsToCents(value: string): number {
  return Math.round(Number.parseFloat(value.replace(/,/g, '')) * 100);
}

function percentToBps(value: string): number {
  return Math.round(Number.parseFloat(value) * 100);
}

function requireMatch(value: string, expression: RegExp, label: string): RegExpMatchArray {
  const match = value.match(expression);
  if (!match) throw new Error(`Could not read ${label} from the official fee page.`);
  return match;
}

function validateRate(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} was outside the expected range.`);
  }
  return value;
}

export function parseEtsyRates(
  basicsHtml: string,
  paymentsHtml: string,
  feesHtml: string,
): EtsyFeeRates {
  const basics = decodeHtml(basicsHtml);
  const payments = decodeHtml(paymentsHtml);
  const fees = decodeHtml(feesHtml);

  const listing = requireMatch(
    basics,
    /flat rate charge of \$([0-9.]+) USD per listing/i,
    'Etsy listing fee',
  );
  const transaction = requireMatch(
    basics,
    /Etsy charges ([0-9.]+)% of the total order amount/i,
    'Etsy transaction rate',
  );
  const payment = requireMatch(
    payments,
    /United States\s+([0-9.]+)%\s*\+\s*([0-9.]+)\s*USD/i,
    'Etsy Payments U.S. rate',
  );
  const standardAd = requireMatch(
    fees,
    /less than \$10,000[\s\S]{0,180}?([0-9.]+)% fee/i,
    'Etsy standard Offsite Ads rate',
  );
  const reducedAd = requireMatch(
    fees,
    /at least \$10,000[\s\S]{0,180}?([0-9.]+)%/i,
    'Etsy reduced Offsite Ads rate',
  );
  const adCap = requireMatch(
    fees,
    /Offsite Ad fee will never exceed \$([0-9,.]+)/i,
    'Etsy Offsite Ads cap',
  );

  return {
    listingFee: validateRate(dollarsToCents(listing[1]), 1, 10_000, 'Etsy listing fee'),
    transactionRateBps: validateRate(
      percentToBps(transaction[1]),
      1,
      5_000,
      'Etsy transaction rate',
    ),
    paymentProcessingRateBps: validateRate(
      percentToBps(payment[1]),
      1,
      5_000,
      'Etsy Payments rate',
    ),
    paymentProcessingFixedFee: validateRate(
      dollarsToCents(payment[2]),
      1,
      10_000,
      'Etsy Payments fixed fee',
    ),
    offsiteAdsStandardRateBps: validateRate(
      percentToBps(standardAd[1]),
      1,
      5_000,
      'Etsy standard Offsite Ads rate',
    ),
    offsiteAdsReducedRateBps: validateRate(
      percentToBps(reducedAd[1]),
      1,
      5_000,
      'Etsy reduced Offsite Ads rate',
    ),
    offsiteAdsCap: validateRate(
      dollarsToCents(adCap[1]),
      1,
      1_000_000,
      'Etsy Offsite Ads cap',
    ),
  };
}

function parseTieredCategory(
  page: string,
  id: EbayCategoryId,
  label: string,
  marker: string,
): EbayCategoryRule {
  const markerIndex = page.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Could not find the eBay ${label} category.`);
  const row = page.slice(markerIndex, markerIndex + 900);
  const match = requireMatch(
    row,
    /([0-9.]+)% on total amount of the sale up to \$([0-9,]+)[\s\S]*?([0-9.]+)% on the portion of the sale over \$[0-9,]+/i,
    `eBay ${label} rates`,
  );
  return {
    id,
    label,
    firstRateBps: validateRate(percentToBps(match[1]), 1, 5_000, `${label} first rate`),
    breakpoint: validateRate(dollarsToCents(match[2]), 1, 100_000_000, `${label} breakpoint`),
    secondRateBps: validateRate(percentToBps(match[3]), 1, 5_000, `${label} second rate`),
    mode: 'tiered',
  };
}

function parseSwitchCategory(
  page: string,
  id: EbayCategoryId,
  label: string,
  marker: string,
): EbayCategoryRule {
  const markerIndex = page.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Could not find the eBay ${label} category.`);
  const row = page.slice(markerIndex, markerIndex + 650);
  const match = requireMatch(
    row,
    /([0-9.]+)% if total amount of the sale is \$([0-9,]+) or less[\s\S]*?([0-9.]+)% if total amount of the sale is over \$[0-9,]+/i,
    `eBay ${label} rates`,
  );
  return {
    id,
    label,
    firstRateBps: validateRate(percentToBps(match[1]), 1, 5_000, `${label} first rate`),
    breakpoint: validateRate(dollarsToCents(match[2]), 1, 100_000_000, `${label} breakpoint`),
    secondRateBps: validateRate(percentToBps(match[3]), 1, 5_000, `${label} second rate`),
    mode: 'switch',
  };
}

export function parseEbayRates(pageHtml: string): EbayStandardFeeRates {
  const page = decodeHtml(pageHtml);
  const basicFeesIndex = page.indexOf('Category Insertion fee Final value fee');
  if (basicFeesIndex < 0) throw new Error('Could not find the eBay basic fee table.');
  const basicFees = page.slice(basicFeesIndex);

  const insertion = requireMatch(
    basicFees,
    /First 250 listings free per month, then \$([0-9.]+) per listing/i,
    'eBay insertion fee',
  );
  const orderFees = requireMatch(
    page,
    /For orders \$([0-9.]+) or less the per order fee is \$([0-9.]+), for orders over \$[0-9.]+ the per order fee is \$([0-9.]+)/i,
    'eBay per-order fees',
  );
  const belowStandard = requireMatch(
    page,
    /Below Standard[\s\S]{0,320}?additional ([0-9.]+)%/i,
    'eBay Below Standard surcharge',
  );
  const belowStandardLongTerm = requireMatch(
    page,
    /Below Standard for four or more consecutive months[\s\S]{0,180}?additional ([0-9.]+)%/i,
    'eBay long-term Below Standard surcharge',
  );
  const veryHigh = requireMatch(
    page,
    /Item not as described[\s\S]{0,360}?additional ([0-9.]+)%/i,
    'eBay Very High Item Not as Described surcharge',
  );
  const veryHighLongTerm = requireMatch(
    page,
    /Very High for four or more consecutive months[\s\S]{0,180}?additional ([0-9.]+)%/i,
    'eBay long-term Very High Item Not as Described surcharge',
  );

  return {
    insertionFee: validateRate(dollarsToCents(insertion[1]), 1, 10_000, 'eBay insertion fee'),
    orderFeeThreshold: validateRate(
      dollarsToCents(orderFees[1]),
      1,
      1_000_000,
      'eBay order fee threshold',
    ),
    orderFeeAtOrBelow: validateRate(
      dollarsToCents(orderFees[2]),
      1,
      10_000,
      'eBay lower order fee',
    ),
    orderFeeAbove: validateRate(
      dollarsToCents(orderFees[3]),
      1,
      10_000,
      'eBay upper order fee',
    ),
    performanceSurcharges: {
      meeting: 0,
      'below-standard': validateRate(
        percentToBps(belowStandard[1]),
        1,
        5_000,
        'eBay Below Standard surcharge',
      ),
      'below-standard-long-term': validateRate(
        percentToBps(belowStandardLongTerm[1]),
        1,
        5_000,
        'eBay long-term Below Standard surcharge',
      ),
      'very-high-inad': validateRate(
        percentToBps(veryHigh[1]),
        1,
        5_000,
        'eBay Very High Item Not as Described surcharge',
      ),
      'very-high-inad-long-term': validateRate(
        percentToBps(veryHighLongTerm[1]),
        1,
        5_000,
        'eBay long-term Very High Item Not as Described surcharge',
      ),
    },
    categories: {
      most: parseTieredCategory(basicFees, 'most', 'Most categories', 'Most categories'),
      'books-media': parseTieredCategory(
        basicFees,
        'books-media',
        'Books, movies & music',
        'Books & Magazines',
      ),
      collectibles: parseTieredCategory(
        basicFees,
        'collectibles',
        'Cards & select collectibles',
        'Select Collectibles categories',
      ),
      jewelry: parseSwitchCategory(
        basicFees,
        'jewelry',
        'Jewelry (excluding watches)',
        'Jewelry & Watches (except Watches, Parts & Accessories)',
      ),
      guitars: parseTieredCategory(
        basicFees,
        'guitars',
        'Guitars & basses',
        'Guitars & Basses',
      ),
    },
  };
}

function storeInsertionFee(page: string, plan: Exclude<EbaySellerPlan, 'no-store'>): number {
  const marker = plan === 'starter'
    ? /Starter\s+[0-9,]+\/\$([0-9.]+)/i
    : new RegExp(`${plan}\\s+[\\s\\S]{0,360}?all categories\\/\\$([0-9.]+)`, 'i');
  const match = requireMatch(page, marker, `eBay ${plan} Store insertion fee`);
  return validateRate(dollarsToCents(match[1]), 1, 10_000, `${plan} Store insertion fee`);
}

export function parseEbayStoreRates(pageHtml: string): EbayStoreFeeRates {
  const page = decodeHtml(pageHtml);
  const insertionStart = page.indexOf('Zero insertion fee listing allocations and insertion fees');
  const storeRatesStart = page.lastIndexOf(
    'Basic, Premium, Anchor, and Enterprise Store subscribers',
  );
  if (insertionStart < 0) throw new Error('Could not find the eBay Store insertion fee table.');
  if (storeRatesStart < 0) throw new Error('Could not find the eBay Store final value fee table.');

  const insertionTable = page.slice(insertionStart, insertionStart + 2_000);
  const storeRates = page.slice(storeRatesStart);
  const fallbackPlans = DEFAULT_FEE_SCHEDULE.ebay.sellerPlans;

  return {
    sellerPlans: {
      'no-store': { ...fallbackPlans['no-store'] },
      starter: {
        ...fallbackPlans.starter,
        insertionFee: storeInsertionFee(insertionTable, 'starter'),
      },
      basic: {
        ...fallbackPlans.basic,
        insertionFee: storeInsertionFee(insertionTable, 'basic'),
      },
      premium: {
        ...fallbackPlans.premium,
        insertionFee: storeInsertionFee(insertionTable, 'premium'),
      },
      anchor: {
        ...fallbackPlans.anchor,
        insertionFee: storeInsertionFee(insertionTable, 'anchor'),
      },
      enterprise: {
        ...fallbackPlans.enterprise,
        insertionFee: storeInsertionFee(insertionTable, 'enterprise'),
      },
    },
    storeCategories: {
      most: parseTieredCategory(
        storeRates,
        'most',
        'Most categories',
        'All other categories',
      ),
      'books-media': parseTieredCategory(
        storeRates,
        'books-media',
        'Books, movies & music',
        'Books & Magazines',
      ),
      collectibles: parseTieredCategory(
        storeRates,
        'collectibles',
        'Trading cards & select collectibles',
        'Non-Sport Trading Cards (except Non-Sport Trading Card NFTs)',
      ),
      jewelry: parseSwitchCategory(
        storeRates,
        'jewelry',
        'Most jewelry & watches',
        'Most Jewelry & Watches categories, except:',
      ),
      guitars: parseTieredCategory(
        storeRates,
        'guitars',
        'Guitars & basses',
        'Guitars & Basses',
      ),
    },
  };
}

async function fetchText(fetcher: typeof fetch, url: string): Promise<string> {
  const response = await fetcher(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 SellerMargin/1.0',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Fee source returned ${response.status}.`);
  return response.text();
}

async function fetchEtsyArticle(fetcher: typeof fetch, url: string): Promise<string> {
  const payload = JSON.parse(await fetchText(fetcher, url)) as EtsyArticleResponse;
  if (!payload.article?.body) throw new Error('The Etsy fee article did not contain a body.');
  return payload.article.body;
}

function sameRates(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function markSourceCheck(
  schedule: FeeSchedule,
  source: 'etsy' | 'ebay' | 'ebayStore',
  matchesPinnedProfile: boolean,
): void {
  schedule.sourceCheckedAt[source] = schedule.checkedAt;
  if (matchesPinnedProfile) {
    schedule.sourceStatus[source] = 'live';
    schedule.sourceMessages[source] = null;
    return;
  }
  schedule.sourceStatus[source] = 'review';
  schedule.sourceMessages[source] =
    'The official fee page differs from the active reviewed profile. SellerMargin kept the pinned profile and flagged it for review instead of changing calculations automatically.';
}

export async function fetchCurrentFeeSchedule(fetcher: typeof fetch = fetch): Promise<FeeSchedule> {
  const schedule: FeeSchedule = JSON.parse(JSON.stringify(DEFAULT_FEE_SCHEDULE)) as FeeSchedule;
  schedule.checkedAt = new Date().toISOString();

  const etsyResult = await Promise.allSettled([
    fetchEtsyArticle(fetcher, ETSY_BASICS_API),
    fetchEtsyArticle(fetcher, ETSY_PAYMENTS_API),
    fetchEtsyArticle(fetcher, ETSY_FEES_API),
  ]);
  if (etsyResult.every((result) => result.status === 'fulfilled')) {
    const [basics, payments, fees] = etsyResult.map((result) =>
      (result as PromiseFulfilledResult<string>).value,
    );
    try {
      const observedRates = parseEtsyRates(basics, payments, fees);
      markSourceCheck(schedule, 'etsy', sameRates(observedRates, schedule.etsy));
    } catch {
      schedule.sourceStatus.etsy = 'verified';
      schedule.sourceMessages.etsy =
        'The official source could not be parsed during this check. The active reviewed profile remains in use.';
    }
  }

  try {
    const observedRates = parseEbayRates(await fetchText(fetcher, EBAY_FEES_PAGE));
    const pinnedRates: EbayStandardFeeRates = {
      insertionFee: schedule.ebay.insertionFee,
      orderFeeThreshold: schedule.ebay.orderFeeThreshold,
      orderFeeAtOrBelow: schedule.ebay.orderFeeAtOrBelow,
      orderFeeAbove: schedule.ebay.orderFeeAbove,
      performanceSurcharges: schedule.ebay.performanceSurcharges,
      categories: schedule.ebay.categories,
    };
    markSourceCheck(schedule, 'ebay', sameRates(observedRates, pinnedRates));
  } catch {
    schedule.sourceStatus.ebay = 'verified';
    schedule.sourceMessages.ebay =
      'The official source could not be parsed during this check. The active reviewed profile remains in use.';
  }

  try {
    const observedRates = parseEbayStoreRates(await fetchText(fetcher, EBAY_STORE_FEES_PAGE));
    const pinnedRates: EbayStoreFeeRates = {
      sellerPlans: schedule.ebay.sellerPlans,
      storeCategories: schedule.ebay.storeCategories,
    };
    markSourceCheck(schedule, 'ebayStore', sameRates(observedRates, pinnedRates));
  } catch {
    schedule.sourceStatus.ebayStore = 'verified';
    schedule.sourceMessages.ebayStore =
      'The official source could not be parsed during this check. The active reviewed profile remains in use.';
  }

  return schedule;
}
