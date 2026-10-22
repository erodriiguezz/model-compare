import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.env.PWD ?? process.cwd(), '.claude', 'artifacts', 'screenshots', '9');
const FAKE = 'sk-test-000000000000a1b2';
const VIEWPORTS = [{ name: '1280', width: 1280, height: 800 }, { name: '390', width: 390, height: 844 }];
const shot = async (page: Page, name: string) => { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };
const matrix = (page: Page) => page.getByRole('region', { name: 'Verdict matrix' });
const suggestions = (page: Page) => page.getByRole('region', { name: 'Suggestions' });

test.afterEach(async ({ request }) => {
  await request.delete('/api/settings/keys/gemini');
  await request.delete('/api/projects/qa-e2e-drafted');
  await request.delete('/api/projects/qa-nine-shot');
});

// Gemini, not OpenAI: models.spec owns the OpenAI key and the two files run in parallel workers.
test('[AC-9.5] Settings key (masked) -> Models lists that provider -> select mock models -> run -> verdict and suggestions', async ({ page }) => {
  await page.goto('/settings/');
  const row = page.locator('[data-provider="gemini"]');
  await row.getByRole('button', { name: 'Add' }).click();
  await row.getByLabel('Gemini API key').fill(FAKE);
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(row.locator('.chip')).toHaveText('set');
  await expect(row.locator('.key-mask')).toHaveText('sk-…a1b2');
  expect(await page.content()).not.toContain(FAKE);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Models' }).click();
  const gemini = page.locator('[data-group="gemini"]');
  await gemini.getByRole('button', { name: /gemini/i }).click();
  await expect(gemini.getByRole('checkbox', { name: /^gemini\/gemini-2.0-flash\b/ })).toBeVisible(); // recorded catalog fixture

  await page.getByRole('checkbox', { name: /^mock-a(\s|$)/ }).check();
  await page.getByRole('checkbox', { name: /^mock-b(\s|$)/ }).check();
  await page.getByRole('link', { name: 'Compare selected' }).click();
  await page.getByRole('checkbox', { name: /^std-reasoning-math\b/ }).check();
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page).toHaveURL(/\/compare\/\?job=\w+/);
  await expect(matrix(page)).toBeVisible({ timeout: 30_000 });
  await expect(suggestions(page)).toBeVisible();
});

test('[AC-9.6] Projects -> describe and paste examples -> Draft -> edit a case -> save -> run on two mock models -> Compare', async ({ page, request }) => {
  await page.goto('/projects/');
  await page.getByRole('link', { name: /New project|Create your first project/ }).click();
  await page.getByRole('button', { name: 'Draft with AI' }).click();
  const dialog = page.getByRole('dialog', { name: 'Draft with AI' });
  await dialog.getByLabel('Model').selectOption('mock-drafter');
  await dialog.getByLabel('Describe the project').fill('Capital cities of Europe');
  await dialog.getByLabel('Examples').fill('Capital of Spain? => Madrid');
  await dialog.getByRole('button', { name: 'Draft', exact: true }).click();
  await expect(page.getByText('Unsaved draft')).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('qa-e2e-drafted'); // projects.spec saves the mock's own name in parallel
  await page.getByRole('button', { name: 'Edit case 1' }).click();
  await page.getByLabel('Case 1 expected').fill('Paris');
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  expect((await (await request.get('/api/projects/qa-e2e-drafted')).json()).cases[0].expected).toBe('Paris');

  await page.getByRole('button', { name: 'Run on selected models' }).click();
  const run = page.getByRole('dialog', { name: 'Run on selected models' });
  await run.getByRole('checkbox', { name: /^mock-a\b/ }).check();
  await run.getByRole('checkbox', { name: /^mock-b\b/ }).check();
  await run.getByRole('button', { name: 'Open Compare' }).click();
  await expect(page.getByRole('checkbox', { name: /^qa-e2e-drafted\b/ })).toBeChecked();
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page).toHaveURL(/\/compare\/\?job=\w+/);
  await expect(matrix(page)).toBeVisible({ timeout: 30_000 });
  await expect(suggestions(page)).toBeVisible();
  await expect(page.getByText('qa-e2e-drafted').first()).toBeVisible();
});

// Each page of the plan's Screens list, with how to force and recognise every state.
const JOB = 'qa-every-verdict';
const EMPTY_JOB = { id: JOB, targets: [], baseline: null, status: 'done', error: null, started_at: '2026-01-01T00:00:00', benchmarks: [], total_calls: 0, done_calls: 0, run_ids: [], runs: [], live: [] };
const PAGES = [
  { name: 'projects', url: '/projects/', api: '**/api/projects', loading: /Loading projects/, empty: { body: [], text: 'No projects yet' }, error: 'Could not load projects', ready: (p: Page) => expect(p.getByRole('row', { name: /qa-nine-shot/ })).toBeVisible() },
  { name: 'editor', url: '/projects/edit/?new=1', api: '**/api/scorers', loading: /Loading project/, empty: null, error: 'Could not load the project', ready: (p: Page) => expect(p.getByText('No cases yet')).toBeVisible() },
  { name: 'settings', url: '/settings/', api: '**/api/settings/keys', loading: /Loading keys/, empty: { body: [{ provider: 'openai', var: 'OPENAI_API_KEY', set: false, masked: null, source: null }], text: 'No keys yet' }, error: 'Provider keys could not be loaded', ready: (p: Page) => expect(p.locator('.key-list')).toBeVisible() },
  { name: 'history', url: '/history/', api: '**/api/jobs', loading: /Loading history/, empty: { body: [], text: 'No comparisons yet', also: ['**/api/runs', []] as const }, error: 'Could not load history', ready: (p: Page) => expect(p.getByRole('region', { name: 'Comparisons' })).toBeVisible() },
  { name: 'models', url: '/models/', api: '**/api/models', loading: /Loading models/, empty: { body: { providers: [{ provider: 'openai', var: 'OPENAI_API_KEY', key_ok: false, reason: 'no key', models: [] }], cached_at: '2026-01-01T00:00:00+00:00' }, text: 'No models yet', also: ['**/api/targets/status', []] as const }, error: 'Could not load models', ready: (p: Page) => expect(p.locator('[data-group="configured"]')).toBeVisible() },
  { name: 'compare', url: '/compare/', api: '**/api/targets/status', loading: /Loading targets and benchmarks/, empty: { body: [], text: 'No targets configured' }, error: 'Could not load targets and benchmarks', ready: (p: Page) => expect(p.getByRole('button', { name: 'Run comparison' })).toBeVisible() },
  { name: 'report', url: `/compare/?job=${JOB}`, api: `**/api/jobs/${JOB}`, loading: /Loading job/, empty: { body: EMPTY_JOB, text: 'No finished runs' }, error: 'Could not load this comparison', ready: (p: Page) => expect(matrix(p)).toBeVisible() },
];

for (const vp of VIEWPORTS) {
  for (const pg of PAGES) {
    test.describe(`[AC-9.7] ${pg.name} at ${vp.name}px`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height }, colorScheme: 'light' });
      const noScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

      test('ready', async ({ page, request }) => {
        await request.post('/api/projects', { data: { name: 'qa-nine-shot', dimension: 'knowledge', scorers: [{ type: 'contains' }], cases: [{ id: 'c1', input: 'Q?', expected: 'A' }] } });
        await page.goto(pg.url);
        await pg.ready(page);
        expect(await noScroll(page)).toBe(true);
        await shot(page, `${pg.name}-${vp.name}`);
      });

      test('loading', async ({ page }) => {
        let release: () => void = () => {};
        const gate = new Promise<void>((r) => { release = r; });
        await page.route(pg.api, async (r) => { await gate; await r.continue(); });
        await page.goto(pg.url);
        await expect(page.getByRole('status').filter({ hasText: pg.loading })).toBeVisible();
        expect(await noScroll(page)).toBe(true);
        await shot(page, `${pg.name}-${vp.name}-loading`);
        release();
      });

      test('empty', async ({ page }) => {
        if (!pg.empty) {
          await page.goto(pg.url); // the blank editor is its own empty state
          await expect(page.getByText('No cases yet')).toBeVisible();
        } else {
          await page.route(pg.api, (r) => r.fulfill({ json: pg.empty!.body }));
          if ('also' in pg.empty) await page.route(pg.empty.also[0], (r) => r.fulfill({ json: pg.empty!.also![1] }));
          await page.goto(pg.url);
          await expect(page.getByRole('heading', { name: pg.empty.text })).toBeVisible();
        }
        expect(await noScroll(page)).toBe(true);
        await shot(page, `${pg.name}-${vp.name}-empty`);
      });

      test('error', async ({ page }) => {
        await page.route(pg.api, (r) => r.fulfill({ status: 500, body: 'boom' }));
        await page.goto(pg.url);
        await expect(page.locator('[data-state="error"]')).toContainText(pg.error);
        await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
        expect(await noScroll(page)).toBe(true);
        await shot(page, `${pg.name}-${vp.name}-error`);
      });
    });
  }
}
