import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Effect } from 'effect';
import { Eye, EyeOff, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { parseCollectionReference } from '../collection-reference';
import type {
  CollectionNode,
  CollectionNodeId,
  CollectionReference,
  CollectionSchema,
  CollectionSnapshot,
  ContentItem,
  ContentState,
  ExplorerError,
  RelationshipDefinition,
} from '../domain';
import { addCollectionNode, removeCollectionNode, renameCollectionNode } from '../explorer-core';
import {
  createBrowserSessionTokenStore,
  type SessionTokenStore,
} from '../view-codec/session-token-store';
import { createZestyApi, fetchZestyTransport, type ZestyApi } from '../zesty-api';
import { ItemDetails } from './components/ItemDetails';
import { RootTable } from './components/RootTable';
import { TreeEditor } from './components/TreeEditor';
import { createChildNode } from './view-state';

interface AppProps {
  readonly api?: ZestyApi;
  readonly tokenStore?: SessionTokenStore;
}

interface ExplorerProps {
  readonly api: ZestyApi;
  readonly tokenStore: SessionTokenStore;
}

const defaultApi = createZestyApi(fetchZestyTransport);

class ExplorerQueryError extends Error {
  constructor(readonly failure: ExplorerError) {
    super(failure.message);
    this.name = 'ExplorerQueryError';
  }
}

async function runApi<A>(effect: Effect.Effect<A, ExplorerError>): Promise<A> {
  const result = await Effect.runPromise(Effect.either(effect));
  if (result._tag === 'Left') throw new ExplorerQueryError(result.left);
  return result.right;
}

function Explorer({ api, tokenStore }: ExplorerProps) {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [collectionInput, setCollectionInput] = useState('');
  const [inputError, setInputError] = useState<string>();
  const [reference, setReference] = useState<CollectionReference>();
  const [treeRoot, setTreeRoot] = useState<CollectionNode>();
  const [contentState, setContentState] = useState<ContentState>('latest');
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const [tokenRequired, setTokenRequired] = useState(false);

  const query = useQuery({
    queryKey: reference
      ? [
          'collection',
          reference.instanceZuid,
          reference.deployment,
          reference.modelZuid,
          contentState,
          'en-US',
        ]
      : ['collection', 'closed'],
    enabled: Boolean(reference && token && !tokenRequired),
    retry: false,
    queryFn: async (): Promise<{
      schema: CollectionSchema;
      snapshot: CollectionSnapshot;
    }> => {
      if (!reference || !token) throw new Error('Collection request is not ready.');
      const [schema, snapshot] = await Promise.all([
        runApi(api.loadCollectionSchema(reference, token)),
        runApi(api.loadCollectionSnapshot(reference, contentState, token)),
      ]);
      return { schema, snapshot };
    },
  });

  const queryError = query.error instanceof ExplorerQueryError ? query.error : null;
  useEffect(() => {
    if (queryError?.failure.kind !== 'authentication' || !reference) return;
    tokenStore.clear(reference.deployment);
    const update = window.setTimeout(() => {
      setToken('');
      setTokenRequired(true);
    }, 0);
    return () => window.clearTimeout(update);
  }, [queryError, reference, tokenStore]);

  const selectedItem = useMemo(
    () =>
      selectedItemId && query.data
        ? query.data.snapshot.itemsById.get(selectedItemId as ContentItem['id'])
        : undefined,
    [query.data, selectedItemId],
  );

  function openCollection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseCollectionReference(collectionInput);
    if (!parsed.ok) {
      setInputError(parsed.error.message);
      return;
    }
    if (!token.trim()) {
      setInputError('Enter the Zesty session token for this deployment.');
      return;
    }

    tokenStore.set(parsed.value.deployment, token);
    setReference(parsed.value);
    setTreeRoot((current) => {
      if (
        current?.reference.instanceZuid === parsed.value.instanceZuid &&
        current.reference.modelZuid === parsed.value.modelZuid &&
        current.reference.deployment === parsed.value.deployment
      ) {
        return current;
      }
      return {
        id: 'node-root',
        name: parsed.value.modelZuid,
        reference: parsed.value,
        presentation: {
          visibleColumns: [],
          columnWidths: {},
          sort: { fieldPath: ['modified'], direction: 'desc' },
          filters: [],
          freeText: '',
        },
        children: [],
      };
    });
    setSelectedItemId(parsed.value.itemZuid);
    setInputError(undefined);
    setTokenRequired(false);
  }

  function clearToken() {
    if (
      !reference ||
      !window.confirm('Clear the session token? The current view will stay open.')
    ) {
      return;
    }
    tokenStore.clear(reference.deployment);
    setToken('');
    setTokenRequired(true);
  }

  const showStart = !reference || tokenRequired;

  function addRelatedCollection(
    parentId: CollectionNodeId,
    childReference: CollectionReference,
    name: string,
    relationship: RelationshipDefinition,
  ): string | undefined {
    if (!treeRoot) return 'Open a root collection first.';
    const result = addCollectionNode(
      treeRoot,
      parentId,
      createChildNode(childReference, name, relationship),
    );
    if (!result.ok) return result.reason;
    setTreeRoot(result.root);
    return undefined;
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <span className="eyebrow">Local read-only browser</span>
          <h1>Zesty Explorer</h1>
        </div>
        <div className="top-actions">
          {reference ? (
            <>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={contentState === 'published'}
                  onChange={(event) =>
                    setContentState(event.target.checked ? 'published' : 'latest')
                  }
                />
                Published only
              </label>
              <button className="button button--quiet" onClick={() => void query.refetch()}>
                <RefreshCw size={14} aria-hidden="true" /> Refresh
              </button>
              <button className="icon-button" aria-label="Clear session token" onClick={clearToken}>
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </>
          ) : (
            <span className="status-dot">No collection open</span>
          )}
        </div>
      </header>

      <div className="workspace">
        <aside className="tree-panel" aria-label="Collection tree">
          <p className="eyebrow">View</p>
          {treeRoot && query.data ? (
            <TreeEditor
              root={{
                ...treeRoot,
                name:
                  treeRoot.name === treeRoot.reference.modelZuid
                    ? query.data.schema.label
                    : treeRoot.name,
              }}
              rootSchema={query.data.schema}
              onAdd={addRelatedCollection}
              onRename={(nodeId, name) =>
                setTreeRoot((root) => root && renameCollectionNode(root, nodeId, name))
              }
              onRemove={(nodeId) =>
                setTreeRoot((root) => (root ? removeCollectionNode(root, nodeId) : root))
              }
            />
          ) : reference ? (
            <div className="tree-node">
              <span className="tree-node__dot" />
              <span>{reference.modelZuid}</span>
            </div>
          ) : (
            <p className="muted">Your root collection will appear here.</p>
          )}
        </aside>

        <section className="main-panel" aria-live="polite">
          {showStart ? (
            <form className="start-card" aria-labelledby="start-title" onSubmit={openCollection}>
              <p className="eyebrow">{tokenRequired ? 'Session expired' : 'Start a view'}</p>
              <h2 id="start-title">
                {tokenRequired ? 'Replace your session token' : 'Open a Zesty collection'}
              </h2>

              <label className="field-label" htmlFor="session-token">
                Zesty session token
              </label>
              <div className="input-with-action">
                <input
                  id="session-token"
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  autoComplete="off"
                  onChange={(event) => setToken(event.target.value)}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={showToken ? 'Hide session token' : 'Reveal session token'}
                  onClick={() => setShowToken((visible) => !visible)}
                >
                  {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <details className="help-text">
                <summary>How to find the token</summary>
                Copy APP_SID for production, STAGE_APP_SID for stage, or DEV_APP_SID for development
                from your Zesty Manager cookies. It carries your permissions. Do not share it.
              </details>

              <label className="field-label" htmlFor="collection-url">
                Root collection URL
              </label>
              <input
                id="collection-url"
                type="url"
                value={collectionInput}
                placeholder="https://8-….manager.zesty.io/content/6-…"
                onChange={(event) => setCollectionInput(event.target.value)}
              />
              <p className="help-text">
                Paste a Content or Blocks URL from Zesty Manager, or a full Instances API collection
                URL.
              </p>
              {inputError ? <p className="error-message">{inputError}</p> : null}
              <button className="button button--primary" type="submit">
                Open collection
              </button>
            </form>
          ) : null}

          {!showStart && query.isPending ? (
            <div className="state-card">Loading collection…</div>
          ) : null}
          {!showStart && queryError ? (
            <div className="state-card state-card--error" role="alert">
              <h2>Collection could not load</h2>
              <p>{queryError?.message ?? 'The collection request failed unexpectedly.'}</p>
              <button className="button" onClick={() => void query.refetch()}>
                Retry
              </button>
            </div>
          ) : null}
          {!showStart && query.data ? (
            <RootTable
              schema={query.data.schema}
              snapshot={query.data.snapshot}
              reference={reference}
              onOpenDetails={(item) => setSelectedItemId(item.id)}
            />
          ) : null}
        </section>
      </div>

      <ItemDetails item={selectedItem} onClose={() => setSelectedItemId(undefined)} />
    </main>
  );
}

export function App({ api = defaultApi, tokenStore }: AppProps) {
  const [queryClient] = useState(() => new QueryClient());
  const resolvedTokenStore = useMemo(
    () => tokenStore ?? createBrowserSessionTokenStore(),
    [tokenStore],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <Explorer api={api} tokenStore={resolvedTokenStore} />
    </QueryClientProvider>
  );
}
