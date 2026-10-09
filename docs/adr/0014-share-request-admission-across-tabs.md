---
status: accepted
---

# Share active HTTP slots and keep scheduling per tab

V1 assumes one open tab, so Web Locks share only four active HTTP slots across same-origin tabs. Pacing and 429 cooldowns belong to each tab, with cooldown deadlines saved in `sessionStorage`. This avoids a shared persistent scheduler and IndexedDB.

The four-slot cap is a conservative app choice that allows parallel loading. It limits concurrency. Separate pacing limits request starts. [Zesty documents](https://docs.zesty.io/docs/headless-rate-limiting) a WebEngine limit of 600 requests per 60 seconds per client fingerprint, with a 30-minute ban. Authenticated Instances and Accounts quotas remain unconfirmed.

## Consequences

- Multiple tabs can multiply request rates. A cooldown in one tab does not pause another.
- Cooldowns survive reloads but end when the tab closes.
- Slot names must stay stable across builds. Changing names or the slot count requires coordination with older open tabs to preserve one shared limit.
