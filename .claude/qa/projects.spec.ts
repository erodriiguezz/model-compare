import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = join(process.env.PWD ?? process.cwd(), '.claude', 'artifacts', 'screenshots', '9');
const shot = async (page: Page, name: string) => { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); };

// Every project a test creates is removed again, so the QA custom dir stays clean.
const made: string[] = [];
const bench = (name: string, n = 2) => ({
  name, dimension: 'knowledge', description: 'QA project', scorers: [{ type: 'contains' }],
  cases: Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, input: `Question ${i + 1}?`, expected: `Answer ${i + 1}` })),
});
async function create(request: APIRequestContext, name: string, n = 2) {
  const res = await request.post('/api/projects', { data: bench(name, n) });
  expect(res.status()).toBe(201);
  const { slug } = await res.json();
  made.push(slug);
  return slug as string;
}
test.afterEach(async ({ request }) => {
  for (const slug of made.splice(0)) await request.delete(`/api/projects/${slug}`);
});

test('[AC-9.1] the list shows name, dimension, case count and last run; a broken file shows its error', async ({ page, request }) => {
  await create(request, 'qa-nine-list', 3);
  await page.route('**/api/runs', (r) => r.fulfill({ json: [
    { id: 90, target_name: 'mock-b', benchmark_name: 'qa-nine-list', status: 'done', started_at: '2026-01-02T03:04:05', n_results: 3, passed: 3, n_errors: 0, cost_usd: 0 },
    { id: 80, target_name: 'mock-a', benchmark_name: 'qa-nine-list', status: 'done', started_at: '2025-01-01T00:00:00', n_results: 3, passed: 1, n_errors: 0, cost_usd: 0 },
  ] }));
  await page.route('**/api/projects', async (r) => {
    const rows = await (await r.fetch()).json();
    await r.fulfill({ json: [...rows, { slug: 'broken', name: 'broken', dimension: null, n_cases: 0, valid: false, error: 'ValidationError: cases is required' }] });
  });
  await page.goto('/projects/');
  const row = page.getByRole('row', { name: /qa-nine-list/ });
  await expect(row).toContainText('knowledge');
  await expect(row.getByRole('cell').nth(2)).toHaveText('3');
  await expect(row.getByRole('cell').nth(3)).toContainText('mock-b'); // newest run wins
  const broken = page.getByRole('row', { name: /broken/ });
  await expect(broken).toContainText('ValidationError: cases is required');
  await expect(broken.locator('.chip')).toHaveText('invalid');
  await shot(page, 'projects-list');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'projects-list-390');
});

test('[AC-9.1] with no projects the page offers "Create your first project"', async ({ page }) => {
  await page.route('**/api/projects', (r) => r.fulfill({ json: [] }));
  await page.goto('/projects/');
  await page.getByRole('link', { name: 'Create your first project' }).click();
  await expect(page).toHaveURL(/\/projects\/edit\/\?new=1$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('New project');
});

test('[AC-9.1] a failed load shows an error with Try again', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/projects', (r) => (calls++ === 0 ? r.fulfill({ status: 500, body: 'boom' }) : r.continue()));
  await page.goto('/projects/');
  await expect(page.locator('[data-state="error"]')).toContainText('Could not load projects');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Projects');
  await expect(page.locator('[data-state="error"]')).toHaveCount(0);
});

test('[AC-9.2] create a project with cases and a scorer, edit and delete cases, save, find it in the list, then delete it', async ({ page, request }) => {
  made.push('qa-nine-new');
  await page.goto('/projects/edit/?new=1');
  await page.getByLabel('Name', { exact: true }).fill('qa-nine-new');
  await page.getByLabel('Dimension').selectOption('reasoning');
  await page.getByLabel('System prompt').fill('Answer briefly.');
  await page.getByRole('checkbox', { name: /^contains/ }).check();
  await page.getByRole('button', { name: 'Add case' }).click();
  await page.getByRole('button', { name: 'Add case' }).click();
  await page.getByLabel('Case 1 id').fill('capital');
  await page.getByLabel('Case 1 input').fill('Capital of France?');
  await page.getByLabel('Case 1 expected').fill('Paris');
  await page.getByLabel('Case 2 id').fill('doomed');
  await page.getByRole('button', { name: 'Delete case 2' }).click();
  await expect(page.getByLabel('Case 2 id')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add case' }).click();
  await page.getByLabel('Case 2 id').fill('colour');
  await page.getByLabel('Case 2 input').fill('Colour of the sky?');
  await page.getByLabel('Case 2 expected').fill('blue');
  await page.getByLabel('Case 2 scorer').selectOption('exact');
  await shot(page, 'editor-filled');
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/edit\/\?slug=qa-nine-new$/);

  const saved = await (await request.get('/api/projects/qa-nine-new')).json();
  expect(saved.dimension).toBe('reasoning');
  expect(saved.system_prompt).toBe('Answer briefly.');
  expect(saved.scorers.map((s: { type: string }) => s.type)).toEqual(['contains']);
  expect(saved.cases.map((c: { id: string }) => c.id)).toEqual(['capital', 'colour']);
  expect(saved.cases[1].scorers[0].type).toBe('exact');

  // Edit an existing project: a changed expected value is written back with PUT.
  await page.reload();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('qa-nine-new');
  await page.getByLabel('Case 1 expected').fill('Paris, France');
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  expect((await (await request.get('/api/projects/qa-nine-new')).json()).cases[0].expected).toBe('Paris, France');

  await page.goto('/projects/');
  await expect(page.getByRole('row', { name: /qa-nine-new/ })).toContainText('reasoning');

  await page.getByRole('link', { name: 'qa-nine-new' }).click();
  await page.getByRole('button', { name: 'Delete project' }).click();
  await expect(page.getByRole('button', { name: 'Confirm delete' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Confirm delete' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete project' }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page).toHaveURL(/\/projects\/$/);
  expect((await request.get('/api/projects/qa-nine-new')).status()).toBe(404);
});

test('[AC-9.2] validation errors from the API appear inline on the field or case row', async ({ page }) => {
  await page.goto('/projects/edit/?new=1');
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Name is required.')).toBeVisible();

  // Real 422s: no cases, then a case without any scorer.
  await page.getByLabel('Name', { exact: true }).fill('qa-nine-invalid');
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('At least one case is required.')).toBeVisible();
  await page.getByRole('button', { name: 'Add case' }).click();
  await page.getByLabel('Case 1 id').fill('c1');
  await page.getByLabel('Case 1 input').fill('Hello?');
  await page.getByRole('button', { name: 'Save project' }).click();
  const row = page.getByRole('listitem').filter({ has: page.getByLabel('Case 1 id') });
  await expect(row).toContainText(/has no scorers/);
  await shot(page, 'editor-errors');

  // A field-level loc lands next to its input.
  await page.route('**/api/projects', (r) => r.fulfill({ status: 422, json: { detail: [{ loc: ['cases', '0', 'input'], msg: 'Input is too long.' }, { loc: ['pass_threshold'], msg: 'Must be at most 1.' }] } }));
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(row).toContainText('Input is too long.');
  await expect(page.getByLabel('Pass threshold')).toHaveAccessibleDescription(/Must be at most 1/);
  await expect(page.getByLabel('Case 1 input')).toHaveAttribute('aria-invalid', 'true');
});

test('[AC-9.2] a taken name is reported at the name field', async ({ page, request }) => {
  await create(request, 'qa-nine-taken');
  await page.goto('/projects/edit/?new=1');
  await page.getByLabel('Name', { exact: true }).fill('qa-nine-taken');
  await page.getByRole('checkbox', { name: /^contains/ }).check();
  await page.getByRole('button', { name: 'Add case' }).click();
  await page.getByLabel('Case 1 id').fill('c1');
  await page.getByLabel('Case 1 input').fill('Hello?');
  await page.getByLabel('Case 1 expected').fill('Hi');
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveAccessibleDescription(/already exists/);
});

test('[AC-9.2] an unknown slug shows a not-found state', async ({ page }) => {
  await page.goto('/projects/edit/?slug=does-not-exist');
  await expect(page.getByText('Project not found')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to projects' })).toBeVisible();
});

test('[AC-9.2] the editor is usable at 390px with no sideways scroll', async ({ page, request }) => {
  await create(request, 'qa-nine-mobile');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/projects/edit/?slug=qa-nine-mobile');
  await expect(page.getByLabel('Case 1 id')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, 'editor-390');
});
