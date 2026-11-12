import { ArrowLeft, ArrowRight, Plus } from 'lucide-react';
import { useState } from 'react';
import type {
  CollectionCatalogEntry,
  CollectionNode,
  CollectionReference,
  ExplorerError,
  ModelZuid,
  RelationshipDefinition,
} from '../../domain';
import {
  relatedSuggestions,
  viewTreeLimits,
  type RelatedCollections,
  type RelatedSuggestion,
} from '../../explorer-core';
import type { SchemaIndexState } from '../hooks/useSchemaIndex';
import { flattenCollectionNodes } from '../load-view';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

interface RelatedCollectionsMenuProps {
  readonly root: CollectionNode;
  readonly node: CollectionNode;
  readonly collections: RelatedCollections;
  readonly catalogByModel: ReadonlyMap<ModelZuid, CollectionCatalogEntry>;
  /** Finding the collections that reference this one needs every schema in the catalog. */
  readonly schemaIndex: SchemaIndexState;
  readonly catalogError: ExplorerError | undefined;
  readonly onFindReferences: () => void;
  readonly onAdd: (
    parentId: CollectionNode['id'],
    reference: CollectionReference,
    name: string,
    relationship: RelationshipDefinition,
  ) => string | undefined;
  readonly onChooseOther: () => void;
  /** Keeps the chip shown, e.g. while a dialog opened from it will return focus to it. */
  readonly keepVisible: boolean;
}

/** The "+N" chip on a tree node: adds the collections it contains or is referenced by. */
export function RelatedCollectionsMenu({
  root,
  node,
  collections,
  catalogByModel,
  schemaIndex,
  catalogError,
  onFindReferences,
  onAdd,
  onChooseOther,
  keepVisible,
}: RelatedCollectionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [rejection, setRejection] = useState<string>();
  const suggestions = relatedSuggestions(root, node.id, collections, schemaIndex.done).filter(
    ({ link }) => catalogByModel.has(link.modelZuid),
  );
  const contains = suggestions.filter(({ link }) => link.relationship.fieldSide === 'parent');
  const referencedBy = suggestions.filter(({ link }) => link.relationship.fieldSide === 'child');
  const full = flattenCollectionNodes(root).length >= viewTreeLimits.nodes;

  function add({ link, name }: RelatedSuggestion) {
    const entry = catalogByModel.get(link.modelZuid);
    if (!entry) return;
    setRejection(onAdd(node.id, entry.reference, name, link.relationship));
  }

  const section = (title: string, content: React.ReactNode) => (
    <section className="grid gap-0.5" aria-label={title}>
      <h3 className="text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider uppercase">
        {title}
      </h3>
      {content}
    </section>
  );
  const note = (text: string) => <p className="text-muted-foreground px-2 pb-1 text-xs">{text}</p>;
  const rows = (items: readonly RelatedSuggestion[], empty: string) =>
    items.length === 0
      ? note(empty)
      : items.map((suggestion) => (
          <button
            key={`${suggestion.link.relationship.fieldSide}:${suggestion.link.modelZuid}:${suggestion.link.field.name}`}
            type="button"
            disabled={full}
            onClick={() => add(suggestion)}
            className="hover:bg-accent focus-visible:bg-accent group/item grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 rounded-md px-2 py-1.5 text-left text-sm outline-none disabled:pointer-events-none disabled:opacity-50"
          >
            {suggestion.link.relationship.fieldSide === 'parent' ? (
              <ArrowRight size={13} className="text-primary" aria-hidden="true" />
            ) : (
              <ArrowLeft size={13} className="text-amber-400" aria-hidden="true" />
            )}
            <span className="truncate">{suggestion.name}</span>
            <Plus
              size={13}
              className="text-muted-foreground opacity-0 group-hover/item:opacity-100 group-focus-visible/item:opacity-100"
              aria-hidden="true"
            />
            <span className="text-muted-foreground col-start-2 truncate text-xs">
              {suggestion.link.relationship.fieldSide === 'parent'
                ? `via ${suggestion.link.field.label}`
                : `via ${collections.labels.get(suggestion.link.modelZuid) ?? suggestion.link.modelZuid}.${suggestion.link.field.label}`}
            </span>
          </button>
        ));

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setRejection(undefined);
        // Enabling the index also reloads schemas a Refresh left stale while it was idle.
        if (nextOpen) onFindReferences();
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'text-muted-foreground h-6 shrink-0 gap-0.5 px-1.5 text-xs tabular-nums',
              // Below the root it appears on hover, so long node names keep their width.
              node.id !== root.id &&
                !keepVisible &&
                'hidden group-focus-within:inline-flex group-hover:inline-flex data-popup-open:inline-flex pointer-coarse:inline-flex',
            )}
            aria-label={`Add related collections to ${node.name}`}
          />
        }
      >
        <Plus size={12} aria-hidden="true" />
        {suggestions.length > 0 ? suggestions.length : null}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        className="grid max-h-[70vh] w-72 gap-1 overflow-y-auto p-1.5"
      >
        <p className="px-2 pt-1 text-sm font-semibold">Add below {node.name}</p>
        {full ? (
          <p className="text-muted-foreground px-2 text-xs" role="status">
            The view has {viewTreeLimits.nodes} collections, the most it can show. Remove one to add
            another.
          </p>
        ) : null}
        {section('Contains', rows(contains, 'Every collection it links to is already shown.'))}
        {section(
          'Referenced by',
          schemaIndex.done ? (
            <>
              {rows(referencedBy, 'No other collection links to it, or they are already shown.')}
              {schemaIndex.failed > 0
                ? note(
                    `${schemaIndex.failed} ${schemaIndex.failed === 1 ? 'collection' : 'collections'} could not be checked.`,
                  )
                : null}
            </>
          ) : catalogError ? (
            note(`The collection catalog did not load: ${catalogError.message}`)
          ) : (
            <p className="text-muted-foreground px-2 pb-1 text-xs" role="status">
              Checking collections…
              {schemaIndex.total > 0 ? ` ${schemaIndex.settled} of ${schemaIndex.total}` : ''}
            </p>
          ),
        )}
        {rejection ? (
          <p className="text-destructive px-2 text-xs" role="alert">
            {rejection}
          </p>
        ) : null}
        <div className="mt-1 border-t pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground w-full justify-start text-xs"
            onClick={() => {
              setOpen(false);
              onChooseOther();
            }}
          >
            Other collection or custom relationship…
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
