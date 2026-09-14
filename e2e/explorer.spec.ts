import { expect, test, type Page, type Route } from '@playwright/test';

const rootUrl = 'https://8-fixture.manager.zesty.io/content/6-rootmodel';
const childUrl = 'https://8-fixture.manager.zesty.io/content/6-childmodel';

interface FakeApiState {
  unauthorized: boolean;
  networkFailure: boolean;
  partialRoot: boolean;
  forbiddenModels: Set<string>;
  requests: string[];
}

function rawItem(id: string, title: string, fields: Readonly<Record<string, unknown>> = {}) {
  return {
    data: { title, ...fields },
    meta: {
      ZUID: id,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      version: 1,
    },
  };
}

const childItems = Array.from({ length: 30 }, (_, index) =>
  rawItem(`7-child-${String(index).padStart(6, '0')}`, `Child ${index}`, {
    parentKey: 'root-0',
    active: index % 2 === 0,
  }),
);

const rootItems = Array.from({ length: 105 }, (_, index) =>
  rawItem(
    `7-root-${String(index).padStart(6, '0')}`,
    index === 0
      ? '<strong>First story</strong>'
      : `Story ${index} with a deliberately long title used to exercise the full-value popover`,
    {
      rootKey: `root-${index}`,
      primaryChild: index === 0 ? childItems.map((item) => item.meta.ZUID) : [],
      secondaryChild: index === 0 ? childItems[0]?.meta.ZUID : null,
      category: index % 2 ? 'news' : 'guide',
      score: index,
    },
  ),
);

const fieldsByModel: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>> = {
  '6-rootmodel': [
    { ZUID: '12-title-root', name: 'title', label: 'Title', datatype: 'text' },
    { ZUID: '12-root-key', name: 'rootKey', label: 'Root key', datatype: 'text' },
    {
      ZUID: '12-primary',
      name: 'primaryChild',
      label: 'Primary child',
      datatype: 'relationship',
      relatedModelZUID: '6-childmodel',
    },
    {
      ZUID: '12-secondary',
      name: 'secondaryChild',
      label: 'Secondary child',
      datatype: 'relationship',
      relatedModelZUID: '6-childmodel',
    },
    {
      ZUID: '12-category',
      name: 'category',
      label: 'Category',
      datatype: 'dropdown',
      relatedModelZUID: null,
      options: null,
      settings: { options: { news: 'News', guide: 'Guide' } },
    },
    { ZUID: '12-score-root', name: 'score', label: 'Score', datatype: 'number' },
  ],
  '6-childmodel': [
    { ZUID: '12-title-child', name: 'title', label: 'Title', datatype: 'text' },
    { ZUID: '12-parent-key', name: 'parentKey', label: 'Parent key', datatype: 'text' },
    { ZUID: '12-active-child', name: 'active', label: 'Active', datatype: 'boolean' },
  ],
};

async function fulfillApi(route: Route, state: FakeApiState) {
  const request = route.request();
  state.requests.push(`${request.method()} ${request.url()}`);
  const cors = {
    'access-control-allow-origin': 'http://localhost:5173',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,OPTIONS',
  };
  if (request.method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: cors });
    return;
  }
  if (state.networkFailure) {
    await route.abort('failed');
    return;
  }
  expect(request.method()).toBe('GET');
  expect(request.headers().authorization).toBe('Bearer synthetic-session-token');
  if (state.unauthorized) {
    await route.fulfill({ status: 401, headers: cors, json: {} });
    return;
  }

  const url = new URL(request.url());
  const model = url.pathname.match(/models\/(6-[^/]+)/)?.[1];
  if (!model) throw new Error(`Unexpected fake API URL: ${url.toString()}`);
  if (state.forbiddenModels.has(model)) {
    await route.fulfill({ status: 403, headers: cors, json: {} });
    return;
  }
  if (url.pathname.endsWith('/fields')) {
    await route.fulfill({ headers: cors, json: { data: fieldsByModel[model] ?? [] } });
    return;
  }
  const data = model === '6-childmodel' ? childItems : rootItems;
  const limit = Number(url.searchParams.get('limit') ?? 2_500);
  const page = Number(url.searchParams.get('page') ?? 1);
  const partialTotal = model === '6-rootmodel' && state.partialRoot ? 10_001 : data.length;
  const pageData =
    model === '6-rootmodel' && state.partialRoot
      ? Array.from(
          { length: Math.min(limit, Math.max(0, partialTotal - (page - 1) * limit)) },
          (_, index) => {
            const itemIndex = (page - 1) * limit + index;
            return rawItem(
              `7-partial-${String(itemIndex).padStart(6, '0')}`,
              `Partial ${itemIndex}`,
            );
          },
        )
      : data.slice((page - 1) * limit, page * limit);
  await route.fulfill({
    headers: cors,
    json: {
      data: pageData,
      _meta: { totalResults: partialTotal, page, limit },
    },
  });
}

async function installFakeApi(page: Page): Promise<FakeApiState> {
  const state: FakeApiState = {
    unauthorized: false,
    networkFailure: false,
    partialRoot: false,
    forbiddenModels: new Set(),
    requests: [],
  };
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') await route.continue();
    else await route.abort('blockedbyclient');
  });
  await page.route('https://8-fixture.api.zesty.io/**', (route) => fulfillApi(route, state));
  return state;
}

async function openRoot(page: Page) {
  await page.goto('/');
  await expect(page.getByText('How to find the token')).toBeVisible();
  await page.getByText('How to find the token').click();
  await expect(page.getByText(/Copy APP_SID for production/)).toBeVisible();
  await page.getByLabel('Zesty session token').fill('synthetic-session-token');
  await page.getByLabel('Root collection URL').fill(rootUrl);
  await page.getByRole('button', { name: 'Open collection' }).click();
  await expect(page.getByRole('heading', { name: '6-rootmodel' })).toBeVisible();
}

async function addNativeChild(page: Page) {
  await page.getByRole('button', { name: 'Add related collection' }).click();
  await page.getByLabel('Related collection URL').fill(childUrl);
  await page.getByLabel('Node name').fill('Children');
  await page.getByLabel('Native field').selectOption('primaryChild');
  await page.getByRole('button', { name: 'Add collection node' }).click();
  await expect(page.getByText('Children', { exact: true })).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('requests Zesty using only headers accepted by its CORS preflight', async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const captured = window as unknown as { __zestyRequestHeaders: string[][] };
    captured.__zestyRequestHeaders = [];
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (new URL(url).hostname.endsWith('.api.zesty.io')) {
        const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
        const corsUnsafeHeaders = [...headers.keys()].filter(
          (name) =>
            !['accept', 'accept-language', 'content-language', 'content-type', 'range'].includes(
              name,
            ),
        );
        captured.__zestyRequestHeaders.push(corsUnsafeHeaders);
      }
      return originalFetch(input, init);
    };
  });
  const state = await installFakeApi(page);
  await openRoot(page);

  const requestHeaders = await page.evaluate(
    () => (window as unknown as { __zestyRequestHeaders: string[][] }).__zestyRequestHeaders,
  );
  expect(state.requests.length).toBeGreaterThan(0);
  expect(requestHeaders.length).toBeGreaterThan(0);
  for (const headers of requestHeaders) expect(headers).toEqual(['authorization']);
});

test('opens, filters, paginates, refreshes, and recovers from authentication failure', async ({
  page,
}) => {
  const state = await installFakeApi(page);
  await openRoot(page);

  await expect(page.getByRole('cell', { name: 'First story', exact: true })).toBeVisible();
  await page.getByLabel('Table filter relationship path').selectOption({ label: '6-rootmodel' });
  await page.getByLabel('Table filter field').selectOption('score');
  await page.getByLabel('Table filter operator').selectOption('greater-than');
  await page.getByLabel('Table filter value').fill('100');
  await page.getByLabel('Table filter').getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('4 items')).toBeVisible();

  await page
    .getByLabel('Table filter')
    .getByRole('button', { name: /Remove filter score/ })
    .click();
  await page.getByRole('button', { name: 'Next' }).last().click();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await page.getByLabel('Published only').check();
  await expect
    .poll(() => state.requests.some((request) => request.includes('_active=true')))
    .toBe(true);

  state.unauthorized = true;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('heading', { name: 'Replace your session token' })).toBeVisible();
  expect(page.url()).toContain('#view=');
});

test('reports the browser origin without claiming that CORS caused a network failure', async ({
  page,
}) => {
  const state = await installFakeApi(page);
  state.networkFailure = true;
  await page.goto('/');
  await page.getByLabel('Zesty session token').fill('synthetic-session-token');
  await page.getByLabel('Root collection URL').fill(rootUrl);
  await page.getByRole('button', { name: 'Open collection' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('The Zesty request could not reach the server.');
  await expect(alert).toContainText('http://localhost:5173');
  await expect(alert).toContainText('CORS may be the cause');
});

test('creates native and custom roles, expands related rows, and preserves details focus', async ({
  page,
}) => {
  const state = await installFakeApi(page);
  await openRoot(page);
  await addNativeChild(page);

  await page.getByRole('button', { name: 'Add related collection' }).first().click();
  await page.getByLabel('Related collection URL').fill(childUrl);
  await page.getByLabel('Node name').fill('Custom children');
  await page.getByLabel('Relationship type').selectOption('custom');
  await page.getByLabel('Parent field path').fill('rootKey');
  await page.getByLabel('Child field path').fill('parentKey');
  await page.getByRole('button', { name: 'Add collection node' }).click();
  await expect(page.getByText('Custom children', { exact: true })).toBeVisible();
  await expect
    .poll(
      () =>
        state.requests.filter(
          (request) => request.startsWith('GET ') && request.includes('6-childmodel'),
        ).length,
    )
    .toBe(2);

  await page.getByText('Columns', { exact: true }).first().click();
  await page.getByRole('checkbox', { name: 'ZUID' }).first().check();
  await expect(page.getByRole('columnheader', { name: 'ZUID' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit relationship for Custom children' }).click();
  await page.getByLabel('Parent field path').fill('legacy.path');
  await page.getByRole('button', { name: 'Save relationship' }).click();

  const expand = page.getByRole('button', { name: 'Expand relationships for 7-root-000000' });
  await expand.click();
  await expect(
    page.getByRole('region', { name: 'Children related items', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Custom children related items' })).toBeVisible();
  await expect(page.getByText(/field path that is no longer/i)).toBeVisible();
  await page.getByRole('button', { name: 'Edit relationship for Custom children' }).click();
  await page.getByLabel('Parent field path').fill('rootKey');
  await page.getByRole('button', { name: 'Save relationship' }).click();
  await expect(page.getByText(/field path that is no longer/i)).toHaveCount(0);
  await expect(page.getByRole('table').first()).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Open First story in Zesty Manager' }),
  ).toHaveAttribute('href', `${rootUrl}/7-root-000000`);

  const children = page.getByRole('region', { name: 'Children related items', exact: true });
  await children.getByRole('button', { name: 'Next' }).click();
  await expect(children.getByText('Page 2 of 2')).toBeVisible();
  await children.getByLabel('Filter Children').fill('no matching item');
  await expect(children.getByText('Page 1 of 1')).toBeVisible();
  await children.getByLabel('Filter Children').fill('');

  const preview = page.getByRole('button', { name: 'Preview full Title' }).first();
  await preview.focus();
  await preview.press('Enter');
  await expect(page.locator('.value-popover')).toContainText('deliberately long title');
  await page.locator('.value-popover').getByRole('button', { name: 'Close' }).click();

  const detailsTrigger = page.getByRole('button', { name: 'Open details for First story' });
  await detailsTrigger.focus();
  await detailsTrigger.press('Enter');
  await expect(page.getByRole('dialog', { name: '7-root-000000' })).toBeVisible();
  await page.getByRole('button', { name: 'Copy title' }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('First story');
  await page.getByRole('tab', { name: 'Raw JSON' }).click();
  await expect(page.locator('.raw-json')).toContainText('primaryChild');
  await page.getByRole('button', { name: 'Close item details' }).click();
  await expect(detailsTrigger).toBeFocused();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove Custom children' }).click();
  await expect(page.getByText('Custom children', { exact: true })).toHaveCount(0);
});

test('uses descendant filters and restores a non-secret link in another tab', async ({
  page,
  context,
}) => {
  await installFakeApi(page);
  await openRoot(page);
  await addNativeChild(page);
  await page
    .getByLabel('View filter relationship path')
    .selectOption({ label: '6-rootmodel → Children' });
  await page.getByLabel('View filter field').selectOption('active');
  await page.getByLabel('View filter operator').selectOption('true');
  await page.getByLabel('View filter').getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('1 items')).toBeVisible();

  await page.getByRole('button', { name: 'Copy view link' }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('#view=');
  expect(copied).not.toContain('synthetic-session-token');
  const restored = await context.newPage();
  await installFakeApi(restored);
  await restored.goto(copied);
  await expect(restored.getByRole('heading', { name: 'Replace your session token' })).toBeVisible();
  await restored.getByLabel('Zesty session token').fill('synthetic-session-token');
  await restored.getByRole('button', { name: 'Open collection' }).click();
  await expect(restored.getByText('1 items')).toBeVisible();
  await expect(restored.getByText(/active · true/)).toBeVisible();
  await restored.close();
});

test('recovers corrupt links and confirms root replacement and reset', async ({ page }) => {
  await installFakeApi(page);
  await page.goto('/#view=truncated');
  await expect(
    page.getByRole('heading', { name: 'Shared view could not be restored' }),
  ).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByRole('heading', { name: 'Open a Zesty collection' })).toBeVisible();

  await openRoot(page);
  let seed = 2_026;
  const longText = Array.from({ length: 14_000 }, () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return String.fromCharCode(33 + (seed % 90));
  }).join('');
  await page.getByLabel('Search the complete view').fill(longText);
  await expect(page.getByText(/may be too long for some tools/i)).toBeVisible();
  await page.getByLabel('Search the complete view').fill('');
  await page.getByRole('button', { name: 'Replace root' }).click();
  await expect(page.getByRole('heading', { name: 'Replace the root collection' })).toBeVisible();
  await page.getByLabel('Root collection URL').fill(childUrl);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Open collection' }).click();
  await expect(page.getByRole('heading', { name: '6-childmodel' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page).not.toHaveURL(/#view=/);
});

test('keeps partial roots and failed descendants usable with persistent recovery', async ({
  page,
}) => {
  const state = await installFakeApi(page);
  state.partialRoot = true;
  await openRoot(page);
  await expect(page.getByText(/incomplete collection data/i)).toBeVisible();
  await expect(page.getByText('10000 items')).toBeVisible();

  state.forbiddenModels.add('6-childmodel');
  await addNativeChild(page);
  await page
    .getByRole('button', { name: /Expand relationships/ })
    .first()
    .click();
  await expect(page.getByRole('alert')).toContainText('Ask a Zesty administrator for read access');
  await expect(page.getByText('10000 items')).toBeVisible();

  state.forbiddenModels.clear();
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  await expect(
    page.getByRole('region', { name: 'Children related items', exact: true }),
  ).toBeVisible();
});
