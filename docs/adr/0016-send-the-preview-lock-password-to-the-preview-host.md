---
status: accepted
---

# Send the preview lock password to the preview host

WebEngine locks an instance's preview host for anonymous visitors: without its preview lock password as `?zpw=`, a request receives `401` and a password page. Endpoint requests are anonymous ([ADR 0011](./0011-call-webengine-endpoints-anonymously.md)), so a user with access still had to look up the password in Zesty Manager and add it to every latest-code request. Zesty Explorer now reads the instance settings with one authenticated `GET /env/settings` to the Instances API host and, while the preview is locked, adds the password to requests sent to the preview host. It considers the preview locked while `preview_lock_password` is set and `preview_lock` is not `"0"`; this rule matched every locked and unlocked production instance we tried, but Zesty does not document it. Instances API responses already reach the same users, who read the password in Manager.

## Considered options

- Sending the session token or Manager cookies to WebEngine was rejected. The token carries every permission of the user, while the password only opens one instance's preview, and cookies sent from `localhost` would also need a credentialed CORS response that WebEngine does not give.
- Asking the user for the password was rejected, because the user already has it through their session.

## Consequences

- The password is added only when the request is sent. The address bar, the `Open in a new tab` link, the response pane, technical details, and shared links show the URL without it. A `zpw` the user adds is sent instead.
- Response bodies are shown as received, so an endpoint that prints its query string shows the password to the user who already has access to it. Explorer does not rewrite response bodies.
- The password is cached in memory with the preview host, and `Refresh` reads it again. A stale password produces a `401` like any other wrong password, and endpoint sends are never replayed automatically, so WebEngine's five-attempt lockout is not reached by Explorer alone.
- When the settings cannot be read, including after a failed `Refresh`, endpoints stay callable without the password, and the panel says how to add it. An expired session token asks for a replacement like every other authenticated read.
- The development deployment serves previews over HTTP, so there the password travels unencrypted.
- Live domains never receive the password. The `preview_lock_custom` setting, which locks custom domains, is not handled.
