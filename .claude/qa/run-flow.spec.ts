import { test, expect, type Page } from '@playwright/test';

const pick = async (page: Page, models: string[]) => {
  for (const m of models) await page.getByRole('checkbox', { name: new RegExp(`^${m}\\b`) }).check();
  await page.getByRole('checkbox', { name: /^std-reasoning-math\b/ }).check();
};

test('[AC-3.1] two models and a benchmark: estimate, run, progress, report with an equivalent verdict', async ({ page }) => {
  await page.goto('/compare/');
  await expect(page.getByTestId('estimate')).toContainText('Pick two models');
  await pick(page, ['mock-a', 'mock-b']);
  await expect(page.getByTestId('estimate')).toContainText(/Estimate: 30 calls/);
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page).toHaveURL(/\/compare\/\?job=\w+/);
  await expect(page.getByRole('progressbar', { name: 'Progress' })).toBeVisible();
  const report = page.getByRole('region', { name: 'std-reasoning-math' });
  await expect(report).toBeVisible({ timeout: 30_000 });
  await expect(report.locator('[data-verdict="equivalent"]')).toBeVisible();
  await expect(page.getByRole('region', { name: /Comparison/ }).getByText('done', { exact: true })).toBeVisible();
});

test('[AC-3.1] a model that errors shows an incomplete verdict and its error reason', async ({ page }) => {
  await page.goto('/compare/');
  await pick(page, ['mock-a', 'mock-errors']);
  await page.getByRole('button', { name: 'Run comparison' }).click();
  const report = page.getByRole('region', { name: 'std-reasoning-math' });
  await expect(report.locator('[data-verdict="incomplete"]')).toBeVisible({ timeout: 30_000 });
  await expect(report).toContainText('provider unavailable');
});

test('[AC-3.2] cancel stops a running job and the status shows cancelled', async ({ page, request }) => {
  // use_cache:false so repeated QA runs against the same data dir stay slow enough to cancel
  const res = await request.post('/api/runs', { data: { targets: ['mock-a', 'mock-slow'], benchmarks: ['std-reasoning-math'], use_cache: false } });
  const { job_id } = await res.json();
  await page.goto(`/compare/?job=${job_id}`);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('[data-verdict="cancelled"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
});

test('[AC-3.5] loading while the job is fetched', async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  await page.route('**/api/jobs/nojob', async (route) => { await gate; await route.fulfill({ status: 404, json: { detail: 'unknown job' } }); });
  await page.goto('/compare/?job=nojob');
  await expect(page.getByRole('status')).toContainText('Loading job');
  release();
  await expect(page.locator('[data-state="error"]')).toContainText('unknown job');
});

test('[AC-3.5] no targets configured is an empty state', async ({ page }) => {
  await page.route('**/api/targets', (route) => route.fulfill({ json: [] }));
  await page.goto('/compare/');
  await expect(page.getByRole('heading', { name: 'No targets configured' })).toBeVisible();
});
