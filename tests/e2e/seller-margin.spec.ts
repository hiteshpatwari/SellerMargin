import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/events', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });
});

test('a new seller can understand the first screen and calculate without signing in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Know what you make. Know what to charge.');
  await expect(page.getByText('Three numbers get you started')).toBeVisible();
  await expect(page.getByRole('link', { name: /sign in|log in/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /sign in|log in/i })).toHaveCount(0);

  await page.getByLabel('Selling price').fill('35');
  await page.getByLabel('What it costs to make').fill('9');
  await expect(page.getByText('You keep', { exact: true })).toBeVisible();
  await expect(page.getByText(/of every \$1/)).toBeVisible();
  await expect(page.getByText('Marketplace fee breakdown')).toBeVisible();
});

test('eBay refuses to guess and becomes actionable after required seller details are selected', async ({ page }) => {
  await page.goto('/ebay-profit-calculator');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('eBay fees');
  await expect(page.getByRole('heading', { name: 'Answer the marketplace questions', exact: true })).toBeVisible();
  await page.getByLabel('eBay Store plan').selectOption('no-store');
  await page.getByLabel('eBay category fee group').selectOption('most');
  await page.getByLabel('Seller status shown in your eBay dashboard').selectOption('meeting');
  await expect(page.getByText('You keep', { exact: true })).toBeVisible();
  await expect(page.getByText(/final value fee/i).first()).toBeVisible();
});

test('the fee-details dialog traps focus, closes with Escape, and restores focus', async ({ page }) => {
  await page.goto('/etsy-fee-calculator');
  const trigger = page.getByRole('button', { name: 'Fee details' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: /Etsy fee details/ });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close fee assumptions' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('mobile layout has no horizontal overflow and keeps onboarding guidance visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByText('Three numbers get you started')).toBeVisible();
  const dimensions = await page.locator('body').evaluate((body) => ({
    clientWidth: body.clientWidth,
    scrollWidth: body.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});

test('critical pages have no serious WCAG A or AA violations', async ({ page }) => {
  for (const route of ['/', '/etsy-fee-calculator', '/ebay-fee-calculator']) {
    await page.goto(route);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const serious = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''));
    expect(serious, `${route}: ${serious.map((item) => `${item.id} (${item.nodes.length})`).join(', ')}`).toEqual([]);
  }
});

test('the paid-tool interest event contains no financial or product data', async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await page.unroute('**/api/events');
  await page.route('**/api/events', async (route) => {
    payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 204, body: '' });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /consider this for \$7/i }).click();
  await expect(page.getByText(/your interest was counted/i)).toBeVisible();
  expect(payload).toEqual({ event: 'profit_pack_interest', route: '/', marketplace: 'etsy' });
  expect(payload).not.toHaveProperty('sellingPrice');
  expect(payload).not.toHaveProperty('profit');
  expect(payload).not.toHaveProperty('productName');
});
