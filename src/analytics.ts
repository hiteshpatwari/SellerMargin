import { isKnownRoute } from './route-content';
import type { MarketplaceId } from './domain/types';

export type AnalyticsEventName =
  | 'calculator_view'
  | 'calculator_completed'
  | 'marketplace_selected'
  | 'advanced_costs_opened'
  | 'fee_assumptions_opened'
  | 'decision_tool_selected'
  | 'profit_pack_interest';

export interface AnalyticsEventProperties {
  marketplace?: MarketplaceId;
  tool?: 'pricing' | 'discount' | 'shipping' | 'ads' | 'goal';
}

/**
 * Sends only an event name, route, and coarse UI selections. Financial inputs,
 * calculated results, product names, and saved products are intentionally excluded.
 */
export function trackEvent(
  event: AnalyticsEventName,
  properties: AnalyticsEventProperties = {},
): void {
  const route = isKnownRoute(window.location.pathname) ? window.location.pathname : '/';
  const body = JSON.stringify({ event, route, ...properties });

  void fetch('/api/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
    credentials: 'omit',
  }).catch(() => {
    // Measurement must never interrupt or delay the calculator.
  });
}
