import { expect, test, type Locator, type Page } from '@playwright/test';
import { ViewCodec } from '../src/view-codec';
import { codeInstanceUrl, installCodeFixture, syntheticToken } from './code-fixtures';

// Loads the instance; a collection URL also preselects that collection as the root.
async function openInstance(page: Page, url = codeInstanceUrl) {
  await installCodeFixture(page);
  await page.goto('/');
  await page.getByLabel('Zesty session token').fill(syntheticToken);
  await page.getByLabel('Zesty instance URL').fill(url);
  await page.getByRole('button', { name: 'Load collections' }).click();
}

function toggle(page: Page, group: string, name: string): Locator {
  return page.getByRole('group', { name: group }).getByRole('button', { name, exact: true });
}

function fileButton(page: Page, fileName: string): Locator {
  return page.getByRole('navigation', { name: 'Code files' }).getByRole('button', {
    name: new RegExp(`^${fileName.replace(/[/.]/g, '\\$&')}`),
  });
}

const steps = (page: Page) => page.getByRole('region', { name: 'How it works' });
const usage = (page: Page) => page.getByRole('complementary', { name: 'What this code uses' });

// Whether the first highlighted source line is inside the scrolled code panel.
async function firstHighlightVisible(page: Page): Promise<boolean> {
  return page.getByTestId('code-lines').evaluate((panel) => {
    const line = panel.querySelector('[data-highlighted]');
    if (!line) return false;
    const box = panel.getBoundingClientRect();
    const rect = line.getBoundingClientRect();
    return rect.top >= box.top && rect.bottom <= box.bottom;
  });
}

test('opens Code without a root collection and explains a file', async ({ page }) => {
  await openInstance(page);
  await expect(page.getByRole('heading', { name: 'Choose the root collection' })).toBeVisible();

  await page.getByRole('tab', { name: 'Code' }).click();
  await expect(fileButton(page, '/z/layouts/home.json')).toBeVisible();
  await fileButton(page, '/data/articles.json').click();

  await expect(page.getByRole('heading', { name: '/data/articles.json' })).toBeVisible();
  await expect(page.getByText('Latest · version 28')).toBeVisible();
  const managerLink = page.getByRole('link', { name: 'Open in Zesty Manager' });
  await expect(managerLink).toHaveAttribute(
    'href',
    'https://8-fixture.manager.zesty.io/code/file/views/11-articles-json',
  );
  await expect(managerLink).toHaveAttribute('target', '_blank');
  await expect(steps(page).getByText('Loop over Articles as “article”')).toBeVisible();
  await expect(usage(page).getByText('Categories', { exact: true })).toBeVisible();
  const link = ViewCodec.decode(new URL(page.url()).hash);
  expect(link.ok && link.state).toEqual({
    version: 3,
    instance: { instanceZuid: '8-fixture', deployment: 'production' },
    tab: 'code',
    codeSelection: { state: 'latest', fileId: '11-articles-json' },
  });
});

test('keeps both tabs and restores both from the link after reload', async ({ page }) => {
  await openInstance(page, `${codeInstanceUrl}content/6-articles01`);
  await page.getByRole('button', { name: 'Open root collection' }).click();
  await expect(page.getByText('articles item 1')).toBeVisible();

  await page.getByRole('tab', { name: 'Code' }).click();
  await fileButton(page, '/api/events.json').click();
  await toggle(page, 'Code state', 'Published').click();
  await expect(page.getByText('Published · version 11')).toBeVisible();

  await page.getByRole('tab', { name: 'Explorer' }).click();
  await expect(page.getByText('articles item 1')).toBeVisible();
  await page.getByRole('tab', { name: 'Code' }).click();
  await expect(page.getByText('Published · version 11')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('tab', { name: 'Code', selected: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '/api/events.json' })).toBeVisible();
  await expect(page.getByText('Published · version 11')).toBeVisible();
  await page.getByRole('tab', { name: 'Explorer' }).click();
  await expect(page.getByText('articles item 1')).toBeVisible();
});

test('filters files by name or URL and restores the filter from the link', async ({ page }) => {
  await openInstance(page);
  await page.getByRole('tab', { name: 'Code' }).click();
  const filter = page.getByRole('searchbox', { name: 'Filter code files' });

  await filter.fill('ARTICLES');
  await expect(fileButton(page, '/data/articles.json')).toBeVisible();
  await expect(fileButton(page, '/api/events.json')).toBeHidden();
  await filter.fill('https://www.example.com/api/events.json?city=Berlin');
  await expect(fileButton(page, '/api/events.json')).toBeVisible();
  await expect(fileButton(page, '/data/articles.json')).toBeHidden();
  await fileButton(page, '/api/events.json').click();

  // The link keeps the URL without its query, which may carry a session token.
  await page.reload();
  await expect(filter).toHaveValue('https://www.example.com/api/events.json');
  await expect(fileButton(page, '/api/events.json')).toBeVisible();
  await expect(fileButton(page, '/data/articles.json')).toBeHidden();
  await expect(page.getByRole('heading', { name: '/api/events.json' })).toBeVisible();

  await filter.fill('no such file');
  await expect(page.getByText('No files match this filter.')).toBeVisible();
});

test('shows a missing published version without switching code states', async ({ page }) => {
  await openInstance(page);
  await page.getByRole('tab', { name: 'Code' }).click();
  await fileButton(page, '/data/drafts.json').click();
  await toggle(page, 'Code state', 'Published').click();

  await expect(page.getByRole('heading', { name: 'No published version' })).toBeVisible();
  await page.getByRole('button', { name: 'View latest' }).click();
  await expect(page.getByText('Latest · version 1')).toBeVisible();
});

test('reports a Code link file that no longer exists', async ({ page }) => {
  await installCodeFixture(page);
  await page.addInitScript((token) => {
    window.sessionStorage.setItem('zesty-explorer:session-token:production', token);
  }, syntheticToken);
  const { fragment } = ViewCodec.encode({
    version: 3,
    instance: { instanceZuid: '8-fixture', deployment: 'production' },
    tab: 'code',
    codeSelection: { state: 'latest', fileId: '11-deleted-file' },
  });
  await page.goto(`/${fragment}`);

  await expect(page.getByRole('heading', { name: 'File not found' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Code files' }).getByRole('button', { pressed: true }),
  ).toHaveCount(0);
});

test('opens an included snippet and returns to the call site', async ({ page }) => {
  await openInstance(page);
  await page.getByRole('tab', { name: 'Code' }).click();
  await fileButton(page, '/data/articles.json').click();
  await steps(page).getByRole('button', { name: 'Open snippet', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'json_helpers' })).toBeVisible();
  await expect(steps(page).getByText('Set $json_date_format to Y-m-d')).toBeVisible();
  await page.getByRole('button', { name: 'Back to call site' }).click();

  await expect(page.getByRole('heading', { name: '/data/articles.json' })).toBeVisible();
  await expect(steps(page).getByRole('button', { pressed: true })).toContainText(
    'Insert the “json_helpers” snippet',
  );
});

test('asks before a referenced collection replaces the Explorer view', async ({ page }) => {
  await openInstance(page, `${codeInstanceUrl}content/6-events0001`);
  await page.getByRole('button', { name: 'Open root collection' }).click();
  await expect(page.getByText('events item 1')).toBeVisible();

  await page.getByRole('tab', { name: 'Code' }).click();
  await fileButton(page, '/data/articles.json').click();
  await usage(page).getByRole('button', { name: 'Open Articles in Explorer' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Open Articles in Explorer?' });
  await expect(dialog).toContainText('replaces the current Explorer view');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('tab', { name: 'Explorer' }).click();
  await expect(page.getByText('events item 1')).toBeVisible();

  await page.getByRole('tab', { name: 'Code' }).click();
  await usage(page).getByRole('button', { name: 'Open Articles in Explorer' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Open in Explorer' }).click();
  await expect(page.getByRole('tab', { name: 'Explorer', selected: true })).toBeVisible();
  await expect(page.getByText('articles item 1')).toBeVisible();
});

test('scrolls a long file to a pinned step in both presentations', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openInstance(page);
  await page.getByRole('tab', { name: 'Code' }).click();
  await fileButton(page, '/archive/by-category.html').click();

  await steps(page).getByText('Loop over Articles as “article”').click();
  await expect.poll(() => firstHighlightVisible(page)).toBe(true);

  await toggle(page, 'Source presentation', 'As saved').click();
  await expect.poll(() => firstHighlightVisible(page)).toBe(true);
  await expect(page.getByTestId('code-lines').locator('[data-highlighted]').first()).toContainText(
    "{{each articles as article where article.category = '{category.zuid}'",
  );
});
