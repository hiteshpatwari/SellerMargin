import type { MarketplaceId } from './domain/types';

export type RouteToolId = 'pricing' | 'discount' | 'shipping' | 'ads' | 'goal';

export interface RouteContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  description: string;
  marketplace?: MarketplaceId;
  tool?: RouteToolId;
  guideTitle: string;
  guideItems: Array<{ title: string; explanation: string }>;
}

export const ROUTE_CONTENT: Record<string, RouteContent> = {
  '/': {
    eyebrow: 'Profit and pricing for independent sellers',
    title: 'Know what you make. Know what to charge.',
    subtitle:
      'Enter one sale, add the costs you actually pay, and see what you keep after marketplace fees, shipping, ads, and discounts.',
    description:
      'Calculate marketplace fees, seller costs, transaction profit, profit margin, and the price needed to reach your goal.',
    guideTitle: 'Three numbers get you started',
    guideItems: [
      { title: '1. Selling price', explanation: 'What the buyer pays for the item before sales tax.' },
      { title: '2. Your costs', explanation: 'What you pay for the product, materials, packaging, and shipping.' },
      { title: '3. What you keep', explanation: 'Your sale revenue after marketplace fees and the costs you entered.' },
    ],
  },
  '/etsy-profit-calculator': {
    eyebrow: 'Free Etsy profit calculator',
    title: 'See what you keep from an Etsy sale.',
    subtitle:
      'Enter your price and costs, then compare an organic sale with a sale attributed to Etsy Offsite Ads.',
    description:
      'Calculate Etsy US fees, product costs, shipping, profit, margin, target price, discounts, and Offsite Ads economics.',
    marketplace: 'etsy',
    guideTitle: 'What Etsy sellers need to enter',
    guideItems: [
      { title: 'Listing fee', explanation: 'Etsy charges a fee when a listing is created or renewed.' },
      { title: 'Transaction and payment fees', explanation: 'Percentage and payment fees based on the order amount.' },
      { title: 'Offsite Ads', explanation: 'Choose this only when Etsy says the order was attributed to an Offsite Ad.' },
    ],
  },
  '/etsy-fee-calculator': {
    eyebrow: 'Etsy US fee calculator',
    title: 'See every Etsy fee in the total.',
    subtitle: 'Itemize the listing, transaction, Etsy Payments, and applicable Offsite Ads fees for one U.S. order.',
    description:
      'Itemize verified Etsy US listing, transaction, payment-processing, shipping-related, and Offsite Ads fees.',
    marketplace: 'etsy',
    guideTitle: 'Etsy fee terms in plain language',
    guideItems: [
      { title: 'Fee base', explanation: 'The order amount Etsy uses when applying a percentage fee.' },
      { title: 'Organic sale', explanation: 'An order that Etsy did not attribute to an Offsite Ad.' },
      { title: 'Offsite Ads tier', explanation: 'The rate Etsy assigns based on your shop revenue in the last 365 days.' },
    ],
  },
  '/ebay-profit-calculator': {
    eyebrow: 'Free eBay profit calculator',
    title: 'See what remains after eBay fees and your costs.',
    subtitle:
      'Choose the exact supported fee group, Store plan, seller status, and ad source before calculating profit.',
    description:
      'Calculate supported eBay US fees, shipping, seller costs, promoted listing fees, profit, margin, and target price.',
    marketplace: 'ebay',
    guideTitle: 'Why eBay asks a few more questions',
    guideItems: [
      { title: 'Store plan', explanation: 'Your eBay Store subscription can change category and insertion fees.' },
      { title: 'Category fee group', explanation: 'eBay percentages vary by product category and price threshold.' },
      { title: 'Seller status', explanation: 'Some dashboard performance statuses add a seller-level surcharge.' },
    ],
  },
  '/ebay-fee-calculator': {
    eyebrow: 'eBay US fee calculator',
    title: 'Resolve the right eBay fee rules first.',
    subtitle: 'SellerMargin asks for the eBay details that affect the fee instead of guessing a universal percentage.',
    description:
      'Itemize supported eBay US final value, per-order, insertion, seller-status, and promoted-listing fees.',
    marketplace: 'ebay',
    guideTitle: 'eBay fee terms in plain language',
    guideItems: [
      { title: 'Final value fee', explanation: 'eBay’s percentage fee on the total sale amount used by its rules.' },
      { title: 'Insertion fee', explanation: 'A listing fee that may apply after your monthly free-listing allowance.' },
      { title: 'Promoted Listing fee', explanation: 'An ad fee only when eBay attributes the sale to an eligible campaign.' },
    ],
  },
  '/pricing-calculator': {
    eyebrow: 'Target price calculator',
    title: 'Find the price that reaches your profit goal.',
    subtitle: 'Choose how much of each sale you want to keep, or enter a dollar-profit goal, and work backward.',
    description: 'Calculate the minimum selling price needed for a target profit margin or target dollar profit.',
    tool: 'pricing',
    guideTitle: 'Two ways to set a price goal',
    guideItems: [
      { title: 'Profit margin goal', explanation: 'The percentage of sale revenue you want left after entered fees and costs.' },
      { title: 'Dollar-profit goal', explanation: 'The exact number of dollars you want to keep from each sale.' },
      { title: 'Minimum price', explanation: 'The lowest whole-cent price that satisfies the selected goal.' },
    ],
  },
  '/discount-calculator': {
    eyebrow: 'Sale discount calculator',
    title: 'Know what a discount costs before you run it.',
    subtitle: 'Compare regular-price profit with a sale and see the largest discount your goal can support.',
    description: 'Test sale discounts, profit reduction, break-even discount, and target-margin-safe discount levels.',
    tool: 'discount',
    guideTitle: 'Read the discount results',
    guideItems: [
      { title: 'Profit reduction', explanation: 'How many fewer dollars you keep from each discounted sale.' },
      { title: 'Extra sales needed', explanation: 'Approximate added volume needed to recover the lost profit.' },
      { title: 'Safe discount', explanation: 'The largest discount that still preserves your selected profit margin goal.' },
    ],
  },
  '/free-shipping-calculator': {
    eyebrow: 'Free shipping calculator',
    title: 'See what free shipping does to your profit.',
    subtitle: 'Compare buyer-paid shipping with absorbing the shipping cost, then find the price that protects your goal.',
    description: 'Compare paid and free shipping profit, margin, and the price needed to preserve your economics.',
    tool: 'shipping',
    guideTitle: 'Free shipping is still a seller cost',
    guideItems: [
      { title: 'Shipping paid by buyer', explanation: 'The shipping amount added to the customer’s order.' },
      { title: 'Shipping you pay', explanation: 'What the carrier charges you to send the order.' },
      { title: 'Price that preserves margin', explanation: 'The item price needed after you absorb shipping.' },
    ],
  },
  '/craft-pricing-calculator': {
    eyebrow: 'Craft pricing calculator',
    title: 'Turn making costs into a sustainable selling price.',
    subtitle: 'Add materials, optional labor, packaging, shipping, and marketplace fees before choosing a price.',
    description: 'Price handmade products using materials, labor, packaging, shipping, marketplace fees, and a profit goal.',
    marketplace: 'etsy',
    tool: 'pricing',
    guideTitle: 'Start with the costs you can verify',
    guideItems: [
      { title: 'Materials and labor', explanation: 'Combine the making costs you want this sale to recover.' },
      { title: 'Packaging and shipping', explanation: 'Include both the packing materials and the carrier charge.' },
      { title: 'Profit goal', explanation: 'Choose the amount or percentage you want left after those costs.' },
    ],
  },
  '/profit-margin-calculator': {
    eyebrow: 'Profit margin calculator',
    title: 'See how much of each sale you keep.',
    subtitle: 'Profit margin turns your dollar profit into a percentage that is easier to compare across products.',
    description: 'Calculate transaction profit margin after marketplace fees, materials, fulfillment, ads, and other costs.',
    guideTitle: 'Profit and margin answer different questions',
    guideItems: [
      { title: 'Profit', explanation: 'The number of dollars left from this sale after entered fees and costs.' },
      { title: 'Profit margin', explanation: 'The percentage of sale revenue represented by that profit.' },
      { title: 'Transaction estimate', explanation: 'This is not income tax, accounting income, or a demand forecast.' },
    ],
  },
};

export const ROUTE_PATHS = Object.keys(ROUTE_CONTENT);

export function getRouteContent(pathname: string): RouteContent {
  return ROUTE_CONTENT[pathname] ?? ROUTE_CONTENT['/'];
}

export function isKnownRoute(pathname: string): boolean {
  return Object.hasOwn(ROUTE_CONTENT, pathname);
}
