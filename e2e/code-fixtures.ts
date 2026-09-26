// A fictional instance with code files for Code tab browser tests. No real Zesty source.
import type { Page, Route } from '@playwright/test';

export const codeInstanceUrl = 'https://8-fixture.manager.zesty.io/';
export const syntheticToken = 'synthetic-session-token';

const models = [
  { ZUID: '6-articles01', label: 'Articles', name: 'articles', type: 'pageset' },
  { ZUID: '6-authors001', label: 'Authors', name: 'authors', type: 'dataset' },
  { ZUID: '6-categories', label: 'Categories', name: 'categories', type: 'dataset' },
  { ZUID: '6-events0001', label: 'Events', name: 'events', type: 'dataset' },
  { ZUID: '6-venues0001', label: 'Venues', name: 'venues', type: 'dataset' },
];

const fields: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>> = {
  '6-articles01': [
    { ZUID: '12-art-title', name: 'title', label: 'Title', datatype: 'text' },
    { ZUID: '12-art-image', name: 'hero_image', label: 'Hero image', datatype: 'images' },
    { ZUID: '12-art-date1', name: 'published_at', label: 'Published at', datatype: 'date' },
    { ZUID: '12-art-hide1', name: 'hidden', label: 'Hidden', datatype: 'yes_no' },
    {
      ZUID: '12-art-categ',
      name: 'category',
      label: 'Category',
      datatype: 'one_to_one',
      relatedModelZUID: '6-categories',
    },
    {
      ZUID: '12-art-auth1',
      name: 'author',
      label: 'Author',
      datatype: 'one_to_one',
      relatedModelZUID: '6-authors001',
    },
  ],
  '6-authors001': [
    { ZUID: '12-aut-name1', name: 'full_name', label: 'Full name', datatype: 'text' },
    { ZUID: '12-aut-avat1', name: 'avatar', label: 'Avatar', datatype: 'images' },
  ],
  '6-categories': [
    { ZUID: '12-cat-title', name: 'title', label: 'Title', datatype: 'text' },
    { ZUID: '12-cat-slug1', name: 'slug', label: 'Slug', datatype: 'text' },
  ],
  '6-events0001': [
    { ZUID: '12-evt-title', name: 'title', label: 'Title', datatype: 'text' },
    { ZUID: '12-evt-start', name: 'starts_at', label: 'Starts at', datatype: 'datetime' },
    {
      ZUID: '12-evt-venue',
      name: 'venue',
      label: 'Venue',
      datatype: 'one_to_one',
      relatedModelZUID: '6-venues0001',
    },
  ],
  '6-venues0001': [
    { ZUID: '12-ven-name1', name: 'name', label: 'Name', datatype: 'text' },
    { ZUID: '12-ven-city1', name: 'city', label: 'City', datatype: 'text' },
  ],
};

const articlesJson = `(** Blog listing for the Next.js site. Do not rename, the app calls it directly **)
{{include json_helpers}}
{{$limit = 12}}{{if {get_var.limit} }}{{$limit = {get_var.limit} }}{{end-if}}
[{{each articles as article where article.category.slug = '{get_var.category}' and article.hidden != 1 sort by article.published_at desc limit {$limit} }}{"id":"{{article.zuid}}","title":"{{article.title.escapeForJs()}}","url":"{{article.getUrl()}}","image":"{{article.hero_image.getImage(800)}}","date":"{{article.published_at.date(Y-m-d)}}",
"author":{{each authors as author where author.zuid = '{article.author}' limit 1}}{"name":"{{author.full_name.escapeForJs()}}","avatar":"{{author.avatar.getImage(96)}}"}{{end-each}},"category":"{{article.category.title}}"}{{if {article._length} > {article._num} }},{{end-if}}{{end-each}}]`;

const publishedArticlesJson = `[{{each articles as article sort by article.published_at desc limit 10}}{"id":"{{article.zuid}}","title":"{{article.title.escapeForJs()}}"}{{if {article._length} > {article._num} }},{{end-if}}{{end-each}}]`;

const eventsJson = `{"generated":"{{site.date(c)}}","events":[{{each events as event where event.starts_at >= '{site.date(Y-m-d)}' sort by event.starts_at limit 0,20}}{"title":"{{event.title.escapeForJs()}}","venue":"{{event.venue.name}}","city":"{{event.venue.city}}"}{{if {event._length} > {event._num} }},{{end-if}}{{end-each}}],
"weather":[{{each api.json.get(https://api.example-weather.test/v1/forecast?city={request.queryParam(city)}) as day limit 3}}"{{day.summary}}"{{if {day._length} > {day._num} }},{{end-if}}{{end-each}}],
"sponsors":[{{each sponsors as sponsor}}"{{sponsor.name}}"{{if {sponsor._length} > {sponsor._num} }},{{end-if}}{{end-each}}],
"legacy":"{{ legacy widget mode }}"}`;

const helpersSnippet = `(** Shared JSON helpers **)
{{$json_date_format = Y-m-d}}
{{if {get_var.debug} }}{{$_debug = 1}}{{end-if}}`;

const longListing = [
  '<!doctype html>',
  '<html>',
  '<body>',
  '<main class="archive">',
  ...Array.from(
    { length: 140 },
    (_, index) => `  <p class="intro-${index}">Static introduction line ${index + 1}.</p>`,
  ),
  '  (** Archive by category, newest first **)',
  '  {{each categories as category sort by category.title}}',
  '    <section id="{{category.slug}}">',
  '      <h2>{{category.title}}</h2>',
  '      <ul>',
  "        {{each articles as article where article.category = '{category.zuid}' sort by article.published_at desc limit 5}}",
  '          <li><a href="{{article.getUrl()}}">{{article.title}}</a>{{if {article.hidden} = 1}} <em>(hidden)</em>{{else}} <time>{{article.published_at.date(M j)}}</time>{{end-if}}</li>',
  '        {{end-each}}',
  '      </ul>',
  '    </section>',
  '  {{end-each}}',
  '</main>',
  '</body>',
  '</html>',
].join('\n');

const articleView = `<article>
  <h1>{{this.title}}</h1>
  <img src="{{this.hero_image.getImage(1200)}}" alt="">
  <p>By {{this.author.full_name}} in {{this.category.title}}</p>
</article>`;

interface FixtureFile {
  readonly ZUID: string;
  readonly fileName: string;
  readonly type: string;
  readonly dev: { readonly version: number; readonly code: string };
  readonly live?: { readonly version: number; readonly code: string };
  readonly contentModelZUID?: string;
}

const files: readonly FixtureFile[] = [
  {
    ZUID: '11-articles-json',
    fileName: '/data/articles.json',
    type: 'ajax-json',
    dev: { version: 28, code: articlesJson },
    live: { version: 26, code: publishedArticlesJson },
  },
  {
    ZUID: '11-drafts-json0',
    fileName: '/data/drafts.json',
    type: 'ajax-json',
    dev: {
      version: 1,
      code: '[{{each articles as a where a.hidden = 1}}"{{a.title}}"{{end-each}}]',
    },
  },
  {
    ZUID: '11-events-json0',
    fileName: '/api/events.json',
    type: 'ajax-json',
    dev: { version: 11, code: eventsJson },
    live: { version: 11, code: eventsJson },
  },
  {
    ZUID: '11-archive-html',
    fileName: '/archive/by-category.html',
    type: 'ajax-json',
    dev: { version: 3, code: longListing },
    live: { version: 3, code: longListing },
  },
  {
    ZUID: '11-helpers-snip',
    fileName: 'json_helpers',
    type: 'snippet',
    dev: { version: 2, code: helpersSnippet },
    live: { version: 2, code: helpersSnippet },
  },
  {
    ZUID: '11-article-view',
    fileName: 'articles',
    type: 'pageset',
    dev: { version: 5, code: articleView },
    live: { version: 5, code: articleView },
    contentModelZUID: '6-articles01',
  },
  {
    ZUID: '11-z-layouts-01',
    fileName: '/z/layouts/home.json',
    type: 'ajax-json',
    dev: { version: 1, code: '{"layout":"{{include {this.layout_name} }}"}' },
    live: { version: 1, code: '{"layout":"{{include {this.layout_name} }}"}' },
  },
];

function viewsFor(status: string) {
  return files.flatMap((file) => {
    const version = status === 'live' ? file.live : file.dev;
    if (!version) return [];
    return [
      {
        ZUID: file.ZUID,
        status,
        type: file.type,
        fileName: file.fileName,
        code: version.code,
        version: version.version,
        contentModelZUID: file.contentModelZUID ?? null,
        updatedAt: '2026-09-20T10:00:00Z',
      },
    ];
  });
}

const cors = {
  'access-control-allow-origin': 'http://localhost:5173',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,OPTIONS',
};

// A few content items so the Explorer tab can open a collection from the Code tab.
function items(model: string) {
  const name = models.find((candidate) => candidate.ZUID === model)?.name ?? model;
  return Array.from({ length: 6 }, (_, index) => ({
    data: { title: `${name} item ${index + 1}` },
    meta: {
      ZUID: `7-${model.slice(2, 8)}-${String(index).padStart(6, '0')}`,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      version: 1,
    },
  }));
}

async function fulfill(route: Route): Promise<void> {
  const request = route.request();
  if (request.method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: cors });
    return;
  }
  const url = new URL(request.url());
  if (url.pathname.endsWith('/web/views')) {
    await route.fulfill({
      headers: cors,
      json: { data: viewsFor(url.searchParams.get('status') ?? 'dev') },
    });
    return;
  }
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
    const data = items(model);
    await route.fulfill({
      headers: cors,
      json: { data, _meta: { totalResults: data.length, page: 1, limit: data.length } },
    });
    return;
  }
  await route.fulfill({ headers: cors, json: { data: [] } });
}

/** Serves the fictional instance and blocks every other external request. */
export async function installCodeFixture(page: Page): Promise<void> {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'localhost') await route.continue();
    else await route.abort('blockedbyclient');
  });
  await page.route('https://8-fixture.api.zesty.io/**', fulfill);
  await page.route('https://accounts.api.zesty.io/**', fulfillAccounts);
  for (const origin of [previewOrigin, liveOrigin, `https://${fixtureDevDomain}`]) {
    await page.route(`${origin}/**`, fulfillWebEngine);
  }
}

export const previewOrigin = 'https://fixture-dev.webengine.zesty.io';
export const liveOrigin = 'https://www.example.test';
const fixtureDevDomain = 'fixture.zesty.dev';

async function fulfillAccounts(route: Route): Promise<void> {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: cors });
    return;
  }
  const { pathname } = new URL(route.request().url());
  if (pathname.endsWith('/instances/8-fixture')) {
    await route.fulfill({ headers: cors, json: { data: { randomHashID: 'fixture' } } });
    return;
  }
  if (pathname.endsWith('/instances/8-fixture/domains')) {
    await route.fulfill({
      headers: cors,
      json: {
        data: [
          { domain: fixtureDevDomain, branch: 'live', updatedAt: '2026-09-01T00:00:00Z' },
          { domain: 'www.example.test', branch: 'live', updatedAt: '2026-06-01T00:00:00Z' },
        ],
      },
    });
    return;
  }
  await route.fulfill({ headers: cors, json: { data: [] } });
}

// A fictional WebEngine. Articles answer with JSON built from the query, events fail with a
// readable 500, and anything else stands for an error page without CORS headers, which the
// browser hides from scripts.
async function fulfillWebEngine(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  await new Promise((resolve) => setTimeout(resolve, 700));
  const anyOrigin = { 'access-control-allow-origin': '*' };
  if (url.pathname === '/data/articles.json') {
    const limit = Number(url.searchParams.get('limit') || 3);
    const category = url.searchParams.get('category') || 'news';
    const articles = Array.from({ length: Math.min(limit, 20) }, (_, index) => ({
      id: `7-article-${index + 1}`,
      title: `${category === 'news' ? 'News' : 'Guide'} article ${index + 1}`,
      url: `/${category}/article-${index + 1}`,
      category,
    }));
    await route.fulfill({
      headers: { ...anyOrigin, 'content-type': 'application/json' },
      // Parsley output often starts with blank lines.
      body: `\n\n${JSON.stringify(articles)}`,
    });
    return;
  }
  if (url.pathname === '/api/events.json') {
    await route.fulfill({
      status: 500,
      headers: { ...anyOrigin, 'content-type': 'text/html' },
      body: [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<h1>WebEngine Error</h1>',
        '<p>Parsley: unknown field `venue.citty`</p>',
        '</body>',
        '</html>',
      ].join('\n'),
    });
    return;
  }
  // Playwright's fulfilled responses skip the CORS check, so a failed request stands in for it.
  await route.abort('failed');
}
