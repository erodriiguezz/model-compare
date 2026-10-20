import { test, expect } from '@playwright/test';

const PAGES = [
  { path: '/', active: 'Compare' },
  { path: '/compare/', active: 'Compare' },
  { path: '/models/', active: 'Models' },
  { path: '/projects/', active: 'Projects' },
  { path: '/settings/', active: 'Settings' },
];
const VIEWPORTS = [{ name: '1280', width: 1280, height: 800 }, { name: '390', width: 390, height: 844 }];

for (const vp of VIEWPORTS) {
  for (const { path, active } of PAGES) {
    test(`[AC-2.2] ${path} shell at ${vp.name}px`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(path);
      const nav = page.getByRole('navigation', { name: 'Main' });
      for (const label of ['Compare', 'Models', 'Projects', 'Settings']) await expect(nav.getByRole('link', { name: label })).toBeVisible();
      await expect(nav.locator('[aria-current="page"]')).toHaveText(active);
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim())).toBe('#f7f7f5');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (vp.width === 390) {
        const left = await page.locator('h1').evaluate((el) => el.getBoundingClientRect().left);
        expect(left).toBe(16);
      }
    });
  }
}

test('[AC-2.1] the Next app is served at / and the API at /api and the old path', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Compare' })).toBeVisible();
  const a = await request.get('/api/targets');
  const b = await request.get('/targets');
  expect(a.ok()).toBe(true);
  expect(await a.json()).toEqual(await b.json());
});

test('[AC-2.3] loading, ready, empty and error states', async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  await page.route('**/api/targets', async (route) => { await gate; await route.continue(); });
  await page.goto('/models/');
  await expect(page.getByRole('status')).toContainText('Loading targets');
  release();
  await expect(page.getByText('targets available')).toBeVisible();
});

test('[AC-2.3] empty state when there are no targets', async ({ page }) => {
  await page.route('**/api/targets', (route) => route.fulfill({ json: [] }));
  await page.goto('/projects/');
  await expect(page.getByRole('heading', { name: 'No targets configured' })).toBeVisible();
});

test('[AC-2.3] error state with retry when the API is down', async ({ page }) => {
  let down = true;
  await page.route('**/api/targets', (route) => (down ? route.abort() : route.continue()));
  await page.goto('/settings/');
  await expect(page.locator('[data-state="error"]')).toContainText('not reachable');
  down = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('targets available')).toBeVisible();
});
