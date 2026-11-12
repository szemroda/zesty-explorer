import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

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
    parent: { zuid: '7-root-000000' },
    active: index % 2 === 0,
  }),
);

const rootItems = Array.from({ length: 105 }, (_, index) =>
  rawItem(
    `7-root-${String(index).padStart(6, '0')}`,
    index === 0
      ? '<strong>First story</strong>'
      : `Story ${index} with a deliberately long title used to exercise the full-value popover and to overflow the item history header on a wide screen`,
    {
      rootKey: `root-${index}`,
      // Zesty returns one_to_many values as one comma-separated ZUID string.
      primaryChild: index === 0 ? childItems.map((item) => item.meta.ZUID).join(',') : null,
      secondaryChild: index === 0 ? childItems[0]?.meta.ZUID : null,
      category: index % 2 ? 'news' : 'guide',
      score: index,
      body:
        index === 0
          ? '<p><strong>Banana on a</strong> <span style="text-decoration: underline;">tree</span>. ' +
            'This <em>is</em> a not-too-long text.</p><ul><li>First point</li><li>Second point</li></ul>'
          : null,
    },
  ),
);

const fieldsByModel: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>> = {
  '6-rootmodel': [
    { ZUID: '12-title-root', name: 'title', label: 'Title', datatype: 'text' },
    { ZUID: '12-body-root', name: 'body', label: 'Body', datatype: 'wysiwyg_basic' },
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
    {
      ZUID: '12-parent',
      name: 'parent',
      label: 'Parent',
      datatype: 'relationship',
      relatedModelZUID: '6-rootmodel',
    },
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
  if (url.pathname === '/v1/instances') {
    await route.fulfill({
      headers: cors,
      json: {
        _meta: { totalResults: 1 },
        data: [{ ZUID: '8-fixture', name: 'Fixture site', domain: 'evil.example' }],
      },
    });
    return;
  }
  if (url.pathname.endsWith('/env/langs')) {
    await route.fulfill({
      headers: cors,
      json: {
        data: [
          { ID: 1, code: 'en-US', name: 'English (US)', active: true, default: true },
          { ID: 2, code: 'de-DE', name: 'German (Germany)', active: true, default: false },
          { ID: 3, code: 'fr-FR', name: 'French (France)', active: false, default: false },
        ],
      },
    });
    return;
  }
  if (url.pathname.endsWith('/content/models')) {
    await route.fulfill({
      headers: cors,
      json: {
        data: [
          { ZUID: '6-rootmodel', label: '6-rootmodel', name: 'root', type: 'pageset' },
          { ZUID: '6-childmodel', label: '6-childmodel', name: 'child', type: 'pageset' },
        ],
      },
    });
    return;
  }
  const model = url.pathname.match(/models\/(6-[^/]+)/)?.[1];
  if (!model) throw new Error(`Unexpected fake API URL: ${url.toString()}`);
  if (url.pathname.endsWith('/versions')) {
    await route.fulfill({
      headers: cors,
      json: {
        data: [
          {
            ...rawItem('7-root-000000', 'Archived First story', { rootKey: 'root-0' }),
            meta: {
              ...rawItem('7-root-000000', '').meta,
              updatedAt: '2026-09-22T12:35:00.000Z',
              version: 2,
            },
            web: {
              versionZUID: '9-version-two',
              createdAt: '2026-09-22T12:35:00.000Z',
              createdByUserZUID: '5-fixture-author',
            },
          },
        ],
      },
    });
    return;
  }
  if (url.pathname.endsWith('/publishings')) {
    await route.fulfill({
      headers: cors,
      json: {
        data: [
          {
            ZUID: '25-active-version-two',
            version: 2,
            versionZUID: '9-version-two',
            publishAt: '2026-09-22T12:35:00.000Z',
            unpublishAt: null,
            _active: true,
          },
        ],
      },
    });
    return;
  }
  if (url.pathname.endsWith('/fields')) {
    await route.fulfill({ headers: cors, json: { data: fieldsByModel[model] ?? [] } });
    return;
  }
  if (state.forbiddenModels.has(model)) {
    await route.fulfill({ status: 403, headers: cors, json: {} });
    return;
  }
  const items = model === '6-childmodel' ? childItems : rootItems;
  // Each language version of an item has its own ZUID.
  const data =
    url.searchParams.get('lang') === 'de-DE'
      ? items.map((item) =>
          rawItem(item.meta.ZUID.replace('7-', '7-de-'), `DE ${String(item.data.title)}`),
        )
      : items;
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
    else {
      state.requests.push(`${route.request().method()} ${route.request().url()}`);
      await route.abort('blockedbyclient');
    }
  });
  await page.route('https://8-fixture.api.zesty.io/**', (route) => fulfillApi(route, state));
  await page.route('https://accounts.api.zesty.io/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/v1/instances') {
      await fulfillApi(route, state);
      return;
    }
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': 'http://localhost:5173',
          'access-control-allow-headers': 'authorization,content-type',
          'access-control-allow-methods': 'GET,OPTIONS',
        },
      });
      return;
    }
    expect(route.request().headers().authorization).toBe('Bearer synthetic-session-token');
    await route.fulfill({
      headers: { 'access-control-allow-origin': 'http://localhost:5173' },
      json: {
        data: [
          {
            ZUID: '5-fixture-author',
            firstName: 'Anna',
            lastName: 'Kowalska',
            email: 'anna@example.test',
          },
        ],
      },
    });
  });
  return state;
}

async function openRoot(page: Page) {
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: 'Open your Production Zesty instances' }),
  ).toHaveAttribute('href', 'https://www.zesty.io/instances/');
  await expect(page.getByText(/Type APP_SID in the filter box/)).toBeVisible();
  await page.getByLabel('Zesty session token').fill('synthetic-session-token');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('combobox', { name: 'Instance' }).fill('Fixture');
  await page.getByRole('option', { name: /Fixture site.*8-fixture/ }).click();
  await page.getByRole('combobox', { name: 'Root collection' }).fill('6-rootmodel');
  await page.getByRole('option', { name: /6-rootmodel.*root/ }).click();
  await page.getByRole('button', { name: 'Open root collection' }).click();
  await expect(page.getByRole('heading', { name: '6-rootmodel' })).toBeVisible();
}

// Searches a table from its Filter button, e.g. `Add view filter`: Enter in the empty field
// picker takes its first field, "Any field".
async function search(page: Page, addLabel: string, editor: string, text: string) {
  await page.getByRole('button', { name: addLabel }).click();
  await page.getByLabel(`${editor} field`).press('Enter');
  await page.getByLabel(`${editor} value`).fill(text);
  await page.getByLabel(`${editor} value`).press('Enter');
}

async function chooseSelectOption(page: Page, label: string, option: string) {
  await page.getByLabel(label).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

// The dialog for any collection or a custom relationship opens from a node's + menu, the root's
// unless a node is named.
async function openAddRelationshipDialog(page: Page, nodeName?: string) {
  // Below the root, the + menu appears when its row is hovered.
  if (nodeName) {
    await page
      .getByRole('complementary', { name: 'Collection tree' })
      .getByText(nodeName, { exact: true })
      .hover();
  }
  await page
    .getByRole('button', {
      name: nodeName ? `Add related collections to ${nodeName}` : /^Add related collections to /,
    })
    .first()
    .click();
  await page.getByRole('button', { name: 'Other collection or custom relationship…' }).click();
}

async function addNativeChild(page: Page) {
  await openAddRelationshipDialog(page);
  await page.getByLabel('Related collection URL').fill(childUrl);
  await page.getByLabel('Node name').fill('Children');
  await chooseSelectOption(page, 'Native field', 'Primary child');
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
  expect(state.requests).toContain('GET https://accounts.api.zesty.io/v1/instances');
  expect(state.requests.some((request) => request.includes('evil.example'))).toBe(false);
  expect(requestHeaders.length).toBeGreaterThan(0);
  for (const headers of requestHeaders) expect(headers).toEqual(['authorization']);
});

test('formats rich text cells and previews their whole text and HTML', async ({ page }) => {
  await installFakeApi(page);
  await openRoot(page);

  const cell = page.getByRole('button', { name: /^Banana on a tree\. This is/ });
  await expect(cell.locator('strong')).toHaveText('Banana on a');
  await expect(cell.locator('u')).toHaveText('tree');
  await expect(cell.locator('li')).toHaveCount(0);

  await cell.hover();
  const preview = page.getByRole('dialog', { name: 'Rich text preview' });
  await expect(preview.getByRole('listitem')).toHaveText(['First point', 'Second point']);
  await preview.getByRole('button', { name: 'HTML' }).click();
  await expect(preview).toContainText('<li>Second point</li>');
});

test('reads the view in a language chosen from the instance languages', async ({ page }) => {
  const state = await installFakeApi(page);
  await openRoot(page);
  const language = page.getByRole('combobox', { name: 'Content language' });
  await expect(language).toContainText('en-US');
  const width = (await language.boundingBox())?.width;
  await language.click();
  await expect(page.getByRole('option')).toHaveText([/English \(US\)/, /German \(Germany\)/]);
  await page.getByRole('option', { name: /German/ }).click();

  await expect(page.getByRole('cell', { name: 'DE Story 1 with', exact: false })).toBeVisible();
  expect(state.requests.some((request) => request.includes('lang=de-DE'))).toBe(true);
  await expect(language).toContainText('de-DE');
  expect((await language.boundingBox())?.width).toBe(width);

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Content language' })).toContainText('de-DE');
});

test('picks the instance and root with the keyboard alone', async ({ page }) => {
  await installFakeApi(page);
  await page.goto('/');
  await page.getByLabel('Zesty session token').fill('synthetic-session-token');
  await page.keyboard.press('Enter');

  // Enter takes the first match, and focus stays in the field for the next Tab.
  const instance = page.getByRole('combobox', { name: 'Instance' });
  await expect(instance).toBeFocused();
  await expect(instance).toHaveAttribute('placeholder', 'Search instances by name or ZUID');
  await page.keyboard.type('Fixture');
  await page.keyboard.press('Enter');
  await expect(instance).toHaveValue('Fixture site');
  await expect(instance).toBeFocused();

  const root = page.getByRole('combobox', { name: 'Root collection' });
  await expect(root).toBeEnabled();
  await root.focus();
  await page.keyboard.type('root');
  await page.keyboard.press('Enter');
  await expect(root).toHaveValue('6-rootmodel');
  await expect(root).toBeFocused();

  // An invalid URL shows its problem when Tab leaves the field, and Tab still moves on.
  const url = page.getByLabel('Or paste a Zesty URL');
  await url.fill('oops');
  await page.keyboard.press('Tab');
  await expect(url).toHaveAttribute('aria-invalid', 'true');
  await expect(url).not.toBeFocused();

  // Opening hands focus to the collection that opened.
  await url.fill('');
  await page.getByRole('button', { name: 'Open root collection' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '6-rootmodel' })).toBeFocused();
});

test('opens a typed collection URL with one click and returns focus on Back', async ({ page }) => {
  await installFakeApi(page);
  await page.goto('/');
  await page.getByLabel('Zesty session token').fill('synthetic-session-token');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByLabel('Zesty session token')).toBeFocused();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Typed, not pasted: the URL applies as the click leaves the field, and the form keeps its
  // shape, so that click still lands on its button.
  await page.getByLabel('Or paste a Zesty URL').pressSequentially(rootUrl);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByLabel('Zesty session token')).toBeFocused();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Or paste a Zesty URL').fill('');
  await page.getByLabel('Or paste a Zesty URL').pressSequentially(rootUrl);
  await page.getByRole('button', { name: 'Open root collection' }).click();
  await expect(page.getByRole('heading', { name: '6-rootmodel' })).toBeVisible();
});

test('opens an item deep link through the pasted URL fallback', async ({ page }) => {
  const state = await installFakeApi(page);
  await page.goto('/');
  await page.getByLabel('Zesty session token').fill('synthetic-session-token');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Or paste a Zesty URL').fill(`${rootUrl}/7-root-000000/edit`);
  await page.getByLabel('Or paste a Zesty URL').blur();
  await expect(page.getByRole('combobox', { name: 'Instance' })).toHaveValue('Fixture site');
  await expect(page.getByRole('combobox', { name: 'Root collection' })).toHaveValue('6-rootmodel');
  await page.getByRole('button', { name: 'Open root collection' }).click();
  await expect(page.getByRole('dialog', { name: 'First story' })).toBeVisible();
  expect(state.requests.some((request) => request.includes('evil.example'))).toBe(false);
});

test('opens, filters, paginates, refreshes, and recovers from authentication failure', async ({
  page,
}) => {
  const state = await installFakeApi(page);
  await openRoot(page);

  await expect(page.getByRole('cell', { name: 'First story', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add view filter' }).click();
  await page.getByLabel('View filter field').fill('Score');
  await page.getByRole('option', { name: /^Score/ }).click();
  await chooseSelectOption(page, 'View filter condition', '>');
  await page.getByLabel('View filter value').fill('100');
  await page.getByLabel('View filter value').press('Enter');
  await expect(page.getByText('4 items')).toBeVisible();

  await page.getByRole('button', { name: /^Remove filter Score/ }).click();
  await page.getByRole('button', { name: 'Next' }).last().click();
  await expect(page.getByText('Page 2 of 2')).toBeVisible();
  await page.getByRole('button', { name: 'Published' }).click();
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
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Or paste a Zesty URL').fill(rootUrl);
  await page.getByLabel('Or paste a Zesty URL').blur();
  await page.getByRole('button', { name: 'Open root collection' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('The Zesty request could not reach the server.');
  await expect(alert).toContainText('http://localhost:5173');
  await expect(alert).toContainText('CORS may be the cause');
});

test('adds the related collections of a new root', async ({ page }) => {
  await installFakeApi(page);
  await page.goto('/');
  await page.getByLabel('Zesty session token').fill('synthetic-session-token');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('combobox', { name: 'Instance' }).fill('Fixture');
  await page.getByRole('option', { name: /Fixture site.*8-fixture/ }).click();
  await page.getByRole('combobox', { name: 'Root collection' }).fill('6-rootmodel');
  await page.getByRole('option', { name: /6-rootmodel.*root/ }).click();
  await page.getByRole('checkbox', { name: /Add related collections/ }).click();
  await page.getByRole('button', { name: 'Open root collection' }).click();

  await expect(page.getByText('Added 2 related collections')).toBeVisible();
  // Two root fields link the child: two roles, named apart. The child's link back to the root
  // shows the same pairs from the other side, so it adds no third node.
  await expect(
    page.getByRole('complementary', { name: 'Collection tree' }).locator('li li span.truncate'),
  ).toHaveText(['Primary child', 'Secondary child']);
  await page.getByRole('button', { name: 'Expand relationships for 7-root-000000' }).click();
  await expect(page.getByRole('region', { name: 'Primary child related items' })).toContainText(
    'Child 0',
  );
});

test('detects a native relationship declared by the nested collection', async ({ page }) => {
  await installFakeApi(page);
  await openRoot(page);

  await openAddRelationshipDialog(page);
  await page.getByLabel('Related collection URL').fill(childUrl);
  await page.getByLabel('Node name').fill('Inverse children');
  await chooseSelectOption(page, 'Native field', 'Parent');
  await page.getByRole('button', { name: 'Add collection node' }).click();
  await expect(page.getByText('Inverse children', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Expand relationships for 7-root-000000' }).click();
  const relatedItems = page.getByRole('region', { name: 'Inverse children related items' });
  await expect(relatedItems).toContainText('Child 0');
});

test('creates native and custom roles, expands related rows, and preserves details focus', async ({
  page,
}) => {
  const state = await installFakeApi(page);
  await openRoot(page);
  await addNativeChild(page);

  await openAddRelationshipDialog(page);
  await page.getByLabel('Related collection URL').fill(childUrl);
  await page.getByLabel('Node name').fill('Custom children');
  await chooseSelectOption(page, 'Relationship type', 'Custom equality');
  await page.getByLabel('Parent field path').fill('rootKey');
  await page.getByLabel('Child field path').fill('parentKey');
  await page.getByRole('button', { name: 'Add collection node' }).click();
  await expect(page.getByText('Custom children', { exact: true })).toBeVisible();
  // Both nodes show one collection, so its items load once.
  await expect
    .poll(
      () =>
        state.requests.filter(
          (request) => request.startsWith('GET ') && request.includes('6-childmodel/items'),
        ).length,
    )
    .toBe(1);

  await page.getByText('Columns', { exact: true }).first().click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'ZUID' }).first()).toBeChecked();
  await expect(page.getByRole('columnheader', { name: 'ZUID' })).toBeVisible();
  await page.getByLabel('Choose visible columns').click();

  await page.getByLabel('Actions for Custom children').click();
  await page.getByRole('menuitem', { name: 'Edit relationship for Custom children' }).click();
  await page.getByLabel('Parent field path').fill('legacy.path');
  await page.getByRole('button', { name: 'Save relationship' }).click();

  const expand = page.getByRole('button', { name: 'Expand relationships for 7-root-000000' });
  await expand.click();
  await expect(
    page.getByRole('region', { name: 'Children related items', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Custom children related items' })).toBeVisible();
  await expect(page.getByText(/field path that is no longer/i)).toBeVisible();
  await page.getByLabel('Actions for Custom children').click();
  await page.getByRole('menuitem', { name: 'Edit relationship for Custom children' }).click();
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
  await search(page, 'Add Children filter', 'Children table filter', 'no matching item');
  await expect(children.getByText('0 related items', { exact: true }).last()).toBeVisible();
  await children
    .getByRole('button', { name: 'Remove filter Any field contains “no matching item”' })
    .click();

  const detailsTrigger = page.getByRole('button', { name: 'Open details for First story' });
  await detailsTrigger.focus();
  await detailsTrigger.press('Enter');
  await expect(page.getByRole('dialog', { name: 'First story' })).toBeVisible();
  const versionTwo = page.getByRole('button', { name: /Version 2/ });
  await expect(versionTwo).toContainText('Latest saved');
  await expect(versionTwo).toContainText('Currently published');
  await expect(versionTwo).toContainText('Anna Kowalska');
  await versionTwo.click();
  await expect(page.getByRole('heading', { name: 'Version 2' })).toBeVisible();
  await expect(page.getByText('Archived First story')).toBeVisible();
  await page.getByRole('button', { name: 'Copy title' }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('First story');
  await page.getByRole('tab', { name: 'Raw JSON' }).click();
  await expect(page.getByRole('tabpanel')).toContainText('Archived First story');
  await page.getByRole('button', { name: 'Compare' }).click();
  await expect(page.getByRole('heading', { name: 'Version 1 → 2' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Raw JSON comparison' })).toContainText(
    '"title": "Archived First story"',
  );
  await page.getByRole('tab', { name: 'Fields' }).click();
  await expect(page.getByRole('region', { name: 'Content fields' })).toContainText('Removed');
  await page.getByRole('button', { name: 'Close item history' }).click();
  await expect(detailsTrigger).toBeFocused();

  await page.getByLabel('Actions for Custom children').click();
  await page.getByRole('menuitem', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('Custom children', { exact: true })).toHaveCount(0);
  const removedToast = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: 'Removed Custom children' });
  await removedToast.getByRole('button', { name: 'Undo' }).click();
  await expect(
    page.getByRole('complementary', { name: 'Collection tree' }).getByText('Custom children'),
  ).toBeVisible();
});

test('uses descendant filters and restores a non-secret link in another tab', async ({
  page,
  context,
}) => {
  await installFakeApi(page);
  await openRoot(page);
  await addNativeChild(page);
  await page.getByRole('button', { name: 'Add view filter' }).click();
  await page.getByLabel('View filter field').fill('Active');
  await page.getByRole('option', { name: /Active/ }).click();
  await page.getByRole('checkbox', { name: /^true/ }).click();
  await page.getByRole('button', { name: /Add filter/ }).click();
  await expect(page.getByText('1 items')).toBeVisible();

  await page.getByRole('button', { name: 'Copy link' }).click();
  const copiedToast = page.locator('[data-sonner-toast]').filter({ hasText: 'Link copied' });
  await expect(copiedToast).toContainText('The session token and code source are not included.');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('#view=');
  expect(copied).not.toContain('synthetic-session-token');
  const restored = await context.newPage();
  await installFakeApi(restored);
  await restored.goto(copied);
  await expect(
    restored.getByRole('heading', { name: 'Enter your Production session token' }),
  ).toBeVisible();
  await restored.getByLabel('Zesty session token').fill('synthetic-session-token');
  await restored.getByRole('button', { name: 'Continue' }).click();
  await expect(restored.getByText('1 items')).toBeVisible();
  await expect(
    restored.getByRole('button', { name: 'Edit filter Children: Active is true' }),
  ).toBeVisible();
  await restored.close();
});

test('recovers corrupt links, confirms root replacement and undoes a reset', async ({ page }) => {
  await installFakeApi(page);
  await page.goto('/#view=truncated');
  await expect(
    page.getByRole('heading', { name: 'Shared view could not be restored' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.getByRole('heading', { name: 'Open a Zesty collection' })).toBeVisible();

  await openRoot(page);
  let seed = 2_026;
  const longText = Array.from({ length: 14_000 }, () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return String.fromCharCode(33 + (seed % 90));
  }).join('');
  await search(page, 'Add view filter', 'View filter', longText);
  await expect(page.getByText(/may be too long for some tools/i)).toBeVisible();
  await page.getByRole('button', { name: /^Remove filter Any field/ }).click();
  await page.getByRole('button', { name: 'Actions for 6-rootmodel' }).click();
  await page.getByRole('menuitem', { name: 'Change root collection' }).click();
  await page.getByLabel('Or paste a Zesty URL').fill(childUrl);
  await page.getByRole('button', { name: 'Open root collection' }).click();
  const replaceRoot = page.getByRole('alertdialog', { name: 'Replace root collection?' });
  await expect(replaceRoot.getByRole('listitem')).toHaveText(['6-rootmodel']);
  await replaceRoot.getByRole('button', { name: 'Replace root' }).click();
  await expect(page.getByRole('heading', { name: '6-childmodel' })).toBeVisible();
  await page.getByLabel('View options').click();
  await page.getByRole('menuitem', { name: 'Reset view' }).click();
  await expect(page).not.toHaveURL(/#view=/);
  const resetToast = page.locator('[data-sonner-toast]').filter({ hasText: 'View reset' });
  await resetToast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('heading', { name: '6-childmodel' })).toBeVisible();
  await expect(page).toHaveURL(/#view=/);
});

test('keeps partial roots and failed descendants usable with persistent recovery', async ({
  page,
}) => {
  const state = await installFakeApi(page);
  state.partialRoot = true;
  await openRoot(page);
  await expect(page.getByText(/incomplete collection data/i)).toBeVisible();
  await expect(page.getByText('10000 items', { exact: true })).toBeVisible();

  state.forbiddenModels.add('6-childmodel');
  await addNativeChild(page);
  await page
    .getByRole('button', { name: /Expand relationships/ })
    .first()
    .click();
  await expect(page.getByRole('alert')).toContainText('Ask a Zesty administrator for read access');
  await expect(page.getByText('10000 items', { exact: true })).toBeVisible();

  state.forbiddenModels.clear();
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();
  await expect(
    page.getByRole('region', { name: 'Children related items', exact: true }),
  ).toBeVisible();
});

test('pins nested tables and docks the root scrollbar while it is off screen', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-laptop', 'Checks the laptop layout.');
  await installFakeApi(page);
  await openRoot(page);
  await addNativeChild(page);
  await page.getByRole('button', { name: 'Expand relationships for 7-root-000000' }).click();
  const children = page.getByRole('region', { name: 'Children related items', exact: true });
  await expect(children).toBeVisible();
  // The root table is the first table on the page, inside its horizontal scroller.
  const scroller = page.getByRole('table').first().locator('..');
  expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
    true,
  );

  const pinnedLeft = (await children.boundingBox())?.x;
  await scroller.evaluate((element) => {
    element.scrollLeft = 200;
  });
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBe(200);
  expect((await children.boundingBox())?.x).toBe(pinnedLeft);

  // A hundred rows put the root table's own scrollbar far below the window.
  const scrollbarTop = await scroller.evaluate((element) => element.getBoundingClientRect().bottom);
  expect(scrollbarTop).toBeGreaterThan(page.viewportSize()?.height ?? 0);
  const dock = page.locator('[data-scroll-dock-bar="6-rootmodel"]');
  await expect(dock).toBeVisible();
  await dock.evaluate((element) => {
    element.scrollLeft = 40;
  });
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBe(40);
});

// The element's top and bottom edges in the viewport.
async function verticalEdges(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('The element is not on the page.');
  return { top: box.y, bottom: box.y + box.height };
}

// The text of each on-screen cell of the row that something outside the row paints over.
function coveredCells(row: Locator) {
  return row.locator(':scope > th, :scope > td').evaluateAll((cells) =>
    cells.flatMap((cell) => {
      const { left, right, top, bottom } = cell.getBoundingClientRect();
      // Cells past the table's own horizontal scroller are clipped, not covered.
      const scroller = cell.closest('[class*="overflow-x-auto"]');
      const edge = Math.min(window.innerWidth, scroller?.getBoundingClientRect().right ?? Infinity);
      if (left >= edge) return [];
      const x = (left + Math.min(right, edge)) / 2;
      const hit = document.elementFromPoint(x, (top + bottom) / 2);
      return hit && cell.parentElement?.contains(hit) ? [] : [cell.textContent];
    }),
  );
}

test('sticks an expanded row over its table header, the nested header below it', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-laptop', 'Checks the laptop layout.');
  await installFakeApi(page);
  await openRoot(page);
  await addNativeChild(page);
  await page.getByRole('button', { name: 'Expand relationships for 7-root-000000' }).click();
  const children = page.getByRole('region', { name: 'Children related items', exact: true });
  await expect(children).toBeVisible();
  const rootTable = page.getByRole('table').first();
  const rootHead = rootTable.locator(':scope > thead > tr');
  const itemRow = rootTable.locator(':scope > tbody > tr').first();
  const childTable = children.getByRole('table');
  const edges = async () => ({
    pageHeader: await verticalEdges(page.locator('main > header')),
    rootHead: await verticalEdges(rootHead),
    itemRow: await verticalEdges(itemRow),
    expansion: await verticalEdges(itemRow.locator('xpath=following-sibling::tr[1]')),
    child: await verticalEdges(childTable),
    childHead: await verticalEdges(childTable.locator(':scope > thead')),
  });
  // Each is -1 while its row is stuck where it belongs, tucked 1px under the row above: the item
  // row over the root header under the page header, and the nested header under the item row.
  // `childEnd` is 0 while the nested header leaves with its table's last row.
  const gaps = async () => {
    const { pageHeader, rootHead, itemRow, child, childHead } = await edges();
    return {
      rootHead: rootHead.top - pageHeader.bottom,
      itemRow: itemRow.top - pageHeader.bottom,
      childHead: childHead.top - itemRow.bottom,
      childEnd: child.bottom - childHead.bottom,
    };
  };
  await page.mouse.move(800, 400);

  // Into the nested table, past its first rows.
  const before = await edges();
  await page.mouse.wheel(0, before.child.top - before.pageHeader.bottom + 200);
  await expect.poll(gaps).toMatchObject({
    rootHead: expect.closeTo(-1),
    itemRow: expect.closeTo(-1),
    childHead: expect.closeTo(-1),
  });
  // The item row stands in for the root header, pinned actions included.
  expect(await coveredCells(itemRow)).toEqual([]);
  expect(await coveredCells(rootHead)).not.toEqual([]);

  // Its last row 10px below the item row.
  const inside = await edges();
  await page.mouse.wheel(0, inside.child.bottom - inside.itemRow.bottom - 10);
  await expect
    .poll(gaps)
    .toMatchObject({ itemRow: expect.closeTo(-1), childEnd: expect.closeTo(0) });

  // Past the expanded row, the root header is back on top.
  const leaving = await edges();
  await page.mouse.wheel(0, leaving.expansion.bottom - leaving.pageHeader.bottom + 100);
  await expect.poll(gaps).toMatchObject({ rootHead: expect.closeTo(-1) });
  expect((await edges()).itemRow.bottom).toBeLessThan(leaving.pageHeader.bottom);
  expect(await coveredCells(rootHead)).toEqual([]);
});

// How many pixels of the screenshot clip are red. The PNG is decoded in the page.
async function redPixels(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
) {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let red = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 100 && pixels[index + 1] < 60) red++;
    }
    return red;
  }, png);
}

test('shows no content through the edge of a stuck header', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-laptop', 'Checks the laptop layout.');
  await installFakeApi(page);
  await openRoot(page);
  // Red rows make any sliver of them between the page header and the stuck header countable.
  await page.addStyleTag({ content: 'tbody td { background: rgb(255 0 0) !important; }' });
  const line = await page
    .locator('main > header')
    .evaluate((header) => header.getBoundingClientRect().bottom);
  // The table sits at a fractional offset, so some of these leave the stuck header off by a
  // fraction of a pixel once the compositor rounds it.
  for (let scrollY = 100; scrollY <= 400; scrollY += 13) {
    await page.evaluate((y) => window.scrollTo(0, y), scrollY);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(await redPixels(page, { x: 300, y: line, width: 900, height: 1 }), `at ${scrollY}`).toBe(
      0,
    );
  }
});

test('stacks expanded rows three tables deep through sorting, paging, and collapsing', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-laptop', 'Checks the laptop layout.');
  await installFakeApi(page);
  await openRoot(page);
  await addNativeChild(page);
  await openAddRelationshipDialog(page, 'Children');
  await page.getByLabel('Related collection URL').fill(childUrl);
  await page.getByLabel('Node name').fill('Grandchildren');
  await page.getByLabel('Parent field path').fill('parentKey');
  await page.getByLabel('Child field path').fill('parentKey');
  await page.getByRole('button', { name: 'Add collection node' }).click();
  await page.getByRole('button', { name: 'Expand relationships for 7-root-000000' }).click();
  const children = page.getByRole('region', { name: 'Children related items', exact: true });
  await children.getByRole('button', { name: 'Expand relationships for 7-child-000000' }).click();
  const grandchildren = children.getByRole('region', {
    name: 'Grandchildren related items',
    exact: true,
  });
  await expect(grandchildren.getByRole('table')).toBeVisible();
  // Scrolls the table's first rows under the stuck rows.
  const scrollIntoBody = (table: Locator) =>
    table.evaluate((element) => {
      const pageHeader = document.querySelector('main > header')!.getBoundingClientRect();
      window.scrollBy(0, element.getBoundingClientRect().top - pageHeader.bottom + 80);
    });
  // The distance of each expanded row, then the deepest table's header, from the bottom of the
  // one above it, the page header first: -1 while each is stuck, tucked under the one above.
  const gaps = () =>
    page.evaluate(() => {
      let bottom = document.querySelector('main > header')!.getBoundingClientRect().bottom;
      const expanded = [...document.querySelectorAll('[aria-label^="Collapse relationships"]')];
      const rows = expanded.map((button) => button.closest('tr')!);
      return [...rows, ...[...document.querySelectorAll('thead')].slice(-1)].map((row) => {
        const rect = row.getBoundingClientRect();
        const gap = rect.top - bottom;
        bottom = rect.bottom;
        return Math.round(gap) || 0;
      });
    });

  await scrollIntoBody(grandchildren.getByRole('table'));
  await expect.poll(gaps).toEqual([-1, -1, -1]);

  // Sorting moves the expanded rows, and the tables inside them, without resizing anything.
  await page
    .getByRole('table')
    .first()
    .getByRole('button', { name: /^Category/ })
    .click();
  await page.getByRole('button', { name: 'Sort descending', exact: true }).click();
  await scrollIntoBody(grandchildren.getByRole('table'));
  await expect.poll(gaps).toEqual([-1, -1, -1]);

  await grandchildren.getByRole('button', { name: 'Next' }).click();
  await expect(grandchildren.getByText('Page 2 of 2')).toBeVisible();
  await scrollIntoBody(grandchildren.getByRole('table'));
  await expect.poll(gaps).toEqual([-1, -1, -1]);

  await children.getByRole('button', { name: 'Collapse relationships for 7-child-000000' }).click();
  await expect(grandchildren).toHaveCount(0);
  await scrollIntoBody(children.getByRole('table'));
  await expect.poll(gaps).toEqual([-1, -1]);
});

test('keeps pinned columns in place while the table scrolls sideways', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-laptop', 'Checks the laptop layout.');
  await installFakeApi(page);
  await openRoot(page);
  const table = page.getByRole('table').first();
  const scroller = table.locator('..');
  // Each data column's header is its menu button; the row actions header has none.
  const left = async (name: string) =>
    (await table.getByRole('button', { name, exact: true }).boundingBox())?.x;

  await table.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('button', { name: 'Pin column' }).click();
  // Opening Category's menu scrolled the table to reach it.
  await scroller.evaluate((element) => {
    element.scrollLeft = 0;
  });
  const actionsLeft = (
    await page.getByRole('group', { name: 'Item actions' }).first().boundingBox()
  )?.x;
  const categoryLeft = await left('Category pinned');
  const titleLeft = await left('Title');
  expect(categoryLeft).toBeLessThan(titleLeft ?? 0);

  await scroller.evaluate((element) => {
    element.scrollLeft = 300;
  });
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBe(300);
  expect((await page.getByRole('group', { name: 'Item actions' }).first().boundingBox())?.x).toBe(
    actionsLeft,
  );
  expect(await left('Category pinned')).toBe(categoryLeft);
  expect(await left('Title')).toBe((titleLeft ?? 0) - 300);

  await page.reload();
  await expect(table.getByRole('button', { name: 'Category pinned', exact: true })).toBeVisible();
});

// Pixels a dialog's content sticks out past its sides; focus can scroll a clipped dialog sideways.
function horizontalOverflow(dialog: Locator) {
  return dialog.evaluate((element) => element.scrollWidth - element.clientWidth);
}

test('truncates a long item title inside the history header', async ({ page }) => {
  await installFakeApi(page);
  await openRoot(page);
  const title = String(rootItems[1]?.data.title);
  await page.getByRole('button', { name: `Open details for ${title}` }).click();
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog.getByRole('link', { name: 'Open in Zesty Manager' })).toBeVisible();

  expect(await horizontalOverflow(dialog)).toBe(0);
  const heading = dialog.getByRole('heading', { name: title, exact: true });
  expect(await heading.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
});

test('wraps a long unbroken node name inside dialogs', async ({ page }) => {
  const name = 'homepage_hero_carousel_items_with_localized_content_and_regional_fallbacks_v2';
  await installFakeApi(page);
  await openRoot(page);
  await openAddRelationshipDialog(page);
  await page.getByLabel('Related collection URL').fill(childUrl);
  await page.getByLabel('Node name').fill(name);
  await chooseSelectOption(page, 'Native field', 'Primary child');
  await page.getByRole('button', { name: 'Add collection node' }).click();

  // The new node offers its own + menu once its schema loads.
  await openAddRelationshipDialog(page, name);
  const add = page.getByRole('dialog', { name: `Add below ${name}` });
  await expect(add).toBeVisible();
  expect(await horizontalOverflow(add)).toBe(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Actions for 6-rootmodel' }).click();
  await page.getByRole('menuitem', { name: 'Change root collection' }).click();
  await page.getByLabel('Or paste a Zesty URL').fill(childUrl);
  await page.getByRole('button', { name: 'Open root collection' }).click();
  const replace = page.getByRole('alertdialog', { name: 'Replace root collection?' });
  await expect(replace.getByRole('listitem')).toHaveText(['6-rootmodel', name]);
  expect(await horizontalOverflow(replace)).toBe(0);
});
