import { Dialog } from '@base-ui/react/dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranch, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { parseCollectionReference } from '../../collection-reference';
import type {
  CollectionNode,
  CollectionNodeId,
  CollectionReference,
  CollectionSchema,
  RelationshipDefinition,
} from '../../domain';
import {
  findNativeRelationshipCandidates,
  findNativeRelationships,
  subtreeNodeNames,
} from '../../explorer-core';

interface TreeEditorProps {
  readonly root: CollectionNode;
  readonly rootSchema: CollectionSchema;
  readonly schemas: ReadonlyMap<CollectionNodeId, CollectionSchema>;
  readonly loadSchema: (
    reference: CollectionReference,
    signal: AbortSignal,
  ) => Promise<
    | { readonly ok: true; readonly schema: CollectionSchema }
    | { readonly ok: false; readonly message: string }
  >;
  readonly onAdd: (
    parentId: CollectionNodeId,
    reference: CollectionReference,
    name: string,
    relationship: RelationshipDefinition,
  ) => string | undefined;
  readonly onRename: (nodeId: CollectionNodeId, name: string) => void;
  readonly onRemove: (nodeId: CollectionNodeId) => void;
  readonly onRelationshipChange: (
    nodeId: CollectionNodeId,
    relationship: RelationshipDefinition,
  ) => void;
}

function schemaPaths(schema: CollectionSchema): readonly string[] {
  return ['id', 'created', 'modified', 'version', ...schema.fields.map((field) => field.name)];
}

function sameFieldPath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function sameNativeRelationship(
  left: Extract<RelationshipDefinition, { readonly kind: 'native' }>,
  right: Extract<RelationshipDefinition, { readonly kind: 'native' }>,
): boolean {
  return (
    left.fieldSide === right.fieldSide &&
    left.relatedModelZuid === right.relatedModelZuid &&
    sameFieldPath(left.field, right.field)
  );
}

function AddRelationship({
  parent,
  schema,
  loadSchema,
  onAdd,
}: {
  readonly parent: CollectionNode;
  readonly schema: CollectionSchema;
  readonly loadSchema: TreeEditorProps['loadSchema'];
  readonly onAdd: TreeEditorProps['onAdd'];
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'native' | 'custom'>('native');
  const [nativeField, setNativeField] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [childPath, setChildPath] = useState('');
  const [error, setError] = useState<string>();
  const parsed = useMemo(() => parseCollectionReference(url), [url]);
  const referenceAllowed =
    parsed.ok &&
    parsed.value.instanceZuid === parent.reference.instanceZuid &&
    parsed.value.deployment === parent.reference.deployment;
  const schemaQueryKey = [
    'relationship-schema',
    parsed.ok ? parsed.value.instanceZuid : '',
    parsed.ok ? parsed.value.deployment : '',
    parsed.ok ? parsed.value.modelZuid : '',
  ] as const;
  const schemaQuery = useQuery({
    queryKey: schemaQueryKey,
    enabled: open && referenceAllowed,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!parsed.ok) throw new Error('A valid related collection URL is required.');
      const result = await loadSchema(parsed.value, signal);
      if (!result.ok) throw new Error(result.message);
      return result.schema;
    },
  });
  const loadedChildSchema = schemaQuery.data;
  const nativeCandidates =
    parsed.ok && loadedChildSchema
      ? findNativeRelationshipCandidates(schema, loadedChildSchema)
      : [];

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parsed.ok) {
      setError(parsed.error.message);
      return;
    }
    if (!referenceAllowed) {
      setError('Every collection node must belong to the root instance and deployment.');
      return;
    }

    let relationship: RelationshipDefinition;
    let defaultName: string;
    if (mode === 'native' && nativeCandidates.length > 0) {
      const selected =
        nativeCandidates.find((candidate) => candidate.field.id === nativeField) ??
        nativeCandidates[0];
      if (!selected || (nativeCandidates.length > 1 && !nativeField)) {
        setError('Choose which native relationship field this role uses.');
        return;
      }
      relationship = selected.relationship;
      defaultName = selected.field.label;
    } else {
      if (!parentPath.trim() || !childPath.trim()) {
        setError('Choose a parent field path and enter a child field path.');
        return;
      }
      const parentField = parentPath.split('.').filter(Boolean);
      relationship = {
        kind: 'custom',
        parentField,
        childField: childPath.split('.').filter(Boolean),
      };
      defaultName =
        schema.fields.find((field) => field.name === parentField[0])?.label ??
        parsed.value.modelZuid;
    }

    const problem = onAdd(parent.id, parsed.value, name || defaultName, relationship);
    if (problem) {
      setError(problem);
      return;
    }
    setOpen(false);
    setUrl('');
    setName('');
    setError(undefined);
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) void queryClient.cancelQueries({ queryKey: schemaQueryKey, exact: true });
      }}
    >
      <Dialog.Trigger className="tree-action">
        <Plus size={13} /> Add relationship
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className="dialog-popup">
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">Relationship</p>
              <Dialog.Title>Add below {parent.name}</Dialog.Title>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close add relationship">
              <X size={17} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="muted">
            Add another collection from the same Zesty instance and deployment.
          </Dialog.Description>
          <form onSubmit={submit}>
            <label className="field-label" htmlFor={`child-url-${parent.id}`}>
              Related collection URL
            </label>
            <input
              id={`child-url-${parent.id}`}
              type="url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setNativeField('');
              }}
            />
            <label className="field-label" htmlFor={`child-name-${parent.id}`}>
              Node name
            </label>
            <input
              id={`child-name-${parent.id}`}
              type="text"
              value={name}
              placeholder="Uses the relationship label by default"
              onChange={(event) => setName(event.target.value)}
            />

            {schemaQuery.isFetching ? (
              <p className="muted" role="status">
                Checking native relationships…
              </p>
            ) : null}
            {schemaQuery.error ? (
              <div>
                <p className="error-message">
                  Could not inspect the related collection schema: {schemaQuery.error.message}
                </p>
                <button type="button" className="button" onClick={() => void schemaQuery.refetch()}>
                  Retry schema inspection
                </button>
              </div>
            ) : null}

            {nativeCandidates.length > 0 ? (
              <>
                <label className="field-label" htmlFor={`relation-mode-${parent.id}`}>
                  Relationship type
                </label>
                <select
                  id={`relation-mode-${parent.id}`}
                  value={mode}
                  onChange={(event) => setMode(event.target.value as 'native' | 'custom')}
                >
                  <option value="native">Native relationship</option>
                  <option value="custom">Custom equality</option>
                </select>
              </>
            ) : null}

            {mode === 'native' && nativeCandidates.length > 0 ? (
              <>
                <label className="field-label" htmlFor={`native-field-${parent.id}`}>
                  Native field
                </label>
                <select
                  id={`native-field-${parent.id}`}
                  value={nativeField}
                  onChange={(event) => setNativeField(event.target.value)}
                >
                  {nativeCandidates.length > 1 ? <option value="">Choose a field</option> : null}
                  {nativeCandidates.map((candidate) => (
                    <option key={candidate.field.id} value={candidate.field.id}>
                      {candidate.field.label}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <div className="field-pair">
                <label className="field-label">
                  Parent field path
                  <input
                    list={`parent-paths-${parent.id}`}
                    value={parentPath}
                    onChange={(event) => setParentPath(event.target.value)}
                    placeholder="e.g. category.zuid"
                  />
                  <datalist id={`parent-paths-${parent.id}`}>
                    {schemaPaths(schema).map((path) => (
                      <option key={path} value={path} />
                    ))}
                  </datalist>
                </label>
                <label className="field-label">
                  Child field path
                  <input
                    type="text"
                    value={childPath}
                    placeholder="e.g. parent.zuid"
                    onChange={(event) => setChildPath(event.target.value)}
                  />
                </label>
              </div>
            )}
            {error ? <p className="error-message">{error}</p> : null}
            <button
              className="button button--primary"
              type="submit"
              disabled={schemaQuery.isFetching || schemaQuery.isError}
            >
              Add collection node
            </button>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EditRelationship({
  node,
  parentSchema,
  childSchema,
  onChange,
}: {
  readonly node: CollectionNode;
  readonly parentSchema: CollectionSchema;
  readonly childSchema?: CollectionSchema;
  readonly onChange: TreeEditorProps['onRelationshipChange'];
}) {
  const relationship = node.relationship;
  const discoveredNativeCandidates = childSchema
    ? findNativeRelationshipCandidates(parentSchema, childSchema)
    : findNativeRelationships(parentSchema, node.reference.modelZuid).map((field) => ({
        field,
        relationship: {
          kind: 'native' as const,
          fieldSide: 'parent' as const,
          field: [field.name],
          relatedModelZuid: node.reference.modelZuid,
        },
      }));
  const currentNativeCandidate =
    relationship?.kind === 'native'
      ? {
          field: {
            id: `12-saved-${node.id}` as const,
            name: relationship.field.join('.'),
            label: node.name,
            kind: 'relationship' as const,
            relatedModelZuid: relationship.relatedModelZuid,
          },
          relationship,
        }
      : undefined;
  const nativeCandidates =
    currentNativeCandidate &&
    !discoveredNativeCandidates.some((candidate) =>
      sameNativeRelationship(candidate.relationship, currentNativeCandidate.relationship),
    )
      ? [...discoveredNativeCandidates, currentNativeCandidate]
      : discoveredNativeCandidates;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'native' | 'custom'>(relationship?.kind ?? 'custom');
  const [nativeField, setNativeField] = useState('');
  const [parentPath, setParentPath] = useState(
    relationship?.kind === 'custom' ? relationship.parentField.join('.') : '',
  );
  const [childPath, setChildPath] = useState(
    relationship?.kind === 'custom' ? relationship.childField.join('.') : 'id',
  );
  const [error, setError] = useState<string>();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === 'custom' && (!parentPath.trim() || !childPath.trim())) {
      setError('Choose both relationship field paths.');
      return;
    }
    const selectedNative =
      nativeCandidates.find((candidate) => candidate.field.id === nativeField) ??
      (relationship?.kind === 'native'
        ? nativeCandidates.find((candidate) =>
            sameNativeRelationship(candidate.relationship, relationship),
          )
        : nativeCandidates.length === 1
          ? nativeCandidates[0]
          : undefined);
    if (mode === 'native' && !selectedNative) {
      setError('Choose which native relationship field this role uses.');
      return;
    }
    const next: RelationshipDefinition =
      mode === 'native' && selectedNative
        ? selectedNative.relationship
        : {
            kind: 'custom',
            parentField: parentPath.split('.').filter(Boolean),
            childField: childPath.split('.').filter(Boolean),
          };
    onChange(node.id, next);
    setError(undefined);
    setOpen(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="tree-menu__item" aria-label={`Edit relationship for ${node.name}`}>
        <Pencil size={12} />
        <span>Edit relationship</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className="dialog-popup">
          <div className="dialog-heading">
            <div>
              <p className="eyebrow">Relationship</p>
              <Dialog.Title>Repair {node.name}</Dialog.Title>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close relationship editor">
              <X size={17} />
            </Dialog.Close>
          </div>
          <form onSubmit={submit}>
            <label className="field-label">
              Relationship type
              <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
                {nativeCandidates.length > 0 ? (
                  <option value="native">Native relationship</option>
                ) : null}
                <option value="custom">Custom equality</option>
              </select>
            </label>
            {mode === 'native' ? (
              <label className="field-label">
                Native field
                <select
                  value={
                    nativeField ||
                    (relationship?.kind === 'native'
                      ? nativeCandidates.find((candidate) =>
                          sameNativeRelationship(candidate.relationship, relationship),
                        )?.field.id
                      : '')
                  }
                  onChange={(event) => setNativeField(event.target.value)}
                >
                  {nativeCandidates.length > 1 && relationship?.kind !== 'native' ? (
                    <option value="">Choose a field</option>
                  ) : null}
                  {nativeCandidates.map((candidate) => (
                    <option key={candidate.field.id} value={candidate.field.id}>
                      {candidate.field.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="field-label">
                Parent field path
                <input
                  list={`edit-parent-paths-${node.id}`}
                  value={parentPath}
                  onChange={(event) => setParentPath(event.target.value)}
                />
                <datalist id={`edit-parent-paths-${node.id}`}>
                  {schemaPaths(parentSchema).map((path) => (
                    <option key={path} value={path} />
                  ))}
                </datalist>
              </label>
            )}
            {mode === 'custom' ? (
              <label className="field-label">
                Child field path
                <input
                  list={`edit-child-paths-${node.id}`}
                  value={childPath}
                  onChange={(event) => setChildPath(event.target.value)}
                />
                <datalist id={`edit-child-paths-${node.id}`}>
                  {childSchema
                    ? schemaPaths(childSchema).map((path) => <option key={path} value={path} />)
                    : null}
                </datalist>
              </label>
            ) : null}
            {error ? <p className="error-message">{error}</p> : null}
            <button className="button button--primary" type="submit">
              Save relationship
            </button>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TreeNodeRow({
  node,
  root,
  onRename,
  onRemove,
  schemas,
  loadSchema,
  onAdd,
  parent,
  onRelationshipChange,
}: {
  readonly node: CollectionNode;
  readonly root: CollectionNode;
  readonly onRename: TreeEditorProps['onRename'];
  readonly onRemove: TreeEditorProps['onRemove'];
  readonly schemas: TreeEditorProps['schemas'];
  readonly loadSchema: TreeEditorProps['loadSchema'];
  readonly onAdd: TreeEditorProps['onAdd'];
  readonly parent?: CollectionNode;
  readonly onRelationshipChange: TreeEditorProps['onRelationshipChange'];
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.name);

  function remove() {
    const names = subtreeNodeNames(root, node.id);
    if (!window.confirm(`Remove ${names.join(', ')} and all of its saved table state?`)) return;
    onRemove(node.id);
  }

  return (
    <li>
      <div className={node.id === root.id ? 'tree-node tree-node--root' : 'tree-node'}>
        <span className="tree-node__dot" />
        {editing ? (
          <input
            aria-label={`Rename ${node.name}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              onRename(node.id, name);
              setEditing(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                setName(node.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <span>{node.name}</span>
        )}
        <details className="tree-menu">
          <summary className="tree-icon" aria-label={`Actions for ${node.name}`}>
            <MoreHorizontal size={15} />
          </summary>
          <div className="tree-menu__popup">
            <button className="tree-menu__item" onClick={() => setEditing(true)}>
              <Pencil size={12} /> <span>Rename</span>
            </button>
            {parent && schemas.get(parent.id) ? (
              <EditRelationship
                node={node}
                parentSchema={schemas.get(parent.id)!}
                {...(schemas.get(node.id) ? { childSchema: schemas.get(node.id)! } : {})}
                onChange={onRelationshipChange}
              />
            ) : null}
            {node.id !== root.id ? (
              <button className="tree-menu__item tree-menu__item--danger" onClick={remove}>
                <Trash2 size={12} /> <span>Remove</span>
              </button>
            ) : null}
          </div>
        </details>
      </div>
      {schemas.get(node.id) ? (
        <AddRelationship
          parent={node}
          schema={schemas.get(node.id)!}
          loadSchema={loadSchema}
          onAdd={onAdd}
        />
      ) : null}
      {node.children.length > 0 ? (
        <ul className="tree-children">
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              root={root}
              onRename={onRename}
              onRemove={onRemove}
              schemas={schemas}
              loadSchema={loadSchema}
              onAdd={onAdd}
              parent={node}
              onRelationshipChange={onRelationshipChange}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function TreeEditor({
  root,
  rootSchema,
  schemas,
  loadSchema,
  onAdd,
  onRename,
  onRemove,
  onRelationshipChange,
}: TreeEditorProps) {
  const availableSchemas = schemas.size > 0 ? schemas : new Map([[root.id, rootSchema]]);
  return (
    <div className="tree-editor">
      <div className="tree-heading">
        <GitBranch size={15} aria-hidden="true" />
        <span>Collections</span>
      </div>
      <ul className="tree-list">
        <TreeNodeRow
          node={root}
          root={root}
          onRename={onRename}
          onRemove={onRemove}
          schemas={availableSchemas}
          loadSchema={loadSchema}
          onAdd={onAdd}
          onRelationshipChange={onRelationshipChange}
        />
      </ul>
    </div>
  );
}
