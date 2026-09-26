---
status: accepted
---

# Call WebEngine endpoints anonymously

The endpoint request panel sends GET requests directly from the browser to WebEngine URLs derived from the selected instance, endpoint, and code state. These requests omit cookies and never receive the user's Zesty session token, passwords, or API keys; authenticated Accounts and Instances API reads retain the host restrictions in [ADR 0007](./0007-keep-the-session-token-tab-scoped.md). This separation supports instance-specific preview and live domains without extending the session token's destinations, at the cost of leaving protected endpoints and responses blocked by CORS unreadable inside Explorer. The panel offers opening the URL separately, and adds neither credential forwarding nor a proxy to bypass that limitation.
