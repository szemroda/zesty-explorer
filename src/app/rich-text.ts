const parser = new DOMParser();

/**
 * Parses WYSIWYG HTML into an inert document's body, which never runs script or loads anything.
 * Returns undefined when the markup shows no text or image, like an editor's `<p>&nbsp;</p>`.
 */
export function parseRichText(html: string): HTMLElement | undefined {
  const body = parser.parseFromString(html, 'text/html').body;
  return body.textContent.trim() !== '' || body.querySelector('img') ? body : undefined;
}
