# Zesty Explorer product specification

Status: Implemented
Date: 2026-09-11

## Outcome

Zesty Explorer is a local, read-only React application for browsing one Zesty instance across related collections. It lets a user build a rooted relationship tree, inspect the resulting nested tables, filter at the view or table level, and share the complete non-secret view through the browser URL.

## Product constraints

- Users clone the repository, install dependencies with pnpm, and run the application on the canonical browser origin `http://localhost:5173`. The literal hostname is required by the Zesty Instances API CORS policy; `127.0.0.1` and `[::1]` are not supported browser origins.
- The development server binds only to IPv4 loopback, opens `http://localhost:5173`, and fails if port `5173` is unavailable. Requests opened through `http://127.0.0.1:5173` are redirected to `localhost` before application startup while preserving the path, query, and fragment. The IPv6 loopback address `[::1]` is unsupported and is not served.
- The application calls the Zesty Instances API directly. It has no backend and is not deployed to Vercel.
- The application is read-only. It never writes content, models, relationships, or settings to Zesty.
- The interface, source code, documentation, errors, and test names use English.
- The interface is dark-only, compact, desktop-only, and supports current Chrome and Edge.
- The application sends no analytics, telemetry, error reports, fonts, scripts, or other runtime requests outside Zesty.
- Installed npm dependencies are allowed and are bundled locally by Vite.

## Security model

The user manually supplies the session token stored in the Zesty Manager cookie for the selected Zesty deployment:

| Zesty deployment | Cookie name     |
| ---------------- | --------------- |
| Production       | `APP_SID`       |
| Stage            | `STAGE_APP_SID` |
| Development      | `DEV_APP_SID`   |

- The token is sent to the Instances API as `Authorization: Bearer <token>`.
- The HTTP transport disables distributed trace propagation so browser requests do not add the `b3` or `traceparent` headers rejected by Zesty's CORS preflight.
- The token is stored only in `sessionStorage` and is never included in the URL, application logs, test output, fixtures, clipboard-generated view links, or error details.
- The token has the logged-in user's Zesty permissions. The UI describes it as a session token, not a read-only token.
- The helper beside the token input explains how to copy the correct cookie and warns the user not to share it.
- `Clear session token` removes the token, preserves the view, and requires confirmation.
- A `401` response clears the token, preserves the view, opens the token form, and retries loading after the user supplies a new token.
- The application performs only `GET` and preflight requests.

Collection input is treated as untrusted. The parser accepts only a closed set of Zesty host and path shapes. It extracts and validates ZUIDs, identifies the deployment, then constructs the Instances API host itself. It never sends the token to a host copied directly from user input.

Supported Manager and API host mappings:

| Deployment  | Manager host suffix                                       | Instances API host suffix |
| ----------- | --------------------------------------------------------- | ------------------------- |
| Production  | `.manager.zesty.io`, `.cms.content.one`                   | `.api.zesty.io/v1`        |
| Stage       | `.manager.stage.zesty.io`, `.cms.stage.content.one`       | `.api.stage.zesty.io/v1`  |
| Development | `.manager.dev.zesty.io:8080`, `.cms.dev.content.one:8080` | `.api.dev.zesty.io/v1`    |

Unknown hosts are rejected without a network request and cannot be overridden by the user.

## Starting a view

The initial screen contains:

1. A password-style `Zesty session token` input with reveal and help actions.
2. A `Root collection URL` input with accepted examples and a help action.
3. An `Open collection` action.

The collection input accepts:

- a Zesty Manager collection URL at `/content/:modelZUID` or `/blocks/:modelZUID`;
- a Zesty Manager item URL at `/content/:modelZUID/:itemZUID` or `/blocks/:modelZUID/:itemZUID`;
- a full Instances API collection URL.

Query parameters, fragments, trailing slashes, and known item-editor suffixes may be present. Paths for `new`, `import`, or a collection area without a model ZUID are rejected. When an item URL is supplied, the application opens its collection and then opens that item's details.

## Content state

One content state applies to every collection node in a view:

- `Latest saved` is the default. The application requests the newest saved version of every content item, whether that version is published or not.
- `Published` requests only the currently active version by adding `_active=true`.

For example, if an item has published version 1 and saved, unpublished version 2, Latest saved shows version 2 and Published shows version 1. An item that has never been published appears only in Latest saved.

The `Published only` checkbox changes the state for the entire view and reloads every collection. All requests use `lang=en-US`.

## View model

- A view has one root collection and an acyclic tree of collection nodes.
- Every node belongs to the same Zesty instance and Zesty deployment.
- The maximum relationship depth is five levels.
- A view contains at most ten collection nodes.
- The same collection may appear in several nodes, such as Author and Reviewer. Its data is fetched once, while each node owns its name, relationship, filters, columns, and sort.
- A new node uses the child collection label by default, regardless of the relationship field or relationship type. If the collection is absent from the catalog, its model ZUID is the fallback. The default may be replaced with a custom node name, duplicate node names are allowed, and names restored from existing views are never recalculated.
- Attempting to add a collection from another instance or deployment is rejected before a request is sent.
- Changing the root is a view reset. The application lists the nodes and settings that will be removed and requires confirmation.
- Removing a node also removes its descendants and their presentation state. The confirmation lists everything that will be removed.

`Reset view` clears the tree and URL state while preserving the session token. It requires confirmation.

## Relationships

The `Add related collection` action belongs to a parent collection node. The user chooses the child collection from the catalog or supplies its collection URL. The node-name field remains empty until the user enters a custom name and shows the current default in its placeholder. Custom names are trimmed; whitespace-only input uses the default.

- The application reads both Zesty models and proposes native relationships declared on either the parent or child collection.
- If several native relationship fields target the same model, the user must choose one. The application does not guess.
- When no suitable native relationship exists, the user creates a custom relationship by choosing one field path on the parent and one on the child.
- A custom relationship supports nested scalar field paths and strict equality only.
- A number does not match its string representation. Values are never coerced.
- Custom array matching, JavaScript expressions, regexes, and normalization functions are not supported.
- A parent retains every matching child as related items.
- A parent with no match remains in the result with an empty related-items list.
- The same child may appear under several parents.
- The custom relationship form does not calculate or show match statistics before saving.

Relationship and filter paths that become invalid after a Zesty schema change remain in the URL and are marked as invalid. The rest of the view continues to load and the user can repair the path.

## Filtering

### View filters

A view filter decides which root content items appear. It may inspect any content field or related item in the tree.

- A nested one-to-many predicate uses `any` semantics.
- A root item that matches through a related item keeps its complete, unfiltered related-items list.
- The global free-text search covers content fields in the root and related items.
- Free-text matching is case-insensitive and strips HTML tags before comparison.
- Technical metadata and raw JSON are excluded from free-text search.

### Table filters

Every root or nested table has its own free-text input, column filters, and path-based filter builder. A table filter limits rows in that collection node without removing ancestor rows.

- One table-filter state is shared by every rendered occurrence of the same collection node.
- A table filter may inspect descendants below its node using the same `any` semantics.
- Filtering a nested table does not mutate the underlying related-items list.

### Filter builder and operators

Users build filters by choosing a relationship path, field, operator, and value. The application never evaluates user-provided JavaScript.

- Text: `contains`, `equals`, `starts with`, `is empty`, `is not empty`.
- Number and date: `equals`, `not equal`, `greater than`, `less than`, `between`, `is empty`.
- Boolean: `true`, `false`, `is empty`.
- Closed value sets: faceted multi-select.
- Missing fields, `null`, and empty text count as empty. Other comparisons against them are false.
- Separate filters use `AND`.
- Values inside one multi-select use `OR`.
- Arbitrary nested `AND` and `OR` groups are outside the first version.

Text inputs use a 200 ms debounce. An in-progress indicator appears only if another 300 ms passes without a result. Superseded calculations are ignored.

## Sorting

- Every collection node has one active sort field and direction.
- The default is technical metadata field `modified` descending.
- Null values always sort last.
- Sorting a nested collection node affects every occurrence of that node.
- Sort state is part of the shared view.
- Multi-column sorting is outside the first version.

## Table presentation

- The root renders as a data table with expandable rows.
- Each expanded relationship renders a separate nested table with its own columns, filters, sort, and pagination.
- The pattern repeats recursively to the five-level limit.
- All relationships start collapsed.
- Several rows may be expanded at once, but there is no `Expand all` action.
- Nested content mounts only while its parent row is expanded.
- Refresh preserves expanded item IDs that still exist. Expansion is not part of the shared view.
- Root pagination defaults to 100 rows.
- Nested pagination defaults to 25 rows.
- Available page sizes are 25, 50, and 100.
- A nested page number belongs to one parent occurrence. Page numbers are not shared in the URL.

All content fields and the content item ZUID are visible by default. ZUID is the first data column after row actions and the first option in the column menu. Users may hide it. Other technical metadata and raw JSON are hidden by default but may be selected. Users may change column visibility and width. The table has horizontal scrolling and a sticky leading actions column. ZUID scrolls with the other data columns. Arbitrary column pinning and drag reordering are outside the first version.

Long cell values are truncated with an ellipsis. A keyboard-accessible Base UI popover can show the full value on hover or explicit interaction. The authoritative full value remains available in item details. HTML is displayed as text and never executed. Structured values are formatted for reading and copying.

Each row has separate controls for:

- expanding relationships;
- opening a right-side item-details Sheet;
- opening the item in the matching Zesty Manager deployment.

The details Sheet lists every content field and technical metadata field, offers a raw JSON view, and lets the user copy individual values. It has a visible close action and returns focus to its trigger.

Nested tables use a compact toolbar with free text, an active-filter count, column visibility, and current sort. The state belongs to the collection node, so changing it in one occurrence updates all occurrences.

The product has no row selection, bulk actions, content export, configuration import, or configuration export.

## Shared URL state

The instance and the state of both tabs are encoded as a versioned, compressed payload in the `#view=` URL fragment. It contains:

- the instance, Zesty deployment, and active tab;
- root and nested collection references;
- content state;
- relationship definitions and node names;
- view filters and table filters;
- visible columns and widths;
- sort state;
- the Code tab's selected file ZUID and code state.

The URL never contains the session token, code source, page numbers, expanded rows, open panels, or temporary loading state. Links in the earlier Explorer-only format still open in the Explorer tab.

- URL synchronization happens automatically after every settled change.
- The application uses `history.replaceState`, so typing does not add browser-history entries.
- Reloading reconstructs the view from the URL and the session token from `sessionStorage`.
- `Copy link` copies the current full localhost URL, which restores both tabs.
- One browser tab owns one view. A second view uses a second browser tab.
- Links longer than 8,000 characters show a sharing warning but remain copyable.
- Invalid, truncated, or unsupported view payloads are never silently reset.
- The error state offers `Copy raw view data` and a confirmed `Reset view` action.

## Data loading and failure behavior

- The root collection loads first.
- Other configured collections load in the background with at most three requests running concurrently.
- Each unique collection is fetched once per instance, deployment, content state, and language.
- Collection pages are fetched until completion or a product limit is reached.
- The per-collection limit is 10,000 content items.
- The whole-view limit is 50,000 loaded content items.
- Crossing either limit stops further pages and marks affected collections as partial.
- Tables remain usable for partial collections, but every result and filter involving them carries a persistent incomplete-data warning.
- A view filter that depends on data still loading does not show a provisional final result. It shows that related data is pending.
- Data loads on initial open, content-state change, or explicit `Refresh`. There is no polling.
- A failed root collection blocks the table and offers retry.
- A failed nested collection leaves the rest of the view usable, marks its node, and offers retry.
- Errors distinguish invalid input, blocked host, authentication, permission, missing resource, schema decoding, network/CORS, timeout, rate limiting, and response limits.
- Root and nested collection load failures include a collapsed `Technical details` disclosure built with the shadcn `Collapsible` component. It shows the error kind, operation, safe request URL, available HTTP status, and decoding issues. Request URLs have user information, fragments, and secret-shaped query parameters removed. Each decoding issue identifies its JSON path, expected type, and received type.
- Technical error details never include authorization headers, session tokens, response values, response bodies, or stack traces. At most 20 decoding issues are retained; the disclosure states when further issues were omitted.
- The disclosure offers `Copy technical details`, which copies the same safe diagnostic information shown on screen and no hidden data.
- Browser Fetch does not expose whether CORS or another network condition blocked a response. The network/CORS error therefore states that Zesty could not be reached, includes the current browser origin, and presents CORS as a diagnostic possibility rather than a confirmed cause.
- Retry with bounded backoff applies only to transient network, `429`, and selected `5xx` failures. Effect owns retry policy. TanStack Query does not add a second retry loop.

## Technical design

### Runtime and UI

- Node.js `22.12+` and pnpm.
- Vite React TypeScript application.
- shadcn/ui using the Base UI base and Nova preset.
- Tailwind with semantic dark tokens and a permanent `dark` class set before the bundle runs.
- TanStack Table v9 for table state and row models.
- TanStack Query for remote-data cache, refresh state, cancellation entry points, and query identity.

### Effect

- Stable Effect v3, `@effect/platform`, and fetch-backed `FetchHttpClient`.
- Effect Schema replaces Zod for API and URL-state decoding.
- Effect owns typed failures, HTTP status handling, timeout, retry, cancellation, and bounded request concurrency.
- `@effect/platform-browser` is added only if a concrete browser-specific requirement appears.
- Effect Atom is not used.
- Effect is not introduced into synchronous per-item joins, filters, sorting, or React render paths.
- `@effect/language-service` is the last TypeScript plugin.
- The package `prepare` script runs `effect-language-service patch` so `tsc --noEmit` includes Effect diagnostics.
- The editor uses the workspace TypeScript version.

### Modules and seams

The implementation should concentrate complexity behind a few deep modules:

- `ViewCodec` has a small interface for decoding, validating, migrating, encoding, and measuring shared view state.
- `CollectionReferenceParser` accepts untrusted URLs and returns a validated instance, deployment, model, optional item, and safe API/Manager targets.
- `ZestyApi` exposes collection schema and paged snapshot loading. Its adapter contains the authorization header, Effect HTTP program, decoding, and typed error mapping.
- `ExplorerCore` is a pure TypeScript module for normalization, relationship indexes, view and table filtering, sorting, and page row selection.
- React adapters connect TanStack Query snapshots and TanStack Table state to those module interfaces.

The pure core does not import React, TanStack, Effect, browser storage, or browser networking. This keeps its interface fast to exercise in tests and lets the implementation move to a Web Worker without changing callers.

## Performance design

- API responses are decoded and normalized once.
- Content items are stored once and referenced by stable IDs. Nested trees do not deep-clone item objects.
- Custom relationships use prebuilt `Map<scalar, item IDs[]>` indexes. They never compare every parent with every child.
- Native and custom relationship indexes are rebuilt only when their source snapshot or relationship definition changes.
- Filters and sorts operate on IDs and references.
- Derived row sets are memoized by snapshot identity and relevant view state.
- Faceted values are calculated only when their filter control opens.
- Only the current page and expanded branches render DOM.
- One shared controlled popover handles long-value previews instead of mounting a complex overlay for every cell.

The first implementation stays on the main thread. A single module Web Worker is introduced only if representative benchmarks still produce tasks around 50 ms or longer, typing becomes blocked, or p95 interaction time exceeds the agreed budgets after algorithm and rendering fixes.

Performance targets after data is loaded:

- Filtering or sorting a representative view of up to 10,000 items completes within 250 ms.
- Expanding a row whose data is loaded completes within 100 ms.
- Typing and UI animation remain responsive during recalculation.
- A 50,000-item view remains usable, with expensive computation completing within one second.

## Local verification

The project has no CI and no test that contacts a real Zesty instance or reads a real session token.

Expected commands:

```text
pnpm dev
pnpm check
pnpm test
pnpm test:e2e
pnpm test:performance
pnpm build
```

- `pnpm check` runs formatting checks, lint, patched `tsc --noEmit`, and Effect diagnostics.
- Unit tests cover parsing, schemas, URL migrations, normalization, relationship cardinality, filters, sorting, limits, and typed errors.
- Effect tests use fake Layers and transports for pagination, bounded concurrency, retry, timeout, and cancellation.
- Browser tests run in Chromium with synthetic snapshots and cover the start screen, URL restoration, table nesting, filters, details, keyboard interaction, error recovery, and refresh.
- Performance tests use generated graphs of 1,000, 10,000, and 50,000 items. They measure indexes, joins, nested predicates, free text, sort, row expansion, and long tasks.
- Local benchmark baselines account for machine variance. A result more than twice the stored baseline fails for investigation. Absolute product targets are also reported.
- Test fixtures contain missing fields, nulls, duplicate matches, unmatched parents, long HTML, invalid schemas, large facets, and stale view paths.

## Explicit non-goals for the first version

- Hosted deployment or server-side proxy.
- Editing or publishing Zesty content.
- Multiple instances or Zesty deployments in one view.
- Mobile layout and broad browser support.
- Light or system theme.
- Analytics, telemetry, or runtime CDN assets.
- Polling and real-time updates.
- Arbitrary relationship graphs or cycles.
- JavaScript filter expressions and custom value coercion.
- Multi-column sorting, arbitrary column pinning, and column drag reordering.
- Row selection, bulk actions, content export, or configuration files.
- Multiple in-app view tabs.
- Effect v4 RC, Effect Atom, and an initial Web Worker.
- CI and tests against a live Zesty instance.

## Supporting records

- [Domain language](../CONTEXT.md)
- [ADR 0001: Run as a local browser application (superseded)](./adr/0001-run-as-local-browser-app.md)
- [ADR 0002: Use Effect v3 at the I/O seam](./adr/0002-use-effect-at-the-io-seam.md)
- [ADR 0003: Call Instances API from the canonical localhost origin](./adr/0003-call-instances-api-from-canonical-localhost.md)
