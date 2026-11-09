# Contributing to Kindred

Thank you for wanting to help. Kindred is a small project for keeping a family's history together, and fixes, translations,
documentation and ideas are all welcome. By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Run it

You need [mise](https://mise.jdx.dev) (it installs Node 26) and nothing else.

```sh
mise install
mise run install   # npm install, with the right Node
mise run data      # two invented families in data/
mise run dev       # http://localhost:4517
```

Open the page and create the first account (a passkey), and the two families are there. `mise tasks` lists everything; `mise run check`
and `mise run test` are the quick checks. The browser journeys (`mise run e2e`) take minutes.

## Send a change

1. Open an issue first for anything large, so we can agree on it before you spend time. Small fixes need no issue.
2. Fork, make a branch, and keep the change to one thing.
3. Run `mise run check` and `mise run test`. Add or update a test.
4. Words the app shows go in all three languages (English, German, Afrikaans); [src/lib/i18n/README.md](src/lib/i18n/README.md) says how.
5. Use invented names in tests and screenshots. Never paste a real family's data anywhere, in code, issues or pull requests.
6. Write commit messages in the style of `git log` (`fix(tree): ...`). Open the pull request; the checklist in it is short.

The conventions (server functions, storage, migrations, privacy) are in [AGENTS.md](AGENTS.md). It is written for AI agents, and
it is the same guide for people. To report a security problem, read [SECURITY.md](SECURITY.md) instead of opening an issue.
