import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FAKE = 'sk-test-000000000000a1b2';
const group = (page: Page, id: string) => page.locator(`[data-group="${id}"]`);
const model = (page: Page, id: string) => page.getByRole('checkbox', { name: id, exact: true });
const bare = { var: 'X', key_ok: false, reason: 'no key', models: [] };
const none = { providers: ['anthropic', 'openai'].map((provider) => ({ provider, ...bare })), cached_at: '2026-01-01T00:00:00+00:00' };

// Catalog fixtures only answer for providers whose key is set; the key is fake and removed again.
test.beforeEach(async ({ request }) => {
  await request.put('/api/settings/keys/openai', { data: { value: FAKE } });
});
test.afterEach(async ({ request }) => {
  await request.delete('/api/settings/keys/openai');
});

test('[AC-6.1] providers are listed, expand to models with price and context, and a keyless one links to Settings', async ({ page }) => {
  await page.goto('/models/');
  const openai = group(page, 'openai');
  await expect(openai).toBeVisible();
  await expect(openai.locator('.chip')).toHaveText('key set');
  const toggle = openai.getByRole('button', { name: /openai/i });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(model(page, 'openai/gpt-4o-mini')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const row = openai.locator('li', { has: model(page, 'openai/gpt-4o-mini') });
  await expect(row).toContainText('$');
  await expect(row).toContainText(/\d+k|\d\.\dM/);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  const anthropic = group(page, 'anthropic');
  await expect(anthropic.locator('.chip')).toHaveText('no key');
  await anthropic.getByRole('link', { name: 'Add key' }).click();
  await expect(page).toHaveURL(/\/settings\/$/);
});

test('[AC-6.2] two checked models open /compare preselected and a run starts with them', async ({ page }) => {
  await page.goto('/models/');
  await expect(page.getByRole('button', { name: 'Compare selected' })).toHaveCount(0);
  await model(page, 'mock-a').check();
  await model(page, 'mock-b').check();
  await expect(page.getByTestId('selection-bar')).toContainText('2 selected');
  await page.reload();
  await expect(model(page, 'mock-b')).toBeChecked();
  await page.getByRole('link', { name: 'Compare selected' }).click();
  await expect(page).toHaveURL(/\/compare\/\?targets=mock-a%2Cmock-b$/);
  await expect(page.getByRole('checkbox', { name: /^mock-a\b/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^mock-b\b/ })).toBeChecked();
  await page.getByRole('checkbox', { name: /^std-reasoning-math\b/ }).check();
  await expect(page.getByTestId('estimate')).toContainText(/Estimate: 30 calls/);
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page).toHaveURL(/\/compare\/\?job=\w+/);
  await expect(page.getByRole('region', { name: 'std-reasoning-math' })).toBeVisible({ timeout: 30_000 });
});

test('[AC-6.2] a catalog model arrives preselected on /compare (not run)', async ({ page }) => {
  await page.goto('/models/');
  await group(page, 'openai').getByRole('button', { name: /openai/i }).click();
  await model(page, 'openai/gpt-4o-mini').check();
  await page.getByRole('link', { name: 'Compare selected' }).click();
  await expect(page).toHaveURL(/targets=openai%2Fgpt-4o-mini/);
  await expect(page.getByRole('checkbox', { name: /^openai\/gpt-4o-mini\b/ })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Run comparison' })).toBeDisabled();
});

test('[AC-6.3] the search box filters models by id across providers', async ({ page }) => {
  await page.goto('/models/');
  const search = page.getByRole('searchbox', { name: 'Search models' });
  await search.fill('GPT-4O');
  await expect(model(page, 'openai/gpt-4o')).toBeVisible();
  await expect(model(page, 'openai/gpt-4o-mini')).toBeVisible();
  await expect(group(page, 'configured')).toHaveCount(0);
  await expect(group(page, 'anthropic')).toHaveCount(0);
  await search.fill('mock-b');
  await expect(model(page, 'mock-b')).toBeVisible();
  await expect(model(page, 'mock-a')).toHaveCount(0);
  await expect(group(page, 'openai')).toHaveCount(0);
  await search.fill('zzz-nothing');
  await expect(page.getByText('No models match')).toBeVisible();
  await search.fill('');
  await expect(group(page, 'configured')).toBeVisible();
});

test('[AC-6.4] loading state while the catalog is fetched', async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  await page.route('**/api/models*', async (route) => { await gate; await route.continue(); });
  await page.goto('/models/');
  await expect(page.getByRole('status')).toContainText('Loading models');
  release();
  await expect(group(page, 'configured')).toBeVisible();
});

test('[AC-6.4] empty state links to Settings when there are no keys and no targets', async ({ page }) => {
  await page.route('**/api/models*', (route) => route.fulfill({ json: none }));
  await page.route('**/api/targets/status', (route) => route.fulfill({ json: [] }));
  await page.goto('/models/');
  await expect(page.getByRole('heading', { name: 'No models yet' })).toBeVisible();
  await expect(page.locator('[data-state="empty"]').getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings/');
});

test('[AC-6.4] error state with retry when the API is down', async ({ page }) => {
  let down = true;
  await page.route('**/api/models*', (route) => (down ? route.abort() : route.continue()));
  await page.goto('/models/');
  await expect(page.locator('[data-state="error"]')).toContainText('Could not load models');
  down = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(group(page, 'configured')).toBeVisible();
});

test('[AC-6.4] a provider that fails shows its error with a retry that refetches', async ({ page }) => {
  const failing = { ...none, providers: [{ provider: 'openai', var: 'X', key_ok: false, error: 'HTTP 401', models: [] }] };
  const urls: string[] = [];
  await page.route('**/api/models*', (route) => {
    urls.push(route.request().url());
    return route.fulfill({ json: urls.length === 1 ? failing : { ...none, providers: [{ provider: 'openai', var: 'X', key_ok: true, models: [{ id: 'gpt-x', target: 'openai/gpt-x', context: 8000, price_in: 1, price_out: 2 }] }] } });
  });
  await page.goto('/models/');
  const openai = group(page, 'openai');
  await expect(openai).toContainText('HTTP 401');
  await openai.getByRole('button', { name: 'Retry' }).click();
  await expect(openai.locator('.chip')).toHaveText('key set');
  expect(urls[1]).toContain('refresh=1');
});

test('[AC-6.1] screenshots: collapsed, expanded, no-key row, search', async ({ page }) => {
  const dir = join(process.cwd(), '.claude/artifacts/screenshots/6');
  mkdirSync(dir, { recursive: true });
  for (const w of [1280, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto('/models/');
    await expect(group(page, 'openai')).toBeVisible();
    await page.screenshot({ path: join(dir, `models-collapsed-${w}.png`), fullPage: true });
    await group(page, 'openai').getByRole('button', { name: /openai/i }).click();
    await model(page, 'openai/gpt-4o').check();
    await page.screenshot({ path: join(dir, `models-expanded-${w}.png`), fullPage: true });
    await group(page, 'anthropic').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(dir, `models-nokey-${w}.png`) });
    await page.getByRole('searchbox', { name: 'Search models' }).fill('mini');
    await page.screenshot({ path: join(dir, `models-search-${w}.png`), fullPage: true });
  }
});
