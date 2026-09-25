// Parses Parsley source into a tree whose every node keeps its source span. Parsing never fails:
// syntax it cannot recognize becomes an `unrecognized` tag, a stray tag, or an unclosed block, so
// the complete source stays available and the gaps stay visible.

export interface Span {
  readonly start: number;
  readonly end: number;
}

// ---------- Expressions ----------

export interface CallArguments {
  /** From `(` to `)` inclusive. */
  readonly span: Span;
  /** The text between the parentheses, exactly as saved. */
  readonly raw: string;
  readonly args: readonly Expr[];
}

export interface PathSegment {
  /** An identifier, or a `$page`, `$_session`, or `@cookie` variable at the head of a path. */
  readonly name: string;
  readonly span: Span;
  readonly call?: CallArguments;
}

export interface InterpolationExpr {
  readonly kind: 'interpolation';
  readonly span: Span;
  readonly expr: Expr;
}

export type StringPart = { readonly kind: 'text'; readonly span: Span } | InterpolationExpr;

export type Expr =
  | {
      readonly kind: 'path';
      readonly span: Span;
      /** Set for a chain on an interpolated value, e.g. `{this.data}.json(items)`. */
      readonly base?: InterpolationExpr;
      readonly segments: readonly PathSegment[];
    }
  | { readonly kind: 'string'; readonly span: Span; readonly parts: readonly StringPart[] }
  | { readonly kind: 'number'; readonly span: Span; readonly text: string }
  | InterpolationExpr
  | { readonly kind: 'group'; readonly span: Span; readonly expr: Expr }
  | {
      readonly kind: 'binary';
      readonly span: Span;
      readonly operator: string;
      readonly operatorSpan: Span;
      readonly left: Expr;
      readonly right: Expr;
    }
  | {
      readonly kind: 'unary';
      readonly span: Span;
      readonly operator: string;
      readonly operatorSpan: Span;
      readonly operand: Expr;
    }
  /** Unquoted text Parsley passes through, such as `Y-m-d` or a URL, with any `{…}` inside. */
  | {
      readonly kind: 'literal';
      readonly span: Span;
      readonly interpolations: readonly InterpolationExpr[];
    }
  /** Text that is not a recognizable expression. */
  | { readonly kind: 'unknown'; readonly span: Span };

// ---------- Tags and documents ----------

export interface SortKey {
  readonly expr: Expr;
  readonly direction?: 'asc' | 'desc';
}

export type IncludeTarget =
  | { readonly kind: 'static'; readonly name: string; readonly span: Span }
  | { readonly kind: 'dynamic'; readonly expr: Expr };

export type Tag =
  | {
      readonly kind: 'each';
      readonly keywords: readonly Span[];
      readonly source: Expr;
      readonly alias: { readonly name: string; readonly span: Span };
      readonly where?: Expr;
      readonly sort: readonly SortKey[];
      readonly limit: readonly Expr[];
      /** Parts of the tag that are not a recognized loop clause. */
      readonly problems: readonly Span[];
    }
  | {
      readonly kind: 'if' | 'else-if';
      readonly keywords: readonly Span[];
      readonly condition: Expr;
      readonly problems: readonly Span[];
    }
  | { readonly kind: 'else'; readonly keywords: readonly Span[] }
  | { readonly kind: 'end'; readonly block: 'each' | 'if'; readonly keywords: readonly Span[] }
  | { readonly kind: 'include'; readonly keywords: readonly Span[]; readonly target: IncludeTarget }
  | {
      readonly kind: 'assign';
      readonly variable: { readonly name: string; readonly span: Span };
      readonly operatorSpan: Span;
      readonly value: Expr;
    }
  | { readonly kind: 'output'; readonly expr: Expr }
  | { readonly kind: 'unrecognized'; readonly reason: string };

export interface TextNode {
  readonly kind: 'text';
  readonly span: Span;
}

export interface CommentNode {
  readonly kind: 'comment';
  readonly id: string;
  readonly span: Span;
  readonly text: string;
}

export interface TagNode {
  readonly kind: 'tag';
  readonly id: string;
  /** From `{{` to `}}` inclusive. */
  readonly span: Span;
  readonly inner: Span;
  readonly tag: Tag;
  /** Set for an `end-*`, `else`, or `else-if` tag that matches no open block. */
  readonly stray?: true;
}

export interface EachBlock {
  readonly kind: 'each';
  readonly id: string;
  readonly open: TagNode;
  readonly body: readonly ParsleyNode[];
  /** Missing when the loop is never closed. */
  readonly close?: TagNode;
}

export interface IfBranch {
  /** The id of the branch's `if`, `else-if`, or `else` tag. */
  readonly id: string;
  readonly tag: TagNode;
  readonly body: readonly ParsleyNode[];
}

export interface IfBlock {
  readonly kind: 'if';
  readonly id: string;
  readonly branches: readonly IfBranch[];
  readonly close?: TagNode;
}

export type ParsleyNode = TextNode | CommentNode | TagNode | EachBlock | IfBlock;

export interface ParsleyDocument {
  readonly source: string;
  readonly nodes: readonly ParsleyNode[];
}

// ---------- Lexer ----------

type LexemeKind =
  'word' | 'variable' | 'number' | 'string' | 'url' | 'operator' | 'punctuation' | 'other';

interface Lexeme {
  readonly kind: LexemeKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

// Words may contain inner hyphens (`end-each`, `one-to-one-field`); `a - b` stays subtraction.
const lexemePattern =
  /(\s+)|(https?:\/\/[^\s{}()'",]+)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|([$@][A-Za-z_]\w*)|(\d+(?:\.\d+)?)|([A-Za-z_]\w*(?:-[A-Za-z_]\w*)*)|(==|!=|<>|>=|<=|&&|\|\||[=<>!+\-*/%])|([{}().,])|([\s\S])/y;

const lexemeKinds: readonly (LexemeKind | undefined)[] = [
  undefined,
  undefined,
  'url',
  'string',
  'variable',
  'number',
  'word',
  'operator',
  'punctuation',
  'other',
];

/** Splits `source[start, end)` into lexemes with absolute offsets, dropping whitespace. */
function lex(source: string, start: number, end: number): Lexeme[] {
  const text = source.slice(0, end);
  const pattern = new RegExp(lexemePattern.source, 'y');
  pattern.lastIndex = start;
  const lexemes: Lexeme[] = [];
  while (pattern.lastIndex < end) {
    const offset = pattern.lastIndex;
    const match = pattern.exec(text);
    if (!match) break;
    const group = match.findIndex((value, index) => index > 0 && value !== undefined);
    const kind = lexemeKinds[group];
    if (kind) lexemes.push({ kind, text: match[0], start: offset, end: pattern.lastIndex });
  }
  return lexemes;
}

function isWord(lexeme: Lexeme | undefined, ...words: readonly string[]): boolean {
  return lexeme?.kind === 'word' && words.includes(lexeme.text.toLowerCase());
}

function spanOf(lexemes: readonly Lexeme[], from: number, to: number): Span {
  const first = lexemes[from];
  const last = lexemes[to - 1];
  if (!first || !last) throw new Error('A span needs at least one lexeme.');
  return { start: first.start, end: last.end };
}

function joinSpans(first: Span, last: Span): Span {
  return { start: first.start, end: last.end };
}

/** Index just past the lexeme that closes the bracket opened at `index`, or -1. */
function closingIndex(lexemes: readonly Lexeme[], index: number, end: number): number {
  const pairs: Readonly<Record<string, string>> = { '(': ')', '{': '}' };
  const stack: string[] = [];
  for (let position = index; position < end; position++) {
    const lexeme = lexemes[position];
    if (lexeme?.kind !== 'punctuation') continue;
    const closer = pairs[lexeme.text];
    if (closer) {
      stack.push(closer);
      continue;
    }
    if (lexeme.text === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return position + 1;
    }
  }
  return -1;
}

/** Splits `[from, to)` at commas outside brackets. */
function splitTopLevel(
  lexemes: readonly Lexeme[],
  from: number,
  to: number,
): readonly (readonly [number, number])[] {
  const ranges: (readonly [number, number])[] = [];
  let depth = 0;
  let rangeStart = from;
  for (let position = from; position < to; position++) {
    const lexeme = lexemes[position];
    if (lexeme?.kind !== 'punctuation') continue;
    if (lexeme.text === '(' || lexeme.text === '{') depth++;
    else if (lexeme.text === ')' || lexeme.text === '}') depth = Math.max(0, depth - 1);
    else if (lexeme.text === ',' && depth === 0) {
      ranges.push([rangeStart, position]);
      rangeStart = position + 1;
    }
  }
  ranges.push([rangeStart, to]);
  return ranges;
}

// ---------- Expression parser ----------

const comparisonOperators = new Set(['=', '==', '!=', '<>', '>', '<', '>=', '<=']);
const arithmeticOperators = new Set(['+', '-', '*', '/', '%']);

// Recursive descent over lexemes. It never throws; text it cannot place becomes `unknown`.
class ExpressionParser {
  private index: number;

  constructor(
    private readonly source: string,
    private readonly lexemes: readonly Lexeme[],
    from: number,
    private readonly end: number,
  ) {
    this.index = from;
  }

  get position(): number {
    return this.index;
  }

  private peek(offset = 0): Lexeme | undefined {
    const index = this.index + offset;
    return index < this.end ? this.lexemes[index] : undefined;
  }

  parseExpression(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    for (;;) {
      const next = this.peek();
      if (!(isWord(next, 'or') || next?.text === '||') || !next) return left;
      this.index++;
      const right = this.parseAnd();
      left = binary(left, next, right);
    }
  }

  private parseAnd(): Expr {
    let left = this.parseComparison();
    for (;;) {
      const next = this.peek();
      if (!(isWord(next, 'and') || next?.text === '&&') || !next) return left;
      this.index++;
      const right = this.parseComparison();
      left = binary(left, next, right);
    }
  }

  private parseComparison(): Expr {
    let left = this.parseArithmetic();
    for (;;) {
      const next = this.peek();
      if (!next) return left;
      if (next.kind === 'operator' && comparisonOperators.has(next.text)) {
        this.index++;
        left = binary(left, next, this.parseArithmetic());
        continue;
      }
      if (isWord(next, 'like')) {
        this.index++;
        left = binary(left, next, this.parseArithmetic());
        continue;
      }
      if (isWord(next, 'not') && isWord(this.peek(1), 'like')) {
        const like = this.peek(1)!;
        this.index += 2;
        const operator: Lexeme = {
          kind: 'word',
          text: `${next.text} ${like.text}`,
          start: next.start,
          end: like.end,
        };
        left = binary(left, operator, this.parseArithmetic());
        continue;
      }
      return left;
    }
  }

  private parseArithmetic(): Expr {
    let left = this.parseUnary();
    for (;;) {
      const next = this.peek();
      if (next?.kind !== 'operator' || !arithmeticOperators.has(next.text)) return left;
      this.index++;
      left = binary(left, next, this.parseUnary());
    }
  }

  private parseUnary(): Expr {
    const next = this.peek();
    if (next && (next.text === '!' || (isWord(next, 'not') && !isWord(this.peek(1), 'like')))) {
      this.index++;
      const operand = this.parseUnary();
      return {
        kind: 'unary',
        span: joinSpans(next, operand.span),
        operator: next.text,
        operatorSpan: next,
        operand,
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const lexeme = this.peek();
    if (!lexeme) {
      const at = this.lexemes[this.index - 1]?.end ?? 0;
      return { kind: 'unknown', span: { start: at, end: at } };
    }
    if (lexeme.kind === 'number') {
      this.index++;
      return { kind: 'number', span: lexeme, text: lexeme.text };
    }
    if (lexeme.kind === 'string') {
      this.index++;
      return parseString(this.source, lexeme);
    }
    if (lexeme.kind === 'url') {
      this.index++;
      return { kind: 'literal', span: lexeme, interpolations: [] };
    }
    if (lexeme.kind === 'punctuation' && (lexeme.text === '{' || lexeme.text === '(')) {
      return this.parseBracketed(lexeme);
    }
    if (lexeme.kind === 'word' || lexeme.kind === 'variable') return this.parsePath();
    this.index++;
    return { kind: 'unknown', span: lexeme };
  }

  private parseBracketed(open: Lexeme): Expr {
    const close = closingIndex(this.lexemes, this.index, this.end);
    if (close < 0) {
      const span = spanOf(this.lexemes, this.index, this.end);
      this.index = this.end;
      return { kind: 'unknown', span };
    }
    const inner = new ExpressionParser(this.source, this.lexemes, this.index + 1, close - 1);
    const expr = inner.parseComplete();
    const span = spanOf(this.lexemes, this.index, close);
    this.index = close;
    if (open.text === '(') return { kind: 'group', span, expr };
    const interpolation: InterpolationExpr = { kind: 'interpolation', span, expr };
    const dot = this.peek();
    if (dot?.kind !== 'punctuation' || dot.text !== '.' || this.peek(1)?.kind !== 'word') {
      return interpolation;
    }
    this.index++;
    return this.parsePath(interpolation);
  }

  private parsePath(base?: InterpolationExpr): Expr {
    const segments: PathSegment[] = [];
    for (;;) {
      const name = this.peek();
      if (!name || (name.kind !== 'word' && (name.kind !== 'variable' || segments.length > 0))) {
        break;
      }
      this.index++;
      const call = this.parseCall();
      segments.push({ name: name.text, span: name, ...(call ? { call } : {}) });
      if (this.peek()?.text !== '.' || this.peek()?.kind !== 'punctuation') break;
      const afterDot = this.peek(1);
      if (afterDot?.kind !== 'word') break;
      this.index++;
    }
    const first = segments[0];
    const last = segments.at(-1);
    if (!first || !last) throw new Error('A path starts with a word or variable.');
    return {
      kind: 'path',
      span: joinSpans(base?.span ?? first.span, last.call?.span ?? last.span),
      ...(base ? { base } : {}),
      segments,
    };
  }

  private parseCall(): CallArguments | undefined {
    const open = this.peek();
    if (open?.kind !== 'punctuation' || open.text !== '(') return undefined;
    const close = closingIndex(this.lexemes, this.index, this.end);
    if (close < 0) return undefined;
    const openIndex = this.index;
    this.index = close;
    const closeLexeme = this.lexemes[close - 1]!;
    const args =
      close - openIndex === 2
        ? []
        : splitTopLevel(this.lexemes, openIndex + 1, close - 1).map(([from, to]) =>
            parseArgument(this.source, this.lexemes, from, to, open.end),
          );
    return {
      span: joinSpans(open, closeLexeme),
      raw: this.source.slice(open.end, closeLexeme.start),
      args,
    };
  }

  /** Parses the remaining range; anything left over is folded into an `unknown` expression. */
  parseComplete(): Expr {
    if (this.index >= this.end) {
      const at = this.lexemes[this.index - 1]?.end ?? 0;
      return { kind: 'unknown', span: { start: at, end: at } };
    }
    const from = this.index;
    const expr = this.parseExpression();
    if (this.index >= this.end) return expr;
    return { kind: 'unknown', span: spanOf(this.lexemes, from, this.end) };
  }
}

function binary(left: Expr, operator: Lexeme, right: Expr): Expr {
  return {
    kind: 'binary',
    span: joinSpans(left.span, right.span),
    operator: operator.text,
    operatorSpan: operator,
    left,
    right,
  };
}

/** The expressions directly inside `expr`, including call arguments and interpolations. */
export function childExpressions(expr: Expr): readonly Expr[] {
  if (expr.kind === 'binary') return [expr.left, expr.right];
  if (expr.kind === 'unary') return [expr.operand];
  if (expr.kind === 'group' || expr.kind === 'interpolation') return [expr.expr];
  if (expr.kind === 'string') return expr.parts.filter((part) => part.kind === 'interpolation');
  if (expr.kind === 'literal') return expr.interpolations;
  if (expr.kind === 'path') {
    return [
      ...(expr.base ? [expr.base] : []),
      ...expr.segments.flatMap((segment) => segment.call?.args ?? []),
    ];
  }
  return [];
}

/** Whether an expression contains text the parser could not place. */
export function hasUnknown(expr: Expr): boolean {
  return expr.kind === 'unknown' || childExpressions(expr).some(hasUnknown);
}

/** Parses `[from, to)` completely, or returns undefined when text is left over. */
function parseWhole(
  source: string,
  lexemes: readonly Lexeme[],
  from: number,
  to: number,
): Expr | undefined {
  if (from >= to) return undefined;
  const parser = new ExpressionParser(source, lexemes, from, to);
  const expr = parser.parseExpression();
  return parser.position === to && !hasUnknown(expr) ? expr : undefined;
}

/** Collects `{…}` interpolations in `[from, to)`. */
function interpolationsIn(
  source: string,
  lexemes: readonly Lexeme[],
  from: number,
  to: number,
): InterpolationExpr[] {
  const found: InterpolationExpr[] = [];
  for (let position = from; position < to; position++) {
    const lexeme = lexemes[position];
    if (lexeme?.kind !== 'punctuation' || lexeme.text !== '{') continue;
    const close = closingIndex(lexemes, position, to);
    if (close < 0) break;
    const expr = new ExpressionParser(source, lexemes, position + 1, close - 1).parseComplete();
    found.push({ kind: 'interpolation', span: spanOf(lexemes, position, close), expr });
    position = close - 1;
  }
  return found;
}

/** Whether lexemes outside `{…}` contain a `$variable` or a `name.member` path. */
function looksLikeCode(lexemes: readonly Lexeme[], from: number, to: number): boolean {
  let depth = 0;
  for (let position = from; position < to; position++) {
    const lexeme = lexemes[position]!;
    if (lexeme.kind === 'punctuation' && lexeme.text === '{') depth++;
    if (lexeme.kind === 'punctuation' && lexeme.text === '}') depth = Math.max(0, depth - 1);
    if (depth > 0) continue;
    if (lexeme.kind === 'variable') return true;
    if (
      lexeme.kind === 'word' &&
      lexemes[position + 1]?.text === '.' &&
      lexemes[position + 2]?.kind === 'word' &&
      position + 2 < to
    ) {
      return true;
    }
  }
  return false;
}

// Call arguments are often bare text (`date(Y-m-d)`, `api.json.get(https://…)`), so an argument
// that is not a complete expression is kept as a literal. Text that reads as code, such as
// `a.b ?? c`, is reported as unknown instead.
function parseArgument(
  source: string,
  lexemes: readonly Lexeme[],
  from: number,
  to: number,
  fallbackOffset: number,
): Expr {
  if (from >= to)
    return {
      kind: 'literal',
      span: { start: fallbackOffset, end: fallbackOffset },
      interpolations: [],
    };
  const whole = parseWhole(source, lexemes, from, to);
  if (whole) return whole;
  if (looksLikeCode(lexemes, from, to)) {
    return new ExpressionParser(source, lexemes, from, to).parseComplete();
  }
  return {
    kind: 'literal',
    span: spanOf(lexemes, from, to),
    interpolations: interpolationsIn(source, lexemes, from, to),
  };
}

/** An expression that must be complete, such as a loop source; leftovers become `unknown`. */
function parseStrict(source: string, lexemes: readonly Lexeme[], from: number, to: number): Expr {
  return new ExpressionParser(source, lexemes, from, to).parseComplete();
}

/** A value that may be bare text, such as an assignment's `Hello World`. */
function parseValue(source: string, lexemes: readonly Lexeme[], from: number, to: number): Expr {
  return parseArgument(source, lexemes, from, to, lexemes[from - 1]?.end ?? 0);
}

function parseString(source: string, lexeme: Lexeme): Expr {
  const parts: StringPart[] = [];
  const contentStart = lexeme.start + 1;
  const contentEnd = lexeme.end - 1;
  let textStart = lexeme.start;
  let position = contentStart;
  while (position < contentEnd) {
    if (source[position] !== '{') {
      position++;
      continue;
    }
    const inner = lex(source, position, contentEnd);
    const close = closingIndex(inner, 0, inner.length);
    if (close < 0) break;
    const closeLexeme = inner[close - 1]!;
    if (position > textStart)
      parts.push({ kind: 'text', span: { start: textStart, end: position } });
    const expr = new ExpressionParser(source, inner, 1, close - 1).parseComplete();
    parts.push({ kind: 'interpolation', span: { start: position, end: closeLexeme.end }, expr });
    position = closeLexeme.end;
    textStart = position;
  }
  parts.push({ kind: 'text', span: { start: textStart, end: lexeme.end } });
  return { kind: 'string', span: lexeme, parts };
}

// ---------- Tag parser ----------

function unrecognized(reason: string): Tag {
  return { kind: 'unrecognized', reason };
}

function endBlock(lexemes: readonly Lexeme[]): 'each' | 'if' | undefined {
  const [first, second] = lexemes;
  if (lexemes.length === 1 && first?.kind === 'word') {
    const word = first.text.toLowerCase();
    if (word === 'end-each' || word === 'endeach') return 'each';
    if (word === 'end-if' || word === 'endif') return 'if';
  }
  if (lexemes.length === 2 && first?.text === '/' && second?.kind === 'word') {
    const word = second.text.toLowerCase();
    if (word === 'each' || word === 'if') return word;
  }
  return undefined;
}

function parseCondition(
  source: string,
  lexemes: readonly Lexeme[],
  from: number,
): { readonly condition: Expr; readonly problems: readonly Span[] } {
  if (from >= lexemes.length) {
    const at = lexemes[from - 1]?.end ?? 0;
    return { condition: { kind: 'unknown', span: { start: at, end: at } }, problems: [] };
  }
  const parser = new ExpressionParser(source, lexemes, from, lexemes.length);
  const condition = parser.parseExpression();
  const problems =
    parser.position < lexemes.length ? [spanOf(lexemes, parser.position, lexemes.length)] : [];
  return { condition, problems };
}

type ClauseKeyword = 'where' | 'sort' | 'limit';

function parseEach(source: string, lexemes: readonly Lexeme[]): Tag {
  const keywords: Span[] = [lexemes[0]!];
  let asIndex = -1;
  let depth = 0;
  for (let position = 1; position < lexemes.length; position++) {
    const lexeme = lexemes[position]!;
    if (lexeme.kind === 'punctuation' && (lexeme.text === '(' || lexeme.text === '{')) depth++;
    if (lexeme.kind === 'punctuation' && (lexeme.text === ')' || lexeme.text === '}')) depth--;
    if (depth === 0 && isWord(lexeme, 'as')) {
      asIndex = position;
      break;
    }
  }
  const alias = lexemes[asIndex + 1];
  if (asIndex < 2 || alias?.kind !== 'word') {
    return unrecognized('A loop needs a source and an `as` alias.');
  }
  keywords.push(lexemes[asIndex]!);
  const loopSource = parseStrict(source, lexemes, 1, asIndex);

  // Clauses may come in any order, e.g. `limit 10 order by rand()`.
  const clauses: { keyword: ClauseKeyword; from: number; to: number }[] = [];
  const problems: Span[] = [];
  depth = 0;
  let position = asIndex + 2;
  const clausesFrom = position;
  const startClause = (keyword: ClauseKeyword, keywordLength: number) => {
    const current = clauses.at(-1);
    if (current) current.to = position;
    else if (position > clausesFrom) problems.push(spanOf(lexemes, clausesFrom, position));
    for (let offset = 0; offset < keywordLength; offset++)
      keywords.push(lexemes[position + offset]!);
    clauses.push({ keyword, from: position + keywordLength, to: lexemes.length });
    position += keywordLength;
  };
  while (position < lexemes.length) {
    const lexeme = lexemes[position]!;
    if (lexeme.kind === 'punctuation' && (lexeme.text === '(' || lexeme.text === '{')) depth++;
    if (lexeme.kind === 'punctuation' && (lexeme.text === ')' || lexeme.text === '}')) depth--;
    // A member such as `a.limit` is a field, not a clause.
    const clauseStart = depth === 0 && lexemes[position - 1]?.text !== '.';
    if (clauseStart && isWord(lexeme, 'where')) {
      startClause('where', 1);
      continue;
    }
    if (clauseStart && isWord(lexeme, 'sort', 'order') && isWord(lexemes[position + 1], 'by')) {
      startClause('sort', 2);
      continue;
    }
    if (clauseStart && isWord(lexeme, 'limit')) {
      startClause('limit', 1);
      continue;
    }
    position++;
  }
  if (clauses.length === 0 && lexemes.length > clausesFrom) {
    problems.push(spanOf(lexemes, clausesFrom, lexemes.length));
  }

  let where: Expr | undefined;
  const sort: SortKey[] = [];
  const limit: Expr[] = [];
  for (const clause of clauses) {
    if (clause.from >= clause.to) {
      problems.push(lexemes[clause.from - 1]!);
      continue;
    }
    if (clause.keyword === 'where') {
      const parser = new ExpressionParser(source, lexemes, clause.from, clause.to);
      where = parser.parseExpression();
      if (parser.position < clause.to) problems.push(spanOf(lexemes, parser.position, clause.to));
      continue;
    }
    for (const [from, to] of splitTopLevel(lexemes, clause.from, clause.to)) {
      if (from >= to) {
        problems.push(spanOf(lexemes, clause.from, clause.to));
        continue;
      }
      if (clause.keyword === 'limit') {
        limit.push(parseStrict(source, lexemes, from, to));
        continue;
      }
      const last = lexemes[to - 1];
      const direction = isWord(last, 'asc', 'desc')
        ? (last!.text.toLowerCase() as 'asc' | 'desc')
        : undefined;
      if (direction) keywords.push(last!);
      const keyEnd = direction ? to - 1 : to;
      const expr = keyEnd > from ? parseStrict(source, lexemes, from, keyEnd) : undefined;
      if (!expr) {
        problems.push(spanOf(lexemes, from, to));
        continue;
      }
      sort.push({ expr, ...(direction ? { direction } : {}) });
    }
    if (clause.keyword === 'limit' && limit.length > 2) {
      problems.push(spanOf(lexemes, clause.from, clause.to));
    }
  }

  return {
    kind: 'each',
    keywords,
    source: loopSource,
    alias: { name: alias.text, span: alias },
    ...(where ? { where } : {}),
    sort,
    limit,
    problems,
  };
}

/** Classifies the text between `{{` and `}}`. */
export function parseTag(source: string, inner: Span): Tag {
  const lexemes = lex(source, inner.start, inner.end);
  const [first, second] = lexemes;
  if (!first) return unrecognized('The tag is empty.');

  const closes = endBlock(lexemes);
  if (closes) return { kind: 'end', block: closes, keywords: [spanOf(lexemes, 0, lexemes.length)] };

  if (isWord(first, 'each')) return parseEach(source, lexemes);
  if (isWord(first, 'if'))
    return { kind: 'if', keywords: [first], ...parseCondition(source, lexemes, 1) };
  if (isWord(first, 'else-if', 'elseif')) {
    return { kind: 'else-if', keywords: [first], ...parseCondition(source, lexemes, 1) };
  }
  if (isWord(first, 'else') && isWord(second, 'if')) {
    return { kind: 'else-if', keywords: [first, second!], ...parseCondition(source, lexemes, 2) };
  }
  if (isWord(first, 'else')) {
    return lexemes.length === 1
      ? { kind: 'else', keywords: [first] }
      : unrecognized('`else` is followed by unexpected text.');
  }
  if (isWord(first, 'include')) {
    if (!second) return unrecognized('The include names no file.');
    const rest = spanOf(lexemes, 1, lexemes.length);
    const name = source.slice(rest.start, rest.end);
    // A name built from `{…}` or a variable is chosen when the page runs.
    if (/[{$@]/.test(name)) {
      return {
        kind: 'include',
        keywords: [first],
        target: { kind: 'dynamic', expr: parseValue(source, lexemes, 1, lexemes.length) },
      };
    }
    return {
      kind: 'include',
      keywords: [first],
      target: { kind: 'static', name, span: rest },
    };
  }
  if (first.kind === 'variable' && second?.kind === 'operator' && second.text === '=') {
    const value =
      lexemes.length > 2
        ? parseValue(source, lexemes, 2, lexemes.length)
        : ({
            kind: 'literal',
            span: { start: second.end, end: second.end },
            interpolations: [],
          } as const);
    return {
      kind: 'assign',
      variable: { name: first.text, span: first },
      operatorSpan: second,
      value,
    };
  }

  const expr = parseWhole(source, lexemes, 0, lexemes.length);
  return expr
    ? { kind: 'output', expr }
    : unrecognized('The tag is not a recognized Parsley form.');
}

// ---------- Document parser ----------

/** Index just past the `}}` closing the tag opened at `start`, skipping `{…}` and quoted values. */
function tagEnd(source: string, start: number): number {
  let depth = 0;
  for (let index = start + 2; index < source.length; index++) {
    const char = source[index];
    if (char === "'" || char === '"') {
      // A quoted value may contain `}}`. An unmatched quote on its line, as in `Don't`, is text.
      let close = source.indexOf(char, index + 1);
      while (close > 0 && source[close - 1] === '\\') close = source.indexOf(char, close + 1);
      const lineEnd = source.indexOf('\n', index);
      if (close > 0 && (lineEnd < 0 || close < lineEnd)) index = close;
      continue;
    }
    if (char === '{') {
      depth++;
      continue;
    }
    if (char !== '}') continue;
    if (depth === 0 && source[index + 1] === '}') return index + 2;
    depth = Math.max(0, depth - 1);
  }
  // Unbalanced braces inside the tag: fall back to the first `}}`.
  const plain = source.indexOf('}}', start + 2);
  return plain < 0 ? -1 : plain + 2;
}

interface MutableEach {
  readonly kind: 'each';
  readonly id: string;
  readonly open: TagNode;
  readonly body: ParsleyNode[];
  close?: TagNode;
}

interface MutableBranch {
  readonly id: string;
  readonly tag: TagNode;
  readonly body: ParsleyNode[];
}

interface MutableIf {
  readonly kind: 'if';
  readonly id: string;
  readonly branches: MutableBranch[];
  close?: TagNode;
}

/** Parses a complete Parsley file. Concatenating every node's span yields the source. */
export function parseParsley(source: string): ParsleyDocument {
  const root: ParsleyNode[] = [];
  const stack: (MutableEach | MutableIf)[] = [];
  const target = (): ParsleyNode[] => {
    const block = stack.at(-1);
    if (!block) return root;
    return block.kind === 'each' ? block.body : block.branches.at(-1)!.body;
  };
  const pushText = (start: number, end: number) => {
    if (end > start) target().push({ kind: 'text', span: { start, end } });
  };

  let position = 0;
  while (position < source.length) {
    const nextTag = source.indexOf('{{', position);
    const nextComment = source.indexOf('(**', position);
    const candidates = [nextTag, nextComment].filter((index) => index >= 0);
    if (candidates.length === 0) {
      pushText(position, source.length);
      break;
    }
    const next = Math.min(...candidates);
    pushText(position, next);

    if (next === nextComment) {
      const end = source.indexOf('**)', next + 3);
      const stop = end < 0 ? source.length : end + 3;
      target().push({
        kind: 'comment',
        id: `c${next}`,
        span: { start: next, end: stop },
        text: source.slice(next + 3, end < 0 ? source.length : end).trim(),
      });
      position = stop;
      continue;
    }

    const stop = tagEnd(source, next);
    if (stop < 0) {
      target().push({
        kind: 'tag',
        id: `t${next}`,
        span: { start: next, end: next + 2 },
        inner: { start: next + 2, end: next + 2 },
        tag: unrecognized('`{{` is never closed with `}}`.'),
      });
      position = next + 2;
      continue;
    }
    const inner = { start: next + 2, end: stop - 2 };
    const node: TagNode = {
      kind: 'tag',
      id: `t${next}`,
      span: { start: next, end: stop },
      inner,
      tag: parseTag(source, inner),
    };
    position = stop;

    const { tag } = node;
    if (tag.kind === 'each') {
      const block: MutableEach = { kind: 'each', id: `b${next}`, open: node, body: [] };
      target().push(block);
      stack.push(block);
      continue;
    }
    if (tag.kind === 'if') {
      const block: MutableIf = {
        kind: 'if',
        id: `b${next}`,
        branches: [{ id: node.id, tag: node, body: [] }],
      };
      target().push(block);
      stack.push(block);
      continue;
    }
    if (tag.kind === 'else' || tag.kind === 'else-if') {
      const block = stack.at(-1);
      const lastBranch = block?.kind === 'if' ? block.branches.at(-1) : undefined;
      if (block?.kind === 'if' && lastBranch?.tag.tag.kind !== 'else') {
        block.branches.push({ id: node.id, tag: node, body: [] });
      } else {
        target().push({ ...node, stray: true });
      }
      continue;
    }
    if (tag.kind === 'end') {
      const depth = stack.findLastIndex((block) => block.kind === tag.block);
      if (depth < 0) {
        target().push({ ...node, stray: true });
        continue;
      }
      // Blocks opened after the matching one are left unclosed.
      const [block] = stack.splice(depth);
      block!.close = node;
      continue;
    }
    target().push(node);
  }

  return { source, nodes: root };
}
