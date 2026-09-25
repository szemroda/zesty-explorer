---
status: accepted
---

# Explain Parsley through tolerant static analysis

The Code tab explains Parsley files with a parser and analyzer in `src/parsley/` that read source text only. They do not execute files or evaluate conditions and queries. Analysis is tolerant: syntax it cannot parse, and references the collection catalog cannot resolve, are shown as unrecognized instead of as errors. A catalog miss may reflect the session's permissions rather than broken code, and Parsley's documented language is broader than the parser.

## Consequences

- A partly understood file is presented as partly explained. Unrecognized fragments remain visible in the source and the walkthrough.
- Formatting only changes how source is displayed. `As saved` keeps the original text, and formatting never rewrites literals.
- Code source stays in browser memory and never enters URLs, browser storage, logs, or reports.
- Parser coverage grows with focused tests. The application never claims complete Parsley support.
