# Security audit

Audit date: 2026-09-14. Scope: the local browser application and its offline tests.

## Results

| Invariant                                            | Result | Evidence                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session tokens stay out of URLs and shared state     | Pass   | `PersistedView` has no token field; `ViewCodec` rejects token-shaped and ephemeral keys; App restoration tests assert that stored tokens do not appear in `location.href`.                                                                                                     |
| Session tokens use tab-scoped storage                | Pass   | `SessionTokenStore` uses only `sessionStorage`, namespaced by deployment. Its unit test supplies no `localStorage` adapter.                                                                                                                                                    |
| Authentication failures preserve the view            | Pass   | A `401` clears only the deployment token and returns to the replacement-token form. Tree and fragment state remain intact.                                                                                                                                                     |
| Untrusted hosts cannot receive authorization         | Pass   | `CollectionReferenceParser` accepts only canonical Zesty deployment hosts. `ViewCodec` re-derives and compares every decoded reference before any query is enabled. Tree operations reject cross-instance and cross-deployment nodes.                                          |
| Runtime Zesty requests are read-only                 | Pass   | `ZestyTransportRequest.method` is the literal type `GET`; adapter tests inspect every generated request. There are no mutation methods. Browser tests block unexpected external requests.                                                                                      |
| Content markup remains inert                         | Pass   | Tables strip tags to text, React escapes details and raw JSON, and no `dangerouslySetInnerHTML` use exists. The root browser test verifies fixture markup creates no nested element.                                                                                           |
| Errors do not expose credentials or content values   | Pass   | Typed errors retain only safe request URLs, status codes, response paths, expected types, and received types. They never retain response values, response bodies, request headers, or session tokens. Tests inspect serialized decoding failures and copied technical details. |
| Fixtures and test output contain no real credentials | Pass   | Fixtures are synthetic; `serializeFixture` refuses token-shaped fields. Tokens used in tests are explicit placeholders.                                                                                                                                                        |
| Clipboard operations exclude credentials             | Pass   | Share copies only `location.href`, whose encoded contract excludes secrets. Value-copy actions copy only the selected content value.                                                                                                                                           |
| No analytics, remote assets, fonts, or reporting     | Pass   | Runtime source has no telemetry client or remote asset reference. The application calls only the selected allowlisted Zesty API and opens explicit Manager links on user action.                                                                                               |
| Destructive view operations require confirmation     | Pass   | Root replacement, subtree removal, token clearing, and complete view reset explain their impact and call `window.confirm`.                                                                                                                                                     |

## Repeatable checks

Run `pnpm check`, `pnpm test`, `pnpm test:e2e`, and `pnpm build`. Then search runtime code with:

```powershell
rg "dangerouslySetInnerHTML|localStorage|console\\.|method: '(POST|PUT|PATCH|DELETE)'" src
```

For the permitted final human sanity check, inspect the browser Network panel. Requests initiated by the app must be `GET` or browser-generated preflight requests and target only the canonical API host derived from the accepted collection URL. Never record or share the request authorization value.
