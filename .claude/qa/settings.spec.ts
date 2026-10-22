import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FAKE = 'sk-test-000000000000a1b2';
const FAKE2 = 'sk-test-000000000000c3d4';
const row = (page: Page) => page.locator('[data-provider="groq"]');

// The keys file for QA lives in .modelcompare-qa; whatever a test adds it removes again.
test.afterEach(async ({ request }) => {
  await request.delete('/api/settings/keys/groq');
});

test('[AC-4.5] [AC-4.2] add, replace, test and remove a key; only the masked form is ever shown', async ({ page }) => {
  await page.goto('/settings/');
  await expect(row(page)).toBeVisible();
  await expect(row(page).locator('.chip')).toHaveText('not set');

  await row(page).getByRole('button', { name: 'Add' }).click();
  await expect(row(page).getByLabel('Groq API key')).toBeFocused();
  await row(page).getByLabel('Groq API key').fill(FAKE);
  await row(page).getByRole('button', { name: 'Save' }).click();
  await expect(row(page).locator('.chip')).toHaveText('set');
  await expect(row(page).getByRole('button', { name: 'Replace' })).toBeFocused();
  await expect(row(page).locator('.key-mask')).toHaveText('sk-…a1b2');
  await expect(row(page).getByLabel('Groq API key')).toHaveCount(0);
  expect(await page.content()).not.toContain(FAKE);

  await row(page).getByRole('button', { name: 'Replace' }).click();
  await expect(row(page).getByLabel('Groq API key')).toHaveValue('');
  await row(page).getByLabel('Groq API key').fill(FAKE2);
  await row(page).getByRole('button', { name: 'Save' }).click();
  await expect(row(page).locator('.key-mask')).toHaveText('sk-…c3d4');
  const html = await page.content();
  expect(html).not.toContain(FAKE2);
  expect(html).not.toContain(FAKE);

  await page.route('**/api/settings/keys/groq/test', (route) => route.fulfill({ json: { ok: true, message: 'Key accepted.' } }));
  await row(page).getByRole('button', { name: 'Test' }).click();
  await expect(row(page).getByRole('status')).toHaveText('Key accepted.');
  await page.unroute('**/api/settings/keys/groq/test');
  await page.route('**/api/settings/keys/groq/test', (route) => route.fulfill({ json: { ok: false, message: 'Key rejected by the provider (401).' } }));
  await row(page).getByRole('button', { name: 'Test' }).click();
  await expect(row(page).getByRole('status')).toHaveText('Key rejected by the provider (401).');

  await row(page).getByRole('button', { name: 'Remove' }).click();
  await expect(row(page).getByText('Remove the Groq key from the env file?')).toBeVisible();
  await row(page).getByRole('button', { name: 'Remove key' }).click();
  await expect(row(page).locator('.chip')).toHaveText('not set');
  await expect(row(page).locator('.key-mask')).toHaveText('—');
});

test('[AC-4.5] an invalid key shows the server message and keeps the form open', async ({ page }) => {
  await page.goto('/settings/');
  await row(page).getByRole('button', { name: 'Add' }).click();
  await row(page).getByLabel('Groq API key').fill('has space');
  await row(page).getByRole('button', { name: 'Save' }).click();
  await expect(row(page).getByRole('status')).toContainText('printable ASCII');
  await expect(row(page).getByLabel('Groq API key')).toBeVisible();
});

test('[AC-4.5] loading state while keys load', async ({ page }) => {
  await page.route('**/api/settings/keys', async (route) => { await new Promise((r) => setTimeout(r, 600)); await route.continue(); });
  await page.goto('/settings/');
  await expect(page.getByText('Loading keys')).toBeVisible();
  await expect(row(page)).toBeVisible();
});

test('[AC-4.5] empty state when no key is set, rows still shown', async ({ page }) => {
  await page.route('**/api/settings/keys', (route) => route.fulfill({
    json: ['openai', 'anthropic', 'gemini', 'togetherai', 'groq', 'openrouter'].map((p) => ({ provider: p, var: `${p.toUpperCase()}_API_KEY`, set: false, masked: null, source: null })),
  }));
  await page.goto('/settings/');
  await expect(page.getByRole('heading', { name: 'No keys yet' })).toBeVisible();
  await expect(page.locator('.key-row')).toHaveCount(6);
});

test('[AC-4.5] a key from the environment is labelled and cannot be removed here', async ({ page }) => {
  await page.route('**/api/settings/keys', (route) => route.fulfill({
    json: [{ provider: 'groq', var: 'GROQ_API_KEY', set: true, masked: 'sk-…a1b2', source: 'environment' }],
  }));
  await page.goto('/settings/');
  await expect(row(page).locator('.chip')).toHaveText('from environment');
  await expect(row(page).getByRole('button', { name: 'Remove' })).toHaveCount(0);
});

test('[AC-4.5] error state with retry when the API fails', async ({ page }) => {
  let down = true;
  await page.route('**/api/settings/keys', (route) => (down ? route.abort() : route.continue()));
  await page.goto('/settings/');
  await expect(page.locator('[data-state="error"]')).toContainText('could not be loaded');
  down = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(row(page)).toBeVisible();
});

// Review screenshots of the states the plan's /settings capture does not reach.
const shotDir = join(process.env.PWD ?? process.cwd(), '.claude', 'artifacts', 'screenshots', '4');
for (const [label, width, height] of [['desktop', 1280, 800], ['mobile', 390, 844]] as const) {
  test(`[AC-4.5] screenshots of set, edit, remove-confirm and environment rows at ${width}px`, async ({ page, request }) => {
    mkdirSync(shotDir, { recursive: true });
    await page.setViewportSize({ width, height });
    await request.put('/api/settings/keys/groq', { data: { value: FAKE } });
    await page.goto('/settings/');
    await expect(row(page).locator('.key-mask')).toHaveText('sk-…a1b2');
    await row(page).screenshot({ path: join(shotDir, `settings-key-set-${label}.png`) });
    await row(page).getByRole('button', { name: 'Replace' }).click();
    await row(page).screenshot({ path: join(shotDir, `settings-key-edit-${label}.png`) });
    await row(page).getByRole('button', { name: 'Cancel' }).click();
    await row(page).getByRole('button', { name: 'Remove' }).click();
    await row(page).screenshot({ path: join(shotDir, `settings-key-remove-confirm-${label}.png`) });
    await page.route('**/api/settings/keys', (route) => route.fulfill({
      json: [{ provider: 'groq', var: 'GROQ_API_KEY', set: true, masked: 'sk-…a1b2', source: 'environment' }],
    }));
    await page.reload();
    await expect(row(page).locator('.chip')).toHaveText('from environment');
    await row(page).screenshot({ path: join(shotDir, `settings-key-environment-${label}.png`) });
  });
}
