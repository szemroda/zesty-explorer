import { expect, test, type Page } from '@playwright/test';
import {
  codeInstanceUrl,
  installCodeFixture,
  previewOrigin,
  syntheticToken,
} from './code-fixtures';

async function prepare(page: Page) {
  await installCodeFixture(page);
  await page.goto('/');
  await page.getByLabel('Zesty session token').fill(syntheticToken);
  await page.getByLabel('Zesty instance URL').fill(codeInstanceUrl);
  await page.getByRole('button', { name: 'Load collections' }).click();
  await expect(page.getByRole('heading', { name: 'Choose the root collection' })).toBeVisible();
  await page.getByRole('tab', { name: 'Code' }).click();
}

async function selectEndpoint(page: Page, path = '/data/articles.json') {
  await page
    .getByRole('navigation', { name: 'Code files' })
    .getByRole('button', { name: new RegExp(`^${path.replace(/[/.]/g, '\\$&')}`) })
    .click();
  await expect(
    page.getByRole('form', { name: 'Request' }).getByRole('button', { name: 'Send' }),
  ).toBeEnabled();
}

test('paces each tab while sharing four active slots and releases them after requests finish', async ({
  context,
  page,
}) => {
  const second = await context.newPage();
  const startsByTab: number[][] = [];
  let active = 0;
  let peak = 0;
  for (const tab of [page, second]) {
    const starts: number[] = [];
    startsByTab.push(starts);
    await installCodeFixture(tab);
    await tab.route(/https:\/\/(?:8-fixture|accounts)\.api\.zesty\.io\//, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      starts.push(Date.now());
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.fallback();
      active -= 1;
    });
    await tab.goto('/');
    await tab.getByLabel('Zesty session token').fill(syntheticToken);
    await tab.getByLabel('Zesty instance URL').fill(codeInstanceUrl);
  }
  await Promise.all(
    [page, second].map(async (tab) => {
      await tab.getByRole('button', { name: 'Load collections' }).click();
      await expect(tab.getByRole('heading', { name: 'Choose the root collection' })).toBeVisible();
      await tab.getByRole('tab', { name: 'Code' }).click();
      await selectEndpoint(tab);
    }),
  );
  for (const starts of startsByTab) {
    expect(starts.length).toBeGreaterThanOrEqual(5);
    expect(starts.slice(1).every((start, index) => start - starts[index] >= 240)).toBe(true);
  }
  expect(peak).toBe(4);
  await expect.poll(() => active).toBe(0);
  const held = await page.evaluate(
    async () =>
      (await navigator.locks.query()).held?.filter((lock) =>
        lock.name?.startsWith('zesty-request-slot-'),
      ).length,
  );
  expect(held).toBe(0);
});

test('restores a cooldown on reload while another tab can send independently', async ({
  context,
  page,
}) => {
  const second = await context.newPage();
  await Promise.all([prepare(page), prepare(second)]);
  await Promise.all([selectEndpoint(page), selectEndpoint(second)]);
  let sends = 0;
  await page.route(`${previewOrigin}/**`, async (route) => {
    sends += 1;
    await route.fulfill({
      status: 429,
      headers: { 'access-control-allow-origin': '*', 'retry-after': '60' },
      body: 'Please slow down',
    });
  });
  await second.route(`${previewOrigin}/**`, async (route) => {
    sends += 1;
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*' },
      body: 'Other tab response',
    });
  });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Response' })).toContainText('429');
  await expect(page.getByTestId('response-body').locator('pre').last()).toHaveText(
    'Please slow down',
  );
  await second.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(second.getByTestId('response-body').locator('pre').last()).toHaveText(
    'Other tab response',
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Response' })).toContainText('Retry after');
  expect(sends).toBe(2);
  const saved = await page.evaluate(() => sessionStorage.getItem('zesty-request-cooldowns'));
  expect(JSON.parse(saved ?? 'null')).toEqual({
    instances: 0,
    accounts: 0,
    webengine: expect.any(Number),
  });
  expect(await second.evaluate(() => sessionStorage.getItem('zesty-request-cooldowns'))).toBeNull();
});

test('closing a tab releases its active slots and allows a queued tab to load', async ({
  context,
  page,
}) => {
  const tabs = [page, ...(await Promise.all(Array.from({ length: 4 }, () => context.newPage())))];
  const started: Page[] = [];
  for (const tab of tabs) {
    await installCodeFixture(tab);
    await tab.route('https://8-fixture.api.zesty.io/**', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      started.push(tab);
      await new Promise<void>((resolve) => {
        tab.once('close', () => resolve());
      });
    });
    await tab.goto('/');
    await tab.getByLabel('Zesty session token').fill(syntheticToken);
    await tab.getByLabel('Zesty instance URL').fill(codeInstanceUrl);
  }
  await Promise.all(
    tabs.map((tab) => tab.getByRole('button', { name: 'Load collections' }).click()),
  );
  await expect.poll(() => started.length).toBe(4);
  const first = started[0];
  if (!first) throw new Error('Expected an active tab');
  await first.close();
  await expect.poll(() => started.length).toBe(5);
  await Promise.all(tabs.filter((tab) => !tab.isClosed()).map((tab) => tab.close()));
});
