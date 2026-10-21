import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.env.PWD ?? process.cwd(), '.claude', 'artifacts', 'screenshots', '34');
const shot = async (page: Page, name: string) => { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };
const ROUTES = [
  { path: '/compare/', active: 'Compare' },
  { path: '/history/', active: 'Compare' },
  { path: '/models/', active: 'Models' },
  { path: '/projects/', active: 'Projects' },
  { path: '/settings/', active: 'Settings' },
];
const job = (id: string, status: string, targets: string[]) => ({
  id, targets, baseline: targets[0], status, error: status === 'failed' ? 'OPENAI_API_KEY missing' : null, started_at: '2026-10-19T10:00:00',
  benchmarks: ['std-reasoning-math'], total_calls: 10, done_calls: 10, run_ids: [RUN_ID[id]], live: [],
});
const RUN_ID: Record<string, number> = { 'j-done': 1, 'j-cancel': 2, 'j-fail': 3 };
const RUNS = [1.25, 0.5, 0].map((cost_usd, i) => ({ id: i + 1, target_name: 'mock-a', benchmark_name: 'std-reasoning-math', status: 'done', n_results: 1, passed: 1, n_errors: 0, cost_usd }));
const JOBS = [job('j-done', 'done', ['claude-sonnet-5-5', 'gpt-6-sol']), job('j-cancel', 'cancelled', ['gemini-3-flash', 'mock-b']), job('j-fail', 'failed', ['mock-a', 'mock-b'])];

for (const width of [1280, 390]) {
  for (const { path, active } of ROUTES) {
    test(`[AC-34.1] ${path} top bar and no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(path);
      const nav = page.getByRole('navigation', { name: 'Main' });
      for (const label of ['Compare', 'Models', 'Projects', 'Settings']) await expect(nav.getByRole('link', { name: label })).toBeVisible();
      await expect(nav.locator('[aria-current="page"]')).toHaveText(active);
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim())).toBe('#17171a');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }
}

test('[AC-34.12] history lists models, outcome, spend and status; filter chips change the rows', async ({ page }) => {
  await page.route('**/api/jobs', (route) => route.fulfill({ json: JOBS }));
  await page.route('**/api/runs', (route) => route.fulfill({ json: RUNS }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/history/');
  const rows = page.getByRole('region', { name: 'Comparisons' }).locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('claude-sonnet-5-5');
  await expect(rows.first()).toContainText('gpt-6-sol');
  await expect(rows.first()).toContainText('Report ready');
  await expect(rows.first()).toContainText('$1.25');
  await expect(rows.first()).toContainText('Complete');
  await shot(page, 'history-1280');

  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: 'Partial or failed' }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('No report');
  await page.getByRole('button', { name: 'All' }).click();
  await expect(rows).toHaveCount(3);
  await page.getByRole('searchbox', { name: 'Search comparisons' }).fill('gemini');
  await expect(rows).toHaveCount(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'history-390');
});

test('[AC-34.12] clicking a history row opens /compare/?job=', async ({ page }) => {
  await page.route('**/api/jobs', (route) => route.fulfill({ json: JOBS }));
  await page.route('**/api/runs', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/jobs/j-done', (route) => route.fulfill({ status: 404, json: { detail: 'unknown job' } }));
  await page.goto('/history/');
  await page.getByRole('region', { name: 'Comparisons' }).locator('tbody tr').first().click();
  await expect(page).toHaveURL(/\/compare\/\?job=j-done$/);
});

test('[AC-34.15] history shows loading, then error with retry that refetches', async ({ page }) => {
  let down = true;
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  await page.route('**/api/jobs', async (route) => {
    await gate;
    return down ? route.fulfill({ status: 500, json: { detail: 'boom' } }) : route.fulfill({ json: JOBS });
  });
  await page.goto('/history/');
  await expect(page.getByRole('status')).toContainText('Loading history');
  release();
  const err = page.locator('[data-state="error"]');
  await expect(err).toContainText('Could not load history');
  await shot(page, 'history-error');
  down = false;
  await err.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('region', { name: 'Comparisons' }).locator('tbody tr')).toHaveCount(3);
});

test('[AC-34.15] history shows the empty state with a next step', async ({ page }) => {
  await page.route('**/api/jobs', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/runs', (route) => route.fulfill({ json: [] }));
  await page.goto('/history/');
  await expect(page.getByRole('heading', { name: 'No comparisons yet' })).toBeVisible();
  await shot(page, 'history-empty');
  await page.getByRole('link', { name: 'Start a comparison' }).click();
  await expect(page).toHaveURL(/\/compare\/$/);
});

test('[AC-34.1] screenshots of /compare/ at 1280 and 390', async ({ page }) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/compare/');
    await expect(page.getByRole('button', { name: 'Run comparison' })).toBeVisible();
    await shot(page, `compare-${width}`);
  }
});
