---
status: accepted
---

# Discover collections through Instances API

After a user supplies an instance reference and session token, Zesty Explorer will build a credential-scoped collection catalog from the authenticated `GET /content/models` endpoint. The catalog includes every valid model returned by Zesty, including empty collections, and supports both root collection and relationship selection without loading content items merely to populate the picker.

## Considered options

- `/env/nav` was rejected as the catalog source because it represents Content Manager navigation rather than a clean list of collections.
- Per-collection item requests were rejected because item counts are not needed for selection and would add one request per collection.
- Manual collection references remain available as a fallback when the catalog is unavailable or omits a collection.

## Consequences

- The catalog is cached per instance, deployment, and session token revision.
- Global refresh updates both the catalog and all opened collections.
- Block collections appear in a separate picker group; unrecognized collection types appear under Other.
- Invalid model records are omitted individually and make the catalog incomplete instead of unusable.
