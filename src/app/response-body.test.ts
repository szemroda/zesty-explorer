import { describe, expect, it } from 'vitest';
import { formattedBody } from './response-body';

const lines = (...text: string[]) => text.join('\n');

describe('formattedBody', () => {
  it('indents JSON after leading whitespace and leaves other text alone', () => {
    expect(formattedBody('\n\n{"items":[1]}')).toBe(
      lines('{', '  "items": [', '    1', '  ]', '}'),
    );
    expect(formattedBody('{"items":')).toBeUndefined();
    expect(formattedBody('Parsley: unknown field')).toBeUndefined();
    expect(formattedBody('')).toBeUndefined();
  });

  it('keeps short runs of text on one line and nests the rest', () => {
    const html =
      '<!DOCTYPE html><html><head><title>Guides</title><meta charset="utf-8"></head>' +
      '<body>\n  <ul class="list"\n      id="articles"><li>First</li>\n<li><a href="/a">Second</a> article</li></ul>' +
      '<p>A paragraph that is long enough that it no longer fits on a single line of the formatted view, <em>with emphasis</em>.</p></body></html>';

    expect(formattedBody(html)).toBe(
      lines(
        '<!DOCTYPE html>',
        '<html>',
        '  <head>',
        '    <title>Guides</title>',
        '    <meta charset="utf-8">',
        '  </head>',
        '  <body>',
        '    <ul class="list" id="articles">',
        '      <li>First</li>',
        '      <li><a href="/a">Second</a> article</li>',
        '    </ul>',
        '    <p>',
        '      A paragraph that is long enough that it no longer fits on a single line of the formatted view,',
        '      <em>with emphasis</em>',
        '      .',
        '    </p>',
        '  </body>',
        '</html>',
      ),
    );
  });

  it('collapses only HTML whitespace and keeps the space inside inline elements', () => {
    expect(
      formattedBody(
        '<p>\n  Hello<span> world</span>!\u00a0\u00a0<b\n   class="x  y">Bye</b>\n</p>',
      ),
    ).toBe('<p>Hello<span> world</span>!\u00a0\u00a0<b class="x  y">Bye</b></p>');
  });

  it('leaves markup too large or nested too deep to lay out as received', () => {
    expect(formattedBody(`${'<div>'.repeat(5_000)}text`)).toBeUndefined();
    expect(formattedBody(`<ul>${'<li>x'.repeat(200_000)}</ul>`)).toBeUndefined();
  });

  it('closes implied ends and keeps stray closing tags', () => {
    const items = Array.from({ length: 12 }, (_, index) => `<li>Item ${index}`).join('');
    const formatted = formattedBody(`<ul>${items}</ul></div>`)!.split('\n');

    expect(formatted[0]).toBe('<ul>');
    expect(formatted[1]).toBe('  <li>Item 0');
    expect(formatted[12]).toBe('  <li>Item 11');
    expect(formatted.slice(13)).toEqual(['</ul>', '</div>']);
  });

  it('keeps preformatted text exactly and re-indents scripts', () => {
    const html =
      '<div><pre>  a\n    b</pre>\n<script>\n        const a = "<b>";\n\n        if (a) run();\n</script>' +
      '<style>p{color:red}</style><!-- a\n comment --></div>';

    expect(formattedBody(html)).toBe(
      lines(
        '<div>',
        '  <pre>  a',
        '    b</pre>',
        '  <script>',
        '    const a = "<b>";',
        '',
        '    if (a) run();',
        '  </script>',
        '  <style>p{color:red}</style>',
        '  <!-- a',
        ' comment -->',
        '</div>',
      ),
    );
  });

  it('treats every XML element as one that may have content', () => {
    const xml =
      '<?xml version="1.0"?><rss><channel><item><link>https://example.com/a-long-article-address</link>' +
      '<title>Article with a title long enough to wrap</title></item></channel></rss>';

    expect(formattedBody(xml)).toBe(
      lines(
        '<?xml version="1.0"?>',
        '<rss>',
        '  <channel>',
        '    <item>',
        '      <link>https://example.com/a-long-article-address</link>',
        '      <title>Article with a title long enough to wrap</title>',
        '    </item>',
        '  </channel>',
        '</rss>',
      ),
    );
  });
});
