# pi-brokered-auth

A [pi](https://pi.dev) extension for machines that share one subscription login
without sharing its refresh token.

Subscription logins such as OpenAI Codex and Radius rotate their refresh token on
every refresh. If two machines hold the same refresh token, the first one to
refresh logs the other out. The fix is to keep the refresh token in one place: a
broker on a hub refreshes it and pushes only short-lived access tokens to the
other machines.

This extension is the receiving end. It reads a JSON file of access tokens:

```json
{
  "openai-codex": { "access": "...", "expires": 1767225600000, "accountId": "..." },
  "radius": { "access": "...", "expires": 1767225600000 }
}
```

and re-registers each listed provider's OAuth so that `/login` and token refresh
read the file instead of calling the provider. pi stores the sentinel refresh
token `brokered`, which is never sent anywhere. When the file holds an expired
token, the error says that the hub has not pushed a fresh one.

## Use

```sh
pi install git:github.com/justmytwospence/pi-brokered-auth
```

or add a checkout's path to `packages` in `~/.pi/agent/settings.json`, after any
package that registers the same providers (pi-radius, for instance).

| Variable | Meaning |
|---|---|
| `PI_BROKERED_AUTH_FILE` | The pushed file. Unset: the extension does nothing, so it is safe to load everywhere. |
| `PI_BROKERED_AUTH_PROVIDERS` | Comma-separated providers to take over while the file does not exist yet. |

Keys starting with `_` in the file are metadata and are ignored. The file is
read on every login and refresh, so a push takes effect without `/reload`.

The pushing side is not part of this package; see
[paseo-machine0](https://github.com/justmytwospence/paseo-machine0) for one.

## Develop

```sh
npm install
npm run check
```
