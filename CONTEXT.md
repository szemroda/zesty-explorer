# Zesty Explorer

Zesty Explorer is a read-only browser for examining content from Zesty across related collections. A team member supplies their own credentials, while views can be shared without credentials.

## Language

**View**:
A shareable definition of selected collections, relationships, filters, and presentation settings from one Zesty instance. A view never contains a session token.
_Avoid_: Configuration, query

**Session token**:
The private `APP_SID` value copied from a team member's logged-in Zesty session. It carries that user's permissions, is kept only for the local browser session, and is never part of a view.
_Avoid_: Access token, API key, credential URL parameter

**Instance**:
A Zesty project that owns the collections available to one view.
_Avoid_: Workspace, site

**Instance reference**:
A Zesty Manager or Instances API URL that identifies an instance and may also identify a collection or content item within it.
_Avoid_: Collection reference when no collection is identified, instance link

**Zesty deployment**:
The production, stage, or development Zesty infrastructure selected by an instance reference. Every collection node in a view belongs to the same deployment.
_Avoid_: Content state, environment

**Collection**:
A set of Zesty content items that share one content model.
_Avoid_: Table, dataset

**Collection catalog**:
The complete set of collections available to a user's session within one instance, including collections that contain no content items.
_Avoid_: Content navigation, non-empty collections

**Incomplete collection catalog**:
A collection catalog that omits one or more records because their API representation could not be understood. It remains usable but carries an explicit warning.
_Avoid_: Partial collection, complete catalog

**Block collection**:
A collection whose Zesty content model represents reusable visual content. It belongs to the collection catalog but is distinguished from other collections when users choose one.
_Avoid_: Block, component collection

**Unrecognized collection type**:
A collection type returned by Zesty that Zesty Explorer does not understand. Its collection remains selectable, but the application has no trusted Manager navigation target for it.
_Avoid_: Invalid collection, unsupported collection

**Collection picker**:
The searchable control for selecting a collection from a collection catalog. It displays collection labels while retaining technical names and model identifiers to distinguish similar collections.
_Avoid_: Dropdown, model selector

**Uncatalogued collection**:
A collection identified by a valid collection reference but absent from the collection catalog available to the current session. Its absence does not prove that the collection is missing or inaccessible.
_Avoid_: Deleted collection, forbidden collection, missing model

**Collection reference**:
A Zesty Manager URL or Instances API URL that uniquely identifies a collection and its instance.
_Avoid_: Collection link, endpoint input

**Content item**:
One record belonging to a collection.
_Avoid_: Row, entry, element

**Content field**:
A field defined by a collection's Zesty content model. Content fields are visible in a table by default.
_Avoid_: Property, column

**Technical metadata**:
System-managed identifiers, version data, timestamps, and API bookkeeping attached to a content item. Technical metadata and raw JSON are hidden in a table by default but remain available in item details.
_Avoid_: Content field

**Root collection**:
The collection whose content items form the top level of a view. Every other collection is attached beneath it in an acyclic tree.
_Avoid_: Main table, primary dataset

**Collection node**:
One use of a collection at a specific position and role in a view's relationship tree. The same collection may have several nodes with different stable names, relationships, filters, columns, and sorting.
_Avoid_: Collection, table instance

**Relationship**:
A directed parent-child connection between two collections in a view. It may come from the Zesty model or from a rule defined in the view.
_Avoid_: Connection, link, join

**Custom relationship**:
A relationship created by testing one scalar field path from the parent collection for strict equality with one scalar field path from the child collection. It does not coerce values between types.
_Avoid_: Manual join

**Related items**:
The complete list of child content items matched by a relationship for one parent item. The list may be empty, and the same child item may appear beneath more than one parent.
_Avoid_: Joined rows, owned items

**Content state**:
The single version policy applied to every collection in a view. It is either latest saved or published.
_Avoid_: Environment, mode

**Latest saved**:
The most recently saved version of each content item, whether published or not. This is the default content state.
_Avoid_: Draft

**Published**:
The currently active version of each content item that is available from Zesty's live environment.
_Avoid_: Production mode, active-only

**Partial collection**:
A collection for which the view loaded only the first 10,000 content items. Results and filters involving it are explicitly marked as incomplete.
_Avoid_: Complete collection, failed collection

**View filter**:
A condition evaluated for each root content item against its content fields and related items. A matching root item retains its complete set of related items.
_Avoid_: Table filter, join condition

**Table filter**:
A condition attached to one collection node that limits the rows shown by every table for that node without removing rows from its ancestors. It may inspect that node's content fields and related items below it.
_Avoid_: View filter, per-parent filter
