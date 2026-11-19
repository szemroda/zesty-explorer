const parser = new DOMParser();

// Elements whose content is never readable text.
export const droppedElements: ReadonlySet<string> = new Set([
  'script',
  'style',
  'noscript',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
]);

/**
 * Parses WYSIWYG HTML into an inert document's body, which never runs script or loads anything.
 * Returns undefined when the markup shows no text or image, like an editor's `<p>&nbsp;</p>`.
 */
export function parseRichText(html: string): HTMLElement | undefined {
  const body = parser.parseFromString(html, 'text/html').body;
  return body.textContent.trim() !== '' || body.querySelector('img') ? body : undefined;
}

// Elements that start a new line when rich text is read as plain text.
const lineElements = 'p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr';

/** WYSIWYG HTML as plain text, like the table reads it, with one line per paragraph or list item. */
export function richTextLines(html: string): string {
  const body = parseRichText(html);
  if (!body) return '';
  for (const dropped of body.querySelectorAll([...droppedElements].join(', '))) dropped.remove();
  // Images read like the table shows them: their alt text in brackets.
  for (const image of body.querySelectorAll('img')) {
    image.replaceWith(`[${image.getAttribute('alt') || 'image'}]`);
  }
  for (const lineBreak of body.querySelectorAll('br')) lineBreak.replaceWith('\n');
  for (const element of body.querySelectorAll(lineElements)) element.append('\n');
  for (const cell of body.querySelectorAll('td, th')) cell.append(' ');
  return body.textContent
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}
