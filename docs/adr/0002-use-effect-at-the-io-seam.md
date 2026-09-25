---
status: accepted
---

# Use Effect v3 at the I/O seam

Zesty Explorer will use stable Effect v3 and Effect Schema for HTTP requests, input decoding, typed failures, cancellation, timeout, retry, and bounded concurrency. TanStack Query will own remote-data caching and request state but will not retry, so Effect's retry policy is the only one. Joins, indexes, filters, sorting, and table row preparation remain pure TypeScript so they stay cheap to call, easy to benchmark, and movable to a Web Worker if measurements require it. The project will not add Zod or Effect Atom, and `@effect/language-service` will patch the local TypeScript installation through the recommended `prepare` script so Effect diagnostics also run during `tsc -b` type checking.
