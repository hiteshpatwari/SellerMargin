import { describe, expect, it, vi } from 'vitest';
import worker, { renderRouteHtml, sanitizeAnalyticsEvent, type Env } from './index';

const baseHtml = `<!doctype html><html><head>
  <meta name="description" content="default" />
  <meta property="og:title" content="default" />
  <meta property="og:description" content="default" />
  <meta property="og:url" content="/" />
  <meta property="og:image" content="/og-v4.png" />
  <meta name="twitter:title" content="default" />
  <meta name="twitter:description" content="default" />
  <meta name="twitter:image" content="/og-v4.png" />
  <link rel="canonical" href="/" />
  <title>default</title>
  <script id="route-schema" type="application/ld+json">{}</script>
</head><body><div id="root"></div></body></html>`;

function assets(): Env['ASSETS'] {
  return {
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/' || pathname === '/index.html') {
        return new Response(baseHtml, { headers: { 'content-type': 'text/html' } });
      }
      return new Response('Not found', { status: 404 });
    },
  };
}

describe('route-aware Worker responses', () => {
  it('renders crawlable route metadata with absolute canonical and social URLs', () => {
    const html = renderRouteHtml(baseHtml, 'https://sellermargin.example/etsy-fee-calculator', '/etsy-fee-calculator');
    expect(html).toContain('<title>Etsy US fee calculator | SellerMargin</title>');
    expect(html).toContain('href="https://sellermargin.example/etsy-fee-calculator"');
    expect(html).toContain('content="https://sellermargin.example/og-v4.png"');
    expect(html).toContain('Itemize verified Etsy US');
  });

  it('serves known calculator routes with security headers and unknown routes as real 404s', async () => {
    const known = await worker.fetch(
      new Request('https://sellermargin.example/ebay-profit-calculator', { headers: { accept: 'text/html' } }),
      { ASSETS: assets() },
    );
    expect(known.status).toBe(200);
    expect(known.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(known.headers.get('strict-transport-security')).toContain('max-age=31536000');
    expect(await known.text()).toContain('eBay profit calculator | SellerMargin');

    const head = await worker.fetch(
      new Request('https://sellermargin.example/ebay-profit-calculator', { method: 'HEAD' }),
      { ASSETS: assets() },
    );
    expect(head.status).toBe(200);
    expect(head.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(await head.text()).toBe('');

    const missing = await worker.fetch(
      new Request('https://sellermargin.example/not-a-page', { headers: { accept: 'text/html' } }),
      { ASSETS: assets() },
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('uses the root HTML asset when Cloudflare canonicalizes an extensionless route', async () => {
    const redirectingAssets: Env['ASSETS'] = {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (pathname === '/') return new Response(baseHtml, { headers: { 'content-type': 'text/html' } });
        return new Response(null, {
          status: 200,
          headers: { 'content-type': 'text/html', location: '/' },
        });
      },
    };
    const response = await worker.fetch(
      new Request('https://sellermargin.example/etsy-fee-calculator', { headers: { accept: 'text/html' } }),
      { ASSETS: redirectingAssets },
    );
    expect(response.status).toBe(200);
    expect(response.headers.has('location')).toBe(false);
    expect(await response.text()).toContain('Etsy US fee calculator | SellerMargin');
  });

  it('generates sitemap and robots URLs from the active hostname', async () => {
    const env = { ASSETS: assets() };
    const sitemap = await worker.fetch(new Request('https://sellermargin.example/sitemap.xml'), env);
    expect(await sitemap.text()).toContain('https://sellermargin.example/etsy-fee-calculator');
    const robots = await worker.fetch(new Request('https://sellermargin.example/robots.txt'), env);
    expect(await robots.text()).toContain('Sitemap: https://sellermargin.example/sitemap.xml');
  });
});

describe('privacy-safe product events', () => {
  it('keeps only the allowed coarse event fields', () => {
    expect(sanitizeAnalyticsEvent({
      event: 'decision_tool_selected',
      route: '/pricing-calculator',
      marketplace: 'etsy',
      tool: 'pricing',
      sellingPrice: 9_999,
      productName: 'Private product',
    })).toEqual({
      event: 'decision_tool_selected',
      route: '/pricing-calculator',
      marketplace: 'etsy',
      tool: 'pricing',
    });
    expect(sanitizeAnalyticsEvent({ event: 'unknown', route: '/' })).toBeNull();
  });

  it('accepts same-origin valid events and rejects cross-origin submissions', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const valid = await worker.fetch(new Request('https://sellermargin.example/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://sellermargin.example' },
      body: JSON.stringify({ event: 'profit_pack_interest', route: '/', marketplace: 'etsy' }),
    }), { ASSETS: assets() });
    expect(valid.status).toBe(204);
    expect(info).toHaveBeenCalledWith('SELLERMARGIN_EVENT', '{"event":"profit_pack_interest","route":"/","marketplace":"etsy"}');
    info.mockRestore();

    const forbidden = await worker.fetch(new Request('https://sellermargin.example/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://malicious.example' },
      body: JSON.stringify({ event: 'calculator_view', route: '/' }),
    }), { ASSETS: assets() });
    expect(forbidden.status).toBe(403);
  });
});
