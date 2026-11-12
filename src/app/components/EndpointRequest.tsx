// The request panel of an endpoint in the Code tab: a one-row address bar builds the URL from the
// instance, the endpoint, and the code state, and Send shows the response in place of the source.
// Requests are anonymous GETs (ADR 0011) that carry a locked preview's password (ADR 0016).
// Forms and last responses live only in memory.
import { Effect, Either } from 'effect';
import {
  ArrowRight,
  ExternalLink,
  FileCode2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Radio,
  RotateCw,
  X,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CodeFile, CodeState, InstanceReference } from '../../domain';
import { queryParameterNames } from '../../parsley';
import {
  endpointLimitBytes,
  endpointTimeoutMs,
  requestEndpoint,
  type EndpointFailure,
  type EndpointResponse,
} from '../../zesty-api';
import { endpointPath, endpointUrl, wildcardCount, type QueryParameter } from '../endpoint-address';
import type { WebEngineBaseUrlsResult } from '../hooks/useCodeFiles';
import { cn } from '../lib/utils';
import { tokenClasses } from '../code-presentation';
import { bodyFormat, bodyTokens, formattedBody, type BodyFormat } from '../response-body';
import { Button } from './ui/button';
import { buttonVariants } from './ui/button-variants';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { TooltipTrigger } from './ui/tooltip';

interface ParameterRow extends QueryParameter {
  readonly id: number;
}

type RequestResult =
  | { readonly kind: 'response'; readonly url: string; readonly response: EndpointResponse }
  | { readonly kind: 'failure'; readonly url: string; readonly failure: EndpointFailure };

interface EndpointForm {
  /** Parameters that are sent, in order. Detected names not listed here are only suggested. */
  readonly parameters: readonly ParameterRow[];
  /** One value per wildcard segment of the path. */
  readonly segments: readonly string[];
  /** The origin chosen when several serve the code state; the preferred one when unset or gone. */
  readonly baseUrl?: string;
  readonly result?: RequestResult;
}

// Forms by deployment, instance, endpoint, and code state, kept until the page reloads.
const forms = new Map<string, EndpointForm>();
let nextParameterId = 0;

const passwordHint =
  "This preview is locked. Send adds the instance's preview lock password as ?zpw.";

type Pane = 'source' | 'response';

interface EndpointRequestProps {
  readonly instance: InstanceReference;
  readonly state: CodeState;
  readonly file: CodeFile;
  /** The files of the same code state, for parameters read by included snippets. */
  readonly files: readonly CodeFile[];
  /** Where WebEngine serves the endpoint in this code state. */
  readonly hosts: WebEngineBaseUrlsResult;
  /** The source view the response replaces. */
  readonly children: ReactNode;
}

export function EndpointRequest({
  instance,
  state,
  file,
  files,
  hosts,
  children,
}: EndpointRequestProps) {
  const formKey = `${instance.deployment}:${instance.instanceZuid}:${file.id}:${state}`;
  const path = endpointPath(file);
  const [form, setForm] = useState<EndpointForm>(
    () => forms.get(formKey) ?? { parameters: [], segments: [] },
  );
  useEffect(() => {
    forms.set(formKey, form);
  }, [form, formKey]);
  const [pane, setPane] = useState<Pane>('source');
  const [sendingUrl, setSendingUrl] = useState<string>();
  const [focusedRow, setFocusedRow] = useState<{
    readonly id: number;
    readonly part: 'name' | 'value';
  }>();
  // Switching endpoint, code state, or instance unmounts the panel and cancels its request.
  const controller = useRef<AbortController>(undefined);
  useEffect(() => () => controller.current?.abort(), []);

  const detected = useMemo(() => queryParameterNames(file, files), [file, files]);
  const suggested = detected.filter(
    (name) => !form.parameters.some((parameter) => parameter.name === name),
  );
  // After a failed refresh the cached origins may be out of date, so none is used.
  const baseUrls = hosts.error ? undefined : hosts.baseUrls;
  const baseUrl = form.baseUrl && baseUrls?.includes(form.baseUrl) ? form.baseUrl : baseUrls?.[0];
  const url = baseUrl ? endpointUrl(baseUrl, path, form.segments, form.parameters) : undefined;
  // A locked preview gets its password only when sent, so it never shows in the address bar or
  // the browser history. A `zpw` the user adds wins.
  const lock = hosts.previewLock;
  const addsPassword =
    lock?.kind === 'password' && !form.parameters.some((parameter) => parameter.name === 'zpw');
  const sentUrl =
    baseUrl && addsPassword
      ? endpointUrl(baseUrl, path, form.segments, [
          ...form.parameters,
          { name: 'zpw', value: lock.password },
        ])
      : url;
  const blocked = hosts.error
    ? `Zesty Explorer could not look up ${state === 'latest' ? 'the preview host' : 'the live domains'} of this instance.`
    : !baseUrls || (!lock && !hosts.previewLockError)
      ? 'Looking up where WebEngine serves this instance…'
      : !baseUrl
        ? 'This instance has no live domain, so its published endpoints have no address.'
        : !url
          ? 'Fill in every * segment of the path to send the request.'
          : undefined;
  // A pending request hides the last result, so a resent request never shows stale content.
  const result = sendingUrl ? undefined : form.result;

  const updateParameter = (id: number, change: Partial<QueryParameter>) =>
    setForm((current) => ({
      ...current,
      parameters: current.parameters.map((parameter) =>
        parameter.id === id ? { ...parameter, ...change } : parameter,
      ),
    }));
  const addParameter = (name: string) => {
    const id = nextParameterId++;
    setForm((current) => ({
      ...current,
      parameters: [...current.parameters, { id, name, value: '' }],
    }));
    setFocusedRow({ id, part: name ? 'value' : 'name' });
  };
  const removeParameter = (id: number) =>
    setForm((current) => ({
      ...current,
      parameters: current.parameters.filter((parameter) => parameter.id !== id),
    }));
  const setSegment = (index: number, value: string) =>
    setForm((current) => {
      const segments = Array.from(
        { length: wildcardCount(path) },
        (_, at) => current.segments[at] ?? '',
      );
      segments[index] = value;
      return { ...current, segments };
    });

  const send = () => {
    if (!url || !sentUrl || blocked || sendingUrl) return;
    setPane('response');
    setSendingUrl(url);
    const request = new AbortController();
    controller.current = request;
    Effect.runPromise(Effect.either(requestEndpoint(sentUrl)), { signal: request.signal }).then(
      (outcome) => {
        if (request.signal.aborted) return;
        setSendingUrl(undefined);
        const result: RequestResult = Either.isRight(outcome)
          ? { kind: 'response', url, response: outcome.right }
          : { kind: 'failure', url, failure: outcome.left };
        setForm((current) => ({ ...current, result }));
      },
      // Only an abort rejects, and it already reset the sending state.
      () => {},
    );
  };
  const cancel = () => {
    controller.current?.abort();
    setSendingUrl(undefined);
  };

  let wildcards = 0;
  const pathParts = path
    .split('/')
    .map((text) => (text === '*' ? { text, wildcard: wildcards++ } : { text }));

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <form
        className="border-border bg-surface-recessed focus-within:border-ring flex items-center gap-2 rounded-full border p-1"
        aria-label="Request"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <ToggleGroup
          aria-label="Workspace pane"
          className="rounded-full [&>*]:rounded-full"
          value={[pane]}
          onValueChange={([next]) => {
            if (next) setPane(next);
          }}
        >
          <ToggleGroupItem value="source">
            <FileCode2 size={14} aria-hidden="true" /> Source
          </ToggleGroupItem>
          <ToggleGroupItem value="response">
            <Radio size={14} aria-hidden="true" /> Response
            {result?.kind === 'response' ? (
              <span
                className={cn(
                  'ml-1',
                  result.url === url ? statusTone(result.response.status) : 'text-muted-foreground',
                )}
              >
                {result.response.status}
              </span>
            ) : null}
          </ToggleGroupItem>
        </ToggleGroup>
        <span className="text-muted-foreground text-[11px] font-bold">GET</span>

        <div className="flex min-w-0 flex-1 items-center overflow-x-auto font-mono text-[13px] whitespace-nowrap [scrollbar-width:none]">
          {baseUrls && baseUrls.length > 1 ? (
            <select
              className="text-muted-foreground hover:text-foreground cursor-pointer bg-transparent outline-none"
              aria-label="Live domain"
              value={baseUrl}
              onChange={(event) =>
                setForm((current) => ({ ...current, baseUrl: event.target.value }))
              }
            >
              {baseUrls.map((origin) => (
                <option key={origin} value={origin}>
                  {origin}
                </option>
              ))}
            </select>
          ) : (
            <span className={cn('text-muted-foreground', baseUrls && !baseUrl && 'text-amber-300')}>
              {baseUrl ?? (baseUrls ? 'no live domain' : 'https://…')}
            </span>
          )}
          {pathParts.map(({ text, wildcard }, index) => (
            <Fragment key={index}>
              {index > 0 ? '/' : null}
              {wildcard === undefined ? (
                text
              ) : (
                <AutoWidthInput
                  className="rounded bg-sky-400/15 px-0.5 text-sky-100"
                  aria-label={`Path segment ${wildcard + 1}`}
                  placeholder="*"
                  value={form.segments[wildcard] ?? ''}
                  onChange={(value) => setSegment(wildcard, value)}
                />
              )}
            </Fragment>
          ))}
          {form.parameters.map((parameter, index) => (
            <span key={parameter.id} className="group inline-flex items-center">
              <span className="text-muted-foreground">{index === 0 ? '?' : '&'}</span>
              <AutoWidthInput
                className="px-0.5 text-orange-300"
                aria-label="Parameter name"
                placeholder="name"
                value={parameter.name}
                autoFocus={focusedRow?.id === parameter.id && focusedRow.part === 'name'}
                onChange={(name) => updateParameter(parameter.id, { name })}
              />
              <span className="text-orange-300">=</span>
              <AutoWidthInput
                className="rounded bg-orange-400/15 px-0.5 text-orange-100"
                aria-label={`Value of ?${parameter.name}`}
                placeholder=""
                value={parameter.value}
                autoFocus={focusedRow?.id === parameter.id && focusedRow.part === 'value'}
                onChange={(value) => updateParameter(parameter.id, { value })}
              />
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground ml-0.5 hidden group-focus-within:inline-flex group-hover:inline-flex"
                aria-label={`Remove ?${parameter.name}`}
                onClick={(event) => {
                  // The chip leaves; focus moves to the next parameter, the previous one, or Add.
                  const chip = event.currentTarget.parentElement;
                  const next =
                    [chip?.nextElementSibling, chip?.previousElementSibling]
                      .map((sibling) => sibling?.querySelector('input'))
                      .find((input) => input) ??
                    chip
                      ?.closest('form')
                      ?.querySelector<HTMLElement>('[aria-label="Add a query parameter"]');
                  removeParameter(parameter.id);
                  requestAnimationFrame(() => next?.focus());
                }}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
          {addsPassword ? (
            <TooltipTrigger
              text={passwordHint}
              render={
                <span
                  className="text-muted-foreground ml-1.5 inline-flex items-center gap-0.5 text-xs"
                  tabIndex={0}
                  aria-description={passwordHint}
                />
              }
            >
              <LockKeyhole size={12} aria-hidden="true" />
              zpw
            </TooltipTrigger>
          ) : null}
          {suggested.map((name) => (
            <TooltipTrigger
              key={name}
              text={`Found in the code. Add ?${name} to the request.`}
              type="button"
              className="text-muted-foreground hover:text-foreground ml-1.5 rounded border border-dashed border-orange-400/40 px-1 text-xs hover:border-orange-400/70"
              aria-label={`Add ?${name}`}
              aria-description="Found in the code"
              onClick={() => addParameter(name)}
            >
              +{name}
            </TooltipTrigger>
          ))}
          <TooltipTrigger
            text="Add a query parameter"
            type="button"
            className="text-muted-foreground hover:text-foreground ml-1.5 inline-flex rounded p-0.5"
            aria-label="Add a query parameter"
            onClick={() => addParameter('')}
          >
            <Plus size={13} aria-hidden="true" />
          </TooltipTrigger>
        </div>

        <TooltipTrigger
          text="Open in a new tab"
          render={
            <a
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'icon-xs' }),
                !url && 'pointer-events-none opacity-40',
              )}
              {...(url ? { href: url } : { 'aria-disabled': true })}
              target="_blank"
              rel="noreferrer"
              aria-label="Open in a new tab"
            />
          }
        >
          <ExternalLink aria-hidden="true" />
        </TooltipTrigger>
        {/* Separate keys, so a Cancel click never ends on a reused submit button that sends again. */}
        {sendingUrl ? (
          <Button
            key="cancel"
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-full"
            onClick={cancel}
          >
            <LoaderCircle className="animate-spin" aria-hidden="true" />
            Cancel
          </Button>
        ) : (
          <Button
            key="send"
            type="submit"
            size="sm"
            className="h-7 rounded-full"
            disabled={Boolean(blocked)}
          >
            <ArrowRight aria-hidden="true" />
            Send
          </Button>
        )}
      </form>

      {blocked ? (
        <p className="text-muted-foreground flex items-center gap-2 px-4 text-xs" role="status">
          {blocked}
          {hosts.error ? (
            <Button variant="ghost" size="sm" className="h-6" onClick={hosts.refresh}>
              <RotateCw aria-hidden="true" /> Retry
            </Button>
          ) : null}
        </p>
      ) : null}
      {!blocked && hosts.previewLockError ? (
        <p className="text-muted-foreground flex items-center gap-2 px-4 text-xs" role="status">
          Zesty Explorer could not read the preview lock password. If the preview answers 401, add
          ?zpw with the password.
          <Button variant="ghost" size="sm" className="h-6" onClick={hosts.refresh}>
            <RotateCw aria-hidden="true" /> Retry
          </Button>
        </p>
      ) : null}

      <div className="min-h-0 flex-1">
        {pane === 'source' ? (
          children
        ) : (
          <ResponsePane
            result={result}
            currentUrl={url}
            sendingUrl={sendingUrl}
            onCancel={cancel}
          />
        )}
      </div>
    </div>
  );
}

type BodyPresentation = 'formatted' | 'received';

function ResponsePane({
  result,
  currentUrl,
  sendingUrl,
  onCancel,
}: {
  readonly result: RequestResult | undefined;
  /** The address as the form reads now; a result for another address is from an earlier send. */
  readonly currentUrl: string | undefined;
  readonly sendingUrl: string | undefined;
  readonly onCancel: () => void;
}) {
  const [presentation, setPresentation] = useState<BodyPresentation>('formatted');
  const response = result?.kind === 'response' ? result.response : undefined;
  const formatted = useMemo(
    () => (response && !response.truncated ? formattedBody(response.body) : undefined),
    [response],
  );
  const body = presentation === 'formatted' && formatted !== undefined ? formatted : response?.body;
  const format = response ? bodyFormat(response.body) : undefined;

  const stale = result !== undefined && result.url !== currentUrl;
  // Announced once per change; the body itself stays out of the live region.
  const announcement = sendingUrl
    ? 'Sending request'
    : response
      ? `Request complete, ${response.status} ${response.statusText}, ${response.durationMs} milliseconds`
      : result?.kind === 'failure'
        ? 'Request failed'
        : '';

  return (
    <section
      className="border-border bg-surface-recessed flex h-full min-h-0 flex-col overflow-hidden rounded-xl border"
      aria-label="Response"
    >
      <span className="sr-only" role="status">
        {announcement}
      </span>
      {stale ? (
        <p
          className="border-border border-b bg-amber-400/10 px-4 py-1.5 text-xs text-amber-200"
          role="status"
        >
          The request changed since it was sent. This is the response to the previous request; Send
          to update it.
        </p>
      ) : null}
      {result ? (
        <div className="bg-surface-header border-border flex min-h-11 items-center gap-4 border-b px-4 py-1.5 text-xs">
          {response ? (
            <>
              <strong className={statusTone(response.status)}>
                {response.status} {response.statusText}
              </strong>
              <span className="text-muted-foreground">{response.durationMs} ms</span>
              <span className="text-muted-foreground">{formatBytes(response.bytes)}</span>
              <span className="text-muted-foreground">{response.contentType}</span>
              {formatted !== undefined ? (
                <ToggleGroup
                  aria-label="Response presentation"
                  value={[presentation]}
                  onValueChange={([next]) => {
                    if (next) setPresentation(next);
                  }}
                >
                  <ToggleGroupItem value="formatted">Formatted</ToggleGroupItem>
                  <ToggleGroupItem value="received">As received</ToggleGroupItem>
                </ToggleGroup>
              ) : null}
            </>
          ) : (
            <strong className="text-red-300">
              {result.kind === 'failure' &&
              (result.failure.kind === 'rate-limit' || result.failure.kind === 'request-budget')
                ? 'Request paused'
                : 'No readable response'}
            </strong>
          )}
          <TooltipTrigger
            text={result.url}
            render={<code className="text-muted-foreground ml-auto truncate" tabIndex={0} />}
          >
            {result.url}
          </TooltipTrigger>
        </div>
      ) : null}
      {response?.rateLimit ? (
        <p
          className="border-border border-b bg-amber-400/10 px-4 py-1.5 text-xs text-amber-200"
          role="status"
        >
          {response.rateLimit.kind === 'cooldown'
            ? `WebEngine requests are paused in this tab. Retry after ${new Date(response.rateLimit.retryAt).toLocaleString()}.`
            : response.rateLimit.message}
        </p>
      ) : null}
      {response?.truncated ? (
        <p
          className="border-border border-b bg-amber-400/10 px-4 py-1.5 text-xs text-amber-200"
          role="status"
        >
          The response is larger than {formatBytes(endpointLimitBytes)}. Only its first{' '}
          {formatBytes(response.bytes)} are shown, and it is cut off at the end.
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {body !== undefined ? (
          <ResponseBody text={body} format={format} />
        ) : result?.kind === 'failure' ? (
          <FailureMessage url={result.url} failure={result.failure} />
        ) : sendingUrl ? (
          <Message>
            <span className="inline-flex items-center gap-2">
              <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
              Waiting for <code className="break-all">{sendingUrl}</code>
            </span>
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </Message>
        ) : (
          <Message>Fill in the address bar and send the request to see its response here.</Message>
        )}
      </div>
    </section>
  );
}

// Beyond this many lines, numbering would cost more than it helps, so the body goes without it.
const numberedLineLimit = 100_000;

// Beyond this many characters, coloring would take too long to render, so the body goes without it.
const highlightLimit = 250_000;

// Line numbers and text in two columns. Uncolored text stays one text node, which keeps
// multi-megabyte bodies cheap to render.
function ResponseBody({
  text,
  format,
}: {
  readonly text: string;
  readonly format: BodyFormat | undefined;
}) {
  const tokens = useMemo(
    () => (format && text.length <= highlightLimit ? bodyTokens(text, format) : undefined),
    [format, text],
  );
  if (!text) return <Message>The response has an empty body.</Message>;
  let lines = 1;
  for (let index = text.indexOf('\n'); index >= 0; index = text.indexOf('\n', index + 1)) lines++;
  return (
    <div className="flex py-2 font-mono text-[12.5px] leading-6" data-testid="response-body">
      {lines <= numberedLineLimit ? (
        <pre
          className="text-muted-foreground/60 w-12 shrink-0 pr-3 text-right select-none"
          aria-hidden="true"
        >
          {Array.from({ length: lines }, (_, index) => index + 1).join('\n')}
        </pre>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <pre className="text-code-content min-w-0 flex-1 pr-4 whitespace-pre">
        {tokens
          ? tokens.map((token, index) =>
              token.kind === 'text' ? (
                token.text
              ) : (
                <span key={index} className={tokenClasses[token.kind]}>
                  {token.text}
                </span>
              ),
            )
          : text}
      </pre>
    </div>
  );
}

function FailureMessage({
  url,
  failure,
}: {
  readonly url: string;
  readonly failure: EndpointFailure;
}) {
  if (failure.kind === 'rate-limit') {
    return <Message>{failure.message}</Message>;
  }
  if (failure.kind === 'request-budget') {
    return <Message>{failure.message}</Message>;
  }
  return (
    <Message>
      <span className="max-w-2xl">
        {failure.kind === 'timeout'
          ? `No response arrived within ${endpointTimeoutMs / 1_000} seconds, so the request was stopped.`
          : 'The browser did not let Zesty Explorer read a response. WebEngine may have answered with an error page, such as a Parsley error or 404, the preview may be locked, the site may not allow requests from Zesty Explorer (CORS), or it may be unreachable.'}{' '}
        Open the URL in a new tab to see what it returns.
      </span>
      <a
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
        href={url}
        target="_blank"
        rel="noreferrer"
      >
        <ExternalLink size={14} aria-hidden="true" /> Open in a new tab
      </a>
    </Message>
  );
}

function Message({ children }: { readonly children: ReactNode }) {
  return (
    <div className="text-muted-foreground grid justify-items-center gap-3 px-4 py-6 text-center text-sm">
      {children}
    </div>
  );
}

// An input that grows with its text, so the address bar reads like one URL.
function AutoWidthInput({
  value,
  onChange,
  placeholder,
  className,
  autoFocus,
  'aria-label': ariaLabel,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly className?: string;
  readonly autoFocus?: boolean;
  readonly 'aria-label': string;
}) {
  return (
    <input
      className={cn(
        'placeholder:text-muted-foreground/50 rounded-sm bg-transparent outline-none focus-visible:ring-1 focus-visible:ring-ring/60',
        className,
      )}
      style={{ width: `calc(${Math.max(value.length, placeholder.length, 1)}ch + 4px)` }}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Text color for a status code class. */
function statusTone(status: number): string {
  if (status < 300) return 'text-emerald-300';
  if (status < 400) return 'text-sky-300';
  if (status < 500) return 'text-amber-300';
  return 'text-red-300';
}
