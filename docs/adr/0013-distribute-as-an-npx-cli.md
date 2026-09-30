---
status: accepted
---

# Distribute as an npx CLI on the canonical origin

Zesty Explorer is distributed as the npm package `zestyx` and run with `npx --yes --prefer-online zestyx@latest`, so users need Node.js but not Git, pnpm, or a checkout. The package contains the built frontend and a small `node:http` server with no runtime dependencies. The CLI serves the build from memory on both loopback addresses, opens `http://localhost:<port>`, and stays attached to the terminal until `Ctrl+C`. Hosting the app elsewhere is not an option because Zesty accepts only `localhost` origins (ADR 0003), and there is still no proxy, daemon, updater, or local data store.

The port defaults to 5173 and never changes automatically: the port is part of every shared link, so silently moving would produce links that other users cannot open. `--port` is an explicit escape hatch. When the port is taken by another `zestyx`, detected through the `x-zestyx-version` response header, the CLI opens the browser at it instead of failing; any other occupant produces an error that suggests `--port`.

Releases are started by hand from `master` with a `minor` or `patch` bump. The release workflow runs CI against the new version and publishes the exact archive that CI tested, after atomically pushing the release commit and tag. Publishing uses npm trusted publishing, so the repository stores no npm token; the first version is published by hand because trusted publishing requires an existing package.

## Consequences

- The published package is the repository root, so frontend libraries are `devDependencies`: Vite bundles them into `dist`, and npx installs nothing else.
- `engines` declares the supported Node.js versions, but `npx` only warns when they do not match. The CLI adds no version check of its own, so it keeps working on older Node.js releases that happen to support it.
- A running server is not updated by a new release. Users stop it and run the command again.
