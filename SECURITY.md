# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration keeps, and where:

- **In the Gladys configuration**: the email and the password of the ecobee
  account (a `secret` field), or a developer API key (a `secret` field). The
  password is used again only when ecobee ends the session.
- **In `/data/ecobee-session.json`**, the only file it writes (mode 0600): the
  ecobee refresh token, the current access token and its expiry, and a
  fingerprint (SHA-256 prefix) of the account they belong to. Never the
  password, never the email in clear. **Sign out** deletes it.
- **In memory only**: a pending verification-code challenge (cookies of the
  sign-in, PKCE verifier), about ten minutes.

Network: outbound HTTPS only, to `auth.ecobee.com` (sign-in) and
`api.ecobee.com` (thermostats). The container opens no port. The logs never
carry a password, an API key, a token, a sign-in code or a URL with
credentials.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and ecobee's services and thermostats.
