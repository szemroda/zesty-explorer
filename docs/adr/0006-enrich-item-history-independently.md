---
status: accepted
---

# Enrich item history independently

Zesty Explorer loads saved item versions from the instance API, then independently enriches them with publishing records from the instance API and author identities from the deployment-specific Accounts API. The three requests run concurrently, and failed publishing or author enrichment remains retryable without blocking version preview, because complete version content is the only data required to inspect history.

## Consequences

- Version history may remain usable while status or author information is unavailable.
- The session token is sent to one additional Zesty origin selected from the active deployment. That origin must also accept the canonical browser origin from [ADR 0003](./0003-call-instances-api-from-canonical-localhost.md).
- Version, publishing, and author responses share a five-minute inactive cache and are discarded when the credential revision, instance, or deployment changes.
