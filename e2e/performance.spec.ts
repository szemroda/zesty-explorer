import { expect, test, type Locator, type Page } from '@playwright/test';

interface BrowserMetrics {
  readonly longTasks: number[];
  readonly usedJSHeapSize?: number;
}

function percentile(samples: readonly number[], percentage: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1)] ?? 0;
}

// Opens the root search in the filter editor: its chip once set, otherwise Filter → "Any field".
async function openSearch(page: Page): Promise<Locator> {
  const chip = page.getByRole('button', { name: /^Edit filter Any field/ });
  if ((await chip.count()) > 0) await chip.click();
  else {
    await page.getByRole('button', { name: 'Add view filter' }).click();
    await page.getByLabel('View filter field').press('Enter');
  }
  return page.getByLabel('View filter value');
}

// Submits a root search and times it until the collection count settles on `expectedCount`.
async function searchUntilPaint(
  page: Page,
  search: string,
  expectedCount: string,
): Promise<number> {
  const value = await openSearch(page);
  await value.fill(search);
  return value.evaluate(async (element, expected) => {
    const started = performance.now();
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    while (performance.now() - started < 2_000) {
      const settled = [...document.querySelectorAll('[aria-label$=" collection"]')].some(
        (collection) =>
          [...collection.querySelectorAll('span')].some(
            (candidate) => candidate.textContent === expected,
          ),
      );
      if (settled) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return performance.now() - started;
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    throw new Error(`Search did not settle on ${expected}.`);
  }, expectedCount);
}

async function nextPaintAfterClick(locator: Locator): Promise<number> {
  return locator.evaluate(async (element) => {
    const started = performance.now();
    (element as HTMLElement).click();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return performance.now() - started;
  });
}

async function installPerformanceApi(page: Page) {
  const rootItems = Array.from({ length: 10_000 }, (_, index) => ({
    data: {
      title: `Performance item ${index}`,
      score: (index * 7_919) % 10_000,
      childRef: '7-performance-child',
    },
    meta: {
      ZUID: `7-performance-${String(index).padStart(6, '0')}`,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: `2026-02-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      version: 1,
    },
  }));
  await page.route('https://8-performance.api.zesty.io/**', async (route) => {
    const request = route.request();
    const headers = {
      'access-control-allow-origin': 'http://localhost:5173',
      'access-control-allow-headers': 'authorization',
      'access-control-allow-methods': 'GET,OPTIONS',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    const url = new URL(request.url());
    if (url.pathname.endsWith('/content/models')) {
      await route.fulfill({
        headers,
        json: {
          data: [
            {
              ZUID: '6-performance-root',
              label: '6-performance-root',
              name: 'performance-root',
              type: 'pageset',
            },
            {
              ZUID: '6-performance-child',
              label: '6-performance-child',
              name: 'performance-child',
              type: 'pageset',
            },
          ],
        },
      });
      return;
    }
    const child = url.pathname.includes('6-performance-child');
    if (url.pathname.endsWith('/fields')) {
      await route.fulfill({
        headers,
        json: {
          data: child
            ? [{ ZUID: '12-child-title', name: 'title', label: 'Title', datatype: 'text' }]
            : [
                { ZUID: '12-root-title', name: 'title', label: 'Title', datatype: 'text' },
                { ZUID: '12-root-score', name: 'score', label: 'Score', datatype: 'number' },
                {
                  ZUID: '12-root-child',
                  name: 'childRef',
                  label: 'Child',
                  datatype: 'relationship',
                  relatedModelZUID: '6-performance-child',
                },
              ],
        },
      });
      return;
    }
    const data = child
      ? [
          {
            data: { title: 'Performance child' },
            meta: {
              ZUID: '7-performance-child',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-02-01T00:00:00.000Z',
              version: 1,
            },
          },
        ]
      : rootItems;
    const limit = Number(url.searchParams.get('limit') ?? 2_500);
    const pageNumber = Number(url.searchParams.get('page') ?? 1);
    await route.fulfill({
      headers,
      json: {
        data: data.slice((pageNumber - 1) * limit, pageNumber * limit),
        _meta: { totalResults: data.length, page: pageNumber, limit },
      },
    });
  });
}

test('reports loaded-data browser p50 and p95 budgets', async ({ page }) => {
  await page.addInitScript(() => {
    const metrics = window as unknown as { __zestyMetrics: BrowserMetrics };
    metrics.__zestyMetrics = { longTasks: [] };
    new PerformanceObserver((entries) => {
      metrics.__zestyMetrics.longTasks.push(...entries.getEntries().map((entry) => entry.duration));
    }).observe({ type: 'longtask', buffered: true });
  });
  await installPerformanceApi(page);
  await page.goto('/');
  await page.getByLabel('Zesty session token').fill('synthetic-session-token');
  await page
    .getByLabel('Zesty instance URL')
    .fill('https://8-performance.manager.zesty.io/content/6-performance-root');
  await page.getByRole('button', { name: 'Load collections' }).click();
  await page.getByRole('button', { name: 'Open root collection' }).click();
  await expect(page.getByText('10000 items', { exact: true })).toBeVisible();

  const searches = ['8765', '765', '65', '5', '4321'];
  const expectedCounts = ['1 items', '11 items', '111 items', '1111 items', '1 items'];
  const clearSearch = async () => {
    await page.getByRole('button', { name: /^Remove filter Any field/ }).click();
    await expect(page.getByText('10000 items', { exact: true })).toBeVisible();
  };
  await searchUntilPaint(page, 'Performance item 9999', '1 items');
  await clearSearch();
  const filterSamples: number[] = [];
  for (let index = 0; index < searches.length; index += 1) {
    filterSamples.push(
      await searchUntilPaint(page, `Performance item ${searches[index]}`, expectedCounts[index]),
    );
  }
  const filterTiming = {
    p50: percentile(filterSamples, 0.5),
    p95: percentile(filterSamples, 0.95),
    samples: filterSamples,
  };
  // Typing in the search editor while the filtered table stays on screen.
  const searchValue = await openSearch(page);
  const typingSamples: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    typingSamples.push(
      await searchValue.evaluate(async (element) => {
        const started = performance.now();
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return performance.now() - started;
      }),
    );
  }
  await page.keyboard.press('Escape');
  await clearSearch();
  await page.waitForTimeout(350);

  // Each sample opens the Score menu, then times the sort from the click to the next paint.
  const sortSamples: number[] = [];
  for (let index = 0; index < 21; index += 1) {
    await page.getByRole('button', { name: /^Score/ }).click();
    const direction = index % 2 === 0 ? 'Sort ascending' : 'Sort descending';
    const sample = await nextPaintAfterClick(page.getByRole('button', { name: direction }));
    if (index > 0) sortSamples.push(sample);
  }
  const sortTiming = {
    p50: percentile(sortSamples, 0.5),
    p95: percentile(sortSamples, 0.95),
    samples: sortSamples,
  };

  await page.getByRole('button', { name: 'Add relationship' }).click();
  await page
    .getByLabel('Related collection URL')
    .fill('https://8-performance.manager.zesty.io/content/6-performance-child');
  await page.getByLabel('Node name').fill('Performance child');
  await page.getByRole('button', { name: 'Add collection node' }).click();
  await expect(page.getByText('Performance child', { exact: true })).toBeVisible();
  const expand = page.getByRole('button', { name: /Expand relationships/ }).first();
  const itemId = (await expand.getAttribute('aria-label'))?.replace(
    'Expand relationships for ',
    '',
  );
  if (!itemId) throw new Error('The measured row needs an item identifier.');
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    (window as unknown as { __zestyMetrics: BrowserMetrics }).__zestyMetrics.longTasks.splice(0);
  });
  const expansionSamples: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    expansionSamples.push(
      await nextPaintAfterClick(
        page.getByRole('button', {
          name: `Expand relationships for ${itemId}`,
          exact: true,
        }),
      ),
    );
    await expect(
      page.getByRole('region', { name: 'Performance child related items' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: `Collapse relationships for ${itemId}`, exact: true })
      .click();
    await expect(page.getByRole('region', { name: 'Performance child related items' })).toHaveCount(
      0,
    );
  }
  const expansionTiming = {
    p50: percentile(expansionSamples, 0.5),
    p95: percentile(expansionSamples, 0.95),
  };

  const metrics = await page.evaluate(() => {
    const measured = (window as unknown as { __zestyMetrics: BrowserMetrics }).__zestyMetrics;
    const memory = performance as Performance & { readonly memory?: { usedJSHeapSize: number } };
    return { ...measured, usedJSHeapSize: memory.memory?.usedJSHeapSize };
  });
  console.info('BROWSER PERF 10000 items', {
    filter: filterTiming,
    typing: { p50: percentile(typingSamples, 0.5), p95: percentile(typingSamples, 0.95) },
    sort: sortTiming,
    expansion: expansionTiming,
    longTaskP95: percentile(metrics.longTasks, 0.95),
    mountedRows: await page.locator('tbody > tr').count(),
    usedJSHeapMiB: metrics.usedJSHeapSize
      ? Number((metrics.usedJSHeapSize / 1024 / 1024).toFixed(1))
      : undefined,
  });

  expect(filterTiming.p95).toBeLessThan(250);
  expect(filterTiming.p95).toBeLessThan(600 * 2);
  expect(percentile(typingSamples, 0.95)).toBeLessThan(100);
  expect(percentile(typingSamples, 0.95)).toBeLessThan(12 * 2);
  expect(sortTiming.p50).toBeLessThan(250);
  expect(sortTiming.p95).toBeLessThan(250);
  expect(expansionTiming.p95).toBeLessThan(100);
  expect(expansionTiming.p95).toBeLessThan(40 * 2);
  expect(await page.locator('tbody > tr').count()).toBeLessThanOrEqual(100);
});
