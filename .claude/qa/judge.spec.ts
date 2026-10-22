import { test, expect, type Page } from '@playwright/test';

const prov = (provider: string, ids: string[]) => ({ provider, var: 'X', key_ok: true, models: ids.map((id) => ({ id, target: `${provider}/${id}` })) });
const catalog = { providers: [prov('openai', ['gpt-4o-mini', 'gpt-4o']), prov('anthropic', ['claude-x'])], cached_at: '2026-01-01T00:00:00+00:00' };

// Only mock yaml targets exist; the benchmark is pretended to need a judge; /api/models is stubbed with keyed providers.
async function setup(page: Page, bodies: Array<Record<string, unknown>>, unpriced: string[] = []) {
  await page.route('**/api/benchmarks', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: (await res.json()).map((b: { name: string }) => ({ ...b, needs_judge: b.name === 'std-reasoning-math' })) });
  });
  await page.route('**/api/models', (route) => route.fulfill({ json: catalog }));
  await page.route('**/api/runs/estimate', (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { usd: 0, total_calls: 30, cached_calls: 0, minutes: 1, unpriced } });
  });
}

test('[AC-3.1] catalog models are offered as judges, a vendor not under test is auto-picked, and the id is sent', async ({ page }) => {
  const bodies: Array<Record<string, unknown>> = [];
  await setup(page, bodies, ['anthropic/claude-x']);
  await page.goto('/compare/?targets=openai%2Fgpt-4o-mini%2Cmock-a');
  await page.getByText('Choose individual benchmarks').click();
  await page.getByRole('checkbox', { name: /^std-reasoning-math\b/ }).check();
  const judge = page.getByRole('combobox', { name: /^Judge/ });
  await expect(judge).toHaveValue('anthropic/claude-x');
  const options = await judge.locator('option').allTextContents();
  expect(options).toContain('openai/gpt-4o (same vendor as a model under test)');
  expect(options.join('|')).not.toMatch(/gpt-4o-mini/); // never its own judge
  await expect(judge.locator('optgroup')).toHaveText([/./, /./]);
  await expect(page.getByRole('button', { name: 'Run comparison' })).toBeEnabled();
  expect(bodies.at(-1)).toMatchObject({ judge: 'anthropic/claude-x' });
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page.getByRole('group', { name: 'Confirm cost' })).toContainText('cost unknown for anthropic/claude-x');
  await page.screenshot({ path: '.claude/artifacts/judge-select-1280.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.claude/artifacts/judge-select-390.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('[AC-3.1] when the catalog fails, Run stays disabled with a muted note', async ({ page }) => {
  await setup(page, []);
  await page.route('**/api/models', (route) => route.fulfill({ status: 500, json: { detail: 'down' } }));
  await page.goto('/compare/');
  await page.getByRole('checkbox', { name: /^mock-a\b/ }).check();
  await page.getByText('Choose individual benchmarks').click();
  await page.getByRole('checkbox', { name: /^std-reasoning-math\b/ }).check();
  await expect(page.getByText('Model catalog unavailable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run comparison' })).toBeDisabled();
});
