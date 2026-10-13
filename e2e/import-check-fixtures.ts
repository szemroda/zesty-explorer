// A fictional instance and a `stores.csv` for the Import check tab. The file has 300 data lines;
// Zesty would send 288 records and most likely create 260 items.
import type { Page, Route } from '@playwright/test';

export const instanceUrl = 'https://8-fixture.manager.zesty.io/content/6-stores00001';
export const syntheticToken = 'synthetic-session-token';

const models = [
  { ZUID: '6-stores00001', label: 'Store locations', name: 'stores', type: 'pageset' },
  { ZUID: '6-regions0001', label: 'Regions', name: 'regions', type: 'dataset' },
  { ZUID: '6-articles001', label: 'Articles', name: 'articles', type: 'pageset' },
];

const fields: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>> = {
  '6-stores00001': [
    { ZUID: '12-st-name01', name: 'name', label: 'Store name', datatype: 'text', required: true },
    { ZUID: '12-st-city01', name: 'city', label: 'City', datatype: 'text' },
    { ZUID: '12-st-addr01', name: 'address', label: 'Address', datatype: 'textarea' },
    { ZUID: '12-st-open01', name: 'opened_on', label: 'Opened on', datatype: 'date' },
    { ZUID: '12-st-rate01', name: 'rating', label: 'Rating', datatype: 'number' },
    {
      ZUID: '12-st-regn01',
      name: 'region',
      label: 'Region',
      datatype: 'one_to_one',
      relatedModelZUID: '6-regions0001',
    },
    {
      ZUID: '12-st-type01',
      name: 'store_type',
      label: 'Store type',
      datatype: 'dropdown',
      settings: { options: { flagship: 'Flagship', outlet: 'Outlet', kiosk: 'Kiosk' } },
    },
    { ZUID: '12-st-phot01', name: 'photo', label: 'Photo', datatype: 'images' },
  ],
  '6-regions0001': [{ ZUID: '12-rg-name01', name: 'title', label: 'Title', datatype: 'text' }],
  '6-articles001': [{ ZUID: '12-ar-titl01', name: 'title', label: 'Title', datatype: 'text' }],
};

const regions = ['north', 'south', 'east', 'west', 'central', 'coast', 'alps', 'rhine'].map(
  (name) => ({ zuid: `7-region-${name}`, title: name[0].toUpperCase() + name.slice(1) }),
);

const cities = [
  'Berlin',
  'Hamburg',
  'Munich',
  'Cologne',
  'Frankfurt',
  'Stuttgart',
  'Düsseldorf',
  'Leipzig',
  'Dresden',
  'Hanover',
  'Nuremberg',
  'Bremen',
  'Essen',
  'Dortmund',
  'Bonn',
  'Mannheim',
  'Karlsruhe',
  'Augsburg',
];
const branches = [
  'Central',
  'North',
  'South',
  'East',
  'West',
  'Old Town',
  'Station',
  'Harbour',
  'Airport',
  'Mall',
  'Market',
  'Riverside',
  'University',
  'Park',
  'Gate',
  'Square',
];
const types = ['flagship', 'outlet', 'kiosk'];
const streets = ['Hauptstraße', 'Bahnhofstraße', 'Marktplatz', 'Lindenallee', 'Gartenweg'];

const slugOf = (value: string) =>
  value
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .replace(/[^a-z0-9]+/g, '-');

interface StoreRow {
  name: string;
  slug: string;
  city: string;
  address: string;
  opened_on: string;
  rating: string;
  region: string;
  store_type: string;
  photo: string;
  internal_notes: string;
}

// Record indices (0-based among the 288 records) that carry each problem.
const alreadyImported = [3, 17, 29, 44, 58, 71, 90, 104, 120, 133];
const duplicates: readonly (readonly [number, number, (slug: string) => string])[] = [
  [150, 5, (slug) => slug.toUpperCase()],
  [161, 20, (slug) => slug.replaceAll('-', ' ')],
  [175, 33, (slug) => slug.replaceAll('-', '_')],
  [190, 48, (slug) => slug.replaceAll('-', '/')],
  [204, 62, (slug) => `${slug[0].toUpperCase()}${slug.slice(1)}`],
  [219, 77, (slug) => slug.replaceAll('-', '.')],
  [233, 95, (slug) => slug.replaceAll('-', ' ').toUpperCase()],
  [250, 110, (slug) => slug],
];
const missingName = [140, 166, 182, 211, 240, 270];
const regionNames: Readonly<Record<number, string>> = {
  52: 'Bavaria',
  86: 'North Rhine-Westphalia',
  197: 'Saxony',
  262: 'Hesse',
};
const commaRatings = [12, 99, 228];
const photoUrls = [66, 279];
const multiline: Readonly<Record<number, string>> = {
  8: 'Hauptstraße 4\nBuilding B',
  37: 'Marktplatz 12\nUpper floor',
  115: 'Lindenallee 3\n2nd floor\nEntrance C',
  158: 'Bahnhofstraße 90\nNext to platform 1',
  225: 'Gartenweg 7\nBack entrance',
  284: 'Hauptstraße 118\nShop 4',
};
// Blank rows after these records; the last three trail the file, like Excel exports often do.
const blankAfter = [60, 130, 287, 287, 287];

function storeRows(): StoreRow[] {
  const rows: StoreRow[] = [];
  for (let index = 0; index < 288; index += 1) {
    const city = cities[Math.floor(index / branches.length)];
    const branch = branches[index % branches.length];
    const name = `${city} ${branch}`;
    rows.push({
      name,
      slug: slugOf(name),
      city,
      address: multiline[index] ?? `${streets[index % streets.length]} ${(index % 97) + 1}`,
      opened_on: `20${String(10 + (index % 15)).padStart(2, '0')}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`,
      rating: commaRatings.includes(index) ? '4,5' : (3 + (index % 20) / 10).toFixed(1),
      region: regionNames[index] ?? regions[index % regions.length].zuid,
      store_type: types[index % types.length],
      photo: photoUrls.includes(index)
        ? `https://cdn.example.test/stores/${slugOf(name)}.jpg`
        : `3-photo-${String(index).padStart(4, '0')}`,
      internal_notes: index % 9 === 0 ? 'Check opening hours' : '',
    });
  }
  for (const [index, original, format] of duplicates) {
    const source = rows[original];
    rows[index] = {
      ...rows[index],
      name: source.name,
      city: source.city,
      slug: format(source.slug),
    };
  }
  for (const index of missingName) rows[index].name = '';
  return rows;
}

const header: readonly (keyof StoreRow)[] = [
  'name',
  'slug',
  'city',
  'address',
  'opened_on',
  'rating',
  'region',
  'store_type',
  'photo',
  'internal_notes',
];

const quote = (value: string) =>
  /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export function storesCsv(): string {
  const lines = [header.join(',')];
  storeRows().forEach((row, index) => {
    lines.push(header.map((key) => quote(row[key])).join(','));
    for (const after of blankAfter) if (after === index) lines.push(','.repeat(header.length - 1));
  });
  return `${lines.join('\r\n')}\r\n`;
}

const cors = {
  'access-control-allow-origin': 'http://localhost:5173',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,OPTIONS',
};

const meta = (zuid: string) => ({
  ZUID: zuid,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  version: 1,
});

function items(model: string) {
  if (model === '6-regions0001') {
    return regions.map((region) => ({ data: { title: region.title }, meta: meta(region.zuid) }));
  }
  if (model !== '6-stores00001') return [];
  // Ten stores from an earlier, interrupted import, plus 30 stores the file does not contain.
  const rows = storeRows();
  const earlier = alreadyImported.map((index, position) => ({
    data: { name: rows[index].name, city: rows[index].city },
    web: { pathPart: rows[index].slug },
    meta: meta(`7-store-prev${String(position).padStart(3, '0')}`),
  }));
  const others = Array.from({ length: 30 }, (_, position) => ({
    data: { name: `Vienna Store ${position + 1}`, city: 'Vienna' },
    web: { pathPart: `vienna-store-${position + 1}` },
    meta: meta(`7-store-vien${String(position).padStart(3, '0')}`),
  }));
  return [...earlier, ...others];
}

async function fulfill(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/content/models')) {
    await route.fulfill({ headers: cors, json: { data: models } });
    return;
  }
  const model = url.pathname.match(/models\/(6-[^/]+)/)?.[1] ?? '';
  if (url.pathname.endsWith('/fields')) {
    await route.fulfill({ headers: cors, json: { data: fields[model] ?? [] } });
    return;
  }
  if (url.pathname.endsWith('/items')) {
    const page = Number(url.searchParams.get('page') ?? '1');
    const data = page === 1 ? items(model) : [];
    await route.fulfill({
      headers: cors,
      json: { data, _meta: { totalResults: items(model).length, page, limit: 5000 } },
    });
    return;
  }
  await route.fulfill({ headers: cors, json: { data: [] } });
}

/**
 * Serves the fictional instance and blocks every other external request. Returns the log of
 * requests the app sends to Zesty, as `METHOD /path`, so a test can prove nothing was written.
 */
export async function installImportFixture(page: Page): Promise<readonly string[]> {
  const requests: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') await route.continue();
    else await route.abort('blockedbyclient');
  });
  await page.route('https://8-fixture.api.zesty.io/**', async (route) => {
    const request = route.request();
    // A CORS preflight names the method the app is about to send.
    const method =
      request.method() === 'OPTIONS'
        ? (request.headers()['access-control-request-method'] ?? 'OPTIONS')
        : request.method();
    requests.push(`${method} ${new URL(request.url()).pathname}`);
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (method !== 'GET') {
      await route.abort('accessdenied');
      return;
    }
    await fulfill(route);
  });
  return requests;
}
