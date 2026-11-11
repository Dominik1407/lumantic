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
- Login is being built. Until it ships, everyone who can reach Lumantic sees every Kosmos and
  shares the same pages, so run it inside your own network. This is a known limitation, not a
  vulnerability.
