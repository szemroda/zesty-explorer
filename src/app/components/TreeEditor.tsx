import { Dialog } from '@base-ui/react/dialog';
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
import { findNativeRelationships, subtreeNodeNames } from '../../explorer-core';

interface TreeEditorProps {
  readonly root: CollectionNode;
  readonly rootSchema: CollectionSchema;
  readonly schemas: ReadonlyMap<CollectionNodeId, CollectionSchema>;
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

function AddRelationship({
  parent,
  schema,
  onAdd,
}: {
  readonly parent: CollectionNode;
  readonly schema: CollectionSchema;
  readonly onAdd: TreeEditorProps['onAdd'];
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'native' | 'custom'>('native');
  const [nativeField, setNativeField] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [childPath, setChildPath] = useState('');
  const [error, setError] = useState<string>();
  const parsed = useMemo(() => parseCollectionReference(url), [url]);
  const nativeFields = parsed.ok ? findNativeRelationships(schema, parsed.value.modelZuid) : [];

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parsed.ok) {
      setError(parsed.error.message);
      return;
    }

    let relationship: RelationshipDefinition;
    let defaultName: string;
    if (mode === 'native' && nativeFields.length > 0) {
      const selected = nativeFields.find((field) => field.name === nativeField) ?? nativeFields[0];
      if (!selected || (nativeFields.length > 1 && !nativeField)) {
        setError('Choose which native relationship field this role uses.');
        return;
      }
      relationship = {
        kind: 'native',
        parentField: [selected.name],
        targetModelZuid: parsed.value.modelZuid,
      };
      defaultName = selected.label;
    } else {
      if (!parentPath.trim() || !childPath.trim()) {
        setError('Choose a parent field path and enter a child field path.');
        return;
      }
      relationship = {
        kind: 'custom',
        parentField: parentPath.split('.').filter(Boolean),
        childField: childPath.split('.').filter(Boolean),
      };
      defaultName =
        schema.fields.find((field) => field.name === relationship.parentField[0])?.label ??
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
    <Dialog.Root open={open} onOpenChange={setOpen}>
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
              onChange={(event) => setUrl(event.target.value)}
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

            {nativeFields.length > 0 ? (
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

            {mode === 'native' && nativeFields.length > 0 ? (
              <>
                <label className="field-label" htmlFor={`native-field-${parent.id}`}>
                  Native field
                </label>
                <select
                  id={`native-field-${parent.id}`}
                  value={nativeField}
                  onChange={(event) => setNativeField(event.target.value)}
                >
                  {nativeFields.length > 1 ? <option value="">Choose a field</option> : null}
                  {nativeFields.map((field) => (
                    <option key={field.id} value={field.name}>
                      {field.label}
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
            <button className="button button--primary" type="submit">
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
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'native' | 'custom'>(relationship?.kind ?? 'custom');
  const [parentPath, setParentPath] = useState(relationship?.parentField.join('.') ?? '');
  const [childPath, setChildPath] = useState(
    relationship?.kind === 'custom' ? relationship.childField.join('.') : 'id',
  );
  const [error, setError] = useState<string>();
  const nativeFields = findNativeRelationships(parentSchema, node.reference.modelZuid);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parentPath.trim() || (mode === 'custom' && !childPath.trim())) {
      setError('Choose both relationship field paths.');
      return;
    }
    const next: RelationshipDefinition =
      mode === 'native'
        ? {
            kind: 'native',
            parentField: parentPath.split('.').filter(Boolean),
            targetModelZuid: node.reference.modelZuid,
          }
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
                {nativeFields.length > 0 ? (
                  <option value="native">Native relationship</option>
                ) : null}
                <option value="custom">Custom equality</option>
              </select>
            </label>
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
  onAdd,
  parent,
  onRelationshipChange,
}: {
  readonly node: CollectionNode;
  readonly root: CollectionNode;
  readonly onRename: TreeEditorProps['onRename'];
  readonly onRemove: TreeEditorProps['onRemove'];
  readonly schemas: TreeEditorProps['schemas'];
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
        <AddRelationship parent={node} schema={schemas.get(node.id)!} onAdd={onAdd} />
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
          onAdd={onAdd}
          onRelationshipChange={onRelationshipChange}
        />
      </ul>
    </div>
  );
}
