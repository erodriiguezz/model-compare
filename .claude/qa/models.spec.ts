import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FAKE = 'sk-test-000000000000a1b2';
const group = (page: Page, id: string) => page.locator(`[data-group="${id}"]`);
// The accessible name is the id followed by muted detail (the yaml model, or price and context on narrow screens).
const model = (page: Page, id: string) => page.getByRole('checkbox', { name: new RegExp(`^${id.replace(/[/.-]/g, '\\$&')}(\\s|$)`) });
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

  const nokey = group(page, 'no-key');
  await expect(nokey).toContainText('Anthropic');
  await expect(nokey).toContainText('Together AI');
  await expect(group(page, 'anthropic')).toHaveCount(0);
  await nokey.getByRole('link', { name: 'Add keys' }).click();
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

const status = (rows: object[]) => (page: Page) => page.route('**/api/targets/status', (route) => route.fulfill({ json: rows }));
const yaml = [{ name: 'mock-a', model: 'mock/a', kind: 'mock', keys_ok: true }, { name: 'nokey', model: 'openai/x', kind: 'litellm', keys_ok: false, missing_keys: ['X_KEY'] }];

test('[AC-6.1] disclosure buttons control their list and searching shows a plain header', async ({ page }) => {
  await page.goto('/models/');
  const toggle = group(page, 'openai').getByRole('button', { name: /OpenAI/ });
  await expect(toggle).toHaveAttribute('aria-controls', 'openai-models');
  await toggle.click();
  await expect(page.locator('#openai-models')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search models' }).fill('gpt');
  await expect(group(page, 'openai').getByRole('button')).toHaveCount(0);
});

test('[AC-6.1] the pass rate sums the latest done run per model and benchmark', async ({ page }) => {
  const run = (id: number, benchmark_name: string, status: string, passed: number) => ({ id, target_name: 'mock-a', benchmark_name, status, n_results: 10, passed, n_errors: 0, cost_usd: 0 });
  await page.route('**/api/runs', (route) => route.fulfill({ json: [run(1, 'b1', 'done', 10), run(2, 'b1', 'done', 0), run(3, 'b2', 'budget_exceeded', 5), run(4, 'b3', 'failed', 10)] }));
  await page.goto('/models/');
  await expect(page.locator('li', { has: model(page, 'mock-a') })).toContainText('25%');
});

test('[AC-6.2] selection: unknown and keyless ids are dropped once loaded, and Clear empties it', async ({ page }) => {
  await status(yaml)(page);
  await page.goto('/models/?sel=mock-a,nokey,ghost%2Fid');
  await expect(page.getByTestId('selection-bar')).toContainText('1 selected');
  await expect(page.getByRole('status').filter({ hasText: 'selected' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  await expect(page).toHaveURL(/\/models\/$/);
});

test('[AC-6.4] a failed retry says so inline', async ({ page }) => {
  let n = 0;
  await page.route('**/api/models*', (route) => (++n === 1
    ? route.fulfill({ json: { ...none, providers: [{ provider: 'openai', var: 'X', key_ok: false, error: 'HTTP 500', models: [] }] } }) : route.abort()));
  await page.goto('/models/');
  await group(page, 'openai').getByRole('button', { name: 'Retry' }).click();
  await expect(group(page, 'openai')).toContainText('Retry failed');
});

test('[AC-6.2] From Models rows show key status, can be unchecked, and keyless yaml targets are dropped', async ({ page }) => {
  await status(yaml)(page);
  const t = encodeURIComponent('mock-a,nokey,openai/gpt-4o-mini,anthropic/claude-x,zz/nothing');
  await page.goto(`/compare/?targets=${t}`);
  const from = page.getByRole('group', { name: 'From Models' });
  await expect(from.getByRole('checkbox', { name: /^openai\/gpt-4o-mini/ })).toBeChecked();
  await expect(from.getByRole('checkbox', { name: /^anthropic\/claude-x/ })).toBeDisabled();
  await expect(from.getByRole('checkbox', { name: /^anthropic\/claude-x/ })).not.toBeChecked();
  await expect(from).toContainText('no key (ANTHROPIC_API_KEY)');
  await expect(from).toContainText('not in catalog');
  await expect(page.getByRole('checkbox', { name: /^nokey\b/ })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^mock-a\b/ })).toBeChecked();
  await from.getByRole('checkbox', { name: /^openai\/gpt-4o-mini/ }).uncheck();
  await expect(from.getByRole('checkbox', { name: /^openai\/gpt-4o-mini/ })).not.toBeChecked();
});

test('[AC-6.2] an unpriced model forces the cost confirmation (nothing runs)', async ({ page }) => {
  await page.route('**/api/runs/estimate', (route) => route.fulfill({ json: { usd: 0, judge_usd: 0, total_calls: 15, cached_calls: 0, minutes: 1, unpriced: ['openai/gpt-4o-mini'] } }));
  let started = false;
  await page.route('**/api/runs', (route) => { if (route.request().method() === 'POST') started = true; return route.fulfill({ json: [] }); });
  await page.goto('/compare/?targets=openai%2Fgpt-4o-mini');
  await page.getByRole('checkbox', { name: /^std-reasoning-math\b/ }).check();
  await page.getByRole('button', { name: 'Run comparison' }).click();
  const confirm = page.getByRole('group', { name: 'Confirm cost' });
  await expect(confirm).toContainText("cost unknown for openai/gpt-4o-mini \u2014 the budget cap can't be enforced for them");
  expect(started).toBe(false);
});

test('[AC-6.1] screenshots: collapsed, expanded, no-key row, search', async ({ page }) => {
  const dir = join(process.env.SDLC_OUT_DIR ?? '.', '..', 'screenshots', '6');
  mkdirSync(dir, { recursive: true });
  for (const w of [1280, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto('/models/');
    await expect(group(page, 'openai')).toBeVisible();
    await page.screenshot({ path: join(dir, `models-collapsed-${w}.png`), fullPage: true });
    await group(page, 'openai').getByRole('button', { name: /openai/i }).click();
    await model(page, 'openai/gpt-4o').check();
    await page.screenshot({ path: join(dir, `models-expanded-${w}.png`), fullPage: true });
    await group(page, 'no-key').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(dir, `models-nokey-${w}.png`) });
    await page.getByRole('searchbox', { name: 'Search models' }).fill('mini');
    await page.screenshot({ path: join(dir, `models-search-${w}.png`), fullPage: true });
  }
});
