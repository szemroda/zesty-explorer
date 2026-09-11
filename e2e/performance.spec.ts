import { expect, test, type Locator, type Page } from '@playwright/test';

interface BrowserMetrics {
  readonly longTasks: number[];
  readonly usedJSHeapSize?: number;
}

function percentile(samples: readonly number[], percentage: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1)] ?? 0;
}

async function measure(run: () => Promise<void>, repetitions = 5) {
  const samples: number[] = [];
  for (let index = 0; index < repetitions; index += 1) {
    const started = performance.now();
    await run();
    samples.push(performance.now() - started);
  }
  return { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) };
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
    title: `Performance item ${index}`,
    score: (index * 7_919) % 10_000,
    childRef: '7-performance-child',
    meta: {
      zuid: `7-performance-${String(index).padStart(6, '0')}`,
      created: '2026-01-01T00:00:00.000Z',
      modified: `2026-02-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      version: 1,
    },
  }));
  await page.route('https://8-performance.api.zesty.io/**', async (route) => {
    const request = route.request();
    const headers = {
      'access-control-allow-origin': 'http://127.0.0.1:5173',
      'access-control-allow-headers': 'authorization',
      'access-control-allow-methods': 'GET,OPTIONS',
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    const url = new URL(request.url());
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
            title: 'Performance child',
            meta: {
              zuid: '7-performance-child',
              created: '2026-01-01T00:00:00.000Z',
              modified: '2026-02-01T00:00:00.000Z',
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

test('reports loaded-data browser p50 and p95 budgets', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'One calibrated Chromium run is enough.');
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
    .getByLabel('Root collection URL')
    .fill('https://8-performance.manager.zesty.io/content/6-performance-root');
  await page.getByRole('button', { name: 'Open collection' }).click();
  await expect(page.getByText('10000 items')).toBeVisible();

  const filter = page.getByLabel('Filter this table');
  const searches = ['8765', '765', '65', '5', '4321'];
  const expectedCounts = ['1 items', '11 items', '111 items', '1111 items', '1 items'];
  let searchIndex = 0;
  const filterTiming = await measure(async () => {
    const search = `Performance item ${searches[searchIndex]}`;
    const expectedCount = expectedCounts[searchIndex];
    searchIndex += 1;
    await filter.fill(search);
    await expect(page.getByText(expectedCount)).toBeVisible();
  });
  const typingSamples: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    typingSamples.push(
      await filter.evaluate(async (element) => {
        const started = performance.now();
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return performance.now() - started;
      }),
    );
  }
  await filter.fill('');
  await expect(page.getByText('10000 items')).toBeVisible();

  const scoreSort = page.getByRole('button', { name: 'Score' });
  await nextPaintAfterClick(scoreSort);
  const sortSamples: number[] = [];
  for (let index = 0; index < 5; index += 1) sortSamples.push(await nextPaintAfterClick(scoreSort));
  const sortTiming = { p50: percentile(sortSamples, 0.5), p95: percentile(sortSamples, 0.95) };

  await page.getByRole('button', { name: 'Add related collection' }).click();
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

  expect(filterTiming.p95).toBeLessThan(1_000);
  expect(filterTiming.p95).toBeLessThan(600 * 2);
  expect(percentile(typingSamples, 0.95)).toBeLessThan(100);
  expect(percentile(typingSamples, 0.95)).toBeLessThan(12 * 2);
  expect(sortTiming.p50).toBeLessThan(250);
  expect(sortTiming.p95).toBeLessThan(250 * 2);
  expect(expansionTiming.p95).toBeLessThan(100);
  expect(expansionTiming.p95).toBeLessThan(40 * 2);
  expect(await page.locator('tbody > tr').count()).toBeLessThanOrEqual(100);
});
