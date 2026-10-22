import { test, expect, type Page } from '@playwright/test';

const pick = async (page: Page, models: string[]) => {
  for (const m of models) await page.getByRole('checkbox', { name: new RegExp(`^${m}\\b`) }).check();
  await page.getByText('Choose individual benchmarks').click();
  await page.getByRole('checkbox', { name: /^std-reasoning-math\b/ }).check();
};

test('[AC-3.1] two models and a benchmark: estimate, run, progress updates, report with an equivalent verdict', async ({ page }) => {
  // Fresh calls (no cache) so a slow pair is still running when the page first polls.
  await page.route('**/api/runs', (route) => route.request().method() === 'POST'
    ? route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), use_cache: false }) }) : route.continue());
  await page.goto('/compare/');
  await expect(page.getByTestId('estimate')).toContainText('Pick a model');
  await pick(page, ['mock-a', 'mock-slow']);
  await expect(page.getByTestId('est-calls')).toHaveText('30');
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page).toHaveURL(/\/compare\/\?job=\w+/);
  const job = page.getByRole('region', { name: /Comparison/ });
  await expect(job.locator('[data-verdict="running"]')).toBeVisible({ timeout: 10_000 });
  const bar = page.getByRole('progressbar', { name: 'Progress' });
  await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  await page.getByText('Details', { exact: true }).click({ timeout: 30_000 }); // per-benchmark tables sit under Details since M7
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
  await page.getByText('Details', { exact: true }).click({ timeout: 30_000 }); // the per-benchmark tables sit under Details since M7
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
  await expect(page.getByRole('region', { name: /Comparison/ }).locator('[data-verdict="cancelled"]').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
});

test('[AC-3.3] past jobs are listed and opening one shows its report', async ({ page, request }) => {
  const res = await request.post('/api/runs', { data: { targets: ['mock-a', 'mock-b'], benchmarks: ['std-reasoning-math'] } });
  const { job_id } = await res.json();
  await expect.poll(async () => (await (await request.get(`/api/jobs/${job_id}`)).json()).status, { timeout: 30_000 }).toBe('done');
  await page.goto('/history/');
  await expect(page.getByRole('navigation', { name: 'Main' }).locator('[aria-current="page"]')).toHaveText('Compare');
  await expect(page.getByRole('navigation', { name: 'Compare sections' }).locator('[aria-current="page"]')).toHaveText('History');
  await expect(page.getByRole('heading', { name: 'Comparisons', exact: true })).toBeVisible();
  await page.locator(`a[href="/compare/?job=${job_id}"]`).click();
  await page.getByText('Details', { exact: true }).click({ timeout: 30_000 }); // per-benchmark tables sit under Details since M7
  await expect(page.getByRole('region', { name: 'std-reasoning-math' })).toBeVisible();
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

test('[AC-3.5] empty history links to a new run', async ({ page }) => {
  await page.route('**/api/jobs', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/runs', (route) => route.fulfill({ json: [] }));
  await page.goto('/history/');
  await expect(page.getByRole('heading', { name: 'No comparisons yet' })).toBeVisible();
  await page.getByRole('link', { name: 'Start a comparison' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Compare' })).toBeVisible();
});

test('[AC-3.5] history shows an error with retry when the API fails', async ({ page }) => {
  let down = true;
  await page.route('**/api/jobs', (route) => (down ? route.abort() : route.continue()));
  await page.goto('/history/');
  await expect(page.locator('[data-state="error"]')).toContainText('Could not load history');
  down = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Comparisons', exact: true })).toBeVisible();
});

test('[AC-3.5] no targets configured is an empty state', async ({ page }) => {
  await page.route('**/api/targets/status', (route) => route.fulfill({ json: [] }));
  await page.goto('/compare/');
  await expect(page.getByRole('heading', { name: 'No targets configured' })).toBeVisible();
});

test('[AC-3.3] history caps long lists and shows all on request', async ({ page }) => {
  const jobs = Array.from({ length: 30 }, (_, i) => ({ id: `j${i}`, targets: ['mock-a', 'mock-b'], baseline: 'mock-a', status: 'done', done_calls: 30, total_calls: 30, run_ids: [], benchmarks: ['std-reasoning-math'], started_at: '2026-10-19T10:00:00' }));
  await page.route('**/api/jobs', (route) => route.fulfill({ json: jobs }));
  await page.goto('/history/');
  const section = page.getByRole('region', { name: 'Comparisons' });
  const rows = section.locator('tbody tr');
  await expect(rows).toHaveCount(25);
  await section.getByRole('button', { name: 'Show all' }).click();
  await expect(rows).toHaveCount(30);
});

test('[AC-3.1] run options feed the estimate and the request, and a cost confirmation precedes a paid run', async ({ page }) => {
  await page.route('**/api/runs/estimate', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), usd: 2.5 } });
  });
  let sent: Record<string, unknown> = {};
  await page.route('**/api/runs', (route) => {
    if (route.request().method() === 'POST') sent = route.request().postDataJSON();
    return route.continue();
  });
  await page.goto('/compare/');
  await pick(page, ['mock-a', 'mock-b']);
  await page.getByLabel('Repeats').fill('2');
  await page.getByLabel('Budget per run (USD)').fill('5');
  await page.getByLabel('Parallel calls per model').fill('4');
  await page.getByRole('checkbox', { name: 'Reuse cached answers' }).uncheck();
  await expect(page.getByTestId('est-calls')).toHaveText('60');
  await page.getByRole('button', { name: 'Run comparison' }).click();
  const confirm = page.getByRole('group', { name: 'Confirm cost' });
  await expect(confirm).toContainText('may cost up to $2.50');
  await confirm.getByRole('button', { name: 'Back' }).click();
  await expect(confirm).toHaveCount(0);
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await page.getByRole('button', { name: 'Confirm and run' }).click();
  await expect(page).toHaveURL(/\/compare\/\?job=\w+/);
  expect(sent).toMatchObject({ repeats: 2, budget_usd: 5, concurrency: 4, use_cache: false });
});

test('[AC-3.1] a model without a key is shown disabled with "no key"', async ({ page }) => {
  await page.route('**/api/targets/status', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: [...body, { name: 'paid-x', model: 'openai/gpt-x', kind: 'litellm', keys_ok: false, missing_keys: ['OPENAI_API_KEY'] }] });
  });
  await page.goto('/compare/');
  await expect(page.getByRole('checkbox', { name: /^paid-x/ })).toBeDisabled();
  await expect(page.getByText('no key (OPENAI_API_KEY)')).toBeVisible();
});

test('[AC-3.3] the case explorer shows each case and the report links open the HTML and JSON', async ({ page, request }) => {
  const { job_id } = await (await request.post('/api/runs', { data: { targets: ['mock-a', 'mock-b'], benchmarks: ['std-reasoning-math'] } })).json();
  await expect.poll(async () => (await (await request.get(`/api/jobs/${job_id}`)).json()).status, { timeout: 30_000 }).toBe('done');
  await page.goto(`/history/?job=${job_id}`);
  await expect(page.getByRole('link', { name: 'Open report' })).toHaveAttribute('href', `/api/jobs/${job_id}/report.html`);
  await expect(page.getByRole('link', { name: 'JSON' })).toHaveAttribute('href', `/api/jobs/${job_id}/report`);
  const explorer = page.getByRole('region', { name: 'Case explorer' });
  await explorer.getByRole('button', { name: 'View cases' }).first().click();
  await expect(explorer.getByRole('cell', { name: 'pens-bulk' })).toBeVisible();
  await expect(explorer.getByText('score 0.00').first()).toBeVisible();
});

const slowJob = async (request: import('@playwright/test').APIRequestContext) =>
  (await (await request.post('/api/runs', { data: { targets: ['mock-a', 'mock-slow'], benchmarks: ['std-reasoning-math'], use_cache: false } })).json()).job_id as string;

test('[AC-3.1] one model gives a scorecard without a verdict', async ({ page }) => {
  await page.goto('/compare/');
  await pick(page, ['mock-a']);
  await expect(page.getByTestId('estimate')).toContainText('one model gives a scorecard; select two for a verdict');
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await page.getByText('Details', { exact: true }).click({ timeout: 30_000 }); // per-benchmark tables sit under Details since M7
  await expect(page.getByRole('region', { name: 'std-reasoning-math' })).toContainText('mock-a', { timeout: 30_000 });
  await expect(page.getByText('One model gives a scorecard; add a second for a verdict.')).toBeVisible();
});

test('[AC-3.1] a benchmark that needs a judge keeps Run disabled until a judge exists', async ({ page }) => {
  let judges = false;
  await page.route('**/api/benchmarks', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: (await res.json()).map((b: { name: string }) => ({ ...b, needs_judge: b.name === 'std-reasoning-math' })) });
  });
  await page.route('**/api/targets/status', async (route) => {
    const res = await route.fetch();
    const extra = judges ? [{ name: 'judge-x', model: 'openai/judge', kind: 'litellm', keys_ok: true, missing_keys: [] }] : [];
    await route.fulfill({ response: res, json: [...(await res.json()), ...extra] });
  });
  await page.route('**/api/runs/estimate', (route) => route.fulfill({ json: { usd: 0, total_calls: 30, cached_calls: 0, minutes: 1 } }));
  await page.goto('/compare/');
  await pick(page, ['mock-a', 'mock-b']);
  await expect(page.getByTestId('estimate')).toContainText('need a judge');
  await expect(page.getByRole('button', { name: 'Run comparison' })).toBeDisabled();
  judges = true;
  await page.reload();
  await pick(page, ['mock-a', 'mock-b']);
  await expect(page.getByRole('combobox', { name: /^Judge/ })).toHaveValue('judge-x');
  await expect(page.getByRole('button', { name: 'Run comparison' })).toBeEnabled();
});

test('[AC-3.5] a failed poll after the first load shows Reconnecting and recovers', async ({ page, request }) => {
  const id = await slowJob(request);
  let down = false;
  await page.route(`**/api/jobs/${id}`, (route) => (down ? route.abort() : route.continue()));
  await page.goto(`/compare/?job=${id}`);
  await expect(page.getByRole('progressbar', { name: 'Progress' })).toBeVisible();
  down = true;
  await expect(page.getByText('Reconnecting…')).toBeVisible();
  await expect(page.locator('[data-state="error"]')).toHaveCount(0);
  down = false;
  await expect(page.getByText('Reconnecting…')).toHaveCount(0, { timeout: 15_000 });
});

test('[AC-3.2] a cancel that loses the race (409) shows no error and refreshes the job', async ({ page, request }) => {
  const id = await slowJob(request);
  let polls = 0;
  await page.route(`**/api/jobs/${id}`, (route) => { polls++; return route.continue(); });
  await page.route(`**/api/jobs/${id}/cancel`, (route) => route.fulfill({ status: 409, json: { detail: 'job is not running' } }));
  await page.goto(`/compare/?job=${id}`);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  const before = polls;
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect.poll(() => polls).toBeGreaterThan(before);
  await expect(page.locator('p[role="alert"]')).toHaveCount(0); // Next's route announcer is also a role=alert
});
