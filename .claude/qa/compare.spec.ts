import { test, expect, type Page } from '@playwright/test';

// Needs the QA seed (engine/scripts/seed_qa.py): qa-every-verdict covers every verdict in 5 capabilities.
const JOB = '/compare/?job=qa-every-verdict';
const token = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('[AC-7.1] one ranked bar chart per capability, sorted, with CI whiskers in provider colours', async ({ page }) => {
  await page.goto(JOB);
  const charts = page.locator('[data-chart="ranked-bars"]');
  await expect(charts).toHaveCount(5);
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
  await expect(page.locator('[data-chart="ranked-bars"]')).toHaveCount(5);
  expect(await noPageScroll(page)).toBe(true);
  const box = await page.locator('[data-chart="ranked-bars"]').first().boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
});

test('[AC-7.3] the scatter plots quality against $ per 1k tasks and highlights the Pareto front', async ({ page }) => {
  await page.goto(JOB);
  const scatter = page.locator('[data-chart="cost-scatter"]');
  await expect(scatter).toBeVisible();
  await expect(scatter.getByRole('img')).toHaveAttribute('aria-label', /quality .* \$ per 1k tasks/i);
  await expect(scatter).toContainText('$ per 1k tasks');
  await expect(scatter).toContainText('Quality');
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
