# Model evaluations

These three files are written by `scripts/ai-eval.ts`. They are lab output, not user documentation: the tables list
which models did Kindred's AI jobs best, on made-up data, and they are why `src/lib/ai/recommended.ts` and
`DEFAULT_MODEL` in `src/lib/ai/types.ts` pick the models they do. [../ai.md](../ai.md) says how to read the result.

| File | What it measured |
| --- | --- |
| [models.md](models.md) | Anthropic's models, through Kindred's own Anthropic connection. The default report of a run. |
| [openrouter.md](openrouter.md) | A set of models through OpenRouter, through Kindred's own OpenRouter connection. Written with `--out`. |
| [cursor.md](cursor.md) | Models run through Cursor's own agent CLI. It uses its own system prompt, so it compares the models only and does **not** test Kindred's provider connections. Not representative of a self-hoster's setup. |

All three were measured on 2026-11-08. Model names and prices change quickly, so treat the tables as a snapshot.

## Reproducing

```sh
mise run ai-eval -- --provider anthropic --models claude-haiku-5-5 --dry-run   # plans and estimates; sends nothing
mise run ai-eval -- --provider anthropic --models claude-haiku-5-5,claude-sonnet-5-5 --max-usd 1
```

A real run sends real requests and costs money. `--max-usd` (default 1) is one budget for the whole run. The key is
`KINDRED_AI_EVAL_KEY`, or `--saved-family <id>` with `KINDRED_DATA_DIR` pointing at a family's folder. `--provider cursor`
needs no key. `--out PATH` chooses the report file; the defaults are `docs/evals/models.md` and, for `cursor`,
`docs/evals/cursor.md`. `mise run ai-eval -- --help` lists every option. `KINDRED_AI_FAKE=1` runs on the fake provider and
sends nothing.
