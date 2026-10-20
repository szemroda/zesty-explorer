import { expect, test, type Page } from '@playwright/test';
import {
  installImportFixture,
  instanceUrl,
  storesCsv,
  syntheticToken,
} from './import-check-fixtures';

async function checkStoresCsv(page: Page, csv = storesCsv()): Promise<readonly string[]> {
  const requests = await installImportFixture(page);
  await page.goto('/');
  await page.getByLabel('Zesty session token').fill(syntheticToken);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Or paste a Zesty URL').fill(instanceUrl);
  await page.getByLabel('Or paste a Zesty URL').blur();
  await page.getByRole('tab', { name: 'Import check' }).click();
  await expect(page.getByRole('combobox', { name: 'Collection to import into' })).toHaveValue(
    'Store locations',
  );
  await page.getByLabel('CSV file to check').setInputFiles({
    name: 'stores.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  return requests;
}

const summary = (page: Page) => page.getByRole('navigation', { name: 'Summary' });
const lines = (page: Page) => page.getByRole('region', { name: 'Lines of stores.csv' });

test('explains why 300 lines become 260 items without writing to Zesty', async ({ page }) => {
  const requests = await checkStoresCsv(page);

  await expect(summary(page)).toContainText('260 items expected');
  await expect(summary(page)).toContainText('from 300 lines in the file');
  await expect(summary(page).getByRole('heading', { name: /Won’t import/ })).toContainText('−28');
  await expect(
    summary(page).getByRole('heading', { name: /Lines that aren’t entries/ }),
  ).toContainText('−12');

  await summary(page)
    .getByRole('button', { name: /Same URL as an earlier row/ })
    .click();
  await expect(lines(page).getByRole('row')).toHaveCount(9);
  await lines(page)
    .getByRole('button', { name: /^Row 151,/ })
    .click();
  const details = page.getByRole('complementary', { name: 'Line details' });
  await expect(details).toContainText('“BERLIN-OLD-TOWN” becomes “berlin-old-town”, like row 6.');
  await details.getByRole('button', { name: 'Go to row 6' }).click();
  await expect(details.getByRole('heading')).toHaveText('Row 6 · line 7');
  await expect(lines(page).getByRole('button', { name: /^Row 6,/ })).toBeInViewport();

  await page.getByRole('searchbox', { name: 'Search the file' }).fill('line 11');
  await expect(page.getByText('1 match for “line 11”')).toBeVisible();
  await expect(lines(page).getByRole('button', { name: /^Row 9, lines 10–11:/ })).toBeVisible();

  const before = requests.length;
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => requests.length).toBeGreaterThan(before);
  await expect(summary(page)).toContainText('260 items expected');

  expect(requests.filter((request) => !request.startsWith('GET '))).toEqual([]);
});

test('says so when no line needs attention', async ({ page }) => {
  await checkStoresCsv(page, 'name,slug\r\nNew Store,new-store\r\nOther Store,other-store\r\n');
  await expect(summary(page)).toContainText('2 items expected');
  await expect(summary(page)).toContainText('A prediction, not a guarantee.');

  await page.getByRole('button', { name: 'Needs attention' }).click();
  await expect(lines(page)).toContainText('Nothing needs attention');
  await lines(page).getByRole('button', { name: 'Show all 2 lines' }).click();
  await expect(lines(page).getByRole('button', { name: /^Row 2,/ })).toBeVisible();
});

test('checks the file with the columns mapped like in Zesty', async ({ page }) => {
  await checkStoresCsv(page, storesCsv().replace('name,slug,', 'Store,Link,'));
  await expect(summary(page)).toContainText('0 items expected');
  await expect(summary(page)).toContainText('Required field has no column');

  await page.getByRole('combobox', { name: 'Field for column Store', exact: true }).click();
  await page.getByRole('option', { name: 'Store name' }).click();
  await page.getByRole('combobox', { name: 'Path part column' }).click();
  await page.getByRole('option', { name: 'Link' }).click();

  await expect(summary(page)).toContainText('260 items expected');
  await expect(
    page.getByRole('combobox', { name: 'Field for column Store', exact: true }),
  ).toContainText('Store name');
});

test('keeps the checked collection in the link', async ({ page }) => {
  await checkStoresCsv(page);
  const picker = page.getByRole('combobox', { name: 'Collection to import into' });
  await page.getByRole('button', { name: 'Change' }).click();
  await picker.fill('Articles');
  await page.getByRole('option', { name: /^Articles/ }).click();
  await expect(page).toHaveURL(/#view=/);

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Collection to import into' })).toHaveValue(
    'Articles',
  );
});

test('keeps the check while another tab is open', async ({ page }) => {
  await checkStoresCsv(page);
  await expect(summary(page)).toContainText('260 items expected');

  await page.getByRole('tab', { name: 'Explorer' }).click();
  await expect(summary(page)).toBeHidden();
  await page.getByRole('tab', { name: 'Import check' }).click();
  await expect(summary(page)).toContainText('260 items expected');
});
