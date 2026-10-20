import { test, expect, type Page } from '@playwright/test';

const pick = async (page: Page, models: string[]) => {
  for (const m of models) await page.getByRole('checkbox', { name: new RegExp(`^${m}\\b`) }).check();
  await page.getByRole('checkbox', { name: /^std-reasoning-math\b/ }).check();
};

test('[AC-3.1] two models and a benchmark: estimate, run, progress updates, report with an equivalent verdict', async ({ page }) => {
  // Fresh calls (no cache) so a slow pair is still running when the page first polls.
  await page.route('**/api/runs', (route) => route.request().method() === 'POST'
    ? route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), use_cache: false }) }) : route.continue());
  await page.goto('/compare/');
  await expect(page.getByTestId('estimate')).toContainText('Pick two models');
  await pick(page, ['mock-a', 'mock-slow']);
  await expect(page.getByTestId('estimate')).toContainText(/Estimate: 30 calls/);
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page).toHaveURL(/\/compare\/\?job=\w+/);
  const job = page.getByRole('region', { name: /Comparison/ });
  await expect(job.locator('[data-verdict="running"]')).toBeVisible({ timeout: 10_000 });
  const bar = page.getByRole('progressbar', { name: 'Progress' });
  await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  const report = page.getByRole('region', { name: 'std-reasoning-math' });
  await expect(report).toBeVisible({ timeout: 30_000 });
  await expect(report.locator('[data-verdict="equivalent"]')).toBeVisible();
  await expect(job.locator('[data-verdict="done"]')).toBeVisible();
});

test('[AC-3.1] an unknown verdict renders as a muted chip with its raw text', async ({ page, request }) => {
  const { job_id } = await (await request.post('/api/runs', { data: { targets: ['mock-a', 'mock-b'], benchmarks: ['std-reasoning-math'] } })).json();
  await expect.poll(async () => (await (await request.get(`/api/jobs/${job_id}`)).json()).status, { timeout: 30_000 }).toBe('done');
  await page.route(`**/api/jobs/${job_id}/report`, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.benchmarks[0].comparisons[0].verdict = 'wobbly';
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(`/compare/?job=${job_id}`);
  await expect(page.locator('.chip.muted[data-verdict="wobbly"]')).toHaveText('wobbly');
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
