---
status: accepted
---

# Share state as versioned URL fragments

The shareable state of both tabs is encoded as one versioned, compressed payload in the `#view=` URL fragment and kept current with `history.replaceState`. It includes the instance, deployment, active tab, Explorer view, and the Code tab's selected file and code state. The application has no backend to store views, so the link is both the persistence and the sharing mechanism, and a fragment is never sent in HTTP requests.

## Consequences

- Every released payload version must stay decodable. A new version adds a migration, and golden fixtures from older versions guard compatibility.
- An invalid, truncated, or unsupported payload is never silently reset. The user can copy the raw data or reset explicitly.
- The payload excludes the session token ([ADR 0007](./0007-keep-the-session-token-tab-scoped.md)), code source, page numbers, expanded rows, open panels, and loading state.
- A Code link selects the current file version in its code state instead of pinning a historical version.
- Editing a view does not add browser-history entries, so Back does not undo view changes.
- Large views produce long links. The application warns about them instead of shortening them.
