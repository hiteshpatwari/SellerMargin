import { describe, expect, it } from 'vitest';
import {
  fetchCurrentFeeSchedule,
  parseEbayRates,
  parseEbayStoreRates,
  parseEtsyRates,
} from '../../../worker/fee-sources';
import { DEFAULT_FEE_SCHEDULE } from './config';

describe('official fee source parsers', () => {
  it('reads the supported Etsy U.S. rates from help-center article content', () => {
    const basics = `
      <p>The listing fee is a flat rate charge of $0.20 USD per listing.</p>
      <p>Etsy charges 6.5% of the total order amount in your designated listing currency.</p>
    `;
    const payments = '<table><tr><td>United States</td><td>3% + 0.25 USD</td></tr></table>';
    const fees = `
      <p>If you made less than $10,000, you'll be charged a 15% fee.</p>
      <p>If you made at least $10,000, you'll get a discounted fee of 12%.</p>
      <p>The Offsite Ad fee will never exceed $100 for an order.</p>
    `;

    expect(parseEtsyRates(basics, payments, fees)).toEqual({
      listingFee: 20,
      transactionRateBps: 650,
      paymentProcessingRateBps: 300,
      paymentProcessingFixedFee: 25,
      offsiteAdsStandardRateBps: 1500,
      offsiteAdsReducedRateBps: 1200,
      offsiteAdsCap: 10_000,
    });
  });

  it('reads eBay basic seller rates and supported category rows', () => {
    const page = `
      <p>For orders $10.00 or less the per order fee is $0.30, for orders over $10.00 the per order fee is $0.40.</p>
      <p>If your account is evaluated as Below Standard, you'll be charged an additional 6%.</p>
      <p>If your account has been evaluated as Below Standard for four or more consecutive months, this fee will increase to an additional 7%.</p>
      <p>If your rate of 'Item not as described' is Very High, you will be charged an additional 5%.</p>
      <p>If a particular rate has been evaluated as Very High for four or more consecutive months, this fee will increase to an additional 6%.</p>
      <table>
        <thead><tr><th>Category</th><th>Insertion fee</th><th>Final value fee</th></tr></thead>
        <tbody>
          <tr><td>Most categories</td><td>First 250 listings free per month, then $0.35 per listing</td><td>13.6% on total amount of the sale up to $7,500 calculated per item 2.35% on the portion of the sale over $7,500</td></tr>
          <tr><td>Books &amp; Magazines Movies &amp; TV Music</td><td>15.3% on total amount of the sale up to $7,500 calculated per item 2.35% on the portion of the sale over $7,500</td></tr>
          <tr><td>Select Collectibles categories</td><td>13.25% on total amount of the sale up to $7,500 calculated per item 2.35% on the portion of the sale over $7,500</td></tr>
          <tr><td>Jewelry &amp; Watches (except Watches, Parts &amp; Accessories)</td><td>15% if total amount of the sale is $5,000 or less, calculated per item 9% if total amount of the sale is over $5,000</td></tr>
          <tr><td>Guitars &amp; Basses</td><td>6.7% on total amount of the sale up to $7,500 calculated per item 2.35% on the portion of the sale over $7,500</td></tr>
        </tbody>
      </table>
    `;

    const rates = parseEbayRates(page);
    expect(rates.insertionFee).toBe(35);
    expect(rates.orderFeeAtOrBelow).toBe(30);
    expect(rates.orderFeeAbove).toBe(40);
    expect(rates.performanceSurcharges).toEqual({
      meeting: 0,
      'below-standard': 600,
      'below-standard-long-term': 700,
      'very-high-inad': 500,
      'very-high-inad-long-term': 600,
    });
    expect(rates.categories.most.firstRateBps).toBe(1360);
    expect(rates.categories['books-media'].firstRateBps).toBe(1530);
    expect(rates.categories.collectibles.firstRateBps).toBe(1325);
    expect(rates.categories.jewelry).toMatchObject({
      firstRateBps: 1500,
      breakpoint: 500_000,
      secondRateBps: 900,
      mode: 'switch',
    });
    expect(rates.categories.guitars.firstRateBps).toBe(670);
  });

  it('reads eBay Store insertion fees and supported Store category rows', () => {
    const page = `
      <p>Zero insertion fee listing allocations and insertion fees</p>
      <table>
        <tr><td>Starter</td><td>250/$0.30</td></tr>
        <tr><td>Basic</td><td>250 in select categories/$0.25 1,000 all categories/$0.25</td></tr>
        <tr><td>Premium</td><td>500 in select categories/$0.15 10,000 all categories/$0.10</td></tr>
        <tr><td>Anchor</td><td>1,000 in select categories/$0.10 25,000 all categories/$0.05</td></tr>
        <tr><td>Enterprise</td><td>2,500 in select categories/$0.10 100,000 all categories/$0.05</td></tr>
      </table>
      <h2>Basic, Premium, Anchor, and Enterprise Store subscribers</h2>
      <table>
        <tr><td>Books &amp; Magazines</td><td>15.3% on total amount of the sale up to $2,500 calculated per item 2.35% on the portion of the sale over $2,500</td></tr>
        <tr><td>Non-Sport Trading Cards (except Non-Sport Trading Card NFTs) Comic Books &amp; Memorabilia</td><td>12.35% on total amount of the sale up to $2,500 calculated per item 2.35% on the portion of the sale over $2,500</td></tr>
        <tr><td>Most Jewelry &amp; Watches categories, except:</td><td>13% if total amount of the sale is $5,000 or less, calculated per item 7% if total amount of the sale is over $5,000</td></tr>
        <tr><td>Guitars &amp; Basses</td><td>6.7% on total amount of the sale up to $2,500 calculated per item 2.35% on the portion of the sale over $2,500</td></tr>
        <tr><td>All other categories</td><td>12.7% on total amount of the sale up to $2,500 calculated per item 2.35% on the portion of the sale over $2,500</td></tr>
      </table>
    `;

    const rates = parseEbayStoreRates(page);
    expect(Object.fromEntries(
      Object.entries(rates.sellerPlans).map(([id, plan]) => [id, plan.insertionFee]),
    )).toEqual({
      'no-store': 35,
      starter: 30,
      basic: 25,
      premium: 10,
      anchor: 5,
      enterprise: 5,
    });
    expect(rates.storeCategories.most).toMatchObject({
      firstRateBps: 1270,
      breakpoint: 250_000,
      secondRateBps: 235,
    });
    expect(rates.storeCategories['books-media'].firstRateBps).toBe(1530);
    expect(rates.storeCategories.collectibles.firstRateBps).toBe(1235);
    expect(rates.storeCategories.jewelry).toMatchObject({
      firstRateBps: 1300,
      breakpoint: 500_000,
      secondRateBps: 700,
      mode: 'switch',
    });
    expect(rates.storeCategories.guitars.firstRateBps).toBe(670);
  });

  it('flags source drift without replacing the pinned calculation profile', async () => {
    const fetcher = (async (url: string | URL | Request) => {
      const address = String(url);
      if (address.includes('360035902374')) {
        return new Response(JSON.stringify({ article: { body: '<p>flat rate charge of $0.20 USD per listing. Etsy charges 7% of the total order amount.</p>' } }), { status: 200 });
      }
      if (address.includes('115015628847')) {
        return new Response(JSON.stringify({ article: { body: '<p>United States 3% + 0.25 USD</p>' } }), { status: 200 });
      }
      if (address.includes('115014483627')) {
        return new Response(JSON.stringify({ article: { body: '<p>less than $10,000, 15% fee. at least $10,000, 12%. Offsite Ad fee will never exceed $100.</p>' } }), { status: 200 });
      }
      return new Response('unavailable', { status: 503 });
    }) as typeof fetch;

    const schedule = await fetchCurrentFeeSchedule(fetcher);
    expect(schedule.sourceStatus.etsy).toBe('review');
    expect(schedule.sourceMessages.etsy).toContain('kept the pinned profile');
    expect(schedule.etsy).toEqual(DEFAULT_FEE_SCHEDULE.etsy);
    expect(schedule.etsy.transactionRateBps).toBe(650);
  });
});
