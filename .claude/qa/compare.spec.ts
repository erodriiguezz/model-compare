import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Needs the QA seed (engine/scripts/seed_qa.py): qa-every-verdict covers every verdict in 5 capabilities.
const JOB = '/compare/?job=qa-every-verdict';
const SHOTS = join(process.env.PWD ?? process.cwd(), '.claude', 'artifacts', 'screenshots', '7');
const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('[AC-7.1] one ranked bar chart per capability, sorted, with CI whiskers in provider colours', async ({ page }) => {
  await page.goto(JOB);
  const charts = page.locator('[data-chart="ranked-bars"]');
  await expect(charts).toHaveCount(6);
  const first = charts.first();
  await expect(first.getByRole('img')).toHaveAttribute('aria-label', /qa-better .*%/);
  await expect(first.locator('.recharts-errorBar').first()).toBeAttached();

  // The accessible table lists the same bars; scores must be in descending order in every chart.
  for (const chart of await charts.all()) {
    const scores = await chart.locator('.sr-only tbody tr td:nth-child(2)').allTextContents();
    const nums = scores.map((s) => parseFloat(s));
    expect(nums.length).toBeGreaterThan(1);
    expect(nums).toEqual([...nums].sort((a, b) => b - a));
  }

  // Bars carry the provider token colours (openai baseline, anthropic candidate), not hardcoded ones.
  const fills = await first.locator('.recharts-bar-rectangle path, .recharts-bar-rectangle rect').evaluateAll((els) => els.map((e) => e.getAttribute('fill')));
  expect(fills).toContain(await token(page, '--provider-anthropic'));
  expect(fills).toContain(await token(page, '--provider-openai'));
});

test('[AC-7.1] bar charts fit a 390px screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(JOB);
  await expect(page.locator('[data-chart="ranked-bars"]')).toHaveCount(6);
  expect(await noPageScroll(page)).toBe(true);
  const box = await page.locator('[data-chart="ranked-bars"]').first().boundingBox();
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
  const chart = page.locator('[data-chart="ranked-bars"]');
  await expect(chart).toHaveCount(1);
  await expect(chart.locator('.sr-only tbody tr', { hasText: 'qa-flaky' })).toContainText('Incomplete');
  await expect(chart.locator('.recharts-wrapper')).toContainText(/qa-flaky\s*\(incomplete\)/);
  await expect(chart.locator('.recharts-errorBar')).toHaveCount(1); // the baseline only
});
const LABELS = ['Better', 'Worse', 'Tie', 'Inconclusive', 'Incomplete'];

test('[AC-7.2] the verdict matrix shows all five verdict labels and marks the baseline', async ({ page }) => {
  await page.goto(JOB);
  const matrix = page.getByRole('region', { name: 'Verdict matrix' });
  await expect(matrix).toBeVisible();
  for (const label of LABELS) await expect(matrix.locator('td', { hasText: new RegExp(`^${label}`) }).first()).toBeVisible();
  const base = matrix.locator('tbody tr', { has: page.getByRole('rowheader', { name: /qa-base/ }) });
  await expect(base.getByRole('rowheader')).toContainText('baseline');
  await expect(matrix.locator('tbody tr')).toHaveCount(5);
  // The legend spells out every label, so colour is never the only cue.
  for (const label of LABELS) await expect(matrix.locator('.legend')).toContainText(label);
});

test('[AC-7.4] the suggestions panel lists errors first, then decisions, then data advice', async ({ page }) => {
  await page.goto(JOB);
  const panel = page.getByRole('region', { name: 'Suggestions' });
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
  await expect(reg.locator('li').first()).toContainText(/qa-reasoning/);
  const details = page.locator('details', { has: page.getByText('Details', { exact: true }) });
  await expect(details).not.toHaveAttribute('open', '');
  await details.getByText('Details', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'qa-reasoning' })).toBeVisible();
});

test('[AC-7.5] an incomplete-only report shows Fix errors, incomplete cells and no broken charts', async ({ page }) => {
  await page.goto('/compare/?job=qa-incomplete');
  await expect(page.getByRole('region', { name: 'Suggestions' }).locator('ol > li')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Suggestions' })).toContainText('Fix errors: qa-flaky');
  await expect(page.getByRole('region', { name: 'Verdict matrix' }).locator('td', { hasText: /^Incomplete/ })).toBeVisible();
  await expect(page.locator('[data-chart="ranked-bars"]')).toHaveCount(1);
  await expect(page.locator('.recharts-wrapper').first()).toBeVisible();
  await expect(page.getByText('NaN')).toHaveCount(0);
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
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Could not load the report');
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('region', { name: 'Suggestions' })).toBeVisible();
});

test('[AC-7.5] with no runs yet, Compare points to Models', async ({ page }) => {
  await page.route('**/api/runs', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.continue()));
  await page.goto('/compare/');
  const empty = page.locator('[data-state="empty"]');
  await expect(empty).toContainText('No comparisons yet');
  await empty.getByRole('link', { name: 'Choose models' }).click();
  await expect(page).toHaveURL(/\/models\/$/);
});

for (const [name, width] of [['1280', 1280], ['390', 390]] as const) {
  test(`[AC-7.5] report screenshots at ${name}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(JOB);
    await expect(page.getByRole('region', { name: 'Suggestions' })).toBeVisible();
    await expect(page.locator('[data-chart="cost-scatter"] .recharts-wrapper')).toBeVisible();
    expect(await noPageScroll(page)).toBe(true);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `compare-${name}.png`), fullPage: true });
    await page.goto('/compare/?job=qa-incomplete');
    await expect(page.getByRole('region', { name: 'Suggestions' })).toBeVisible();
    await page.screenshot({ path: join(SHOTS, `incomplete-${name}.png`), fullPage: true });
    await page.route('**/api/runs', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: [] }) : route.continue()));
    await page.goto('/compare/');
    await expect(page.locator('[data-state="empty"]')).toBeVisible();
    await page.screenshot({ path: join(SHOTS, `empty-${name}.png`), fullPage: true });
  });
}
