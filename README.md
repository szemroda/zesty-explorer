# Zesty Explorer

Zesty Explorer is a local, read-only browser for inspecting related content collections in one Zesty instance. It supports relationship trees, nested tables, view and table filters, sorting, item details, and credential-free shared view links.

## Prerequisites

- [Node.js](https://nodejs.org) 22.12 or newer
- Current Chrome or Edge on a desktop or laptop
- Access to the relevant Zesty instance

The app runs only on your computer. It has no backend, hosted deployment, analytics, or runtime CDN assets.

## Run

```sh
npx --yes --prefer-online zestyx@latest
```

The command downloads the latest release, starts a local server, and opens [http://localhost:5173](http://localhost:5173) in your default browser. Use Chrome or Edge if your default browser is different. Requests go directly from your browser to Zesty; the local server only serves the app files.

Keep the terminal open while using the app and press `Ctrl+C` to stop it. To update, stop the server and run the same command again. Running the command while the app is already running opens the browser at the existing server.

Options go after the package name, for example `npx --yes --prefer-online zestyx@latest --no-open`:

- `--port <number>` serves on another port when 5173 is taken. Shared links contain the port, so recipients must run the app on the same port to open them.
- `--no-open` starts the server without opening the browser.
- `--version` and `--help` print the version and usage.

Open the app at `localhost`, not `127.0.0.1` or `[::1]`: Zesty accepts only `localhost` as a browser origin. The app redirects `127.0.0.1` URLs to `localhost` while preserving the complete view URL.

On Windows, PowerShell may refuse to run `npx` with "running scripts is disabled on this system". Type `npx.cmd` instead of `npx`, with the same arguments.

## Develop

Development also requires Git and pnpm 11.18 or a compatible pnpm 11 release.

```powershell
git clone https://github.com/szemroda/zesty-explorer.git
cd zesty-explorer
pnpm install --frozen-lockfile
pnpm dev
```

The development server starts on port 5173 or the next available port without opening a browser. Open `http://localhost:<port>` using the port printed in the terminal. To run the CLI that npm users get, use `pnpm build` and then `pnpm start`.

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
- Native relationships use model relationship fields declared on either collection. When several fields connect the same models, choose the intended field.
- Custom relationships compare one parent field path with one child field path using strict scalar equality. Values are not coerced.
- Expand a content item to mount its related tables. Several rows can remain expanded.
- View filters determine which root items remain and may inspect descendants. Table filters limit only that node's rows and may also inspect descendants.
- A collection node shares its filters, columns, widths, and sorting across every rendered occurrence. Nested page numbers and expanded rows remain local UI state.
- The details button opens read-only item history. Choose any saved version to inspect its content fields, technical metadata, and raw JSON together; status badges identify the latest saved, currently published, and scheduled versions when Zesty returns that information. Save times use the browser's locale and time zone, and authors appear when the active session can resolve them.
- Closing item history resets its selected version. Responses remain cached for five minutes while inactive, then refresh in the background when reopened. The external-link button opens the same item in the matching Zesty Manager deployment.
- Content HTML is shown as inert text; it is never executed.

## Limits and failures

A view supports at most 10 collection nodes and five levels.

Item history remains usable when publishing status or author information fails to load. Each failed source has its own retry.

Code history, opened with `History` beside a Code tab file, previews and compares the file's saved versions. Zesty returns at most the newest 1,000 versions of a file; when older ones exist, code history says so.

The app loads at most 10,000 items per collection and 50,000 items across a view. Affected collections remain usable and show persistent incomplete-data warnings. A failed root blocks the table area and offers retry. A failed descendant leaves the rest of the view usable and provides recovery at that node.

## Share, replace, and reset

`Copy link` copies the current localhost URL. Its compressed fragment contains the active tab, the relationship tree, references, names, content state, filters, columns, widths, sorts, and the Code tab's selected file and code state. It never contains the session token, code source, endpoint request forms or responses, pages, expanded rows, open details or code history, or loading state.

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
- `pnpm test` runs focused module, React, and CLI tests.
- `pnpm test:e2e` builds the app, serves it with the CLI, and runs offline Chromium flows at laptop and desktop sizes, followed by browser performance budgets.
- `pnpm test:performance` measures generated 1,000-, 10,000-, and 50,000-item graphs against stored baselines and product budgets.
- `pnpm build` creates the frontend in `dist` and the CLI in `build/cli`.

CI runs everything except the performance budgets, which are calibrated on a developer machine, then starts the packed CLI on Linux, Windows, and macOS.

See the [performance report](docs/performance-report.md) for repeatable evidence, and [the architecture decision records](docs/adr/) for the reasoning behind key constraints.

## Troubleshooting

For network or CORS errors, confirm that the URL belongs to the intended Zesty deployment and inspect the browser Network panel without recording authorization headers. For `403`, request read access from a Zesty administrator. For response-shape errors, refresh once and record only non-secret response structure if the problem persists.
