# SellerMargin

SellerMargin is a marketplace profit and pricing calculator for independent sellers. It combines marketplace fees, product costs, fulfillment, advertising, and pricing scenarios in one clear workspace.

## Included in this foundation

- Reactive profit calculator for Etsy, eBay, Direct Sale, and Custom marketplaces
- Live official-source fee checks with a versioned marketplace adapter boundary
- Inspectable fee breakdowns with verification metadata and official sources
- Target-margin and target-profit reverse pricing
- Discount, break-even discount, free-shipping, and monthly-income scenarios
- Local draft and saved-product persistence
- Responsive marketplace-specific calculator routes and baseline structured data
- Installable/offline-ready application shell
- Sites-compatible Cloudflare Worker output and social preview metadata
- Regression tests for rounding, fee bases, source parsing, boundary conditions, and scenarios

## Run locally

```bash
pnpm install
pnpm dev
```

Then open `http://localhost:5173`.

## Validate

```bash
pnpm test
pnpm test:live-fees
pnpm test:e2e
pnpm lint
pnpm exec tsc --noEmit
pnpm build
pnpm build:cloudflare
```

`pnpm test` is deterministic and uses controlled source-page fixtures. `pnpm test:live-fees` is the network contract test: it fetches and parses the current Etsy fee articles, eBay standard selling-fee page, and eBay Store selling-fee page, then fails if the published values or page structure no longer match the supported schedule.

## Architecture

The UI lives in `src/App.tsx`. Financial logic is isolated under `src/domain`:

- `engine.ts` composes revenue, fees, costs, profit, margin, and reverse-pricing solvers.
- `fees/adapters.ts` contains marketplace-specific calculations behind a common interface.
- `fees/verified-us.json` contains the latest verified fallback data, separate from calculation code.
- `fees/config.ts` provides official source metadata and readable fee summaries.
- `scenarios.ts` transforms a base transaction and calls the same calculation engine.
- `worker/fee-sources.ts` reads supported U.S. rates from official Etsy articles plus the eBay standard and Store fee pages with strict validation.
- `worker/index.ts` refreshes and caches the fee schedule, serves the Vite client bundle from Sites, and falls back to `index.html` for functional routes.

All monetary inputs and outputs use integer cents internally. Percentage rates use basis points.

## Marketplace fee schedule

The application checks the official Etsy and eBay fee pages and uses refreshed rates when all required values pass validation. If a source is unavailable or changes format, calculations continue with the latest verified U.S. fallback schedule and the interface clearly labels that state. Marketplace fees still vary by country, plan, category, tax treatment, seller performance, and optional services.

## Deployment

The repository supports two Cloudflare-backed deployment paths:

- Sites uses `.openai/hosting.json` and the Sites-compatible Worker bundle emitted by `pnpm build`.
- Standalone Cloudflare Workers uses `wrangler.jsonc`; validate locally with `pnpm build:cloudflare`, run with `pnpm cloudflare:dev`, and deploy with `pnpm cloudflare:deploy`.

The Worker serves functional calculator routes through `index.html`, returns genuine `404` responses for unknown routes, and generates canonical metadata, `robots.txt`, and `sitemap.xml` from the public request origin. It does not include an application login or depend on a ChatGPT session.

The optional `/api/events` endpoint records only an enumerated event name, calculator route, marketplace, and decision tool. Prices, costs, product names, profit figures, and other calculator inputs are never included in these events.
