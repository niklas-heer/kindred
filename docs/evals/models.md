# Which models do Kindred’s AI jobs best

Measured on 2026-11-08 with `scripts/ai-eval.ts`. Models: `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5` (anthropic).

The budget was $1.000 for the whole run, shared by all models. Spent: $0.836.

## Results

| Model | Names | Arms | Tools | Proposals | Language | Vision | Web | Overall | Latency | Cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `claude-haiku-5-5` | 9/9 | 3/3 | 3/3 | 3/3 | 2/2 | 1/1 | 1/1 | 100% | 2284 ms | $0.028 |
| `claude-sonnet-5-5` | 9/9 | 3/3 | 3/3 | 3/3 | 2/2 | 1/1 | 0/1 | 86% | 2631 ms | $0.348 |
| `claude-opus-5-5` | 9/9 | 2/3 | 3/3 | 2/2 (1 skipped) | skipped | skipped | skipped | 92% | 3414 ms | $0.460 |

Each cell is passed/run per task. "skipped" items were not sent because the budget would have been passed. The overall score is the mean of the tasks’ pass rates; a task that failed counts as 0, and a task the budget skipped is left out.

## Method

- **Made-up data only.** An invented family (The Testfeld family) is written into a temporary folder with `scripts/seed.ts`, and the surnames are common public names whose meanings are in dictionaries. Nothing is a real person. The cases are in `scripts/ai-eval.fixtures.ts`.
- **The app’s own code.** Each call goes through the provider adapter, and the prompts and functions are the app’s: `researchName` and `designArms` (arms), `systemPrompt`, `toolsFor` and `runTool` (the assistant), and the face-box schema.
- **Names.** Nine surnames, eight with a known meaning and one made-up trap. A known name passes when each expected meaning appears among the candidates and no candidate is stated as well-attested without being expected. The trap passes only when no candidate is stated as well-attested.
- **Arms.** Three surnames, two steps as the app runs them: the meanings, then the top two chosen for the designs. A design passes when the schema holds, its charges exist, the tincture rule holds and it names a chosen meaning. Repairs (unknown charges, clashes the app fixed, designs it dropped) are counted and not failed.
- **Tools.** Three questions on the family: a fact that needs a tool, a kinship question, and a question the tree does not record, which must be said not to be recorded with no invented year.
- **Proposals.** Three requests that must become a proposal card with the right kind and details. The reply must not say anything was saved, because nothing is written.
- **Language.** The same kind of question in German (du) and Afrikaans (jy). A reply passes when it uses at least one word of that language, none of the other languages’ words the scorer lists, and no formal address.
- **Vision.** One generated picture; the reply passes when it is the face-box shape with each box between 0 and 1. Nothing else is judged.
- **Web.** One research with web search, for the surname Schmidt: the meaning must be found, and a cited page must be listed.
- **Cost.** Each call is estimated before it is sent, and a call that would pass the budget is not sent. The cost after a call is what the provider billed (OpenRouter reports its own), so the total is the real spend, not the estimate. Prices are those in `src/lib/ai/prices.ts`, checked 2026-11-08 (https://platform.claude.com/docs/en/about-claude/pricing, https://developers.openai.com/api/docs/pricing, https://openrouter.ai/api/v1/models).
- **Latency.** The mean time of each successful call.
- **Raw answers are not kept here.** Only the scores and short notes are written.

## Notes

- `claude-sonnet-5-5`, web Schmidt: bad-output: The AI’s answer couldn’t be read. Try again.
- `claude-opus-5-5`, arms Sjöberg: 4 designs, not valid: tincture rule
