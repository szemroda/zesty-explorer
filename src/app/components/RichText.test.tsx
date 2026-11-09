import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { parseRichText } from '../rich-text';
import { RichText } from './RichText';

// The rendered markup with whitespace collapsed, as the browser displays it.
function renderedHtml(html: string, layout: 'inline' | 'block'): string {
  const body = parseRichText(html);
  if (!body) throw new Error('Expected visible rich text');
  const { container } = render(<RichText body={body} layout={layout} />);
  return container.innerHTML.replace(/\s+/g, ' ').trim();
}

describe('RichText', () => {
  it('keeps formatting and flattens blocks onto one line without merging words', () => {
    expect(
      renderedHtml(
        '<p><strong>Banana on a</strong> <span style="text-decoration: underline;">tree</span>. ' +
          'This <em>is</em> text.</p><p>Second</p>Before<div>After</div><ul><li>Parent<ul><li>Child</li></ul></li></ul>',
        'inline',
      ),
    ).toBe(
      '<strong>Banana on a</strong> <u>tree</u>. This <em>is</em> text. Second Before After Parent Child',
    );
  });

  it('keeps paragraphs and lists as blocks', () => {
    expect(renderedHtml('<h2>Title</h2><ul><li>One</li><li>Two<br>lines</li></ul>', 'block')).toBe(
      '<div class="my-2 font-semibold">Title</div> <ul> <li>One</li> <li>Two<br>lines</li> </ul>',
    );
  });

  it('keeps only the text of unknown elements, including ones named like object keys', () => {
    expect(renderedHtml('<constructor>one</constructor> <toString>two</toString>', 'block')).toBe(
      'one two',
    );
  });

  it('drops attributes, scripts, and handlers from stored markup', () => {
    expect(
      renderedHtml(
        '<p onclick="alert(1)" class="x"><a href="javascript:alert(1)">link</a>' +
          '<script>alert(1)</script><img src="x" onerror="alert(1)" alt="Logo"></p>',
        'block',
      ),
    ).toBe(
      '<p><span class="text-accent underline underline-offset-2">link</span>' +
        '<span class="text-muted-foreground">[Logo] </span></p>',
    );
  });

  it('treats markup without text or images as empty', () => {
    expect(parseRichText('<p>&nbsp;</p><p><br></p>')).toBeUndefined();
  });
});
