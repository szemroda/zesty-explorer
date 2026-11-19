const parser = new DOMParser();

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

/** WYSIWYG HTML as plain text: one line per paragraph, list item, or line break. */
export function richTextLines(html: string): string {
  const body = parseRichText(html);
  if (!body) return '';
  for (const lineBreak of body.querySelectorAll('br')) lineBreak.replaceWith('\n');
  for (const element of body.querySelectorAll(lineElements)) element.append('\n');
  return body.textContent
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}
