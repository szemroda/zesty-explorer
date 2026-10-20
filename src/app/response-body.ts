// Readable layouts of endpoint response bodies for the response pane's `Formatted` view, and the
// syntax colors of both views. A layout may change whitespace the body relies on, such as between
// inline elements or inside scripts; the `As received` view shows the body exactly.
import type { TokenKind } from '../parsley';

export type BodyFormat = 'json' | 'markup';

/** Whether the body reads as JSON or markup, whatever its content type says. */
export function bodyFormat(body: string): BodyFormat | undefined {
  const text = body.trimStart();
  if (text.startsWith('{') || text.startsWith('[')) return 'json';
  if (/^<[a-z!?]/i.test(text)) return 'markup';
  return undefined;
}

/** The body laid out for reading when it is JSON or markup. */
export function formattedBody(body: string): string | undefined {
  const format = bodyFormat(body);
  if (format === 'json') return formattedJson(body.trim());
  if (format === 'markup') return formattedMarkup(body.trim());
  return undefined;
}

/** A run of body text colored like the same syntax in Code tab source. */
export interface BodyToken {
  readonly text: string;
  readonly kind: Extract<
    TokenKind,
    | 'json-key'
    | 'string'
    | 'number'
    | 'builtin'
    | 'json-punctuation'
    | 'html-tag'
    | 'comment'
    | 'text'
  >;
}

// One alternative per kind, in `jsonKinds` order. Malformed or cut-off JSON still colors: an
// unclosed string ends at the line, and anything else is text.
const jsonToken =
  /("(?:[^"\\\n]|\\.)*"(?=\s*:))|("(?:[^"\\\n]|\\.)*"?)|(-?\d[\d.eE+-]*)|(true|false|null)\b|([{}[\],:]+)|(\s+|[^"\s{}[\],:]+)/g;
const jsonKinds = ['json-key', 'string', 'number', 'builtin', 'json-punctuation', 'text'] as const;

// Comments and declarations, tags up to their `>` (a `>` inside a quoted value does not end one),
// and the text between them, where a `<` that starts no tag is text. A quoted value ends at the
// line, so a stray quote such as `title=Don't` miscolors one line at most.
const markupToken =
  /(<!--[\s\S]*?(?:-->|$)|<[!?][^>]*>?)|(<\/?[a-z](?:"[^"\n]*"|'[^'\n]*'|[^"'>])*>?)|([^<]+|<)/gi;

/** The body split into colored runs. Adjacent runs of one kind merge, so there are few of them. */
export function bodyTokens(body: string, format: BodyFormat): readonly BodyToken[] {
  const tokens: BodyToken[] = [];
  const append = (text: string, kind: BodyToken['kind']) => {
    const last = tokens.at(-1);
    if (last?.kind === kind) tokens[tokens.length - 1] = { text: last.text + text, kind };
    else tokens.push({ text, kind });
  };
  if (format === 'json') {
    for (const match of body.matchAll(jsonToken)) {
      const group = match.findIndex((text, index) => index > 0 && text !== undefined);
      append(match[0], jsonKinds[group - 1]!);
    }
    return tokens;
  }
  for (const [text, comment, tag] of body.matchAll(markupToken)) {
    if (comment) append(comment, 'comment');
    else if (tag) {
      // Quoted attribute values are strings; the rest of the tag is the tag's color.
      for (const [index, part] of tag.split(/("[^"\n]*"|'[^'\n]*')/).entries()) {
        if (part) append(part, index % 2 ? 'string' : 'html-tag');
      }
    } else append(text, 'text');
  }
  return tokens;
}

function formattedJson(text: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return undefined;
  }
}

type MarkupNode =
  | { readonly kind: 'text'; readonly text: string }
  /** Kept exactly: comments, declarations, stray closing tags, and whitespace-sensitive elements. */
  | { readonly kind: 'verbatim'; readonly text: string }
  /** The code inside `<script>` or `<style>`, re-indented as a block. */
  | { readonly kind: 'code'; readonly text: string }
  | MarkupElement;

interface MarkupElement {
  readonly kind: 'element';
  readonly name: string;
  readonly open: string;
  /** Unset when the element is never closed, as `<li>` may be. */
  close?: string;
  readonly children: MarkupNode[];
}

// HTML elements that never have a closing tag.
const voidElements = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
// Elements that flow within text. Only an element whose child elements all flow fits on one line.
const phrasingElements = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'br',
  'button',
  'cite',
  'code',
  'data',
  'del',
  'dfn',
  'em',
  'i',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
  'wbr',
]);
const codeElements = new Set(['script', 'style']);
const whitespaceSensitiveElements = new Set(['pre', 'textarea']);
// Open elements that an opening tag closes, as a new `<li>` closes the previous one.
const impliedEnds: Readonly<Record<string, readonly string[]>> = {
  li: ['li'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  p: ['p'],
  option: ['option'],
  tr: ['td', 'th', 'tr'],
  td: ['td', 'th'],
  th: ['td', 'th'],
};

// Larger or deeper markup is left as received: laying it out would take too long and too much
// memory, or indent it ever wider.
const nodeLimit = 200_000;
const depthLimit = 200;
const indentUnit = '  ';
// An element stays on one line when it fits in this many characters after its indentation.
const lineWidth = 100;

/**
 * Short runs of text and phrasing elements stay on one line; any other element gets its opening
 * tag, its indented children, and its closing tag on their own lines. Runs of HTML whitespace in
 * text collapse to single spaces. An XML document (`<?xml`) has no void, code, or
 * whitespace-sensitive elements.
 */
function formattedMarkup(text: string): string | undefined {
  const nodes = parseMarkup(text, !text.startsWith('<?xml'));
  if (!nodes) return undefined;
  const lines: string[] = [];
  layOut(nodes, 0, lines);
  return lines.join('\n');
}

// A tolerant parse: unmatched closing tags are kept as they are and unclosed elements end with
// their parent, so any text within the limits gives a tree.
function parseMarkup(source: string, html: boolean): MarkupNode[] | undefined {
  const root: MarkupNode[] = [];
  const open: MarkupElement[] = [];
  let nodes = 0;
  const append = (node: MarkupNode) => {
    nodes++;
    (open.at(-1)?.children ?? root).push(node);
  };
  const tagStart = /<[a-z/!?]/gi;
  let at = 0;
  while (at < source.length) {
    tagStart.lastIndex = at;
    const next = tagStart.exec(source)?.index ?? source.length;
    if (next > at) {
      append({ kind: 'text', text: source.slice(at, next).replace(htmlSpace, ' ') });
      at = next;
      continue;
    }
    if (source.startsWith('<!--', at) || source.startsWith('<![CDATA[', at)) {
      const end = endAfter(source, source[at + 2] === '-' ? '-->' : ']]>', at);
      append({ kind: 'verbatim', text: source.slice(at, end) });
      at = end;
      continue;
    }
    const tag = readTag(source, at);
    at = tag.end;
    const marker = source[tag.start + 1];
    if (marker === '!' || marker === '?') {
      append({ kind: 'verbatim', text: tag.text });
      continue;
    }
    const name = tagName(source, tag.start);
    if (marker === '/') {
      const index = open.findLastIndex((element) => element.name === name);
      if (index < 0) {
        append({ kind: 'verbatim', text: tag.text });
        continue;
      }
      open[index]!.close = tag.text;
      open.length = index;
      continue;
    }
    if (html && (codeElements.has(name) || whitespaceSensitiveElements.has(name))) {
      const closing = new RegExp(`</${name}[\\s/>]`, 'gi');
      closing.lastIndex = tag.end;
      const closeStart = closing.exec(source)?.index;
      const close = closeStart === undefined ? undefined : readTag(source, closeStart);
      at = close?.end ?? source.length;
      if (whitespaceSensitiveElements.has(name)) {
        append({ kind: 'verbatim', text: source.slice(tag.start, at) });
        continue;
      }
      append({
        kind: 'element',
        name,
        open: tag.text,
        ...(close ? { close: close.text } : {}),
        children: [{ kind: 'code', text: source.slice(tag.end, closeStart) }],
      });
      continue;
    }
    const implied = html ? impliedEnds[name] : undefined;
    while (implied?.includes(open.at(-1)?.name ?? '')) open.pop();
    const element: MarkupElement = { kind: 'element', name, open: tag.text, children: [] };
    append(element);
    if (!tag.text.endsWith('/>') && !(html && voidElements.has(name))) open.push(element);
    if (open.length > depthLimit || nodes > nodeLimit) return undefined;
  }
  return root;
}

/** The lowercase name of the opening or closing tag at `start`. */
function tagName(source: string, start: number): string {
  const name = /[^\s/>]*/y;
  name.lastIndex = source[start + 1] === '/' ? start + 2 : start + 1;
  return name.exec(source)![0].toLowerCase();
}

/** The index just past `terminator`, or the end of the source when it never comes. */
function endAfter(source: string, terminator: string, from: number): number {
  const index = source.indexOf(terminator, from);
  return index < 0 ? source.length : index + terminator.length;
}

// Whitespace as HTML sees it; JavaScript's `\s` would also match non-breaking spaces.
const htmlSpace = /[ \t\n\r\f]+/g;

// A tag up to its `>`, where a `>` inside a quoted attribute value does not end it.
const tagPattern = /<(?:"[^"]*"|'[^']*'|[^"'>])*>?/y;

/** The tag starting at `start`, with whitespace outside quotes collapsed. */
function readTag(source: string, start: number): Tag {
  tagPattern.lastIndex = start;
  const raw = tagPattern.exec(source)![0];
  const text = raw
    .replace(/("[^"]*"|'[^']*')|[ \t\n\r\f]+/g, (_, quoted?: string) => quoted ?? ' ')
    .replace(/ >$/, '>');
  return { text, start, end: start + raw.length };
}

interface Tag {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function layOut(nodes: readonly MarkupNode[], depth: number, lines: string[]): void {
  const indent = indentUnit.repeat(depth);
  for (const node of nodes) {
    if (node.kind === 'code') {
      for (const line of dedented(node.text)) lines.push(line ? indent + line : '');
      continue;
    }
    if (node.kind !== 'element') {
      const text = node.kind === 'text' ? node.text.replace(/^ | $/g, '') : node.text;
      if (text) lines.push(indent + text);
      continue;
    }
    const inline = inlineElement(node, lineWidth, true);
    if (inline !== undefined) {
      lines.push(indent + inline);
      continue;
    }
    lines.push(indent + node.open);
    layOut(node.children, depth + 1, lines);
    if (node.close) lines.push(indent + node.close);
  }
}

/**
 * The element on one line when its child elements are all phrasing content and it fits in
 * `width` characters. An empty element always does. Only the element that starts the line drops
 * the space at the edges of its content, so `Hello<span> world</span>` keeps its space.
 */
function inlineElement(element: MarkupElement, width: number, line: boolean): string | undefined {
  let text = element.open;
  const last = element.children.length - 1;
  for (const [index, child] of element.children.entries()) {
    if (child.kind === 'element' && !phrasingElements.has(child.name)) return undefined;
    let part =
      child.kind === 'element' ? inlineElement(child, width - text.length, false) : child.text;
    if (part === undefined) return undefined;
    if (child.kind === 'code') part = part.trim();
    if (line && index === 0) part = part.replace(/^ /, '');
    if (line && index === last) part = part.replace(/ $/, '');
    if (part.includes('\n')) return undefined;
    text += part;
    if (text.length > width) return undefined;
  }
  text += element.close ?? '';
  return text.length <= width || last < 0 ? text : undefined;
}

/** Lines without their common indentation and the blank lines around them. Blank lines are empty. */
function dedented(text: string): string[] {
  const lines = text.split('\n').map((line) => (/^[ \t\r]*$/.test(line) ? '' : line));
  const first = lines.findIndex(Boolean);
  if (first < 0) return [];
  const content = lines.slice(first, lines.findLastIndex(Boolean) + 1);
  const margin = content.reduce(
    (least, line) => (line ? Math.min(least, /^[ \t]*/.exec(line)![0].length) : least),
    Infinity,
  );
  return content.map((line) => line.slice(margin));
}
