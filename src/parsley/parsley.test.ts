import { describe, expect, it } from 'vitest';
import type { CollectionSchema, ModelZuid } from '../domain';
import {
  analyzeParsley,
  formattedLines,
  matchingLines,
  parseParsley,
  savedLines,
  sourceModeFor,
  type AnalysisContext,
  type DisplayLine,
  type Step,
} from './index';

const articles = { modelZuid: '6-articles01' as ModelZuid, name: 'articles', label: 'Articles' };
const authors = { modelZuid: '6-authors001' as ModelZuid, name: 'authors', label: 'Authors' };
const categories = {
  modelZuid: '6-categories' as ModelZuid,
  name: 'categories',
  label: 'Categories',
};

const schemas: readonly CollectionSchema[] = [
  {
    modelZuid: articles.modelZuid,
    label: 'Articles',
    fields: [
      { id: '12-title0001', name: 'title', label: 'Title', kind: 'text' },
      { id: '12-published', name: 'published_at', label: 'Published at', kind: 'date' },
      { id: '12-hidden001', name: 'hidden', label: 'Hidden', kind: 'boolean' },
      {
        id: '12-category1',
        name: 'category',
        label: 'Category',
        kind: 'relationship',
        relatedModelZuid: categories.modelZuid,
      },
    ],
  },
  {
    modelZuid: authors.modelZuid,
    label: 'Authors',
    fields: [{ id: '12-fullname1', name: 'full_name', label: 'Full name', kind: 'text' }],
  },
  {
    modelZuid: categories.modelZuid,
    label: 'Categories',
    fields: [{ id: '12-cattitle1', name: 'title', label: 'Title', kind: 'text' }],
  },
];

const context: AnalysisContext = {
  collections: [articles, authors, categories],
  schemas: new Map(schemas.map((schema) => [schema.modelZuid, schema])),
  files: [{ id: '11-helpers001', fileName: 'json_helpers', type: 'snippet' }],
};

function explain(source: string, overrides: Partial<AnalysisContext> = {}) {
  const document = parseParsley(source);
  const analysis = analyzeParsley(document, { ...context, ...overrides });
  return { document, analysis };
}

function lineText(line: DisplayLine): string {
  return line.tokens.map((token) => token.text).join('');
}

function step(steps: readonly Step[], title: string | RegExp): Step {
  const found = steps.find((candidate) =>
    typeof title === 'string' ? candidate.title === title : title.test(candidate.title),
  );
  if (!found)
    throw new Error(`No step ${String(title)} in ${steps.map((s) => s.title).join(' | ')}`);
  return found;
}

// The messy one-line endpoint from the accepted prototype, with a relationship and a separator.
const articlesJson = `(** Blog listing. Do not rename **)
{{$limit = 12}}{{if {get_var.limit} }}{{$limit = {get_var.limit} }}{{end-if}}
[{{each articles as article where article.hidden != 1 sort by article.published_at desc, article.title limit {$limit} }}{"id":"{{article.zuid}}","title":"{{article.title.escapeForJs()}}","category":"{{article.category.title}}",
"author":{{each authors as author where author.zuid = '{article.author}' limit 1}}{"name":"{{author.full_name.escapeForJs()}}"}{{end-each}}}{{if {article._length} > {article._num} }},{{end-if}}{{end-each}}]`;

describe('Parsley presentation', () => {
  it('reproduces the source exactly as saved, including unrecognized syntax', () => {
    const sources = [
      articlesJson,
      '<ul>\n  {{each items as i}}<li>{{i.name}}</li>{{end-each}}\n</ul>\n',
      '{{ foo bar }} {{end-if}} {{ each broken }} {{ unclosed',
      '',
    ];
    for (const source of sources) {
      const { document, analysis } = explain(source);
      const lines = savedLines(document, analysis.annotations, sourceModeFor('/x.json', document));
      expect(lines.map(lineText).join('\n')).toBe(source);
    }
  });

  it('formats JSON by changing only whitespace outside string literals', () => {
    const source =
      '[{{each articles as a}}{"title" : "{{a.title}}  and   more",\n"n":  1}{{end-each}}]';
    const { document, analysis } = explain(source);
    const lines = formattedLines(document, analysis.annotations, 'json');
    const formatted = lines.map(lineText).join('\n');

    expect(formatted.replace(/\s/g, '')).toBe(source.replace(/\s/g, ''));
    expect(formatted).toContain('"{{a.title}}  and   more"');
    expect(lines.map((line) => [line.indent, lineText(line)])).toEqual([
      [0, '['],
      [1, '{{each articles as a}}'],
      [2, '{'],
      [3, '"title": "{{a.title}}  and   more",'],
      [3, '"n": 1'],
      [2, '}'],
      [1, '{{end-each}}'],
      [0, ']'],
    ]);
  });

  it('formats an extensionless endpoint that prints JSON as JSON', () => {
    const source = `{{if {get_var.q} }}
  {{ $q = {get_var.q} }}
{{end-if}}

{
   "items": [
{{each articles as a where a.title like '%{$q}%'}}
         {
            "title": "{{a.title}}"
         }
   {{if {a._length} != {a._num} }},{{end-if}}
{{end-each}}
    ]
}`;
    const { document, analysis } = explain(source);
    const mode = sourceModeFor('/plans', document);
    const lines = formattedLines(document, analysis.annotations, mode);

    expect(mode).toBe('json');
    expect(lines.map((line) => '  '.repeat(line.indent) + lineText(line))).toEqual([
      '{{if {get_var.q} }}',
      '  {{ $q = {get_var.q} }}',
      '{{end-if}}',
      '{',
      '  "items": [',
      "    {{each articles as a where a.title like '%{$q}%'}}",
      '      {',
      '        "title": "{{a.title}}"',
      '      }{{if {a._length} != {a._num} }},{{end-if}}',
      '    {{end-each}}',
      '  ]',
      '}',
    ]);
  });

  it('indents markup by its element nesting inside Parsley blocks', () => {
    const source = `<div class="root">
<div style="display:flex">
<h1>{{this.title}}</h1>
<img src="{{this.image}}">
{{if {this.note} }}
<p>{{this.note}}</p>
{{end-if}}
</div>
</div>`;
    const { document, analysis } = explain(source);
    const lines = formattedLines(
      document,
      analysis.annotations,
      sourceModeFor('/card.zhtml', document),
    );

    expect(lines.map((line) => '  '.repeat(line.indent) + lineText(line))).toEqual([
      '<div class="root">',
      '  <div style="display:flex">',
      '    <h1>{{this.title}}</h1>',
      '    <img src="{{this.image}}">',
      '    {{if {this.note} }}',
      '      <p>{{this.note}}</p>',
      '    {{end-if}}',
      '  </div>',
      '</div>',
    ]);
  });

  it('keeps blocks inside a JSON string or an HTML tag on their line', () => {
    const json = '{"url": "{{if a.link}}{{a.link}}{{else}}#{{end-if}}"}';
    const markup = '<a class="btn {{if x}}active{{end-if}}">Go</a>';
    const format = (source: string, mode: 'json' | 'markup') => {
      const { document, analysis } = explain(source);
      return formattedLines(document, analysis.annotations, mode).map(lineText);
    };

    expect(format(json, 'json')).toEqual([
      '{',
      '"url": "{{if a.link}}{{a.link}}{{else}}#{{end-if}}"',
      '}',
    ]);
    expect(format(markup, 'markup')).toEqual([markup]);
  });

  it('keeps words apart in markup and breaks long loops at their clauses', () => {
    const source =
      '<p>Hello   world</p>\n\n\n{{each articles as article where article.hidden != 1 sort by article.title limit 25}}<b>{{article.title}}</b>{{end-each}}';
    const { document, analysis } = explain(source);
    const lines = formattedLines(document, analysis.annotations, 'markup').map(lineText);

    expect(lines).toEqual([
      '<p>Hello   world</p>',
      '',
      '{{each articles as article',
      'where article.hidden != 1',
      'sort by article.title',
      'limit 25}}',
      '<b>{{article.title}}</b>',
      '{{end-each}}',
    ]);
  });
});

describe('Parsley analysis', () => {
  it('explains nested loops, conditions, assignments, and comments in source order', () => {
    const { analysis } = explain(articlesJson);

    expect(analysis.steps.map((s) => [s.number, s.depth, s.title])).toEqual([
      ['', 0, 'Blog listing. Do not rename'],
      ['1', 0, 'Set $limit to 12'],
      ['2', 0, 'Only if ?limit is set'],
      ['2.1', 1, 'Set $limit to ?limit'],
      ['3', 0, 'Loop over Articles as “article”'],
      ['3.1', 1, 'Loop over Authors as “author”'],
    ]);
    expect(step(analysis.steps, 'Loop over Articles as “article”').details).toEqual([
      'Only where Articles › Hidden ≠ 1',
      'Sorted by Articles › Published at (newest first), then Articles › Title (A → Z)',
      'At most $limit items',
      'Outputs id, title, category, author',
    ]);
    expect(step(analysis.steps, /Authors/).details).toEqual([
      'Only where Authors › ZUID = Articles › author',
      'Only the first match',
      'Outputs name',
    ]);
    expect(analysis.gaps).toBe(0);
  });

  it('lists collections, fields, relationships, inputs, and variables it uses', () => {
    const { analysis } = explain(articlesJson);

    expect(
      analysis.usage.collections.map(({ collection, fields, access }) => ({
        name: collection.name,
        fields: fields.map((field) => field.name),
        access,
      })),
    ).toEqual([
      {
        name: 'articles',
        fields: ['title', 'published_at', 'hidden', 'category'],
        access: ['loop'],
      },
      { name: 'categories', fields: ['title'], access: ['relationship'] },
      { name: 'authors', fields: ['full_name'], access: ['loop'] },
    ]);
    expect(analysis.usage.inputs).toEqual([{ target: 'input:query:limit', label: '?limit' }]);
    expect(analysis.usage.variables.map((entry) => entry.label)).toEqual(['$limit']);
  });

  it('reports a field missing from the schema as unrecognized, not as an error', () => {
    const { analysis } = explain('{{each articles as a}}{{a.sponsor}}{{end-each}}');

    const [entry, ...others] = analysis.usage.unrecognized;
    expect(others).toEqual([]);
    expect(entry).toMatchObject({
      target: `unrecognized-field:${articles.modelZuid}:sponsor`,
      label: 'Articles › sponsor',
    });
    expect(entry?.detail).toContain('may be metadata or a field this session cannot see');
    const token = analysis.annotations.find(
      (annotation) => annotation.kind === 'unrecognized-reference',
    );
    expect(token?.hint).not.toMatch(/error|invalid/i);
    expect(analysis.gaps).toBe(0);
  });

  it('keeps an uncatalogued loop source neutral and does not describe its fields', () => {
    const { analysis } = explain('{{each sponsors as s}}{{s.name}}{{end-each}}');

    expect(analysis.steps[0]).toMatchObject({
      title: 'Loop over “sponsors” as “s”',
      details: [
        'Not matched to the collection catalog, so its fields are not described.',
        'Prints “sponsors” › name',
      ],
    });
    expect(analysis.usage.unrecognized.map((entry) => entry.target)).toEqual([
      'unrecognized:sponsors',
    ]);
    expect(analysis.usage.collections).toEqual([]);
  });

  it('follows method chains and keeps unknown calls visible with their arguments', () => {
    const { analysis } = explain(
      "{{articles.filter(z.hidden = 0).first().title}} {{articles.filter(title like '%parsley%').toJSON()}} {{articles.first().title.truncate(40)}}",
    );
    const functions = analysis.annotations.filter((annotation) => annotation.kind === 'function');

    expect(functions.map((annotation) => annotation.hint)).toEqual([
      'Keeps only the items that match the condition',
      'Picks the first item',
      'Keeps only the items that match the condition',
      expect.stringContaining('Serializes'),
      'Picks the first item',
      'Parsley method truncate(); its result is not explained here',
    ]);
    const fieldHints = analysis.annotations
      .filter((annotation) => annotation.kind === 'field')
      .map((annotation) => annotation.hint);
    expect(fieldHints).toEqual([
      'Articles › Hidden (yes/no)',
      'Articles › Title (text)',
      'Articles › Title (text)',
      'Articles › Title (text)',
    ]);
    expect(analysis.usage.unrecognized).toEqual([]);
  });

  it('accepts loop clauses in any order and describes them as filter, sort, limit', () => {
    const { analysis } = explain(
      '{{each articles as a limit 10,20 order by rand()}}{{end-each}}{{each articles as b sort by b.title desc limit 0,5}}{{end-each}}',
    );

    expect(analysis.steps.map((s) => s.details)).toEqual([
      ['In random order', 'At most 20 items, skipping the first 10'],
      ['Sorted by Articles › Title (Z → A)', 'At most 5 items'],
    ]);
  });

  it('distinguishes page, session, and cookie variables and request inputs', () => {
    const { analysis } = explain(
      '{{$_seen = 1}}{{@theme = dark}}{{post_var.email}}{{request.queryParam(city)}}{{request.pathPart(2)}}{{request.fullpath()}}{{$_seen}}',
    );

    expect(analysis.steps.map((s) => s.title)).toEqual([
      'Set session variable $_seen to 1',
      'Set cookie @theme to dark',
    ]);
    expect(explain('{{$format = Y-m-d}}').analysis.usage.unrecognized).toEqual([]);
    expect(analysis.usage.inputs.map((entry) => entry.label)).toEqual([
      'posted email',
      '?city',
      'URL path segment 2',
      'full request path with query',
    ]);
    expect(analysis.usage.variables.map((entry) => entry.label)).toEqual(['$_seen', '@theme']);
  });

  it('links a static include to its snippet and keeps a dynamic include unresolved', () => {
    const { analysis } = explain(
      '{{include json_helpers}}{{include footer}}{{include {get_var.part} }}',
    );

    expect(analysis.steps.map((s) => [s.title, s.snippet?.fileId])).toEqual([
      ['Insert the “json_helpers” snippet', '11-helpers001'],
      ['Insert the “footer” snippet', undefined],
      ['Insert a file chosen at runtime: ?part', undefined],
    ]);
    expect(analysis.steps[0]?.details).toEqual([
      'Its code is not analyzed here. Open the snippet to see its explanation.',
    ]);
  });

  it('marks remote requests as dependencies without describing their response', () => {
    const { analysis } = explain(
      '{{each api.json.get(https://api.example.test/v1?city={request.queryParam(city)}) as day limit 3}}{{day.summary}}{{end-each}}',
    );

    expect(analysis.usage.remote).toEqual([
      {
        target: 'remote:https://api.example.test/v1?city={request.queryParam(city)}',
        label: 'https://api.example.test/v1?city={request.queryParam(city)}',
        detail: 'api.json.get()',
      },
    ]);
    expect(analysis.steps[0]?.details).toEqual([
      'Fetches https://api.example.test/v1?city={request.queryParam(city)}',
      'The remote response is not described.',
      'At most 3 items',
      'Prints remote JSON › summary',
    ]);
    expect(analysis.usage.inputs.map((entry) => entry.label)).toEqual(['?city']);
  });

  it('binds `this` only in a view generated from a model', () => {
    const unbound = explain('{{this.title}}').analysis;
    expect(unbound.usage.unrecognized.map((entry) => entry.target)).toEqual(['unrecognized:this']);

    const bound = explain('{{this.title}}', { boundModelZuid: articles.modelZuid }).analysis;
    expect(bound.usage.unrecognized).toEqual([]);
    expect(bound.usage.collections[0]).toMatchObject({ access: ['bound'] });
  });

  it('marks unrecognized syntax and broken block structure as gaps', () => {
    const { analysis } = explain(
      '{{ foo bar }}{{end-if}}{{each articles as a whre a.x}}{{if {a.title}}}x{{end-each}}{{ unclosed',
    );

    expect(analysis.steps.map((s) => [s.kind, s.title])).toEqual([
      ['unrecognized', 'Not recognized: {{ foo bar }}'],
      ['unrecognized', 'Unmatched {{end-if}}'],
      ['loop', 'Loop over Articles as “a”'],
      ['condition', 'Only if Articles › Title is set'],
      ['unrecognized', 'Not recognized: {{'],
    ]);
    expect(analysis.steps[2]?.details).toContain('Not recognized: whre a.x');
    expect(analysis.steps[3]?.details).toContain('This condition is never closed with {{end-if}}.');
    expect(analysis.gaps).toBe(5);
  });

  it('follows a method chain on an interpolated value', () => {
    const { analysis } = explain(
      '{{each {this.json_object}.json(arr) as item}}{{item.name}}{{end-each}}',
      { boundModelZuid: articles.modelZuid },
    );
    const functions = analysis.annotations.filter((annotation) => annotation.kind === 'function');

    expect(functions.map((annotation) => annotation.hint)).toEqual([
      'Parsley method json(); its result is not explained here',
    ]);
    expect(analysis.steps[0]?.title).toBe(
      'Loop over this Articles item › json_object (json(arr)) as “item”',
    );
  });

  it('reports code it cannot parse inside call arguments instead of hiding it as text', () => {
    const { analysis } = explain(
      '{{articles.filter(z.title ?? request.queryParam(q)).first().title}}{{article.date.date(F j, Y)}}',
    );

    expect(analysis.gaps).toBe(1);
    expect(analysis.usage.unrecognized[0]?.label).toContain('z.title ?? request.queryParam(q)');
  });

  it('keeps a quoted `}}` inside its tag', () => {
    const source = '{{$x = "}}" }}after';
    const { document, analysis } = explain(source);

    expect(document.nodes.map((node) => node.kind)).toEqual(['tag', 'text']);
    expect(analysis.steps.map((s) => s.title)).toEqual(['Set $x to "}}"']);
  });

  it('keeps an escaped quote and the `}}` after it inside the tag', () => {
    const { analysis } = explain('{{$x = "a\\"}}" }}after');
    expect(analysis.steps.map((s) => s.title)).toEqual(['Set $x to "a\\"}}"']);
  });

  it('treats an include named by a variable or interpolation as dynamic', () => {
    const { analysis } = explain('{{include $part}}{{include header_{get_var.lang}}}');
    expect(analysis.usage.snippets.map((snippet) => snippet.dynamic)).toEqual([true, true]);
  });

  it('reads clause keywords only as whole words, in any case', () => {
    const { analysis } = explain('{{each articles AS a where a.limit > 3}}{{end-each}}');
    expect(analysis.steps[0]?.details).toEqual(['Only where Articles › limit > 3']);
  });

  it('marks an assignment whose value is only partly recognized', () => {
    const { analysis } = explain('{{$x = a.b ?? c}}');
    expect(analysis.steps[0]?.details).toEqual(['Part of this value is not recognized.']);
  });

  it('accepts alternative closing tags', () => {
    const { analysis } = explain('{{each articles as a}}{{if {a.title}}}x{{endif}}{{/each}}');
    expect(analysis.gaps).toBe(0);
  });

  it('omits comma separators from the steps', () => {
    const { analysis } = explain(
      '[{{each articles as a}}"{{a.title}}"{{if {a._length} > {a._num} }},{{end-if}}{{end-each}}]',
    );
    expect(analysis.steps.map((s) => s.title)).toEqual(['Loop over Articles as “a”']);
  });

  it('asks for the schemas it needs to follow relationships', () => {
    const { analysis } = explain('{{each articles as a}}{{a.category.title}}{{end-each}}', {
      schemas: new Map([[articles.modelZuid, schemas[0]!]]),
    });
    expect(analysis.wantedModels).toEqual([categories.modelZuid]);
  });
});

describe('Parsley highlighting', () => {
  it('keeps repeated identical statements distinguishable', () => {
    const source =
      '{{if {get_var.a}}}\n{{$x = 1}}\n{{else}}\n{{$x = 1}}\n{{end-if}}\n{{if {get_var.b}}}\n{{$x = 1}}\n{{else}}\n{{$x = 1}}\n{{end-if}}';
    const { document, analysis } = explain(source);
    const assignments = analysis.steps.filter((s) => s.kind === 'assignment');
    const otherwise = analysis.steps.filter((s) => s.title === 'Otherwise');

    expect(new Set(assignments.map((s) => s.target)).size).toBe(4);
    expect(new Set(otherwise.map((s) => s.target)).size).toBe(2);
    const lines = savedLines(document, analysis.annotations, 'markup');
    expect([...matchingLines(lines, assignments[2]!.target)]).toEqual([6]);
    expect([...matchingLines(lines, otherwise[0]!.target)]).toEqual([2, 3, 4]);
  });

  it('highlights a loop and a collection in both presentations of a long file', () => {
    const filler = Array.from({ length: 60 }, (_, index) => `<p>Line ${index}</p>`).join('\n');
    const source = `${filler}\n{{each articles as article}}\n<h2>{{article.title}}</h2>\n{{end-each}}`;
    const { document, analysis } = explain(source);
    const loop = step(analysis.steps, 'Loop over Articles as “article”');
    const saved = savedLines(document, analysis.annotations, 'markup');
    const formatted = formattedLines(document, analysis.annotations, 'markup');

    expect([...matchingLines(saved, loop.target)]).toEqual([60, 61, 62]);
    expect([...matchingLines(formatted, loop.target)]).toEqual([60, 61, 62]);
    expect([...matchingLines(saved, `collection:${articles.modelZuid}`)]).toEqual([60, 61]);
    expect(formatted[61]?.indent).toBe(1);
  });
});
