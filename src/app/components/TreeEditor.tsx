import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, GitBranch, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { parseCollectionReference } from '../../collection-reference';
import type {
  CollectionNode,
  CollectionNodeId,
  CollectionCatalogEntry,
  CollectionReference,
  CollectionSchema,
  ModelZuid,
  RelationshipDefinition,
  ExplorerError,
} from '../../domain';
import {
  findNativeRelationshipCandidates,
  findNativeRelationships,
  sameNativeRelationship,
  viewTreeLimits,
  type RelatedCollections,
} from '../../explorer-core';
import { useFieldProblem } from '../hooks/useFieldProblem';
import {
  relatedCollectionsFor,
  relationshipSchemaQuery,
  type SchemaIndexState,
  type SchemaLoader,
} from '../hooks/useSchemaIndex';
import { RelatedCollectionsMenu } from './RelatedCollectionsMenu';
import { CollectionPicker } from './CollectionPicker';
import { ErrorTechnicalDetails } from './ErrorTechnicalDetails';
import { FieldPathInput } from './FieldPathInput';
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
import { Field, FieldLabel } from './ui/field';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface TreeEditorProps {
  readonly root: CollectionNode;
  /** Each loaded node's schema. A node without one can't list or add related collections yet. */
  readonly schemas: ReadonlyMap<CollectionNodeId, CollectionSchema>;
  readonly catalog: readonly CollectionCatalogEntry[];
  readonly catalogError: ExplorerError | undefined;
  readonly catalogWarning: ExplorerError | undefined;
  readonly onRetryCatalog: () => void;
  readonly loadSchema: SchemaLoader;
  readonly schemaIndex: SchemaIndexState;
  readonly onFindReferences: () => void;
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

// Both relationship forms need a parent and a child path for custom equality.
function missingPathProblem(
  parentPath: string,
  childPath: string,
): { readonly field: 'parent-path' | 'child-path'; readonly message: string } | undefined {
  if (!parentPath.trim()) return { field: 'parent-path', message: 'Enter a parent field path.' };
  if (!childPath.trim()) return { field: 'child-path', message: 'Enter a child field path.' };
  return undefined;
}

function AddRelationship({
  open,
  onOpenChange,
  parent,
  schema,
  catalog,
  catalogError,
  catalogWarning,
  onRetryCatalog,
  loadSchema,
  onAdd,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly parent: CollectionNode;
  readonly schema: CollectionSchema;
  readonly catalog: TreeEditorProps['catalog'];
  readonly catalogError: TreeEditorProps['catalogError'];
  readonly catalogWarning: TreeEditorProps['catalogWarning'];
  readonly onRetryCatalog: TreeEditorProps['onRetryCatalog'];
  readonly loadSchema: TreeEditorProps['loadSchema'];
  readonly onAdd: TreeEditorProps['onAdd'];
}) {
  const [url, setUrl] = useState('');
  const [selectedCollection, setSelectedCollection] = useState<CollectionCatalogEntry>();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'native' | 'custom'>('native');
  const [nativeField, setNativeField] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [childPath, setChildPath] = useState('');
  const [rejection, setRejection] = useState<string>();
  const collectionInput = useRef<HTMLInputElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const nativeFieldTrigger = useRef<HTMLButtonElement>(null);
  const parentPathInput = useRef<HTMLInputElement>(null);
  const childPathInput = useRef<HTMLInputElement>(null);
  const problem = useFieldProblem({
    'related-collection': collectionInput,
    'related-url': urlInput,
    'native-field': nativeFieldTrigger,
    'parent-path': parentPathInput,
    'child-path': childPathInput,
  });
  const parsed = useMemo(() => parseCollectionReference(url), [url]);
  const selectedReference = selectedCollection?.reference ?? (parsed.ok ? parsed.value : undefined);
  const referenceAllowed =
    selectedReference !== undefined &&
    selectedReference.instanceZuid === parent.reference.instanceZuid &&
    selectedReference.deployment === parent.reference.deployment;
  const queryClient = useQueryClient();
  const schemaQueryOptions = relationshipSchemaQuery(selectedReference, loadSchema, 'dialog');
  const schemaQueryKey = schemaQueryOptions.queryKey;
  const schemaQuery = useQuery({
    ...schemaQueryOptions,
    enabled: open && referenceAllowed,
    // Starts from the index's copy unless a Refresh has made it stale.
    initialData: () => {
      const indexed = queryClient.getQueryState(
        relationshipSchemaQuery(selectedReference, loadSchema, 'index').queryKey,
      );
      return indexed && !indexed.isInvalidated ? indexed.data : undefined;
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
    setRejection(undefined);
    if (!selectedReference && url.trim() && !parsed.ok) {
      problem.report('related-url', parsed.error.message);
      return;
    }
    if (!selectedReference) {
      problem.report('related-collection', 'Choose a related collection.');
      return;
    }
    if (!referenceAllowed) {
      problem.report(
        'related-url',
        'Every collection node must belong to the root instance and deployment.',
      );
      return;
    }

    let relationship: RelationshipDefinition;
    if (effectiveMode === 'native' && nativeCandidates.length > 0) {
      const selected =
        nativeCandidates.find((candidate) => candidate.field.id === nativeField) ??
        nativeCandidates[0];
      if (!selected || (nativeCandidates.length > 1 && !nativeField)) {
        problem.report('native-field', 'Choose which native relationship field this role uses.');
        return;
      }
      relationship = selected.relationship;
    } else {
      const missingPath = missingPathProblem(parentPath, effectiveChildPath);
      if (missingPath) {
        problem.report(missingPath.field, missingPath.message);
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
    const addRejection = onAdd(parent.id, selectedReference, nodeName, relationship);
    if (addRejection) {
      setRejection(addRejection);
      return;
    }
    onOpenChange(false);
    setUrl('');
    setSelectedCollection(undefined);
    setName('');
    setRejection(undefined);
    problem.clear();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) void queryClient.cancelQueries({ queryKey: schemaQueryKey, exact: true });
      }}
    >
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
        <form className="grid gap-4" noValidate onSubmit={submit}>
          <CollectionPicker
            label="Related collection"
            collections={catalog}
            value={selectedReference?.modelZuid}
            error={problem.messageFor('related-collection')}
            inputRef={collectionInput}
            onChange={(collection) => {
              problem.clear();
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
            <Field error={problem.messageFor('related-url')}>
              <FieldLabel>Related collection URL</FieldLabel>
              <Input
                ref={urlInput}
                type="url"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setSelectedCollection(undefined);
                  setNativeField('');
                  problem.clear();
                }}
              />
            </Field>
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
            <Field error={problem.messageFor('native-field')}>
              <FieldLabel>Native field</FieldLabel>
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
                onValueChange={(nextNativeField) => {
                  setNativeField(nextNativeField ?? '');
                  problem.clear('native-field');
                }}
              >
                <SelectTrigger ref={nativeFieldTrigger} className="w-full">
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
            </Field>
          ) : (
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <FieldPathInput
                label="Parent field path"
                value={parentPath}
                onValueChange={(value) => {
                  setParentPath(value);
                  problem.clear('parent-path');
                }}
                paths={schemaPaths(schema)}
                placeholder="e.g. category.zuid"
                error={problem.messageFor('parent-path')}
                inputRef={parentPathInput}
              />
              <FieldPathInput
                label="Child field path"
                value={effectiveChildPath}
                onValueChange={(value) => {
                  setChildPath(value);
                  problem.clear('child-path');
                }}
                paths={loadedChildSchema ? schemaPaths(loadedChildSchema) : []}
                placeholder="e.g. parent.zuid"
                error={problem.messageFor('child-path')}
                inputRef={childPathInput}
              />
            </div>
          )}
          {rejection ? (
            <p className="text-destructive text-sm" role="alert">
              {rejection}
            </p>
          ) : null}
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
  const nativeFieldTrigger = useRef<HTMLButtonElement>(null);
  const parentPathInput = useRef<HTMLInputElement>(null);
  const childPathInput = useRef<HTMLInputElement>(null);
  const problem = useFieldProblem({
    'native-field': nativeFieldTrigger,
    'parent-path': parentPathInput,
    'child-path': childPathInput,
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missingPath = mode === 'custom' ? missingPathProblem(parentPath, childPath) : undefined;
    if (missingPath) {
      problem.report(missingPath.field, missingPath.message);
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
      problem.report('native-field', 'Choose which native relationship field this role uses.');
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
    problem.clear();
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
        <form className="grid gap-4" noValidate onSubmit={submit}>
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
            <Field error={problem.messageFor('native-field')}>
              <FieldLabel>Native field</FieldLabel>
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
                onValueChange={(nextNativeField) => {
                  setNativeField(nextNativeField ?? '');
                  problem.clear('native-field');
                }}
              >
                <SelectTrigger ref={nativeFieldTrigger} className="w-full">
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
            </Field>
          ) : (
            <>
              <FieldPathInput
                label="Parent field path"
                value={parentPath}
                onValueChange={(value) => {
                  setParentPath(value);
                  problem.clear('parent-path');
                }}
                paths={schemaPaths(parentSchema)}
                error={problem.messageFor('parent-path')}
                inputRef={parentPathInput}
              />
              <FieldPathInput
                label="Child field path"
                value={childPath}
                onValueChange={(value) => {
                  setChildPath(value);
                  problem.clear('child-path');
                }}
                paths={childSchema ? schemaPaths(childSchema) : []}
                error={problem.messageFor('child-path')}
                inputRef={childPathInput}
              />
            </>
          )}
          <Button type="submit">Save relationship</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** What every node's related-collections chip needs, computed once per tree. */
interface RelatedContext {
  readonly collections: RelatedCollections;
  readonly catalogByModel: ReadonlyMap<ModelZuid, CollectionCatalogEntry>;
  readonly schemaIndex: SchemaIndexState;
  readonly catalogError: ExplorerError | undefined;
  readonly onFindReferences: () => void;
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
  related,
  level,
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
  readonly related: RelatedContext;
  /** 1 for the root. Nothing can be added below the deepest level a view allows. */
  readonly level: number;
}) {
  const [editing, setEditing] = useState(false);
  const [addingOther, setAddingOther] = useState(false);
  const [name, setName] = useState(node.name);
  // Rename hands focus to the name field instead of back to the menu button, and Enter or Escape
  // hands it back.
  const actionsButton = useRef<HTMLButtonElement>(null);
  const renaming = useRef(false);
  // Escape moves focus away, which blurs the field; the blur must not save the cancelled name.
  const renameCancelled = useRef(false);

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
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              if (!renameCancelled.current) onRename(node.id, name);
              renameCancelled.current = false;
              setEditing(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                // Without this, Enter's keypress would also press the button focused below.
                event.preventDefault();
                event.currentTarget.blur();
                actionsButton.current?.focus();
              }
              if (event.key === 'Escape') {
                renameCancelled.current = true;
                setName(node.name);
                setEditing(false);
                actionsButton.current?.focus();
              }
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        )}
        {schemas.get(node.id) && level < viewTreeLimits.levels ? (
          <RelatedCollectionsMenu
            root={root}
            node={node}
            collections={related.collections}
            catalogByModel={related.catalogByModel}
            schemaIndex={related.schemaIndex}
            catalogError={related.catalogError}
            onFindReferences={related.onFindReferences}
            onAdd={onAdd}
            onChooseOther={() => setAddingOther(true)}
            keepVisible={addingOther}
          />
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                ref={actionsButton}
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
                aria-label={`Actions for ${node.name}`}
              />
            }
          >
            <MoreHorizontal size={15} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="right"
            keepMounted
            finalFocus={() => {
              const restore = !renaming.current;
              renaming.current = false;
              return restore;
            }}
          >
            <DropdownMenuItem
              onClick={() => {
                renaming.current = true;
                setEditing(true);
              }}
            >
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
          open={addingOther}
          onOpenChange={setAddingOther}
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
              related={related}
              level={level + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function TreeEditor({
  root,
  schemas,
  catalog,
  catalogError,
  catalogWarning,
  onRetryCatalog,
  loadSchema,
  schemaIndex,
  onFindReferences,
  onAdd,
  onRename,
  onChangeRoot,
  onRemove,
  onRelationshipChange,
}: TreeEditorProps) {
  const linked = useMemo(
    () => relatedCollectionsFor(root.reference, catalog, schemaIndex, schemas),
    [catalog, root.reference, schemaIndex, schemas],
  );
  const related: RelatedContext = { ...linked, schemaIndex, catalogError, onFindReferences };
  return (
    <div className="flex flex-col">
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
          schemas={schemas}
          catalog={catalog}
          catalogError={catalogError}
          catalogWarning={catalogWarning}
          onRetryCatalog={onRetryCatalog}
          loadSchema={loadSchema}
          onAdd={onAdd}
          onRelationshipChange={onRelationshipChange}
          related={related}
          level={1}
        />
      </ul>
    </div>
  );
}
