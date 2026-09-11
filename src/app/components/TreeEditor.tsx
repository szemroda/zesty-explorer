import { Dialog } from '@base-ui/react/dialog';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
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
  readonly onAdd: (
    parentId: CollectionNodeId,
    reference: CollectionReference,
    name: string,
    relationship: RelationshipDefinition,
  ) => string | undefined;
  readonly onRename: (nodeId: CollectionNodeId, name: string) => void;
  readonly onRemove: (nodeId: CollectionNodeId) => void;
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
    }

    const problem = onAdd(parent.id, parsed.value, name || parsed.value.modelZuid, relationship);
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
        <Plus size={13} /> Add related collection
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
                  <select
                    value={parentPath}
                    onChange={(event) => setParentPath(event.target.value)}
                  >
                    <option value="">Choose a field</option>
                    {schema.fields.map((field) => (
                      <option key={field.id} value={field.name}>
                        {field.label}
                      </option>
                    ))}
                  </select>
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

function TreeNodeRow({
  node,
  root,
  onRename,
  onRemove,
}: {
  readonly node: CollectionNode;
  readonly root: CollectionNode;
  readonly onRename: TreeEditorProps['onRename'];
  readonly onRemove: TreeEditorProps['onRemove'];
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
      <div className="tree-node">
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
          />
        ) : (
          <span>{node.name}</span>
        )}
        <button
          className="tree-icon"
          aria-label={`Rename ${node.name}`}
          onClick={() => setEditing(true)}
        >
          <Pencil size={12} />
        </button>
        {node.id !== root.id ? (
          <button className="tree-icon" aria-label={`Remove ${node.name}`} onClick={remove}>
            <Trash2 size={12} />
          </button>
        ) : null}
      </div>
      {node.children.length > 0 ? (
        <ul className="tree-children">
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              root={root}
              onRename={onRename}
              onRemove={onRemove}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function TreeEditor({ root, rootSchema, onAdd, onRename, onRemove }: TreeEditorProps) {
  return (
    <div>
      <ul className="tree-list">
        <TreeNodeRow node={root} root={root} onRename={onRename} onRemove={onRemove} />
      </ul>
      <AddRelationship parent={root} schema={rootSchema} onAdd={onAdd} />
    </div>
  );
}
