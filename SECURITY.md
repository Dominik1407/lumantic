# Security

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub instead:
**Security → Report a vulnerability** in this repository
(https://github.com/Dominik1407/lumantic/security/advisories/new).

Include what you found, how to reproduce it and what an attacker could do with it. Lumantic is
maintained in spare time; expect an answer within a week. Once a fix is out, the advisory is
published, and you are credited if you want.

## Supported versions

Lumantic is before 1.0. Only the latest release gets security fixes.

## How Lumantic handles sensitive data

Useful to know when judging whether something is a vulnerability:

- Tokens and passwords (AI, Snowflake, Databricks, Windmill) live in `data/secrets.json` or in
  environment variables. They are never sent to the browser.
- Lumina sends only the evaluated figures of the current month to the configured AI provider,
  no raw tables. AI can be switched off in the settings.
- Requests that change something must be JSON and come from the same origin.
- Without a login (`auth.kind: "none"`) everyone who reaches Lumantic may change everything, so
  it then listens only on 127.0.0.1 and refuses to start on any other address unless
  `LUMANTIC_OPEN` is set. That is by design.
- With a login, people sign in through a trusted proxy (headers count only from its addresses) or
  with OpenID Connect (authorization code with PKCE, ID tokens checked against the provider's
  keys, RS256 and ES256 only). Sessions live in memory. Who sees which Kosmos, who changes
  settings and who looks after key figures follows the groups of the login.
- A loading job may trigger a refresh with a per-Kosmos token; only a hash of it is stored.
- Lumantic only reads from data sources. Snowflake and Databricks adapters also refuse anything
  that is not a single `SELECT` or `WITH` statement.
