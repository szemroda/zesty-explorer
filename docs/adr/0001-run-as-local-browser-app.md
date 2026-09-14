---
status: superseded by ADR-0003
---

# Run as a local browser application

Zesty Explorer will be cloned and started with a pnpm command on `localhost`. It will call the Zesty Instances API directly with the user's `APP_SID`, kept only for the browser session, and will have neither a hosted Vercel build nor a server-side proxy. The Instances API accepts requests from `localhost` but rejected preflight requests from external Vercel origins, so local execution preserves the browser-only design at the cost of requiring each user to set up the repository and supply their Zesty session token.
