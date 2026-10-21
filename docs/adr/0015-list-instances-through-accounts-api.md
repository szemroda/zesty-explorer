---
status: accepted
---

# List instances through the Accounts API

A user who knows their session token but not an instance URL can start a view without visiting Zesty Manager. After the user enters a session token for a deployment, Zesty Explorer makes one authenticated `GET /instances` request to that deployment's Accounts API, the same unpaginated request Zesty Manager makes, and offers the result in the instance picker. A record becomes an instance only through its validated instance ZUID and the deployment the user chose, so the hosts of every later request still come from the closed deployment table in [ADR 0007](./0007-keep-the-session-token-tab-scoped.md). Fields such as `domain` and `screenshotURL` are not decoded.

## Considered options

- Pasting a Manager or Instances API URL as the only way to start was rejected, because every first visit then began with a search in Zesty Manager.
- Paging with `limit` and an offset was deferred. The Accounts API documents only `limit`, and neither Zesty Manager nor Accounts UI pages this request.
- A dedicated instance step before the root picker was rejected. It adds a screen, and a pasted collection URL would belong on two screens.

## Consequences

- The instance list is cached per deployment and credential revision, like the collection catalog in [ADR 0005](./0005-discover-collections-through-instances-api.md).
- Invalid records are omitted one by one and make the list incomplete instead of unusable. When `_meta.totalResults` exceeds the records returned, the picker reports a truncated list.
- A pasted Manager or Instances API URL remains the fallback for deep links and for instances the list omits. An instance named by a link or reference does not have to appear in the list.
- While a view is open, the root picker keeps its instance. To switch instance, the user resets the view, which offers Undo.
- A `401` from the instance list clears that deployment's token, like any other authenticated `401`. If the Accounts API ever rejected a token that the Instances API accepts, the user could not reach the URL fallback. Zesty Manager sends the same token for this request, so this case is not expected.
