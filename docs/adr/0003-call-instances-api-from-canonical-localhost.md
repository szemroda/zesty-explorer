---
status: accepted
---

# Call Instances API from the canonical localhost origin

Zesty Explorer remains a local-only browser application that calls the authenticated Zesty Instances API directly with the user's deployment-specific session token. Its canonical browser origin is `http://localhost:5173`: anonymous preflight checks against production, stage, and development Zesty gateways accepted literal `localhost` with the `Authorization` header but rejected `127.0.0.1`, `[::1]`, and an external Vercel origin. The application will therefore open the canonical URL and redirect reachable `127.0.0.1` URLs to it while preserving the complete view URL. The IPv4-only development server does not serve `[::1]`. The application will not add a local proxy, hosted backend, Instant API fallback, or long-lived access token. If Zesty stops accepting the canonical origin, the application will stop instead of bypassing browser security. Because browser Fetch does not expose whether CORS or another network condition blocked a response, the error will report that Zesty could not be reached, show the origin, and offer CORS as a diagnostic possibility rather than a proven cause.

## Consequences

- The exact browser hostname is part of the runtime contract even though the development server remains bound to the loopback interface.
- Shared links use `localhost`, and canonicalization from `127.0.0.1` must preserve their path, query, and fragment.
- The IPv6 loopback address `[::1]` is unsupported and may fail before application code can run.
- Direct access depends on observed Zesty gateway behavior that its public Instances API documentation does not guarantee. A future policy change requires a new architectural decision.
