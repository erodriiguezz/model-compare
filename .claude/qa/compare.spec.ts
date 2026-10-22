import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Needs the QA seed (engine/scripts/seed_qa.py): qa-every-verdict covers every verdict in 5 capabilities.
const JOB = '/compare/?job=qa-every-verdict';
const SHOTS = join(process.env.PWD ?? process.cwd(), '.claude', 'artifacts', 'screenshots', '7');
const caps = (page: Page) => page.getByRole('region', { name: 'Capabilities' });
const cards = (page: Page) => caps(page).getByRole('article');
const color = (page: Page, v: string) => page.evaluate((n) => { const e = document.createElement('i'); e.style.color = `var(${n})`; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; }, v);
const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('[AC-7.1] one capability card per dimension, bars sorted, with CI whiskers in vendor colours', async ({ page, request }) => {
  // Vendor colours follow the model name, so give two models names that map to anthropic and openai.
  const body = (await (await request.get('/api/jobs/qa-every-verdict/report')).text()).replaceAll('qa-better', 'claude-better').replaceAll('qa-base', 'gpt-base');
  await page.route('**/api/jobs/qa-every-verdict/report', (route) => route.fulfill({ body, contentType: 'application/json' }));
  await page.goto(JOB);
  await expect(cards(page)).toHaveCount(6);
  const first = cards(page).first();
  await expect(first.getByRole('list', { name: / score$/ })).toContainText('claude-better');
  await expect(first.locator('.whisker').first()).toBeAttached();

  // Bars are listed best first in every card.
  for (const card of await cards(page).all()) {
    const nums = (await card.getByRole('list', { name: / score$/ }).locator('.value').allTextContents()).map((s) => parseFloat(s));
    expect(nums.length).toBeGreaterThan(1);
    expect(nums).toEqual([...nums].sort((a, b) => b - a));
  }

  // Bars carry the vendor token colours (openai baseline, anthropic candidate), not hardcoded ones.
  const fills = await first.locator('.fill').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(fills).toContain(await color(page, '--vendor-anthropic'));
  expect(fills).toContain(await color(page, '--vendor-openai'));
});

test('[AC-7.1] capability cards fit a 390px screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(JOB);
  await expect(cards(page)).toHaveCount(6);
  expect(await noPageScroll(page)).toBe(true);
  const box = await cards(page).first().boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
});

test('[AC-7.3] the scatter plots quality against $ per 1k tasks and highlights the Pareto front', async ({ page }) => {
  await page.goto(JOB);
  const scatter = page.locator('[data-chart="cost-scatter"]');
  await expect(scatter).toBeVisible();
  await expect(scatter.getByRole('img')).toHaveAttribute('aria-label', /pass rate .* \$ per 1k tasks/i);
  await expect(scatter).toContainText('$ per 1k tasks');
  await expect(scatter).toContainText('Overall pass rate');
  const front = await scatter.locator('.sr-only tbody tr[data-pareto="true"]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-target')).sort());
  const rest = await scatter.locator('.sr-only tbody tr[data-pareto="false"]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-target')).sort());
  expect(front).toEqual(['qa-better', 'qa-tie', 'qa-worse']);
  expect(rest).toEqual(['qa-base', 'qa-flaky']);
  await expect(scatter.locator('.recharts-scatter-line')).toBeAttached();
  await expect(scatter.getByText('anthropic', { exact: true })).toBeVisible(); // legend by provider
});

test('[AC-7.3] the scatter fits a 390px screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(JOB);
  await expect(page.locator('[data-chart="cost-scatter"]')).toBeVisible();
  expect(await noPageScroll(page)).toBe(true);
});

test('[AC-7.3] an incomplete model is never on the Pareto front and is marked incomplete', async ({ page }) => {
  await page.goto('/compare/?job=qa-incomplete');
  const scatter = page.locator('[data-chart="cost-scatter"]');
  await expect(scatter).toBeVisible();
  const flaky = scatter.locator('.sr-only tbody tr[data-target="qa-flaky"]');
  await expect(flaky).toHaveAttribute('data-pareto', 'false');
  await expect(flaky).toHaveAttribute('data-incomplete', 'true');
  await expect(flaky).toContainText('Incomplete');
  await expect(scatter.getByRole('img')).toHaveAttribute('aria-label', /qa-flaky .*incomplete/);
  await expect(scatter.locator('.recharts-wrapper')).toContainText(/qa-flaky\s*\(incomplete\)/);
});

test('[AC-7.1] an incomplete bar is flagged and has no whisker', async ({ page }) => {
  await page.goto('/compare/?job=qa-incomplete');
  await expect(cards(page)).toHaveCount(1);
  const flaky = cards(page).getByRole('listitem').filter({ hasText: 'qa-flaky' }).first();
  await expect(flaky.locator('.fill.hatched')).toBeAttached();
  await expect(flaky).toContainText(/qa-flaky\s*\(incomplete\)/);
  await expect(cards(page).locator('.whisker')).toHaveCount(1); // the baseline only
});
const LABELS = ['Better', 'Worse', 'Tie', 'Inconclusive', 'Incomplete'];

test('[AC-7.2] the capability cards show all five verdict labels and mark the baseline', async ({ page }) => {
  await page.goto(JOB);
  await expect(caps(page)).toBeVisible();
  for (const label of LABELS) await expect(caps(page).locator('.verdicts .chip', { hasText: new RegExp(`^${label}$`) }).first()).toBeVisible();
  const bars = cards(page).first().getByRole('list', { name: / score$/ }).getByRole('listitem');
  await expect(bars).toHaveCount(5);
  await expect(bars.filter({ hasText: 'qa-base' })).toContainText('baseline');
  // The legend spells out every label, so colour is never the only cue.
  for (const label of LABELS) await expect(caps(page).getByRole('list', { name: 'Verdict legend' })).toContainText(label);
});

test('[AC-7.2] insufficient data reads n<10 in the cards instead of a point change', async ({ page }) => {
  await page.goto(JOB);
  const cell = caps(page).locator('.verdicts li').filter({ has: page.locator('[data-verdict="insufficient_data"]') });
  await expect(cell).toHaveCount(1);
  await expect(cell).toContainText('Inconclusive');
  await expect(cell).toContainText('n<10');
  await expect(cell).not.toContainText('pts');
});

test('[AC-7.5] a finished job collapses its progress so the decision is the first thing on screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(JOB);
  const summary = page.locator('[data-job-summary]');
  await expect(summary).toContainText(/done · \d+\/\d+ calls · 5 models · 6 capabilities/);
  await expect(page.getByRole('region', { name: 'By benchmark' })).toHaveCount(0);
  const top = (await page.getByRole('region', { name: 'Recommendation' }).boundingBox())!.y;
  expect(top).toBeLessThan(800);
  await page.getByRole('button', { name: 'Show progress' }).click();
  await expect(page.getByRole('region', { name: 'By benchmark' })).toBeVisible();
  await page.getByRole('button', { name: 'Hide progress' }).click();
  await expect(page.getByRole('region', { name: 'By benchmark' })).toHaveCount(0);
});

test('[AC-7.4] the recommendation panel lists errors first, then decisions, then data advice', async ({ page }) => {
  await page.goto(JOB);
  const panel = page.getByRole('region', { name: 'Recommendation' });
  const items = panel.locator('ol > li');
  await expect(items.first()).toContainText('Fix errors');
  await expect(panel).toContainText(/cheaper is qa-tie \(saves \$[\d.]+ \/ 1k tasks/);
  await expect(panel).toContainText(/add \d+ more cases to qa-instructions/);
  await expect(panel).toContainText('Benchmark saturated: qa-easy');
  await expect(panel).toContainText('Switch to qa-better');
  await expect(panel).toContainText('Stay on qa-base');
  const kinds = await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
  const rank = (k: string | null) => (k === 'fix_errors' ? 0 : ['add_cases', 'too_small', 'saturated'].includes(k ?? '') ? 2 : 1);
  expect(kinds.map(rank)).toEqual([...kinds.map(rank)].sort());
});

test('[AC-7.5] regressions list the cases that got worse and details stay collapsed', async ({ page }) => {
  await page.goto(JOB);
  const reg = page.getByRole('region', { name: 'Regressions' });
  await expect(reg).toContainText('qa-worse');
  await reg.getByRole('button', { name: /Show all/ }).click();
  await expect(reg).toContainText('qa-worse · qa-reasoning');
  const details = page.locator('details', { has: page.getByText('Details', { exact: true }) });
  await expect(details).not.toHaveAttribute('open', '');
  await details.getByText('Details', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'qa-reasoning' })).toBeVisible();
});

test('[AC-7.5] an incomplete-only report shows Fix errors, incomplete cells and no broken charts', async ({ page }) => {
  await page.goto('/compare/?job=qa-incomplete');
  await expect(page.getByRole('region', { name: 'Recommendation' }).locator('ol > li')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Recommendation' })).toContainText('Fix errors: qa-flaky');
  await expect(caps(page).locator('.verdicts .chip', { hasText: /^Incomplete/ })).toBeVisible();
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator('.recharts-wrapper').first()).toBeVisible();
  await expect(page.getByText('NaN')).toHaveCount(0);
});

test('every call errored on a benchmark: the report renders "No paired cases" and never NaN', async ({ page }) => {
  await page.goto('/compare/?job=qa-all-errors');
  await expect(page.getByRole('region', { name: 'Recommendation' })).toContainText('Fix errors');
  await page.getByText('Details', { exact: true }).click();
  await expect(page.getByText('2 capabilities')).toBeVisible();
  const tools = cards(page).filter({ has: page.getByRole('heading', { name: /tool/i }) });
  await expect(tools).toBeVisible();
  await expect(tools.locator('.chip', { hasText: /^Incomplete/ })).toBeVisible();
  await expect(tools).toContainText('No scored cases');
  const bench = page.getByRole('region', { name: 'qa-allerr-tools' });
  await expect(bench).toContainText('No paired cases');
  await expect(bench).toContainText('Incomplete');
  await expect(page.locator('.recharts-wrapper').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/NaN/);
  expect(await noPageScroll(page)).toBe(true);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, 'all-errors.png'), fullPage: true });
});

test('[AC-7.5] the report shows a loading state, then an error with retry', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let calls = 0;
  await page.route('**/api/jobs/qa-every-verdict/report', async (route) => {
    calls += 1;
    await gate;
    if (calls === 1) return route.fulfill({ status: 500, json: { detail: 'boom' } });
    return route.continue();
  });
  await page.goto(JOB);
  await expect(page.getByRole('status').filter({ hasText: 'Loading report' })).toBeVisible();
  release();
  const alert = page.locator('[data-state="error"]');
  await expect(alert).toContainText('Could not load the report');
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('region', { name: 'Recommendation' })).toBeVisible();
});

test('[AC-7.5] with no runs yet, Compare points to Models', async ({ page }) => {
  const asked: string[] = [];
  await page.route('**/api/runs?*', (route) => { asked.push(route.request().url()); return route.fulfill({ json: [] }); });
  await page.goto('/compare/');
  const empty = page.locator('[data-state="empty"]');
  await expect(empty).toContainText('No comparisons yet');
  expect(new URL(asked[0]).searchParams.get('limit')).toBe('1'); // a cheap existence check, not the full run list
  await empty.getByRole('link', { name: 'Choose models' }).click();
  await expect(page).toHaveURL(/\/models\/$/);
});

for (const [name, width] of [['1280', 1280], ['390', 390]] as const) {
  test(`[AC-7.5] report screenshots at ${name}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(JOB);
    await expect(page.getByRole('region', { name: 'Recommendation' })).toBeVisible();
    await expect(page.locator('[data-chart="cost-scatter"] .recharts-wrapper')).toBeVisible();
    expect(await noPageScroll(page)).toBe(true);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `compare-${name}.png`), fullPage: true });
    await page.goto('/compare/?job=qa-incomplete');
    await expect(page.getByRole('region', { name: 'Recommendation' })).toBeVisible();
    await page.screenshot({ path: join(SHOTS, `incomplete-${name}.png`), fullPage: true });
    await page.goto('/compare/?job=qa-all-errors');
    await expect(page.getByRole('region', { name: 'Recommendation' })).toBeVisible();
    await page.screenshot({ path: join(SHOTS, `all-errors-${name}.png`), fullPage: true });
    await page.route('**/api/runs?*', (route) => route.fulfill({ json: [] }));
    await page.goto('/compare/');
    await expect(page.locator('[data-state="empty"]')).toBeVisible();
    await page.screenshot({ path: join(SHOTS, `empty-${name}.png`), fullPage: true });
  });
}

test('[AC-7.5] the real /api/runs?limit=1 answers with at most one run for the empty check', async ({ request }) => {
  const res = await request.get('/api/runs?limit=1');
  expect(res.ok()).toBe(true);
  const rows = await res.json();
  expect(Array.isArray(rows) && rows.length === 1).toBe(true); // the QA seed guarantees runs exist
  expect(rows[0]).toHaveProperty('target_name');
});
