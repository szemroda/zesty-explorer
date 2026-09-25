---
status: accepted
---

# Match custom relationships by strict equality

A custom relationship connects one scalar field path on the parent collection with one on the child and relates items only when the two values are strictly equal: the number `5` does not match the string `"5"`, and no trimming, case folding, array matching, or expressions apply. Coercion rules would silently change which items are related, while strict matching keeps results predictable for every recipient of a shared view. It also lets the core answer joins from prebuilt value indexes instead of comparing every parent with every child.

## Consequences

- Collections that store the same identifier with different types or formatting cannot be joined by a custom relationship until the data is consistent.
- Loosening the rule would change the results of existing shared views.
