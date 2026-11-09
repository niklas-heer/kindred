# Security policy

Kindred holds a family's names, dates, photographs and, if the AI features are on, a provider key. We take reports about it seriously.

## Supported versions

The latest 2.x release, and `main`. Version 1 (the Rust CLI) is not supported.

## Report a problem privately

Use GitHub's private reporting: open the **Security** tab of [github.com/niklas-heer/kindred](https://github.com/niklas-heer/kindred),
choose **Report a vulnerability** and fill in the form. Only the maintainer sees it.

Please do **not** open a public issue, a pull request or a discussion for a vulnerability. A report may contain family details,
and a public one tells everyone before there is a fix. Do not put a real family's data, a real key or a real passkey in a report:
reproduce the problem on the invented families (`mise run data`) or an empty installation.

A good report says which version or commit (the feedback report in the app shows it), how it runs (Docker, Node, Cloudflare),
what you did, what you expected and what happened.

## What is in scope

- Signing in: passkeys, sessions, invitations, the first-account setup code, Cloudflare Access token checks.
- Roles: a viewer, contributor, editor or steward doing more than their role allows, or a guest of a share link doing more than reading, or seeing a field that is not for them (the Personal and Editors levels).
- Reading or changing another family's data on the same installation.
- Share links and their guest host, uploads (photographs and research documents), and the content policy and CSRF protection.
- The sealed AI provider keys and `KINDRED_SECRET`, and the nightly archive token.
- Anything that leaks data through a cache, a log or an export.

Out of scope: a problem that needs you to already control the server or the data folder; denial of service by sending huge
traffic; missing hardening on a setup the documentation tells you not to use (for example, plain HTTP on an open network);
and the AI provider's own behaviour.

## What to expect

This is a small project run by one person, so there are no promises of speed, but we aim to:

- answer your report within a week;
- tell you whether we agree it is a vulnerability, and what we plan;
- fix it in a release, say so in [CHANGELOG.md](CHANGELOG.md), and credit you if you want to be named;
- ask you to keep the details private until the fix is out.

We do not run a bounty.
