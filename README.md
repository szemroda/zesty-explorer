# Zesty Explorer

Zesty Explorer is a local, read-only browser for inspecting related content collections in one Zesty instance. It supports relationship trees, nested tables, view and table filters, sorting, item details, and credential-free shared view links.

## Prerequisites

- Node.js 22.12 or newer
- pnpm 11.18 or a compatible pnpm 11 release
- Current Chrome or Edge on a desktop or laptop
- Access to the relevant Zesty instance

The app runs only on your computer. It has no backend, hosted deployment, analytics, or runtime CDN assets.

## Install and run

```powershell
git clone <repository-url>
cd zesty-explorer
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173). The development server binds to `127.0.0.1` and exits if port 5173 is already in use.

## Start a view

1. Sign in to the matching Zesty Manager deployment.
2. In Chrome or Edge Developer Tools, open Application → Storage → Cookies and select the Manager origin.
3. Copy the cookie value for the deployment you intend to browse:

   | Deployment  | Cookie          |
   | ----------- | --------------- |
   | Production  | `APP_SID`       |
   | Stage       | `STAGE_APP_SID` |
   | Development | `DEV_APP_SID`   |

4. Paste that value into `Zesty session token`. Treat it like a password: do not put it in chat, an issue, a screenshot, or a shared link.
5. Paste a Zesty Manager Content or Blocks collection URL. A full Instances API collection URL also works. An item-editor URL opens the collection and that item's details.
6. Select `Open collection`.

The token is stored only in that tab's `sessionStorage`, separated by deployment. A `401` removes the expired token but preserves the view so a replacement can be entered.

## Use the explorer

- `Published only` applies the same content state to every collection. Off means latest saved content.
- `Add related collection` attaches a collection below a tree node. All nodes must belong to the root instance and deployment.
- Native relationships use model relationship fields. When several fields target the same model, choose the intended field.
- Custom relationships compare one parent field path with one child field path using strict scalar equality. Values are not coerced.
- Expand a content item to mount its related tables. Several rows can remain expanded.
- View filters determine which root items remain and may inspect descendants. Table filters limit only that node's rows and may also inspect descendants.
- A collection node shares its filters, columns, widths, and sorting across every rendered occurrence. Nested page numbers and expanded rows remain local UI state.
- The details button opens content fields, technical metadata, raw JSON, and copy actions. The external-link button opens the same item in the matching Zesty Manager deployment.
- Content HTML is shown as inert text; it is never executed.

## Limits and failures

A view supports at most 10 collection nodes and five levels. Each unique collection is fetched once for the selected deployment and content state, with at most three background loads running concurrently.

The app loads at most 10,000 items per collection and 50,000 items across a view. Affected collections remain usable and show persistent incomplete-data warnings. A failed root blocks the table area and offers retry. A failed descendant leaves the rest of the view usable and provides recovery at that node.

## Share, replace, and reset

`Copy view link` copies the current localhost URL. Its compressed fragment contains the relationship tree, references, names, content state, filters, columns, widths, and sorts. It never contains the session token, pages, expanded rows, open details, or loading state.

The recipient opens the link and supplies a token in their own tab if one is not already stored there. Links over 8,000 characters remain copyable but show a compatibility warning. A damaged link can be copied as raw data for diagnosis or reset explicitly; it is never silently discarded.

`Replace root` confirms that the old relationship tree and saved settings will be discarded. `Reset view` clears the tree and URL state after confirmation while preserving the session token. Removing a tree node confirms the full subtree that will be removed.

## Verification

All automated tests use synthetic responses and placeholder tokens. They never contact a real Zesty instance or read browser cookies.

```powershell
pnpm check
pnpm test
pnpm test:e2e
pnpm test:performance
pnpm build
```

- `pnpm check` verifies formatting, lint, TypeScript, and Effect diagnostics.
- `pnpm test` runs focused module and React tests.
- `pnpm test:e2e` builds the production app and runs offline Chromium flows at laptop and desktop sizes.
- `pnpm test:performance` measures generated 1,000-, 10,000-, and 50,000-item graphs against stored baselines and product budgets.
- `pnpm build` creates the production bundle in `dist`.

See [the verification matrix](docs/verification-matrix.md), [security audit](docs/security-audit.md), and [performance report](docs/performance-report.md) for coverage and repeatable evidence.

## Known boundaries

Version one is intentionally desktop-only and dark-only. It does not edit or publish Zesty content, mix instances or deployments in one view, poll for changes, export content or configuration, evaluate JavaScript filters, provide arbitrary boolean filter groups, add analytics, provide a proxy, or host the application. Current Chrome and Edge are the supported browsers.

For network or CORS errors, confirm that the URL belongs to the intended Zesty deployment and inspect the browser Network panel without recording authorization headers. For `403`, request read access from a Zesty administrator. For response-shape errors, refresh once and record only non-secret response structure if the problem persists.
