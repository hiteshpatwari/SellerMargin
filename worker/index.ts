import { getRouteContent, isKnownRoute, ROUTE_PATHS } from '../src/route-content';
import { fetchCurrentFeeSchedule } from './fee-sources';

export interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

const FEE_CACHE_MS = 6 * 60 * 60 * 1000;
const MAX_EVENT_BYTES = 2_048;
const EVENT_NAMES = new Set([
  'calculator_view',
  'calculator_completed',
  'marketplace_selected',
  'advanced_costs_opened',
  'fee_assumptions_opened',
  'decision_tool_selected',
  'profit_pack_interest',
]);
const MARKETPLACES = new Set(['etsy', 'ebay', 'direct', 'custom']);
const TOOLS = new Set(['pricing', 'discount', 'shipping', 'ads', 'goal']);

let cachedFeeSchedule: Awaited<ReturnType<typeof fetchCurrentFeeSchedule>> | null = null;
let feeCacheExpiresAt = 0;

function securityHeaders(headers = new Headers()): Headers {
  const next = new Headers(headers);
  next.set(
    'content-security-policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
  );
  next.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next.set('referrer-policy', 'strict-origin-when-cross-origin');
  next.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  next.set('x-content-type-options', 'nosniff');
  next.set('x-frame-options', 'DENY');
  next.set('cross-origin-opener-policy', 'same-origin');
  next.set('cross-origin-resource-policy', 'same-origin');
  return next;
}

function secureResponse(response: Response, overrides: ResponseInit = {}): Response {
  return new Response(response.body, {
    status: overrides.status ?? response.status,
    statusText: overrides.statusText ?? response.statusText,
    headers: securityHeaders(overrides.headers ? new Headers(overrides.headers) : response.headers),
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderRouteHtml(html: string, requestUrl: string, pathname: string): string {
  const route = getRouteContent(pathname);
  const origin = new URL(requestUrl).origin;
  const canonical = new URL(pathname, origin).toString();
  const image = new URL('/og-v4.png', origin).toString();
  const title = `${route.eyebrow} | SellerMargin`;
  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'SellerMargin',
    url: canonical,
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Any',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description: route.description,
  });

  return html
    .replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(title)}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*("\s*\/?>)/, `$1${escapeHtml(route.description)}$2`)
    .replace(/(<meta\s+property="og:title"\s+content=")[^"]*("\s*\/?>)/, `$1${escapeHtml(title)}$2`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*("\s*\/?>)/, `$1${escapeHtml(route.description)}$2`)
    .replace(/(<meta\s+property="og:url"\s+content=")[^"]*("\s*\/?>)/, `$1${escapeHtml(canonical)}$2`)
    .replace(/(<meta\s+property="og:image"\s+content=")[^"]*("\s*\/?>)/, `$1${escapeHtml(image)}$2`)
    .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*("\s*\/?>)/, `$1${escapeHtml(title)}$2`)
    .replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*("\s*\/?>)/, `$1${escapeHtml(route.description)}$2`)
    .replace(/(<meta\s+name="twitter:image"\s+content=")[^"]*("\s*\/?>)/, `$1${escapeHtml(image)}$2`)
    .replace(/(<link\s+rel="canonical"\s+href=")[^"]*("\s*\/?>)/, `$1${escapeHtml(canonical)}$2`)
    .replace(/<script id="route-schema" type="application\/ld\+json">.*?<\/script>/s, `<script id="route-schema" type="application/ld+json">${schema}</script>`);
}

async function feeScheduleResponse(): Promise<Response> {
  const now = Date.now();
  if (!cachedFeeSchedule || now >= feeCacheExpiresAt) {
    cachedFeeSchedule = await fetchCurrentFeeSchedule();
    feeCacheExpiresAt = now + FEE_CACHE_MS;
  }

  return new Response(JSON.stringify(cachedFeeSchedule), {
    headers: securityHeaders(new Headers({
      'cache-control': 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400',
      'content-type': 'application/json; charset=utf-8',
      'x-robots-tag': 'noindex',
    })),
  });
}

interface SafeEvent {
  event: string;
  route: string;
  marketplace?: string;
  tool?: string;
}

export function sanitizeAnalyticsEvent(value: unknown): SafeEvent | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.event !== 'string' || !EVENT_NAMES.has(candidate.event)) return null;
  if (typeof candidate.route !== 'string' || !isKnownRoute(candidate.route)) return null;
  if (candidate.marketplace !== undefined && (typeof candidate.marketplace !== 'string' || !MARKETPLACES.has(candidate.marketplace))) return null;
  if (candidate.tool !== undefined && (typeof candidate.tool !== 'string' || !TOOLS.has(candidate.tool))) return null;
  return {
    event: candidate.event,
    route: candidate.route,
    ...(candidate.marketplace ? { marketplace: candidate.marketplace } : {}),
    ...(candidate.tool ? { tool: candidate.tool } : {}),
  };
}

async function analyticsResponse(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: securityHeaders(new Headers({ allow: 'POST', 'cache-control': 'no-store' })),
    });
  }

  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return new Response('Forbidden', { status: 403, headers: securityHeaders() });
  }
  const length = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_EVENT_BYTES) {
    return new Response('Payload too large', { status: 413, headers: securityHeaders() });
  }
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return new Response('Unsupported media type', { status: 415, headers: securityHeaders() });
  }

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_EVENT_BYTES) {
      return new Response('Payload too large', { status: 413, headers: securityHeaders() });
    }
    const event = sanitizeAnalyticsEvent(JSON.parse(raw));
    if (!event) return new Response('Invalid event', { status: 400, headers: securityHeaders() });
    console.info('SELLERMARGIN_EVENT', JSON.stringify(event));
    return new Response(null, {
      status: 204,
      headers: securityHeaders(new Headers({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex' })),
    });
  } catch {
    return new Response('Invalid event', { status: 400, headers: securityHeaders() });
  }
}

function sitemapResponse(requestUrl: string): Response {
  const origin = new URL(requestUrl).origin;
  const urls = ROUTE_PATHS.map((path) => `<url><loc>${escapeHtml(new URL(path, origin).toString())}</loc></url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, {
    headers: securityHeaders(new Headers({ 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' })),
  });
}

function robotsResponse(requestUrl: string): Response {
  const origin = new URL(requestUrl).origin;
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`, {
    headers: securityHeaders(new Headers({ 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' })),
  });
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/fee-schedule') {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405, headers: securityHeaders(new Headers({ allow: 'GET' })) });
      }
      return feeScheduleResponse();
    }
    if (url.pathname === '/api/events') return analyticsResponse(request);
    if (url.pathname === '/sitemap.xml') return sitemapResponse(request.url);
    if (url.pathname === '/robots.txt') return robotsResponse(request.url);

    const isHeadRequest = request.method === 'HEAD';
    const assetRequest = isHeadRequest ? new Request(request, { method: 'GET' }) : request;
    const response = await env.ASSETS.fetch(assetRequest);
    if (request.method !== 'GET' && !isHeadRequest) return secureResponse(response);

    const contentType = response.headers.get('content-type') ?? '';
    if (response.status !== 404 && !contentType.includes('text/html')) return secureResponse(response);

    const accept = request.headers.get('accept') ?? '';
    const isDocumentRequest = contentType.includes('text/html')
      || accept.includes('text/html')
      || isKnownRoute(url.pathname)
      || !url.pathname.split('/').at(-1)?.includes('.');
    if (!isDocumentRequest) return secureResponse(response);

    // Cloudflare's asset binding may canonicalize `/index.html` or an unknown
    // extensionless path to `/` with an empty redirect-shaped response. Fetch
    // the root document directly for every non-root HTML route.
    const canUseAssetResponse = url.pathname === '/'
      && contentType.includes('text/html')
      && !response.headers.has('location');
    const indexResponse = canUseAssetResponse
      ? response
      : await env.ASSETS.fetch(new Request(new URL('/', request.url), assetRequest));
    const html = renderRouteHtml(await indexResponse.text(), request.url, url.pathname);
    const headers = new Headers(indexResponse.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'public, max-age=300');
    if (!isKnownRoute(url.pathname)) headers.set('x-robots-tag', 'noindex');
    return new Response(isHeadRequest ? null : html, {
      status: isKnownRoute(url.pathname) ? 200 : 404,
      headers: securityHeaders(headers),
    });
  },
};

export default worker;
