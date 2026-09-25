---
status: accepted
---

# Keep the session token tab-scoped and send it only to derived hosts

The session token is the user's Zesty Manager session, so it carries all of that user's permissions rather than a read-only scope. Zesty Explorer therefore keeps it only in the tab's `sessionStorage`, keyed by Zesty deployment, and sends it only to hosts that the application builds from a closed deployment table after validating an instance reference. A host copied from user input never receives the token, an unknown host is rejected without a request, and users cannot add hosts, because a leaked token or a mistyped host would expose full account access.

## Consequences

- Every new browser tab, and every recipient of a shared link, supplies their own token.
- The token never appears in URLs, copied links, logs, fixtures, or technical error details. Diagnostics also omit request headers, response bodies, and response values, and strip secret-shaped query parameters from request URLs.
- The application sends only `GET` requests, because the same token could also change content.
- A `401` clears only that deployment's token and preserves the view.
- The token reaches the instance's Instances API host and the deployment's Accounts API host ([ADR 0006](./0006-enrich-item-history-independently.md)). Supporting another Zesty host requires a code change.
