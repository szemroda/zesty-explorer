import type {
  CollectionArea,
  CollectionReference,
  Deployment,
  ExplorerError,
  InstanceZuid,
  ItemZuid,
  ModelZuid,
} from '../domain';

interface DeploymentHosts {
  readonly deployment: Deployment;
  readonly managerSuffixes: readonly string[];
  readonly apiSuffix: string;
  readonly protocol: 'http:' | 'https:';
  readonly requiredPort?: string;
}

const deploymentHosts: readonly DeploymentHosts[] = [
  {
    deployment: 'development',
    managerSuffixes: ['.manager.dev.zesty.io', '.cms.dev.content.one'],
    apiSuffix: '.api.dev.zesty.io',
    protocol: 'http:',
    requiredPort: '8080',
  },
  {
    deployment: 'stage',
    managerSuffixes: ['.manager.stage.zesty.io', '.cms.stage.content.one'],
    apiSuffix: '.api.stage.zesty.io',
    protocol: 'https:',
  },
  {
    deployment: 'production',
    managerSuffixes: ['.manager.zesty.io', '.cms.content.one'],
    apiSuffix: '.api.zesty.io',
    protocol: 'https:',
  },
];

const instancePattern = /^8-[a-z0-9][a-z0-9-]{4,}$/i;
const modelPattern = /^6-[a-z0-9][a-z0-9-]{4,}$/i;
const itemPattern = /^7-[a-z0-9][a-z0-9-]{4,}$/i;
const editorSuffixes = new Set(['edit', 'preview', 'settings']);

export type CollectionReferenceParseResult =
  | { readonly ok: true; readonly value: CollectionReference }
  | { readonly ok: false; readonly error: ExplorerError };

function failure(
  kind: 'invalid-input' | 'blocked-host',
  message: string,
): CollectionReferenceParseResult {
  return { ok: false, error: { kind, message } };
}

function parseHost(url: URL):
  | {
      readonly instanceZuid: InstanceZuid;
      readonly hosts: DeploymentHosts;
      readonly source: 'manager' | 'api';
    }
  | undefined {
  for (const hosts of deploymentHosts) {
    const allSuffixes = [...hosts.managerSuffixes, hosts.apiSuffix];
    const suffix = allSuffixes.find((candidate) => url.hostname.endsWith(candidate));
    if (!suffix) continue;

    const instance = url.hostname.slice(0, -suffix.length);
    if (!instancePattern.test(instance)) return undefined;
    if (url.protocol !== hosts.protocol) return undefined;
    if ((hosts.requiredPort ?? '') !== url.port) return undefined;

    return {
      instanceZuid: instance as InstanceZuid,
      hosts,
      source: suffix === hosts.apiSuffix ? 'api' : 'manager',
    };
  }
  return undefined;
}

function parseManagerPath(segments: readonly string[]):
  | {
      readonly area: CollectionArea;
      readonly modelZuid: ModelZuid;
      readonly itemZuid: ItemZuid | undefined;
    }
  | undefined {
  const [area, model, item, suffix, ...extra] = segments;
  if ((area !== 'content' && area !== 'blocks') || !model || !modelPattern.test(model)) {
    return undefined;
  }
  if (extra.length > 0 || (suffix && !editorSuffixes.has(suffix))) return undefined;
  if (item && !itemPattern.test(item)) return undefined;

  return {
    area,
    modelZuid: model as ModelZuid,
    itemZuid: item ? (item as ItemZuid) : undefined,
  };
}

function parseApiPath(segments: readonly string[]):
  | {
      readonly area: CollectionArea;
      readonly modelZuid: ModelZuid;
      readonly itemZuid: undefined;
    }
  | undefined {
  const [version, content, models, model, items, ...extra] = segments;
  if (
    version !== 'v1' ||
    content !== 'content' ||
    models !== 'models' ||
    !model ||
    !modelPattern.test(model) ||
    items !== 'items' ||
    extra.length > 0
  ) {
    return undefined;
  }
  return { area: 'content', modelZuid: model as ModelZuid, itemZuid: undefined };
}

export function parseCollectionReference(input: string): CollectionReferenceParseResult {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return failure('invalid-input', 'Enter a complete Zesty Manager or Instances API URL.');
  }

  const host = parseHost(url);
  if (!host) {
    return failure('blocked-host', 'This host is not an allowed Zesty deployment host.');
  }

  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const path = host.source === 'api' ? parseApiPath(segments) : parseManagerPath(segments);
  if (!path) {
    return failure('invalid-input', 'The URL does not identify a supported Zesty collection.');
  }

  const { hosts, instanceZuid } = host;
  const port = hosts.requiredPort ? `:${hosts.requiredPort}` : '';
  const managerSuffix = hosts.managerSuffixes[0];
  if (!managerSuffix) return failure('blocked-host', 'No Manager host is configured.');

  return {
    ok: true,
    value: {
      instanceZuid,
      modelZuid: path.modelZuid,
      ...(path.itemZuid ? { itemZuid: path.itemZuid } : {}),
      deployment: hosts.deployment,
      area: path.area,
      apiBaseUrl: `${hosts.protocol}//${instanceZuid}${hosts.apiSuffix}/v1`,
      managerBaseUrl: `${hosts.protocol}//${instanceZuid}${managerSuffix}${port}`,
    },
  };
}
