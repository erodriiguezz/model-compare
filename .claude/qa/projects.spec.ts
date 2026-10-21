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
  await expect(row.locator('.show-sm')).toBeVisible(); // narrow screens keep dimension and last run under the name
  await expect(row.locator('.show-sm')).toContainText('mock-b');
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
  await page.getByLabel('Case 1 id').fill('capital');
  await page.getByLabel('Case 1 input').fill('Capital of France?');
  await page.getByLabel('Case 1 expected').fill('Paris');
  await page.getByRole('button', { name: 'Add case' }).click(); // a new case opens expanded, the previous one folds
  await expect(page.getByLabel('Case 1 id')).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Edit case 1' }).click();
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
  await expect(page.getByLabel('Case 1 scorer')).toHaveAccessibleDescription(/has no scorers/); // under the field it belongs to
  await expect(page.getByLabel('Case 1 expected')).not.toHaveAttribute('aria-invalid', 'true');
  await shot(page, 'editor-errors');

  // A field-level loc lands next to its input.
  await page.route('**/api/projects', (r) => r.fulfill({ status: 422, json: { detail: [{ loc: ['cases', '0', 'input'], msg: 'Input is too long.' }, { loc: ['pass_threshold'], msg: 'Must be at most 1.' }] } }));
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByLabel('Case 1 input')).toHaveAccessibleDescription('Input is too long.');
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
  await expect(page.getByRole('button', { name: 'Edit case 1' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Edit case 1' }).click();
  await expect(page.getByLabel('Case 1 id')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, 'editor-390');
});

const editCase = (page: Page, n: number) => page.getByRole('button', { name: `Edit case ${n}` });
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `q${i + 1}`, input: `Question number ${i + 1} with a rather long text that must be cut in the table row`, expected: `Answer ${i + 1}` }));
async function createFull(request: APIRequestContext, body: object) {
  const res = await request.post('/api/projects', { data: body });
  expect(res.status(), await res.text()).toBe(201);
  const slug = (await res.json()).slug as string;
  made.push(slug);
  return slug;
}

test('[AC-9.2] a project round-trips untouched: vars, documents, tools, repeats, typed expected values and scorer params survive a save', async ({ page, request }) => {
  const slug = await createFull(request, {
    name: 'qa-nine-round', version: '2', dimension: 'knowledge', description: 'before', system_prompt: 'Be brief.', repeats: 3, pass_threshold: 0.5,
    tools: [{ name: 'lookup', description: 'Look up', parameters: { type: 'object', properties: { q: { type: 'string' } } } }],
    documents: { doc1: 'A long document.' },
    scorers: [{ type: 'contains', params: { values: ['a'] } }, { type: 'contains', weight: 2, params: { values: ['b'] } }],
    cases: [
      { id: 'n1', input: 'Q1', expected: 42, vars: { must_include: ['x'] }, tags: ['t1', 't2'], document: 'doc1' },
      { id: 'n2', input: 'Q2', expected: { a: [1, 2] }, scorers: [{ type: 'regex', params: { pattern: '^a' } }] },
      { id: 'n3', input: 'Q3', expected: '[1, 2]', scorers: [{ type: 'exact' }, { type: 'contains', weight: 0.5, params: { values: ['x'] } }] },
      { id: 'n4', input: 'Q4', expected: ['p', 'q'] },
    ],
  });
  const before = await (await request.get(`/api/projects/${slug}`)).json();
  await page.goto(`/projects/edit/?slug=${slug}`);
  // Two scorers of one type each keep their own parameters.
  await expect(page.getByLabel('contains parameters 1')).toHaveValue('{"values":["a"]}');
  await expect(page.getByLabel('contains parameters 2')).toHaveValue('{"values":["b"]}');
  await page.getByLabel('Description').fill('after');
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  const after = await (await request.get(`/api/projects/${slug}`)).json();
  expect(after).toEqual({ ...before, description: 'after' });
});

test('[AC-9.2] expected values keep their type: text stays text, numbers and objects stay JSON', async ({ page, request }) => {
  const slug = await createFull(request, { name: 'qa-nine-types', dimension: 'knowledge', scorers: [{ type: 'contains' }], cases: [
    { id: 'str', input: 'A', expected: 'x' }, { id: 'num', input: 'B', expected: 42 }, { id: 'obj', input: 'C', expected: { a: 1 } }, { id: 'bad', input: 'D', expected: [1] },
  ] });
  await page.goto(`/projects/edit/?slug=${slug}`);
  const set = async (n: number, text: string) => { await editCase(page, n).click(); await page.getByLabel(`Case ${n} expected`).fill(text); };
  await set(1, '[3]'); // a string stays a string, even when it looks like JSON
  await set(2, '43');
  await set(3, '{"a": 2}');
  await set(4, '[1,'); // not JSON: falls back to the text
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  const cases = (await (await request.get(`/api/projects/${slug}`)).json()).cases;
  expect(cases.map((c: { expected: unknown }) => c.expected)).toEqual(['[3]', 43, { a: 2 }, '[1,']);
});

test('[AC-9.2] a new case gets the first unused case-N id, and duplicate ids are flagged on the row before saving', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/projects', (r) => { if (r.request().method() !== 'GET') writes++; return r.continue(); });
  await page.goto('/projects/edit/?new=1');
  await page.getByLabel('Name', { exact: true }).fill('qa-nine-dup');
  await page.getByRole('button', { name: 'Add case' }).click();
  await page.getByRole('button', { name: 'Add case' }).click();
  await expect(page.getByLabel('Case 2 id')).toHaveValue('case-2');
  await editCase(page, 1).click();
  await page.getByRole('button', { name: 'Delete case 1' }).click();
  await page.getByRole('button', { name: 'Add case' }).click();
  await expect(page.getByLabel('Case 2 id')).toHaveValue('case-1'); // case-1 was free again
  await page.getByLabel('Case 2 id').fill('case-2');
  await expect(page.getByLabel('Case 2 id')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('Case 2 id')).toHaveAccessibleDescription(/Duplicate id/);
  await page.getByRole('checkbox', { name: /^contains/ }).check();
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByLabel('Case 2 id')).toHaveAccessibleDescription(/Duplicate id/);
  expect(writes).toBe(0);
});

test('[AC-9.2] the slug in the URL is validated before anything is fetched', async ({ page }) => {
  const seen: string[] = [];
  page.on('request', (r) => { if (/\/api\/projects\//.test(r.url())) seen.push(r.url()); });
  for (const bad of ['..%2Fetc', 'A%20B', 'x'.repeat(65)]) {
    await page.goto(`/projects/edit/?slug=${bad}`);
    await expect(page.getByText('Project not found')).toBeVisible();
  }
  expect(seen).toEqual([]);
});

test('[AC-9.2] the scorer picker shows every scorer unclipped in a grid, and warns on code-running ones', async ({ page }) => {
  await page.goto('/projects/edit/?new=1');
  const grid = page.getByTestId('scorer-grid');
  await expect(grid).toBeVisible();
  expect(await grid.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true); // no inner scroll box, no half-cut row
  const items = grid.locator('.scorer');
  const [a, b] = [await items.nth(0).boundingBox(), await items.nth(1).boundingBox()];
  expect(b!.x).toBeGreaterThan(a!.x); // two columns at 1280
  await expect(page.getByText(/runs Python on this machine/)).toHaveCount(0);
  await page.getByRole('checkbox', { name: /^code_exec/ }).check();
  await expect(page.getByText('Runs Python on this machine — only use with code you trust.')).toBeVisible();
  await page.getByRole('checkbox', { name: /^test_quality/ }).check();
  await expect(page.getByText(/only use with code you trust/)).toHaveCount(2);
  await shot(page, 'scorer-grid');
  await page.setViewportSize({ width: 390, height: 844 });
  const [c, d] = [await items.nth(0).boundingBox(), await items.nth(1).boundingBox()];
  expect(d!.x).toBe(c!.x); // one column at 390
  await shot(page, 'scorer-grid-390');
});

test('[AC-9.2] twelve or more cases stay scannable: a compact table, one expanded case at a time', async ({ page, request }) => {
  const slug = await createFull(request, { name: 'qa-nine-many', dimension: 'knowledge', scorers: [{ type: 'contains' }], cases: many(14) });
  await page.goto(`/projects/edit/?slug=${slug}`);
  const table = page.getByRole('table', { name: 'Cases' });
  await expect(table.getByRole('button', { name: /^Edit case \d+$/ })).toHaveCount(14);
  await expect(page.getByLabel('Case 1 id')).toHaveCount(0);
  const rowH = (await table.getByRole('row').nth(1).boundingBox())!.height;
  expect(rowH).toBeLessThan(80); // a row is one or two lines, not a form
  await shot(page, 'editor-many');
  await editCase(page, 3).click();
  await expect(editCase(page, 3)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Case 3 input')).toBeVisible();
  await shot(page, 'editor-case-open');
  await editCase(page, 5).focus();
  await page.keyboard.press('Enter');
  await expect(editCase(page, 5)).toHaveAttribute('aria-expanded', 'true');
  await expect(editCase(page, 3)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Case 3 id')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, 'editor-many-390');
const draftWith = async (page: Page) => {
  await page.getByRole('button', { name: 'Draft with AI' }).click();
  const dialog = page.getByRole('dialog', { name: 'Draft with AI' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Model').selectOption('mock-drafter');
  await dialog.getByLabel('Describe the project').fill('Capital cities of Europe');
  await dialog.getByLabel('Examples').fill('Capital of Spain? => Madrid\nCapital of Italy? => Rome');
  return dialog;
};

test('[AC-9.3] Draft fills the editor unsaved with a cost banner, and every field is editable before saving', async ({ page, request }) => {
  made.push('qa-drafted');
  page.on('dialog', (d) => { throw new Error(`native ${d.type()} dialog: ${d.message()}`); });
  await page.goto('/projects/edit/?new=1');
  const dialog = await draftWith(page);
  await dialog.getByRole('button', { name: 'Draft', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: /Unsaved draft · cost \$/ })).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('qa-drafted');
  await expect(page.getByLabel('Case 3 id')).toHaveValue('c3');
  await expect(page.getByRole('checkbox', { name: /^contains/ })).toBeChecked();
  expect((await request.get('/api/projects/qa-drafted')).status()).toBe(404); // nothing saved yet
  await shot(page, 'editor-draft');
  await page.getByLabel('Case 1 expected').fill('Paris, France');
  await page.getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await expect(page.getByText('Unsaved draft')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('qa-drafted');
  expect((await (await request.get('/api/projects/qa-drafted')).json()).cases[0].expected).toBe('Paris, France');

  // A project created in this session runs under the name it was saved with.
  await page.getByRole('button', { name: 'Run on selected models' }).click();
  await page.getByRole('dialog', { name: 'Run on selected models' }).getByRole('checkbox', { name: /^mock-a\b/ }).check();
  await page.getByRole('button', { name: 'Open Compare' }).click();
  await expect(page).toHaveURL(/benchmarks=qa-drafted$/);
  await expect(page.getByRole('checkbox', { name: /^qa-drafted\b/ })).toBeChecked();
});

test('[AC-9.3] the dialog traps focus, Esc closes it and returns focus, and draft errors stay inside it', async ({ page }) => {
  await page.goto('/projects/edit/?new=1');
  const trigger = page.getByRole('button', { name: 'Draft with AI' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Draft with AI' });
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.route('**/api/projects/draft', (r) => r.fulfill({ status: 422, json: { detail: [{ loc: ['scorers'], msg: 'Drafts cannot use code-running scorers (code_exec).' }] } }));
  await draftWith(page);
  await dialog.getByRole('button', { name: 'Draft', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('code-running scorers');
  await shot(page, 'draft-dialog-error');
  await page.unroute('**/api/projects/draft');
  await page.route('**/api/projects/draft', (r) => r.fulfill({ status: 502, json: { detail: 'The model call failed: boom' } }));
  await dialog.getByRole('button', { name: 'Draft', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('The model call failed');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('');
});

test('[AC-9.3] leaving with unsaved changes asks in an in-page dialog; saved or untouched forms leave freely', async ({ page }) => {
  page.on('dialog', (d) => { throw new Error(`native ${d.type()} dialog: ${d.message()}`); });
  await page.goto('/projects/edit/?new=1');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Models' }).click();
  await expect(page).toHaveURL(/\/models\/$/); // untouched: no prompt
  await page.goBack();
  await page.getByLabel('Name', { exact: true }).fill('half-written');
  await page.getByRole('link', { name: '← Projects' }).click();
  const ask = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(ask).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/edit\//);
  await shot(page, 'leave-dialog');
  await ask.getByRole('button', { name: 'Stay' }).click();
  await expect(ask).toBeHidden();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('half-written');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
  await ask.getByRole('button', { name: 'Discard and leave' }).click();
  await expect(page).toHaveURL(/\/settings\/$/);
});

test('[AC-9.4] Run on selected models opens Compare with the project and models preselected, and the run completes', async ({ page, request }) => {
  await create(request, 'qa-nine-run');
  await page.goto('/projects/edit/?slug=qa-nine-run');
  await page.getByRole('button', { name: 'Run on selected models' }).click();
  const dialog = page.getByRole('dialog', { name: 'Run on selected models' });
  await expect(dialog.getByRole('button', { name: 'Open Compare' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /^mock-a\b/ }).check();
  await dialog.getByRole('checkbox', { name: /^mock-b\b/ }).check();
  await shot(page, 'run-dialog');
  await dialog.getByRole('button', { name: 'Open Compare' }).click();
  await expect(page).toHaveURL(/\/compare\/\?targets=mock-a%2Cmock-b&benchmarks=qa-nine-run$/);
  await expect(page.getByRole('checkbox', { name: /^mock-a\b/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^qa-nine-run\b/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^std-reasoning-math\b/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await expect(page).toHaveURL(/\/compare\/\?job=\w+/);
  await page.getByText('Details', { exact: true }).click({ timeout: 30_000 });
  await expect(page.getByText('qa-nine-run').first()).toBeVisible();
});
