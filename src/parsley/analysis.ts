// Explains one Parsley file without running it: resolves references against the session's
// collection catalog, lists what the file uses, and describes its steps in source order.
// References the catalog cannot match stay neutral "unrecognized" entries, never code errors.
import type {
  CodeFileZuid,
  CollectionField,
  CollectionSchema,
  FieldKind,
  ModelZuid,
} from '../domain';
import {
  childExpressions,
  hasUnknown,
  type EachBlock,
  type Expr,
  type IfBlock,
  type ParsleyDocument,
  type ParsleyNode,
  type PathSegment,
  type SortKey,
  type Span,
  type TagNode,
} from './syntax';

export interface CodeCollection {
  readonly modelZuid: ModelZuid;
  /** The technical name Parsley uses, e.g. `articles`. */
  readonly name: string;
  readonly label: string;
}

export interface CodeFileSummary {
  readonly id: CodeFileZuid;
  readonly fileName: string;
  readonly type: string;
}

export interface AnalysisContext {
  readonly collections: readonly CodeCollection[];
  readonly schemas: ReadonlyMap<ModelZuid, CollectionSchema>;
  /** The content model a model template renders; `this` is only bound when set. */
  readonly boundModelZuid?: ModelZuid;
  /** Files that an include may name. */
  readonly files: readonly CodeFileSummary[];
}

export type TokenKind =
  | 'delimiter'
  | 'keyword'
  | 'collection'
  | 'alias'
  | 'field'
  | 'meta'
  | 'input'
  | 'function'
  | 'builtin'
  | 'variable'
  | 'string'
  | 'number'
  | 'operator'
  | 'comment'
  | 'snippet'
  | 'remote'
  | 'literal'
  /** A reference the session cannot resolve: an unrecognized code reference. */
  | 'unrecognized-reference'
  /** Syntax or block structure Zesty Explorer does not recognize. */
  | 'unrecognized-syntax'
  | 'json-key'
  | 'json-punctuation'
  | 'html-tag'
  | 'text';

/** Highlighting for part of a tag. `ref` groups every mention of the same thing. */
export interface Annotation {
  readonly span: Span;
  readonly kind: TokenKind;
  readonly ref?: string;
  readonly hint?: string;
}

export type CollectionAccess = 'loop' | 'relationship' | 'bound' | 'reference';

export interface CollectionUsage {
  readonly collection: CodeCollection;
  readonly ref: string;
  /** Used fields in schema order. */
  readonly fields: readonly CollectionField[];
  readonly access: readonly CollectionAccess[];
}

export interface UsageEntry {
  /** A reference (`input:query:q`) or a node target (`node:t12`). */
  readonly target: string;
  readonly label: string;
  readonly detail?: string;
}

export interface SnippetUsage extends UsageEntry {
  readonly name: string;
  /** The file an include resolves to, when one matches. */
  readonly fileId?: CodeFileZuid;
  readonly dynamic: boolean;
}

export interface CodeUsage {
  readonly collections: readonly CollectionUsage[];
  readonly inputs: readonly UsageEntry[];
  readonly variables: readonly UsageEntry[];
  readonly snippets: readonly SnippetUsage[];
  readonly remote: readonly UsageEntry[];
  readonly unrecognized: readonly UsageEntry[];
}

export type StepKind =
  'loop' | 'condition' | 'branch' | 'assignment' | 'include' | 'note' | 'unrecognized';

export interface Step {
  /** Node target highlighted by the step, e.g. `node:b12`. */
  readonly target: string;
  /** Nested number such as `2.1`; empty for notes and `else` branches. */
  readonly number: string;
  readonly depth: number;
  readonly kind: StepKind;
  readonly title: string;
  readonly details: readonly string[];
  /** Collection whose color marks a loop over it. */
  readonly collection?: ModelZuid;
  readonly snippet?: SnippetUsage;
}

export interface CodeAnalysis {
  readonly annotations: readonly Annotation[];
  readonly usage: CodeUsage;
  readonly steps: readonly Step[];
  /** Tags whose syntax or block structure was not recognized. */
  readonly gaps: number;
  /** Field schemas the analysis could use but the context does not have yet. */
  readonly wantedModels: readonly ModelZuid[];
}

// Highlight targets are strings so they compare cheaply in the UI. A node target selects the
// lines a tag or block owns; every other target is a reference that tokens carry as `ref`.
const nodePrefix = 'node:';
const collectionPrefix = 'collection:';

/** The highlight target for a tag, comment, block, or branch. */
export function nodeTarget(id: string): string {
  return `${nodePrefix}${id}`;
}

/** The node id in a node target, or undefined for a reference. */
export function targetNodeId(target: string): string | undefined {
  return target.startsWith(nodePrefix) ? target.slice(nodePrefix.length) : undefined;
}

/** The reference shared by a collection's name, aliases, and fields. */
export function collectionRef(modelZuid: ModelZuid): string {
  return `${collectionPrefix}${modelZuid}`;
}

/** The collection a reference points to, if it is a collection reference. */
export function refCollection(ref: string | undefined): ModelZuid | undefined {
  return ref?.startsWith(collectionPrefix)
    ? (ref.slice(collectionPrefix.length) as ModelZuid)
    : undefined;
}

// ---------- Descriptions ----------

const fieldKindLabels: Readonly<Record<FieldKind, string>> = {
  text: 'text',
  number: 'number',
  date: 'date',
  boolean: 'yes/no',
  relationship: 'relationship',
  structured: 'structured',
};

const methodHints: Readonly<Record<string, string>> = {
  first: 'Picks the first item',
  last: 'Picks the last item',
  random: 'Picks a random item',
  filter: 'Keeps only the items that match the condition',
  toJSON: 'Serializes the item, with related items, as JSON. Arguments: depth, include metadata',
  escapeForJs:
    'Escapes quotes and line breaks so the value is safe inside a JSON or JavaScript string',
  getUrl: 'The public URL of the item',
  getImage: 'The image URL, resized to the given width',
  date: 'Formats the date with the given pattern',
  htmlentities: 'Escapes HTML characters',
};

const metaHints: Readonly<Record<string, string>> = {
  zuid: 'The item ZUID',
  _num: 'Position of the current item in the loop, starting at 1',
  _length: 'Number of items in the loop',
  _index: 'Position of the current item in the loop, starting at 0',
  _arraycomma: 'A comma after every item except the last',
};

/** How ascending and descending read for a sort field of each kind. */
const sortOrderText: Partial<Record<FieldKind, readonly [string, string]>> = {
  date: ['oldest first', 'newest first'],
  number: ['smallest first', 'largest first'],
  text: ['A → Z', 'Z → A'],
};
const plainSortOrder = ['ascending', 'descending'] as const;

const comparisonText: Readonly<Record<string, string>> = {
  '=': '=',
  '==': '=',
  '!=': '≠',
  '<>': '≠',
  '>': '>',
  '<': '<',
  '>=': '≥',
  '<=': '≤',
  '&&': 'and',
  '||': 'or',
};

const builtinHints: Readonly<Record<string, string>> = {
  site: 'Site-wide Parsley helpers',
  instance: 'Instance details and helpers',
  globals: 'Instance globals (clippings)',
  clippings: 'Instance globals (clippings)',
  setting: 'An instance setting',
  settings: 'Instance settings',
  response: 'Changes the HTTP response',
  current_view: 'The view being rendered',
  navigation: 'Site navigation',
  breadcrumbs: 'Breadcrumb links for the current page',
  text_breadcrumbs: 'Breadcrumb text for the current page',
  sectionlinks: 'Links within the current section',
  find_in_set: 'Checks whether a value is in a comma-separated list',
  rand: 'A random order',
  math: 'Calculates a value',
};

type ValueState =
  | { readonly kind: 'items'; readonly collection: CodeCollection; readonly text: string }
  | { readonly kind: 'item'; readonly collection: CodeCollection; readonly text: string }
  | { readonly kind: 'remote'; readonly url: string }
  | { readonly kind: 'unresolved'; readonly name: string }
  | { readonly kind: 'value' };

type AliasBinding =
  | {
      readonly kind: 'item';
      readonly collection: CodeCollection;
      readonly access: CollectionAccess;
    }
  | { readonly kind: 'remote'; readonly url: string }
  | { readonly kind: 'unresolved'; readonly name: string };

interface Scope {
  readonly aliases: ReadonlyMap<string, AliasBinding>;
  /** Inside `filter(…)`, bare names are fields of the filtered collection. */
  readonly implicitItem?: CodeCollection;
  /** Inside call arguments, unmatched bare words are literals such as `Y-m-d`. */
  readonly argument?: boolean;
  /** Describing a loop source, whose collection access the loop records itself. */
  readonly loopSource?: boolean;
}

/** Numbers sibling steps `1, 2, …` below `prefix`, e.g. `2.1, 2.2`. */
function counter(prefix: string): () => string {
  let count = 0;
  return () => `${prefix}${++count}`;
}

interface Described {
  readonly text: string;
  readonly state: ValueState;
}

const plainValue: ValueState = { kind: 'value' };

function withAlias(scope: Scope, name: string, binding: AliasBinding): Scope {
  return { ...scope, aliases: new Map([...scope.aliases, [name, binding]]) };
}

function aliasLabel(binding: AliasBinding): string {
  if (binding.kind === 'item') return binding.collection.label;
  if (binding.kind === 'remote') return 'remote JSON';
  return `“${binding.name}”`;
}

function aliasRef(binding: AliasBinding): string {
  if (binding.kind === 'item') return collectionRef(binding.collection.modelZuid);
  if (binding.kind === 'remote') return `remote:${binding.url}`;
  return `unrecognized:${binding.name}`;
}

function isPlainIdentifier(expr: Expr): boolean {
  return expr.kind === 'path' && expr.segments.length === 1 && !expr.segments[0]?.call;
}

function mentionsLoopPosition(expr: Expr): boolean {
  const names = new Set<string>();
  const visit = (current: Expr) => {
    if (current.kind === 'path') current.segments.forEach((segment) => names.add(segment.name));
    childExpressions(current).forEach(visit);
  };
  visit(expr);
  return names.has('_length') && (names.has('_num') || names.has('_index'));
}

class Analyzer {
  private readonly annotations: Annotation[] = [];
  private readonly collectionsByName: ReadonlyMap<string, CodeCollection>;
  private readonly collectionsByZuid: ReadonlyMap<ModelZuid, CodeCollection>;
  private readonly wanted = new Set<ModelZuid>();
  private readonly usedFields = new Map<ModelZuid, Set<string>>();
  private readonly access = new Map<ModelZuid, Set<CollectionAccess>>();
  private readonly inputs = new Map<string, UsageEntry>();
  private readonly variables = new Map<string, UsageEntry>();
  private readonly snippets = new Map<string, SnippetUsage>();
  private readonly remote = new Map<string, UsageEntry>();
  private readonly unrecognized = new Map<string, UsageEntry>();
  /** Descriptions of output tags by node id, for loop summaries. */
  private readonly outputs = new Map<string, string>();
  private gaps = 0;

  constructor(
    private readonly document: ParsleyDocument,
    private readonly context: AnalysisContext,
  ) {
    this.collectionsByName = new Map(context.collections.map((entry) => [entry.name, entry]));
    this.collectionsByZuid = new Map(context.collections.map((entry) => [entry.modelZuid, entry]));
  }

  analyze(): CodeAnalysis {
    const steps = this.walk(this.document.nodes, { aliases: new Map() }, 0, counter(''));
    const collections: CollectionUsage[] = [];
    for (const [modelZuid, access] of this.access) {
      const collection = this.collectionsByZuid.get(modelZuid);
      if (!collection) continue;
      const used = this.usedFields.get(modelZuid) ?? new Set();
      collections.push({
        collection,
        ref: collectionRef(modelZuid),
        fields: (this.context.schemas.get(modelZuid)?.fields ?? []).filter((field) =>
          used.has(field.name),
        ),
        access: [...access],
      });
    }
    return {
      annotations: [...this.annotations].sort((left, right) => left.span.start - right.span.start),
      usage: {
        collections,
        inputs: [...this.inputs.values()],
        variables: [...this.variables.values()],
        snippets: [...this.snippets.values()],
        remote: [...this.remote.values()],
        unrecognized: [...this.unrecognized.values()],
      },
      steps,
      gaps: this.gaps,
      wantedModels: [...this.wanted],
    };
  }

  // ---------- Recording ----------

  private annotate(span: Span, kind: TokenKind, ref?: string, hint?: string): void {
    if (span.end <= span.start) return;
    this.annotations.push({
      span,
      kind,
      ...(ref ? { ref } : {}),
      ...(hint ? { hint } : {}),
    });
  }

  private text(span: Span): string {
    return this.document.source.slice(span.start, span.end);
  }

  private excerpt(span: Span): string {
    const text = this.text(span).replace(/\s+/g, ' ').trim();
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  }

  private addAccess(collection: CodeCollection, access: CollectionAccess): void {
    const current = this.access.get(collection.modelZuid) ?? new Set();
    current.add(access);
    this.access.set(collection.modelZuid, current);
  }

  private addUnrecognized(entry: UsageEntry): void {
    if (!this.unrecognized.has(entry.target)) this.unrecognized.set(entry.target, entry);
  }

  private syntaxGap(node: TagNode | undefined, span: Span, reason: string): void {
    this.gaps++;
    const target = node ? nodeTarget(node.id) : `span:${span.start}`;
    this.annotate(
      span,
      'unrecognized-syntax',
      target,
      `Not recognized by Zesty Explorer. ${reason}`,
    );
    this.addUnrecognized({ target, label: this.excerpt(span), detail: reason });
  }

  // ---------- Expressions ----------

  private describe(expr: Expr, scope: Scope): Described {
    switch (expr.kind) {
      case 'number':
        this.annotate(expr.span, 'number');
        return { text: expr.text, state: plainValue };
      case 'literal':
        return this.describeLiteral(expr, scope);
      case 'string':
        return this.describeString(expr, scope);
      case 'interpolation':
        return this.describe(expr.expr, scope);
      case 'group': {
        const inner = this.describe(expr.expr, scope);
        return { text: `(${inner.text})`, state: inner.state };
      }
      case 'unary': {
        this.annotate(expr.operatorSpan, expr.operator === '!' ? 'operator' : 'keyword');
        const operand = this.describe(expr.operand, scope);
        return { text: `not ${operand.text}`, state: plainValue };
      }
      case 'binary':
        return { text: this.describeBinary(expr, scope), state: plainValue };
      case 'path':
        return expr.base
          ? this.describeMembers(expr.segments, this.describe(expr.base, scope), scope)
          : this.describePath(expr.segments, scope);
      case 'unknown': {
        this.gaps++;
        const target = `span:${expr.span.start}`;
        const label = this.excerpt(expr.span) || '(missing expression)';
        const detail = 'Not a Parsley expression Zesty Explorer recognizes.';
        this.annotate(
          expr.span,
          'unrecognized-syntax',
          target,
          `Not recognized by Zesty Explorer.`,
        );
        this.addUnrecognized({ target, label, detail });
        return { text: this.text(expr.span), state: plainValue };
      }
    }
  }

  private describeLiteral(expr: Extract<Expr, { kind: 'literal' }>, scope: Scope): Described {
    let cursor = expr.span.start;
    let text = '';
    for (const interpolation of expr.interpolations) {
      this.annotate({ start: cursor, end: interpolation.span.start }, 'literal');
      text += this.document.source.slice(cursor, interpolation.span.start);
      text += `{${this.describe(interpolation.expr, scope).text}}`;
      cursor = interpolation.span.end;
    }
    this.annotate({ start: cursor, end: expr.span.end }, 'literal');
    text += this.document.source.slice(cursor, expr.span.end);
    return { text: text.trim(), state: plainValue };
  }

  private describeString(expr: Extract<Expr, { kind: 'string' }>, scope: Scope): Described {
    const pieces = expr.parts.map((part) => {
      if (part.kind === 'text') {
        this.annotate(part.span, 'string');
        return { literal: true, text: this.text(part.span) };
      }
      return { literal: false, text: this.describe(part.expr, scope).text };
    });
    const quote = this.document.source[expr.span.start] ?? "'";
    const inner = pieces
      .map((piece) => piece.text)
      .join('')
      .slice(1, -1);
    const interpolated = pieces.filter((piece) => !piece.literal);
    const only = interpolated[0];
    if (only && interpolated.length === 1 && inner === only.text) {
      return { text: only.text, state: plainValue };
    }
    return { text: `${quote}${inner}${quote}`, state: plainValue };
  }

  private describeBinary(expr: Extract<Expr, { kind: 'binary' }>, scope: Scope): string {
    const operator = expr.operator.toLowerCase();
    const wordOperator = /^[a-z]/.test(operator);
    this.annotate(expr.operatorSpan, wordOperator ? 'keyword' : 'operator');
    const left = this.describe(expr.left, scope).text;
    const right = this.describe(expr.right, scope);
    if (operator === 'like' || operator === 'not like') {
      const negated = operator === 'not like';
      const pattern = right.text.replace(/^'(.*)'$/s, '$1');
      const starts = pattern.startsWith('%');
      const ends = pattern.endsWith('%') && pattern.length > 1;
      const core = pattern.replace(/^%/, '').replace(/%$/, '');
      const verb =
        starts && ends ? 'contains' : ends ? 'starts with' : starts ? 'ends with' : 'matches';
      return `${left} ${negated ? `does not ${verb.replace(/s$/, '')}` : verb} ${core}`;
    }
    const symbol = comparisonText[operator] ?? operator;
    return `${left} ${symbol} ${right.text}`;
  }

  private describePath(segments: readonly PathSegment[], scope: Scope): Described {
    const [head, ...rest] = segments;
    if (!head) return { text: '', state: plainValue };
    const name = head.name;

    if (name.startsWith('$') || name.startsWith('@')) {
      const described = this.describeVariable(head);
      return this.describeMembers(rest, { text: described, state: plainValue }, scope);
    }

    const alias = scope.aliases.get(name);
    if (alias && !head.call) {
      this.annotate(head.span, 'alias', aliasRef(alias), `The current ${aliasLabel(alias)} item`);
      const state: ValueState =
        alias.kind === 'item'
          ? { kind: 'item', collection: alias.collection, text: alias.collection.label }
          : alias.kind === 'remote'
            ? { kind: 'remote', url: alias.url }
            : { kind: 'unresolved', name: alias.name };
      return this.describeMembers(rest, { text: aliasLabel(alias), state }, scope);
    }

    if ((name === 'this' || name === 'page') && !head.call) {
      const bound = this.context.boundModelZuid
        ? this.collectionsByZuid.get(this.context.boundModelZuid)
        : undefined;
      if (bound) {
        this.addAccess(bound, 'bound');
        this.annotate(
          head.span,
          'alias',
          collectionRef(bound.modelZuid),
          `The ${bound.label} item this view renders`,
        );
        const state: ValueState = {
          kind: 'item',
          collection: bound,
          text: `this ${bound.label} item`,
        };
        return this.describeMembers(rest, { text: state.text, state }, scope);
      }
      const ref = `unrecognized:${name}`;
      const detail = this.context.boundModelZuid
        ? 'This model template’s content model is not in this session’s collection catalog.'
        : '`this` is bound only in a model template. This file has no content model.';
      this.annotate(head.span, 'unrecognized-reference', ref, detail);
      this.addUnrecognized({ target: ref, label: name, detail });
      return this.describeMembers(
        rest,
        { text: `${name} item`, state: { kind: 'unresolved', name } },
        scope,
      );
    }

    if ((name === 'get_var' || name === 'post_var') && !head.call) {
      const parameter = rest[0];
      this.annotate(
        head.span,
        'builtin',
        undefined,
        name === 'get_var' ? 'Query string values' : 'Posted form values',
      );
      if (!parameter) return { text: name, state: plainValue };
      const source = name === 'get_var' ? 'query' : 'post';
      const label = source === 'query' ? `?${parameter.name}` : `posted ${parameter.name}`;
      const ref = `input:${source}:${parameter.name}`;
      this.annotate(
        parameter.span,
        'input',
        ref,
        source === 'query'
          ? `Query parameter ?${parameter.name}`
          : `Posted form value “${parameter.name}”`,
      );
      this.inputs.set(ref, { target: ref, label });
      if (parameter.call) this.argumentTexts(parameter, scope);
      return this.describeMembers(rest.slice(1), { text: label, state: plainValue }, scope);
    }

    if (name === 'request' && !head.call) return this.describeRequest(head, rest, scope);
    if (name === 'api' && !head.call) return this.describeRemote(segments, scope);

    if (!head.call) {
      const collection = this.collectionsByName.get(name);
      if (collection) {
        if (!scope.loopSource) this.addAccess(collection, 'reference');
        this.annotate(
          head.span,
          'collection',
          collectionRef(collection.modelZuid),
          `Collection ${collection.label} (${collection.name})`,
        );
        const state: ValueState = { kind: 'items', collection, text: collection.label };
        return this.describeMembers(rest, { text: collection.label, state }, scope);
      }
      const implicitField = scope.implicitItem ? this.fieldOf(scope.implicitItem, name) : undefined;
      if (scope.implicitItem && implicitField) {
        const itemState: ValueState = {
          kind: 'item',
          collection: scope.implicitItem,
          text: scope.implicitItem.label,
        };
        return this.describeMembers(
          segments,
          { text: scope.implicitItem.label, state: itemState },
          scope,
        );
      }
    }

    const builtin = builtinHints[name];
    if (builtin) {
      this.annotate(head.span, head.call ? 'function' : 'builtin', undefined, builtin);
      if (head.call) this.argumentTexts(head, scope);
      const text = head.call ? `${name}(${this.argumentTexts(head, scope).join(', ')})` : name;
      return this.describeMembers(rest, { text, state: plainValue }, scope);
    }

    if (head.call) {
      this.annotate(
        head.span,
        'function',
        undefined,
        `Parsley function ${name}(); its result is not explained here`,
      );
      const args = this.argumentTexts(head, scope);
      return this.describeMembers(
        rest,
        { text: `${name}(${args.join(', ')})`, state: plainValue },
        scope,
      );
    }

    if (scope.argument && segments.length === 1) {
      this.annotate(head.span, 'literal');
      return { text: name, state: plainValue };
    }

    const ref = `unrecognized:${name}`;
    const detail =
      'Not a loop alias, a collection in this session’s catalog, or a Parsley name Zesty Explorer knows. It may still be valid.';
    this.annotate(head.span, 'unrecognized-reference', ref, detail);
    this.addUnrecognized({ target: ref, label: name, detail });
    return this.describeMembers(rest, { text: name, state: { kind: 'unresolved', name } }, scope);
  }

  private describeVariable(segment: PathSegment): string {
    const name = segment.name;
    const kind = name.startsWith('@')
      ? {
          label: `cookie ${name}`,
          hint: 'Cookie variable; it lasts 30 days in the visitor’s browser',
        }
      : name.startsWith('$_')
        ? {
            label: `session variable ${name}`,
            hint: 'Session variable; it lasts for the browser session',
          }
        : { label: name, hint: 'Variable set during this page load' };
    const ref = `variable:${name}`;
    this.annotate(segment.span, 'variable', ref, kind.hint);
    this.variables.set(ref, { target: ref, label: name, detail: kind.hint });
    return kind.label;
  }

  private describeRequest(
    head: PathSegment,
    rest: readonly PathSegment[],
    scope: Scope,
  ): Described {
    this.annotate(head.span, 'builtin', undefined, 'The incoming HTTP request');
    const [method, ...after] = rest;
    if (!method) return { text: 'request', state: plainValue };
    const argument = method.call?.args[0];
    const raw = method.call?.raw.trim().replace(/^['"]|['"]$/g, '') ?? '';
    let input: { readonly ref: string; readonly label: string; readonly hint: string } | undefined;
    if (method.name === 'queryParam' && raw) {
      input = { ref: `input:query:${raw}`, label: `?${raw}`, hint: `Query parameter ?${raw}` };
    } else if (method.name === 'pathPart' && raw) {
      input = {
        ref: `input:path:${raw}`,
        label: `URL path segment ${raw}`,
        hint: `URL path segment ${raw}`,
      };
    } else if (method.name === 'fullpath' || method.name === 'path') {
      const label = method.name === 'fullpath' ? 'full request path with query' : 'request path';
      input = { ref: `input:request:${method.name}`, label, hint: `The ${label}` };
    }
    if (!input) {
      this.annotate(method.span, 'function', undefined, `request.${method.name}()`);
      if (method.call) this.argumentTexts(method, scope);
      return this.describeMembers(
        after,
        { text: `request.${method.name}`, state: plainValue },
        scope,
      );
    }
    this.annotate(method.span, 'function', undefined, input.hint);
    if (argument && method.call && method.call.raw.trim()) {
      this.annotate(argument.span, 'input', input.ref, input.hint);
    } else {
      this.annotate(method.span, 'input', input.ref, input.hint);
    }
    this.inputs.set(input.ref, { target: input.ref, label: input.label });
    return this.describeMembers(after, { text: input.label, state: plainValue }, scope);
  }

  private describeRemote(segments: readonly PathSegment[], scope: Scope): Described {
    const callIndex = segments.findIndex((segment) => segment.call);
    const call = callIndex >= 0 ? segments[callIndex]?.call : undefined;
    const url = call?.raw.trim() ?? '';
    const ref = `remote:${url || segments.map((segment) => segment.name).join('.')}`;
    const name = segments
      .slice(0, callIndex >= 0 ? callIndex + 1 : segments.length)
      .map((segment) => segment.name)
      .join('.');
    for (const segment of segments.slice(0, callIndex >= 0 ? callIndex + 1 : segments.length)) {
      this.annotate(segment.span, 'remote', ref, `Remote request ${name}(); not run here`);
    }
    call?.args.forEach((arg) => this.describe(arg, { ...scope, argument: true }));
    this.remote.set(ref, { target: ref, label: url || name, detail: `${name}()` });
    const state: ValueState = { kind: 'remote', url: url || name };
    return this.describeMembers(
      callIndex >= 0 ? segments.slice(callIndex + 1) : [],
      { text: 'remote JSON', state },
      scope,
    );
  }

  private argumentTexts(segment: PathSegment, scope: Scope): string[] {
    return (segment.call?.args ?? []).map(
      (arg) => this.describe(arg, { ...scope, argument: true }).text,
    );
  }

  private fieldOf(collection: CodeCollection, name: string): CollectionField | undefined {
    return this.context.schemas
      .get(collection.modelZuid)
      ?.fields.find((field) => field.name === name);
  }

  // Walks `.member` and `.method()` segments after the head, tracking which collection item
  // they refer to so fields resolve to labels and relationships lead to related collections.
  private describeMembers(
    segments: readonly PathSegment[],
    initial: Described,
    scope: Scope,
  ): Described {
    let state = initial.state;
    let subject = initial.text;
    const notes: string[] = [];
    for (const segment of segments) {
      if (segment.call) {
        const result = this.describeMethod(segment, state, subject, scope);
        state = result.state;
        subject = result.subject;
        if (result.note) notes.push(result.note);
        continue;
      }
      const result = this.describeMember(segment, state, subject);
      state = result.state;
      subject = result.subject;
    }
    return { text: notes.length ? `${subject} (${notes.join(', ')})` : subject, state };
  }

  private describeMember(
    segment: PathSegment,
    state: ValueState,
    subject: string,
  ): { readonly state: ValueState; readonly subject: string } {
    const name = segment.name;
    const collection =
      state.kind === 'item' || state.kind === 'items' ? state.collection : undefined;
    if (!collection) {
      this.annotate(segment.span, 'text');
      return { state: plainValue, subject: `${subject} › ${name}` };
    }
    const ref = collectionRef(collection.modelZuid);
    const meta = metaHints[name];
    if (meta || name.startsWith('_')) {
      this.annotate(segment.span, 'meta', undefined, meta ?? 'Item metadata');
      const label =
        name === '_num'
          ? 'position in the loop'
          : name === '_length'
            ? 'number of items in the loop'
            : name === 'zuid'
              ? `${subject} › ZUID`
              : `${subject} › ${name}`;
      return { state: plainValue, subject: label };
    }
    const schema = this.context.schemas.get(collection.modelZuid);
    if (!schema) {
      this.wanted.add(collection.modelZuid);
      this.annotate(segment.span, 'field', ref, `${collection.label} › ${name}`);
      this.markField(collection, name);
      return { state: plainValue, subject: `${subject} › ${name}` };
    }
    const field = schema.fields.find((candidate) => candidate.name === name);
    if (!field) {
      const fieldRef = `unrecognized-field:${collection.modelZuid}:${name}`;
      const detail = `${collection.label} has no field “${name}” in the field list available to this session. It may be metadata or a field this session cannot see.`;
      this.annotate(segment.span, 'unrecognized-reference', fieldRef, detail);
      this.addUnrecognized({ target: fieldRef, label: `${collection.label} › ${name}`, detail });
      return { state: plainValue, subject: `${subject} › ${name}` };
    }
    this.markField(collection, name);
    const related = field.relatedModelZuid
      ? this.collectionsByZuid.get(field.relatedModelZuid)
      : undefined;
    const relatedText = field.relatedModelZuid
      ? ` → ${related?.label ?? `${field.relatedModelZuid} (not in the catalog)`}`
      : '';
    this.annotate(
      segment.span,
      'field',
      ref,
      `${collection.label} › ${field.label} (${fieldKindLabels[field.kind]}${relatedText})`,
    );
    const text = `${subject} › ${field.label}`;
    if (related) {
      this.addAccess(related, 'relationship');
      if (!this.context.schemas.has(related.modelZuid)) this.wanted.add(related.modelZuid);
      return { state: { kind: 'item', collection: related, text }, subject: text };
    }
    return { state: plainValue, subject: text };
  }

  private markField(collection: CodeCollection, name: string): void {
    const fields = this.usedFields.get(collection.modelZuid) ?? new Set();
    fields.add(name);
    this.usedFields.set(collection.modelZuid, fields);
  }

  private describeMethod(
    segment: PathSegment,
    state: ValueState,
    subject: string,
    scope: Scope,
  ): { readonly state: ValueState; readonly subject: string; readonly note?: string } {
    const name = segment.name;
    const collection =
      state.kind === 'item' || state.kind === 'items' ? state.collection : undefined;
    const hint = methodHints[name] ?? `Parsley method ${name}(); its result is not explained here`;
    this.annotate(segment.span, 'function', undefined, hint);

    if (name === 'filter' && collection) {
      const arg = segment.call?.args[0];
      let condition = '';
      if (arg) {
        const filterScope: Scope = {
          ...withAlias(scope, 'z', { kind: 'item', collection, access: 'reference' }),
          implicitItem: collection,
        };
        const described = this.describe(arg, filterScope).text;
        condition =
          arg.kind === 'interpolation' || arg.kind === 'string' ? `ZUID = ${described}` : described;
      }
      const text = `${collection.label} items where ${condition}`;
      return { state: { kind: 'items', collection, text }, subject: text };
    }
    if ((name === 'first' || name === 'last' || name === 'random') && collection) {
      const base = state.kind === 'items' ? state.text : collection.label;
      const itemsText =
        base === collection.label
          ? `${collection.label} item`
          : base.replace(' items where', ' item where');
      const text = `${name} ${itemsText}`;
      return { state: { kind: 'item', collection, text }, subject: text };
    }

    const args = this.argumentTexts(segment, scope);
    const raw = segment.call?.raw.trim() ?? '';
    if (name === 'toJSON') {
      const [depth, meta] = args;
      const target = state.kind === 'items' ? `all ${subject} items` : `entire ${subject} item`;
      const text = `${target} as JSON (depth ${depth || '2'}${meta === 'true' ? ', with metadata' : ''})`;
      return { state: plainValue, subject: text };
    }
    if (name === 'getUrl') return { state: plainValue, subject: `${subject} › URL` };
    if (name === 'getImage') {
      return {
        state: plainValue,
        subject,
        note: args[0] ? `image URL, ${args[0]}px wide` : 'image URL',
      };
    }
    if (name === 'escapeForJs') return { state: plainValue, subject, note: 'escaped for JSON' };
    if (name === 'htmlentities') return { state: plainValue, subject, note: 'HTML-escaped' };
    if (name === 'date') {
      // `site.date(Y-m-d)` and `instance.date(…)` print the current date.
      const current = subject === 'site' || subject === 'instance';
      return {
        state: plainValue,
        subject: current ? 'current date' : subject,
        note: `formatted as ${raw}`,
      };
    }
    return { state: plainValue, subject, note: `${name}(${raw})` };
  }

  // ---------- Steps ----------

  private walk(
    nodes: readonly ParsleyNode[],
    scope: Scope,
    depth: number,
    nextNumber: () => string,
  ): Step[] {
    const steps: Step[] = [];
    for (const node of nodes) {
      if (node.kind === 'text') continue;
      if (node.kind === 'comment') {
        this.annotate(node.span, 'comment');
        if (node.text) {
          steps.push({
            target: nodeTarget(node.id),
            number: '',
            depth,
            kind: 'note',
            title: node.text,
            details: [],
          });
        }
        continue;
      }
      if (node.kind === 'tag') {
        const step = this.tagStep(node, scope, depth, nextNumber);
        if (step) steps.push(step);
        continue;
      }
      if (node.kind === 'each') {
        steps.push(...this.eachSteps(node, scope, depth, nextNumber()));
        continue;
      }
      steps.push(...this.ifSteps(node, scope, depth, nextNumber));
    }
    return steps;
  }

  private tagKeywords(node: TagNode): void {
    const tag = node.tag;
    if ('keywords' in tag) tag.keywords.forEach((span) => this.annotate(span, 'keyword'));
  }

  private tagStep(
    node: TagNode,
    scope: Scope,
    depth: number,
    nextNumber: () => string,
  ): Step | undefined {
    const tag = node.tag;
    const target = nodeTarget(node.id);
    if (node.stray) {
      this.gaps++;
      this.annotate(node.inner, 'unrecognized-syntax', target, 'This tag matches no open block.');
      const label = this.excerpt(node.span);
      const detail =
        tag.kind === 'end'
          ? `No open ${tag.block} block to close here.`
          : 'No open if block to continue here.';
      this.addUnrecognized({ target, label, detail });
      return {
        target,
        number: nextNumber(),
        depth,
        kind: 'unrecognized',
        title: `Unmatched ${label}`,
        details: [detail],
      };
    }
    if (tag.kind === 'unrecognized') {
      this.gaps++;
      this.annotate(
        node.inner,
        'unrecognized-syntax',
        target,
        `Not recognized by Zesty Explorer. ${tag.reason}`,
      );
      const label = this.excerpt(node.span);
      this.addUnrecognized({ target, label, detail: tag.reason });
      return {
        target,
        number: nextNumber(),
        depth,
        kind: 'unrecognized',
        title: `Not recognized: ${label}`,
        details: [tag.reason, 'It stays in the source as saved.'],
      };
    }
    if (tag.kind === 'output') {
      this.outputs.set(node.id, this.describe(tag.expr, scope).text);
      return undefined;
    }
    if (tag.kind === 'assign') {
      const variable = this.describeVariable({ name: tag.variable.name, span: tag.variable.span });
      this.annotate(tag.operatorSpan, 'operator');
      // Values are often unquoted text, such as `{{$format = Y-m-d}}`.
      const value = this.describe(tag.value, { ...scope, argument: true }).text;
      return {
        target,
        number: nextNumber(),
        depth,
        kind: 'assignment',
        title: `Set ${variable} to ${value}`,
        details: hasUnknown(tag.value) ? ['Part of this value is not recognized.'] : [],
      };
    }
    if (tag.kind === 'include') {
      this.tagKeywords(node);
      const snippet = this.includeUsage(node, tag.target, scope);
      const details = snippet.dynamic
        ? ['The file is chosen when the page runs, so Zesty Explorer cannot open it.']
        : snippet.fileId
          ? ['Its code is not analyzed here. Open the snippet to see its explanation.']
          : [`No file named “${snippet.name}” was returned for this instance.`];
      return {
        target,
        number: nextNumber(),
        depth,
        kind: 'include',
        title: snippet.dynamic
          ? `Insert a file chosen at runtime: ${snippet.label}`
          : `Insert the “${snippet.name}” snippet`,
        details,
        snippet,
      };
    }
    // Branch tags are handled by their block; anything else here is an `end` without a block.
    this.tagKeywords(node);
    return undefined;
  }

  private includeUsage(
    node: TagNode,
    target: Extract<TagNode['tag'], { kind: 'include' }>['target'],
    scope: Scope,
  ): SnippetUsage {
    if (target.kind === 'dynamic') {
      const described = this.describe(target.expr, scope).text;
      const ref = `include:${node.id}`;
      const entry: SnippetUsage = {
        target: nodeTarget(node.id),
        label: described,
        name: this.text(target.expr.span),
        dynamic: true,
        detail: 'Chosen at runtime',
      };
      this.snippets.set(ref, entry);
      return entry;
    }
    const file =
      this.context.files.find(
        (candidate) => candidate.fileName === target.name && candidate.type === 'snippet',
      ) ?? this.context.files.find((candidate) => candidate.fileName === target.name);
    const ref = `snippet:${target.name}`;
    this.annotate(
      target.span,
      'snippet',
      ref,
      file
        ? `Snippet ${target.name}. Its code is analyzed separately.`
        : `No file named “${target.name}” was found.`,
    );
    const entry: SnippetUsage = {
      target: ref,
      label: target.name,
      name: target.name,
      dynamic: false,
      ...(file ? { fileId: file.id } : { detail: 'Not found in this instance’s files' }),
    };
    if (!this.snippets.has(ref)) this.snippets.set(ref, entry);
    return entry;
  }

  private eachSteps(block: EachBlock, scope: Scope, depth: number, number: string): Step[] {
    const tag = block.open.tag;
    if (tag.kind !== 'each') throw new Error('An each block opens with an each tag.');
    this.tagKeywords(block.open);
    if (block.close) this.tagKeywords(block.close);
    const details: string[] = [];

    const sourceName = this.text(tag.source.span).trim();
    const uncatalogued =
      isPlainIdentifier(tag.source) &&
      !this.collectionsByName.has(sourceName) &&
      !scope.aliases.has(sourceName);
    const source: Described = uncatalogued
      ? { text: sourceName, state: { kind: 'unresolved', name: sourceName } }
      : this.describe(tag.source, { ...scope, loopSource: true });
    let binding: AliasBinding;
    let title: string;
    if (uncatalogued) {
      const ref = `unrecognized:${sourceName}`;
      const detail =
        'Not in this session’s collection catalog. It may be a collection this session cannot see, a name defined elsewhere, or a typo.';
      this.annotate(tag.source.span, 'unrecognized-reference', ref, detail);
      this.addUnrecognized({ target: ref, label: sourceName, detail });
      binding = { kind: 'unresolved', name: sourceName };
      title = `Loop over “${sourceName}”`;
      details.push('Not matched to the collection catalog, so its fields are not described.');
    } else if (source.state.kind === 'items' || source.state.kind === 'item') {
      const viaRelationship = source.state.kind === 'item';
      const access: CollectionAccess = viaRelationship ? 'relationship' : 'loop';
      this.addAccess(source.state.collection, access);
      binding = { kind: 'item', collection: source.state.collection, access };
      const where =
        source.state.text !== source.state.collection.label ? source.state.text : undefined;
      title = viaRelationship
        ? `Loop over ${source.state.collection.label} related through ${source.text}`
        : `Loop over ${where ?? source.state.collection.label}`;
    } else if (source.state.kind === 'remote') {
      binding = { kind: 'remote', url: source.state.url };
      title = 'Loop over remote JSON';
      details.push(`Fetches ${source.state.url}`, 'The remote response is not described.');
    } else {
      binding = { kind: 'unresolved', name: sourceName };
      title = `Loop over ${source.text}`;
      details.push('Its items are not matched to a collection, so their fields are not described.');
    }
    this.annotate(
      tag.alias.span,
      'alias',
      aliasRef(binding),
      `Alias for each ${aliasLabel(binding)} item`,
    );
    const inner = withAlias(scope, tag.alias.name, binding);

    if (tag.where) details.push(`Only where ${this.describe(tag.where, inner).text}`);
    if (tag.sort.length) details.push(this.describeSort(tag.sort, inner));
    if (tag.limit.length) details.push(this.describeLimit(tag.limit, inner));
    for (const problem of tag.problems) {
      this.syntaxGap(block.open, problem, 'This part of the loop is not a recognized clause.');
      details.push(`Not recognized: ${this.excerpt(problem)}`);
    }
    if (!block.close)
      this.structureGap(block.open, 'This loop is never closed with {{end-each}}.', details);

    const children = this.walk(block.body, inner, depth + 1, counter(`${number}.`));
    const outputs = this.loopOutputs(block);
    if (outputs) details.push(outputs);
    return [
      {
        target: nodeTarget(block.id),
        number,
        depth,
        kind: 'loop',
        title: `${title} as “${tag.alias.name}”`,
        details,
        ...(binding.kind === 'item' ? { collection: binding.collection.modelZuid } : {}),
      },
      ...children,
    ];
  }

  private structureGap(node: TagNode, detail: string, details: string[]): void {
    this.gaps++;
    const target = nodeTarget(node.id);
    this.addUnrecognized({ target, label: this.excerpt(node.span), detail });
    details.push(detail);
  }

  private describeSort(keys: readonly SortKey[], scope: Scope): string {
    const parts = keys.map((key) => {
      if (
        key.expr.kind === 'path' &&
        key.expr.segments[0]?.name === 'rand' &&
        key.expr.segments[0].call
      ) {
        this.describe(key.expr, scope);
        return 'random order';
      }
      const described = this.describe(key.expr, scope);
      const kind = this.sortFieldKind(key.expr, scope);
      const descending = key.direction === 'desc';
      const [ascending, descendingText] = (kind && sortOrderText[kind]) ?? plainSortOrder;
      return `${described.text} (${descending ? descendingText : ascending})`;
    });
    const [first, ...rest] = parts;
    if (first === 'random order' && rest.length === 0) return 'In random order';
    return `Sorted by ${[first, ...rest].join(', then ')}`;
  }

  private sortFieldKind(expr: Expr, scope: Scope): FieldKind | undefined {
    if (expr.kind !== 'path' || expr.segments.length !== 2) return undefined;
    const [head, field] = expr.segments;
    const alias = head ? scope.aliases.get(head.name) : undefined;
    if (alias?.kind !== 'item' || !field) return undefined;
    return this.fieldOf(alias.collection, field.name)?.kind;
  }

  private describeLimit(values: readonly Expr[], scope: Scope): string {
    const [first, second] = values.map((value) => this.describe(value, scope).text);
    if (second !== undefined) {
      return first === '0'
        ? `At most ${second} items`
        : `At most ${second} items, skipping the first ${first}`;
    }
    return first === '1' ? 'Only the first match' : `At most ${first} items`;
  }

  // Summarizes what a loop prints directly. JSON keys are clearer than the expressions behind
  // them; nested loops describe their own output.
  private loopOutputs(block: EachBlock): string | undefined {
    const keys = block.body.flatMap((node) =>
      node.kind === 'text'
        ? [...this.text(node.span).matchAll(/"([^"{}\\]+)"\s*:/g)].map((match) => match[1]!)
        : [],
    );
    if (keys.length) return `Outputs ${[...new Set(keys)].join(', ')}`;
    const printed = block.body.flatMap((node) => {
      if (node.kind !== 'tag' || node.tag.kind !== 'output') return [];
      const expr = node.tag.expr;
      if (expr.kind === 'path' && expr.segments.some((segment) => segment.name.startsWith('_'))) {
        return [];
      }
      const text = this.outputs.get(node.id);
      return text ? [text] : [];
    });
    return printed.length ? `Prints ${[...new Set(printed)].join('; ')}` : undefined;
  }

  private ifSteps(block: IfBlock, scope: Scope, depth: number, nextNumber: () => string): Step[] {
    if (block.close) this.tagKeywords(block.close);
    if (isSeparatorBlock(this.document, block)) {
      for (const branch of block.branches) {
        this.tagKeywords(branch.tag);
        const tag = branch.tag.tag;
        if (tag.kind === 'if' || tag.kind === 'else-if') this.describe(tag.condition, scope);
      }
      return [];
    }
    const steps: Step[] = [];
    const number = nextNumber();
    // Every branch continues the same numbering: 2.1, Otherwise, 2.2, …
    const childNumber = counter(`${number}.`);
    block.branches.forEach((branch, index) => {
      this.tagKeywords(branch.tag);
      const tag = branch.tag.tag;
      const details: string[] = [];
      let title: string;
      if (tag.kind === 'if' || tag.kind === 'else-if') {
        const condition = this.describe(tag.condition, scope).text;
        const bare =
          tag.condition.kind === 'path' ||
          tag.condition.kind === 'interpolation' ||
          (tag.condition.kind === 'unary' && tag.condition.operand.kind !== 'binary');
        const phrase = bare
          ? tag.condition.kind === 'unary'
            ? `${condition.replace(/^not /, '')} is not set`
            : `${condition} is set`
          : condition;
        title = tag.kind === 'if' ? `Only if ${phrase}` : `Otherwise, if ${phrase}`;
        for (const problem of tag.problems) {
          this.syntaxGap(branch.tag, problem, 'This part of the condition is not recognized.');
          details.push(`Not recognized: ${this.excerpt(problem)}`);
        }
        if (hasUnknown(tag.condition)) details.push('Part of this condition is not recognized.');
      } else {
        title = 'Otherwise';
      }
      if (index === block.branches.length - 1 && !block.close) {
        this.structureGap(
          block.branches[0]!.tag,
          'This condition is never closed with {{end-if}}.',
          details,
        );
      }
      steps.push({
        target: nodeTarget(branch.id),
        number: index === 0 ? number : '',
        depth,
        kind: index === 0 ? 'condition' : 'branch',
        title,
        details,
      });
      steps.push(...this.walk(branch.body, scope, depth + 1, childNumber));
    });
    return steps;
  }
}

/** Explains `document` using what the current session knows about the instance. */
export function analyzeParsley(document: ParsleyDocument, context: AnalysisContext): CodeAnalysis {
  return new Analyzer(document, context).analyze();
}

/** Whether an `if` block only prints the comma between JSON items, e.g.
 * `{{if {x._length} > {x._num}}},{{end-if}}`. Such boilerplate is left out of the steps. */
export function isSeparatorBlock(document: ParsleyDocument, block: IfBlock): boolean {
  const [branch] = block.branches;
  if (!branch || block.branches.length !== 1) return false;
  const tag = branch.tag.tag;
  if (tag.kind !== 'if' || !mentionsLoopPosition(tag.condition)) return false;
  if (!branch.body.every((node) => node.kind === 'text')) return false;
  const body = branch.body
    .map((node) => document.source.slice(node.span.start, node.span.end))
    .join('')
    .trim();
  return body === ',';
}
