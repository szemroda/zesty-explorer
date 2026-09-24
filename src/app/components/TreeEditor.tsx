import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, GitBranch, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { parseCollectionReference } from '../../collection-reference';
import type {
  CollectionNode,
  CollectionNodeId,
  CollectionCatalogEntry,
  CollectionReference,
  CollectionSchema,
  RelationshipDefinition,
  ExplorerError,
} from '../../domain';
import { findNativeRelationshipCandidates, findNativeRelationships } from '../../explorer-core';
import { CollectionPicker } from './CollectionPicker';
import { ErrorTechnicalDetails } from './ErrorTechnicalDetails';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface TreeEditorProps {
  readonly root: CollectionNode;
  readonly rootSchema: CollectionSchema;
  readonly schemas: ReadonlyMap<CollectionNodeId, CollectionSchema>;
  readonly catalog: readonly CollectionCatalogEntry[];
  readonly catalogError: ExplorerError | undefined;
  readonly catalogWarning: ExplorerError | undefined;
  readonly onRetryCatalog: () => void;
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
  readonly onChangeRoot: () => void;
  readonly onRemove: (nodeId: CollectionNodeId) => void;
  readonly onRelationshipChange: (
    nodeId: CollectionNodeId,
    relationship: RelationshipDefinition,
  ) => void;
}

function schemaPaths(schema: CollectionSchema): readonly string[] {
  return [
    ...new Set([
      'id',
      'created',
      'modified',
      'version',
      ...schema.fields.map((field) => field.name),
    ]),
  ];
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
  catalog,
  catalogError,
  catalogWarning,
  onRetryCatalog,
  loadSchema,
  onAdd,
}: {
  readonly parent: CollectionNode;
  readonly schema: CollectionSchema;
  readonly catalog: TreeEditorProps['catalog'];
  readonly catalogError: TreeEditorProps['catalogError'];
  readonly catalogWarning: TreeEditorProps['catalogWarning'];
  readonly onRetryCatalog: TreeEditorProps['onRetryCatalog'];
  readonly loadSchema: TreeEditorProps['loadSchema'];
  readonly onAdd: TreeEditorProps['onAdd'];
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [selectedCollection, setSelectedCollection] = useState<CollectionCatalogEntry>();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'native' | 'custom'>('native');
  const [nativeField, setNativeField] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [childPath, setChildPath] = useState('');
  const [error, setError] = useState<string>();
  const parsed = useMemo(() => parseCollectionReference(url), [url]);
  const selectedReference = selectedCollection?.reference ?? (parsed.ok ? parsed.value : undefined);
  const referenceAllowed =
    selectedReference !== undefined &&
    selectedReference.instanceZuid === parent.reference.instanceZuid &&
    selectedReference.deployment === parent.reference.deployment;
  const schemaQueryKey = [
    'relationship-schema',
    selectedReference?.instanceZuid ?? '',
    selectedReference?.deployment ?? '',
    selectedReference?.modelZuid ?? '',
  ] as const;
  const schemaQuery = useQuery({
    queryKey: schemaQueryKey,
    enabled: open && referenceAllowed,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!selectedReference) throw new Error('A valid related collection URL is required.');
      const result = await loadSchema(selectedReference, signal);
      if (!result.ok) throw new Error(result.message);
      return result.schema;
    },
  });
  const loadedChildSchema = schemaQuery.data;
  const nativeCandidates = loadedChildSchema
    ? findNativeRelationshipCandidates(schema, loadedChildSchema)
    : [];
  const effectiveMode = loadedChildSchema && nativeCandidates.length === 0 ? 'custom' : mode;
  const effectiveChildPath =
    effectiveMode === 'custom' && loadedChildSchema && !childPath ? 'id' : childPath;
  const catalogCollection = selectedReference
    ? catalog.find(
        (collection) =>
          collection.reference.instanceZuid === selectedReference.instanceZuid &&
          collection.reference.deployment === selectedReference.deployment &&
          collection.reference.modelZuid === selectedReference.modelZuid,
      )
    : undefined;
  const defaultNodeName = catalogCollection?.label ?? selectedReference?.modelZuid;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedReference) {
      setError(parsed.ok ? 'Choose a related collection.' : parsed.error.message);
      return;
    }
    if (!referenceAllowed) {
      setError('Every collection node must belong to the root instance and deployment.');
      return;
    }

    let relationship: RelationshipDefinition;
    if (effectiveMode === 'native' && nativeCandidates.length > 0) {
      const selected =
        nativeCandidates.find((candidate) => candidate.field.id === nativeField) ??
        nativeCandidates[0];
      if (!selected || (nativeCandidates.length > 1 && !nativeField)) {
        setError('Choose which native relationship field this role uses.');
        return;
      }
      relationship = selected.relationship;
    } else {
      if (!parentPath.trim() || !effectiveChildPath.trim()) {
        setError('Choose a parent field path and enter a child field path.');
        return;
      }
      const parentField = parentPath.split('.').filter(Boolean);
      relationship = {
        kind: 'custom',
        parentField,
        childField: effectiveChildPath.split('.').filter(Boolean),
      };
    }

    const customName = name.trim();
    const nodeName = customName || defaultNodeName || selectedReference.modelZuid;
    const problem = onAdd(parent.id, selectedReference, nodeName, relationship);
    if (problem) {
      setError(problem);
      return;
    }
    setOpen(false);
    setUrl('');
    setSelectedCollection(undefined);
    setName('');
    setError(undefined);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) void queryClient.cancelQueries({ queryKey: schemaQueryKey, exact: true });
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground w-full justify-start text-xs"
          />
        }
      >
        <Plus size={13} /> Add relationship
      </DialogTrigger>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
        closeLabel="Close add relationship"
      >
        <DialogHeader className="pr-10 text-left">
          <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            Relationship
          </p>
          <DialogTitle>Add below {parent.name}</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          Add another collection from the same Zesty instance and deployment.
        </DialogDescription>
        <form className="grid gap-4" onSubmit={submit}>
          <CollectionPicker
            label="Related collection"
            collections={catalog}
            value={selectedReference?.modelZuid}
            onChange={(collection) => {
              if (!collection) {
                setUrl('');
                setSelectedCollection(undefined);
                return;
              }
              const reference = collection.reference;
              setSelectedCollection(collection);
              setUrl(
                reference.area === 'other'
                  ? `${reference.apiBaseUrl}/content/models/${reference.modelZuid}`
                  : `${reference.managerBaseUrl}/${reference.area}/${reference.modelZuid}`,
              );
              setNativeField('');
              setMode('native');
            }}
          />
          {catalogError ? (
            <div
              className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-sm"
              role="alert"
            >
              <p className="mb-2">{catalogError.message}</p>
              <ErrorTechnicalDetails error={catalogError} />
              <Button type="button" variant="outline" onClick={onRetryCatalog}>
                Retry catalog
              </Button>
            </div>
          ) : null}
          {catalogWarning ? (
            <div
              className="border-amber-500/40 bg-amber-500/10 rounded-md border p-3 text-sm"
              role="status"
            >
              <p>{catalogWarning.message}</p>
              <ErrorTechnicalDetails error={catalogWarning} />
            </div>
          ) : null}
          <div className="grid gap-2 border-t pt-4">
            <span className="text-muted-foreground text-xs font-medium">
              Or paste a collection reference
            </span>
            <Label htmlFor={`child-url-${parent.id}`}>Related collection URL</Label>
            <Input
              id={`child-url-${parent.id}`}
              type="url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setSelectedCollection(undefined);
                setNativeField('');
              }}
            />
          </div>
          <Label htmlFor={`child-name-${parent.id}`}>Node name</Label>
          <Input
            id={`child-name-${parent.id}`}
            type="text"
            value={name}
            placeholder={
              defaultNodeName
                ? `Defaults to ${defaultNodeName}`
                : 'Defaults to the collection label'
            }
            onChange={(event) => setName(event.target.value)}
          />

          {schemaQuery.isFetching ? (
            <p className="text-muted-foreground text-sm" role="status">
              Checking native relationships…
            </p>
          ) : null}
          {schemaQuery.error ? (
            <div>
              <p className="text-destructive text-sm">
                Could not inspect the related collection schema: {schemaQuery.error.message}
              </p>
              <Button type="button" variant="outline" onClick={() => void schemaQuery.refetch()}>
                Retry schema inspection
              </Button>
            </div>
          ) : null}
          {loadedChildSchema && nativeCandidates.length === 0 ? (
            <p className="bg-muted text-muted-foreground rounded-md p-3 text-sm" role="status">
              No native relationship targets this collection. Custom equality is selected.
            </p>
          ) : null}

          {nativeCandidates.length > 0 ? (
            <>
              <Label htmlFor={`relation-mode-${parent.id}`}>Relationship type</Label>
              <Select
                items={[
                  { label: 'Native relationship', value: 'native' },
                  { label: 'Custom equality', value: 'custom' },
                ]}
                value={mode}
                onValueChange={(nextMode) => {
                  if (nextMode !== null) setMode(nextMode);
                }}
              >
                <SelectTrigger className="w-full" id={`relation-mode-${parent.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="native">Native relationship</SelectItem>
                  <SelectItem value="custom">Custom equality</SelectItem>
                </SelectContent>
              </Select>
            </>
          ) : null}

          {effectiveMode === 'native' && nativeCandidates.length > 0 ? (
            <>
              <Label htmlFor={`native-field-${parent.id}`}>Native field</Label>
              <Select
                items={nativeCandidates.map((candidate) => ({
                  label: candidate.field.label,
                  value: candidate.field.id,
                }))}
                value={
                  nativeField ||
                  (nativeCandidates.length === 1 ? nativeCandidates[0]?.field.id : null) ||
                  null
                }
                onValueChange={(nextNativeField) => setNativeField(nextNativeField ?? '')}
              >
                <SelectTrigger className="w-full" id={`native-field-${parent.id}`}>
                  <SelectValue placeholder="Choose a field" />
                </SelectTrigger>
                <SelectContent>
                  {nativeCandidates.map((candidate) => (
                    <SelectItem key={candidate.field.id} value={candidate.field.id}>
                      {candidate.field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Label className="grid gap-2">
                Parent field path
                <Input
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
              </Label>
              <Label className="grid gap-2">
                Child field path
                <Input
                  type="text"
                  value={effectiveChildPath}
                  placeholder="e.g. parent.zuid"
                  onChange={(event) => setChildPath(event.target.value)}
                />
              </Label>
            </div>
          )}
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <Button type="submit" disabled={schemaQuery.isFetching || schemaQuery.isError}>
            Add collection node
          </Button>
        </form>
      </DialogContent>
    </Dialog>
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<DropdownMenuItem aria-label={`Edit relationship for ${node.name}`} />}
      >
        <Pencil size={12} />
        <span>Edit relationship</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" closeLabel="Close relationship editor">
        <DialogHeader className="pr-10 text-left">
          <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            Relationship
          </p>
          <DialogTitle>Repair {node.name}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <Label className="grid gap-2">
            Relationship type
            <Select
              items={[
                ...(nativeCandidates.length > 0
                  ? [{ label: 'Native relationship', value: 'native' as const }]
                  : []),
                { label: 'Custom equality', value: 'custom' as const },
              ]}
              value={mode}
              onValueChange={(nextMode) => {
                if (nextMode !== null) setMode(nextMode);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {nativeCandidates.length > 0 ? (
                  <SelectItem value="native">Native relationship</SelectItem>
                ) : null}
                <SelectItem value="custom">Custom equality</SelectItem>
              </SelectContent>
            </Select>
          </Label>
          {mode === 'native' ? (
            <Label className="grid gap-2">
              Native field
              <Select
                items={nativeCandidates.map((candidate) => ({
                  label: candidate.field.label,
                  value: candidate.field.id,
                }))}
                value={
                  nativeField ||
                  (relationship?.kind === 'native'
                    ? nativeCandidates.find((candidate) =>
                        sameNativeRelationship(candidate.relationship, relationship),
                      )?.field.id
                    : nativeCandidates.length === 1
                      ? nativeCandidates[0]?.field.id
                      : null) ||
                  null
                }
                onValueChange={(nextNativeField) => setNativeField(nextNativeField ?? '')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a field" />
                </SelectTrigger>
                <SelectContent>
                  {nativeCandidates.map((candidate) => (
                    <SelectItem key={candidate.field.id} value={candidate.field.id}>
                      {candidate.field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
          ) : (
            <Label className="grid gap-2">
              Parent field path
              <Input
                list={`edit-parent-paths-${node.id}`}
                value={parentPath}
                onChange={(event) => setParentPath(event.target.value)}
              />
              <datalist id={`edit-parent-paths-${node.id}`}>
                {schemaPaths(parentSchema).map((path) => (
                  <option key={path} value={path} />
                ))}
              </datalist>
            </Label>
          )}
          {mode === 'custom' ? (
            <Label className="grid gap-2">
              Child field path
              <Input
                list={`edit-child-paths-${node.id}`}
                value={childPath}
                onChange={(event) => setChildPath(event.target.value)}
              />
              <datalist id={`edit-child-paths-${node.id}`}>
                {childSchema
                  ? schemaPaths(childSchema).map((path) => <option key={path} value={path} />)
                  : null}
              </datalist>
            </Label>
          ) : null}
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <Button type="submit">Save relationship</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TreeNodeRow({
  node,
  root,
  onRename,
  onChangeRoot,
  onRemove,
  schemas,
  catalog,
  catalogError,
  catalogWarning,
  onRetryCatalog,
  loadSchema,
  onAdd,
  parent,
  onRelationshipChange,
}: {
  readonly node: CollectionNode;
  readonly root: CollectionNode;
  readonly onRename: TreeEditorProps['onRename'];
  readonly onChangeRoot: TreeEditorProps['onChangeRoot'];
  readonly onRemove: TreeEditorProps['onRemove'];
  readonly schemas: TreeEditorProps['schemas'];
  readonly catalog: TreeEditorProps['catalog'];
  readonly catalogError: TreeEditorProps['catalogError'];
  readonly catalogWarning: TreeEditorProps['catalogWarning'];
  readonly onRetryCatalog: TreeEditorProps['onRetryCatalog'];
  readonly loadSchema: TreeEditorProps['loadSchema'];
  readonly onAdd: TreeEditorProps['onAdd'];
  readonly parent?: CollectionNode;
  readonly onRelationshipChange: TreeEditorProps['onRelationshipChange'];
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.name);

  return (
    <li>
      <div
        className={`group flex min-h-9 items-center gap-2 rounded-md px-2 text-sm ${
          node.id === root.id ? 'bg-accent/60 font-medium' : 'hover:bg-accent/40'
        }`}
      >
        <span className="bg-primary size-1.5 shrink-0 rounded-full" />
        {editing ? (
          <Input
            className="h-7 min-w-0 flex-1"
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
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                aria-label={`Actions for ${node.name}`}
              />
            }
          >
            <MoreHorizontal size={15} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="right" keepMounted>
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <Pencil size={12} /> <span>Rename</span>
            </DropdownMenuItem>
            {node.id === root.id ? (
              <DropdownMenuItem onClick={onChangeRoot}>
                <Database size={12} /> <span>Change root collection</span>
              </DropdownMenuItem>
            ) : null}
            {parent && schemas.get(parent.id) ? (
              <EditRelationship
                node={node}
                parentSchema={schemas.get(parent.id)!}
                {...(schemas.get(node.id) ? { childSchema: schemas.get(node.id)! } : {})}
                onChange={onRelationshipChange}
              />
            ) : null}
            {node.id !== root.id ? (
              <DropdownMenuItem variant="destructive" onClick={() => onRemove(node.id)}>
                <Trash2 size={12} /> <span>Remove</span>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {schemas.get(node.id) ? (
        <AddRelationship
          parent={node}
          schema={schemas.get(node.id)!}
          catalog={catalog}
          catalogError={catalogError}
          catalogWarning={catalogWarning}
          onRetryCatalog={onRetryCatalog}
          loadSchema={loadSchema}
          onAdd={onAdd}
        />
      ) : null}
      {node.children.length > 0 ? (
        <ul className="border-border ml-3 border-l pl-2">
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              root={root}
              onRename={onRename}
              onChangeRoot={onChangeRoot}
              onRemove={onRemove}
              schemas={schemas}
              catalog={catalog}
              catalogError={catalogError}
              catalogWarning={catalogWarning}
              onRetryCatalog={onRetryCatalog}
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
  catalog,
  catalogError,
  catalogWarning,
  onRetryCatalog,
  loadSchema,
  onAdd,
  onRename,
  onChangeRoot,
  onRemove,
  onRelationshipChange,
}: TreeEditorProps) {
  const availableSchemas = schemas.size > 0 ? schemas : new Map([[root.id, rootSchema]]);
  return (
    <div className="flex h-full flex-col">
      <div className="text-muted-foreground flex items-center gap-2 px-2 py-3 text-xs font-semibold tracking-wider uppercase">
        <GitBranch size={15} aria-hidden="true" />
        <span>Collections</span>
      </div>
      <ul className="space-y-1">
        <TreeNodeRow
          node={root}
          root={root}
          onRename={onRename}
          onChangeRoot={onChangeRoot}
          onRemove={onRemove}
          schemas={availableSchemas}
          catalog={catalog}
          catalogError={catalogError}
          catalogWarning={catalogWarning}
          onRetryCatalog={onRetryCatalog}
          loadSchema={loadSchema}
          onAdd={onAdd}
          onRelationshipChange={onRelationshipChange}
        />
      </ul>
    </div>
  );
}
