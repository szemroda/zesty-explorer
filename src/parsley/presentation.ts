// Turns an analyzed Parsley document into display lines. `As saved` lines reproduce the source
// exactly. `Formatted` lines only change whitespace outside string literals: blocks go on their
// own lines, block bodies are indented, and JSON text is pretty-printed.
import {
  isSeparatorBlock,
  nodeTarget,
  targetNodeId,
  type Annotation,
  type TokenKind,
} from './analysis';
import type { EachBlock, IfBlock, ParsleyDocument, ParsleyNode, Span, TagNode } from './syntax';

export type SourceMode = 'json' | 'markup';

export interface DisplayToken {
  readonly text: string;
  readonly kind: TokenKind;
  readonly ref?: string;
  readonly hint?: string;
  /** Ids of the nodes this text belongs to: its tag or comment and every enclosing block. */
  readonly owners: readonly string[];
}

export interface DisplayLine {
  readonly indent: number;
  readonly tokens: readonly DisplayToken[];
}

/**
 * JSON files are pretty-printed; everything else keeps its own line breaks. A file without an
 * extension, such as a custom endpoint `/plans`, is JSON when its text starts with `{` or `[`.
 */
export function sourceModeFor(fileName: string, document: ParsleyDocument): SourceMode {
  const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  if (extension) return extension === 'json' ? 'json' : 'markup';
  const text = firstVisibleText(document.nodes, document.source);
  return text.startsWith('{') || text.startsWith('[') ? 'json' : 'markup';
}

/** The first text outside tags and comments, without leading whitespace. */
function firstVisibleText(nodes: readonly ParsleyNode[], source: string): string {
  for (const node of nodes) {
    let text = '';
    if (node.kind === 'text') text = source.slice(node.span.start, node.span.end).trimStart();
    if (node.kind === 'each') text = firstVisibleText(node.body, source);
    if (node.kind === 'if') {
      text = firstVisibleText(
        node.branches.flatMap((branch) => branch.body),
        source,
      );
    }
    if (text) return text;
  }
  return '';
}

// Elements that never have a closing tag, so they do not indent what follows.
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

interface MutableToken {
  text: string;
  kind: TokenKind;
  ref?: string;
  hint?: string;
  owners: readonly string[];
}

function isSpace(text: string): boolean {
  return /^\s*$/.test(text);
}

// Colors text between tags. JSON string state carries across tags, as in `"{{a.title}}"`, and
// so does being inside an HTML tag, as in `<a class="{{if x}}on{{end-if}}">`.
class TextColorer {
  private inString = false;
  private escaped = false;
  private lastString: MutableToken | undefined;
  private inMarkupTag = false;
  private markupQuote: string | undefined;

  constructor(private readonly mode: SourceMode) {}

  /** Whether the text so far ends inside a JSON string or an HTML tag. */
  inLiteral(): boolean {
    return this.mode === 'json' ? this.inString : this.inMarkupTag;
  }

  private trackMarkup(text: string): void {
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (this.markupQuote) {
        if (char === this.markupQuote) this.markupQuote = undefined;
      } else if (this.inMarkupTag) {
        if (char === '"' || char === "'") this.markupQuote = char;
        else if (char === '>') this.inMarkupTag = false;
      } else if (char === '<' && /[A-Za-z/!]/.test(text[index + 1] ?? '')) {
        this.inMarkupTag = true;
      }
    }
  }

  tokens(text: string, owners: readonly string[]): MutableToken[] {
    if (this.mode === 'markup') {
      this.trackMarkup(text);
      return text
        .split(/(<\/?[\w-]+|\/?>)/)
        .filter(Boolean)
        .map((part) => ({ text: part, kind: /^<|>$/.test(part) ? 'html-tag' : 'text', owners }));
    }
    const tokens: MutableToken[] = [];
    const append = (char: string, kind: TokenKind) => {
      const last = tokens.at(-1);
      if (
        last?.kind === kind &&
        kind !== 'json-punctuation' &&
        isSpace(last.text) === isSpace(char)
      ) {
        last.text += char;
        return last;
      }
      const token: MutableToken = { text: char, kind, owners };
      tokens.push(token);
      return token;
    };
    for (const char of text) {
      if (this.inString) {
        this.lastString = append(char, 'string');
        if (char === '"' && !this.escaped) this.inString = false;
        this.escaped = char === '\\' && !this.escaped;
        continue;
      }
      if (char === '"') {
        this.inString = true;
        // A new string never merges into the previous one.
        this.lastString = { text: char, kind: 'string', owners };
        tokens.push(this.lastString);
        continue;
      }
      if ('{}[],:'.includes(char)) {
        if (char === ':' && this.lastString) this.lastString.kind = 'json-key';
        append(char, 'json-punctuation');
        continue;
      }
      append(char, 'text');
      if (!isSpace(char)) this.lastString = undefined;
    }
    return tokens;
  }
}

// Finds the annotations inside a tag. Annotations are sorted by start.
class AnnotationIndex {
  constructor(private readonly annotations: readonly Annotation[]) {}

  within(span: Span): readonly Annotation[] {
    let low = 0;
    let high = this.annotations.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.annotations[middle]!.span.start < span.start) low = middle + 1;
      else high = middle;
    }
    const found: Annotation[] = [];
    for (let index = low; index < this.annotations.length; index++) {
      const annotation = this.annotations[index]!;
      if (annotation.span.start >= span.end) break;
      found.push(annotation);
    }
    return found;
  }
}

/** Splits unannotated tag text into words, whitespace, and punctuation. */
function plainTagTokens(text: string, owners: readonly string[]): MutableToken[] {
  return (text.match(/\s+|[\w$@-]+|[^\s\w$@-]+/g) ?? []).map((part) => ({
    text: part,
    kind: /^[\w$@-]/.test(part) || isSpace(part) ? 'text' : 'operator',
    owners,
  }));
}

class TokenBuilder {
  private readonly index: AnnotationIndex;
  private readonly colorer: TextColorer;

  constructor(
    private readonly document: ParsleyDocument,
    annotations: readonly Annotation[],
    mode: SourceMode,
  ) {
    this.index = new AnnotationIndex(annotations);
    this.colorer = new TextColorer(mode);
  }

  slice(span: Span): string {
    return this.document.source.slice(span.start, span.end);
  }

  text(span: Span, owners: readonly string[]): MutableToken[] {
    return this.colorer.tokens(this.slice(span), owners);
  }

  inLiteral(): boolean {
    return this.colorer.inLiteral();
  }

  comment(span: Span, owners: readonly string[]): MutableToken {
    return { text: this.slice(span), kind: 'comment', owners };
  }

  /** Tokens covering a tag exactly, from `{{` to `}}`. */
  tag(node: TagNode, owners: readonly string[]): MutableToken[] {
    const unrecognized = node.tag.kind === 'unrecognized' || node.stray === true;
    const delimiter = (text: string): MutableToken =>
      unrecognized
        ? { text, kind: 'unrecognized-syntax', ref: nodeTarget(node.id), owners }
        : { text, kind: 'delimiter', owners };
    const tokens: MutableToken[] = [
      delimiter(this.slice({ start: node.span.start, end: node.inner.start })),
    ];
    let cursor = node.inner.start;
    for (const annotation of this.index.within(node.inner)) {
      const start = Math.max(annotation.span.start, cursor);
      const end = Math.min(annotation.span.end, node.inner.end);
      if (end <= start) continue;
      if (start > cursor) {
        tokens.push(...plainTagTokens(this.slice({ start: cursor, end: start }), owners));
      }
      tokens.push({
        text: this.slice({ start, end }),
        kind: annotation.kind,
        ...(annotation.ref ? { ref: annotation.ref } : {}),
        ...(annotation.hint ? { hint: annotation.hint } : {}),
        owners,
      });
      cursor = end;
    }
    if (cursor < node.inner.end) {
      tokens.push(...plainTagTokens(this.slice({ start: cursor, end: node.inner.end }), owners));
    }
    tokens.push(delimiter(this.slice({ start: node.inner.end, end: node.span.end })));
    return tokens.filter((token) => token.text);
  }

  // A comma separator stays inline: `}{{if {a._length} > {a._num}}},{{end-if}}`.
  separator(block: IfBlock, owners: readonly string[]): MutableToken[] {
    const tokens: MutableToken[] = [];
    for (const branch of block.branches) {
      tokens.push(...this.tag(branch.tag, owners));
      for (const node of branch.body) {
        if (node.kind === 'text') tokens.push(...this.text(node.span, owners));
      }
    }
    if (block.close) tokens.push(...this.tag(block.close, owners));
    return tokens;
  }
}

interface Visitor {
  text(span: Span, owners: readonly string[]): void;
  comment(span: Span, owners: readonly string[]): void;
  tag(node: TagNode, owners: readonly string[], role: 'statement' | 'block'): void;
  /** Before a block's opening tag and after its closing tag, even when it is never closed. */
  startBlock(): void;
  endBlock(): void;
  /** Around each block body. */
  enterBlock(): void;
  leaveBlock(): void;
  separator(block: IfBlock, owners: readonly string[]): void;
}

// Visits nodes in source order with the owner ids each piece of text belongs to. A loop's
// tags and body belong to the loop; an `if` branch's tag and body belong to that branch.
function visitDocument(document: ParsleyDocument, visitor: Visitor): void {
  const visit = (nodes: readonly ParsleyNode[], owners: readonly string[]) => {
    for (const node of nodes) {
      if (node.kind === 'text') visitor.text(node.span, owners);
      else if (node.kind === 'comment') visitor.comment(node.span, [node.id, ...owners]);
      else if (node.kind === 'tag') visitor.tag(node, [node.id, ...owners], 'statement');
      else if (node.kind === 'each') visitEach(node, owners);
      else visitIf(node, owners);
    }
  };
  const visitEach = (block: EachBlock, owners: readonly string[]) => {
    const inner = [block.id, ...owners];
    visitor.startBlock();
    visitor.tag(block.open, [block.open.id, ...inner], 'block');
    visitor.enterBlock();
    visit(block.body, inner);
    visitor.leaveBlock();
    if (block.close) visitor.tag(block.close, [block.close.id, ...inner], 'block');
    visitor.endBlock();
  };
  const visitIf = (block: IfBlock, owners: readonly string[]) => {
    const inner = [block.id, ...owners];
    const branchIds = block.branches.map((branch) => branch.id);
    if (isSeparatorBlock(document, block)) {
      visitor.separator(block, [...branchIds, ...inner]);
      return;
    }
    visitor.startBlock();
    for (const branch of block.branches) {
      visitor.tag(branch.tag, [branch.id, ...inner], 'block');
      visitor.enterBlock();
      visit(branch.body, [branch.id, ...inner]);
      visitor.leaveBlock();
    }
    if (block.close) visitor.tag(block.close, [block.close.id, ...branchIds, ...inner], 'block');
    visitor.endBlock();
  };
  visit(document.nodes, []);
}

/** The source exactly as saved, one display line per source line. */
export function savedLines(
  document: ParsleyDocument,
  annotations: readonly Annotation[],
  mode: SourceMode,
): DisplayLine[] {
  const builder = new TokenBuilder(document, annotations, mode);
  const lines: DisplayLine[] = [];
  let current: DisplayToken[] = [];
  const push = (tokens: readonly MutableToken[]) => {
    for (const token of tokens) {
      token.text.split('\n').forEach((piece, index) => {
        if (index > 0) {
          lines.push({ indent: 0, tokens: current });
          current = [];
        }
        if (piece) current.push({ ...token, text: piece });
      });
    }
  };
  visitDocument(document, {
    text: (span, owners) => push(builder.text(span, owners)),
    comment: (span, owners) => push([builder.comment(span, owners)]),
    tag: (node, owners) => push(builder.tag(node, owners)),
    startBlock: () => undefined,
    endBlock: () => undefined,
    enterBlock: () => undefined,
    leaveBlock: () => undefined,
    separator: (block, owners) => push(builder.separator(block, owners)),
  });
  lines.push({ indent: 0, tokens: current });
  return lines;
}

const wrapWidth = 80;
const clauseKeywords = new Set(['where', 'sort', 'order', 'limit']);

class LineWriter {
  readonly lines: DisplayLine[] = [];
  indent = 0;
  private current: MutableToken[] = [];
  private currentIndent = 0;
  private pendingSpace: MutableToken | undefined;
  private blankPending = false;

  push(token: MutableToken): void {
    if (isSpace(token.text)) {
      if (this.current.length > 0) this.pendingSpace = token;
      return;
    }
    if (this.blankPending) {
      this.blankPending = false;
      this.flush();
      const previous = this.lines.at(-1);
      if (previous && previous.tokens.length > 0) this.lines.push({ indent: 0, tokens: [] });
    }
    // Whitespace survives only between two words, so `a b` keeps its space but `"a": 1` doesn't.
    const space = this.pendingSpace;
    this.pendingSpace = undefined;
    if (space && this.wordLike(this.current.at(-1)) && this.wordLike(token)) {
      if (space.text.includes('\n')) this.flush();
      else this.current.push(space);
    }
    if (this.current.length === 0) this.currentIndent = this.indent;
    this.current.push(token);
  }

  lineEmpty(): boolean {
    return this.current.length === 0;
  }

  /** Adds the space after a JSON key's colon. */
  space(owners: readonly string[]): void {
    this.pendingSpace = undefined;
    if (this.current.length > 0) this.current.push({ text: ' ', kind: 'text', owners });
  }

  private wordLike(token: MutableToken | undefined): boolean {
    return token !== undefined && token.kind !== 'json-punctuation' && !isSpace(token.text);
  }

  /** Appends to the previous line when nothing is pending, e.g. `,` after `{{end-each}}`. */
  attach(token: MutableToken): boolean {
    const previous = this.lines.at(-1);
    if (this.current.length > 0 || !previous || previous.tokens.length === 0) return false;
    this.lines[this.lines.length - 1] = { ...previous, tokens: [...previous.tokens, token] };
    return true;
  }

  flush(): void {
    this.pendingSpace = undefined;
    while (this.current.length && isSpace(this.current.at(-1)!.text)) this.current.pop();
    if (this.current.length) this.lines.push({ indent: this.currentIndent, tokens: this.current });
    this.current = [];
  }

  /** Puts one blank line before the next visible text. */
  blankLine(): void {
    this.flush();
    this.blankPending = true;
  }
}

/** A readable layout that changes only whitespace outside string literals. */
export function formattedLines(
  document: ParsleyDocument,
  annotations: readonly Annotation[],
  mode: SourceMode,
): DisplayLine[] {
  const builder = new TokenBuilder(document, annotations, mode);
  const writer = new LineWriter();

  const jsonText = (tokens: readonly MutableToken[]) => {
    for (const token of tokens) {
      if (token.kind !== 'json-punctuation') {
        writer.push(token);
        continue;
      }
      const char = token.text;
      if (char === '{' || char === '[') {
        writer.push(token);
        writer.flush();
        writer.indent++;
      } else if (char === '}' || char === ']') {
        writer.flush();
        writer.indent = Math.max(0, writer.indent - 1);
        writer.push(token);
      } else if (char === ',') {
        if (!writer.attach(token)) {
          writer.push(token);
          writer.flush();
        }
      } else {
        writer.push(token);
        writer.space(token.owners);
      }
    }
  };

  // Keeps the file's own line breaks and collapses runs of blank lines. Each line is re-indented
  // by its HTML element nesting on top of the Parsley blocks around it.
  let openElement: string | undefined;
  const markupText = (tokens: readonly MutableToken[]) => {
    let newlines = 0;
    for (const token of tokens) {
      token.text.split('\n').forEach((piece, index) => {
        if (index > 0) {
          newlines++;
          writer.flush();
          if (newlines === 2) writer.blankLine();
        }
        if (isSpace(piece)) {
          if (piece) writer.push({ ...token, text: piece });
          return;
        }
        newlines = 0;
        const text = writer.lineEmpty() ? piece.trimStart() : piece;
        const htmlTag = token.kind === 'html-tag';
        if (htmlTag && text.startsWith('</')) writer.indent = Math.max(0, writer.indent - 1);
        else if (htmlTag && text.startsWith('<')) openElement = text.slice(1).toLowerCase();
        writer.push({ ...token, text });
        if (htmlTag && text === '>' && openElement) {
          if (!voidElements.has(openElement)) writer.indent++;
          openElement = undefined;
        } else if (htmlTag && text === '/>') {
          openElement = undefined;
        }
      });
    }
  };

  const ownLine = (tokens: readonly MutableToken[]) => {
    writer.flush();
    tokens.forEach((token) => writer.push(token));
    writer.flush();
  };
  // A block that starts inside a string or an HTML tag stays inline, so the literal is kept whole.
  const inlineBlocks: boolean[] = [];
  const inline = () => inlineBlocks.at(-1) === true;

  visitDocument(document, {
    text: (span, owners) => {
      const tokens = builder.text(span, owners);
      if (mode === 'json') jsonText(tokens);
      else markupText(tokens);
    },
    comment: (span, owners) => ownLine([builder.comment(span, owners)]),
    tag: (node, owners, role) => {
      const tokens = builder.tag(node, owners);
      const kind = node.tag.kind;
      const inlineTag =
        inline() ||
        (role === 'statement' &&
          (builder.inLiteral() || (!node.stray && (kind === 'output' || kind === 'unrecognized'))));
      if (inlineTag) {
        tokens.forEach((token) => writer.push(token));
        return;
      }
      if (kind !== 'each' || builder.slice(node.span).length <= wrapWidth) {
        ownLine(tokens);
        return;
      }
      // Long loops read better with one clause per line.
      writer.flush();
      for (const token of tokens) {
        if (token.kind === 'keyword' && clauseKeywords.has(token.text.toLowerCase())) {
          writer.flush();
          writer.indent += 2;
          writer.push(token);
          writer.indent -= 2;
          continue;
        }
        writer.push(token);
      }
      writer.flush();
    },
    startBlock: () => inlineBlocks.push(inline() || builder.inLiteral()),
    endBlock: () => inlineBlocks.pop(),
    enterBlock: () => {
      if (inline()) return;
      writer.flush();
      writer.indent++;
    },
    leaveBlock: () => {
      if (inline()) return;
      writer.flush();
      writer.indent = Math.max(0, writer.indent - 1);
    },
    separator: (block, owners) =>
      builder.separator(block, owners).forEach((token) => writer.push(token)),
  });
  writer.flush();
  return writer.lines;
}

/** Line indexes that mention a reference (`collection:…`) or belong to a node (`node:…`). */
export function matchingLines(lines: readonly DisplayLine[], target: string): ReadonlySet<number> {
  const matches = new Set<number>();
  const nodeId = targetNodeId(target);
  lines.forEach((line, index) => {
    const found = line.tokens.some((token) =>
      nodeId ? token.owners.includes(nodeId) : token.ref === target,
    );
    if (found) matches.add(index);
  });
  return matches;
}
