---
status: accepted
---

# Predict CSV imports without writing to Zesty

Zesty offers no dry run for its Import CSV. The Import check therefore re-implements the parts of Zesty Manager's importer that change the item count, in `src/import-check/`: csv-parse 4 splitting on commas only, rejecting the whole file on a broken line, silently dropping blank lines, keying cells by header so a repeated header loses its earlier column, and Manager's path-part transform. It combines them with read-only Instances API requests for the collection's schema, latest saved items and related items. The file never leaves the browser, and the check sends no write request.

## Consequences

- What follows from Manager's importer is stated as fact. Rejections by the Instances API, whose rules are not public, are predictions: `likely` ones count as won't import, `possible` ones count as imported but are flagged.
- Columns are mapped by field name or label, as a careful user would map them in Zesty's own screen. The check cannot know which mapping the user will choose.
- When Zesty's importer changes, the check can drift silently. Its behaviour is pinned by focused tests on small files, not by comparison with a live import.
