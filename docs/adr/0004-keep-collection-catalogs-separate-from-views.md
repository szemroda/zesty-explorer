---
status: accepted
---

# Keep collection catalogs separate from views

A view keeps its collection references independently of the collection catalog available to the current session. The catalog helps users make new choices, but it does not validate, rewrite, or remove collections from an existing view. This preserves shared views across permission and schema changes; when a referenced collection is unavailable, the application reports its load failure at the existing error boundary.

## Consequences

- The collection catalog is credential-scoped and is never serialized into a view.
- Refreshing the catalog cannot remove collection nodes or reset view settings.
- A view may reference a collection that the current session cannot see in the catalog.
- A catalog request failure does not block an already loaded view.
