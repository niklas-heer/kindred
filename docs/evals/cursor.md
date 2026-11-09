# Which models do Kindred’s AI jobs best

Source: Cursor. The models ran through Cursor’s own agent (the `agent` CLI), with its own system prompt, so this compares the models on these jobs. It does **not** test Kindred’s OpenAI or OpenRouter connection code.

Measured on 2026-11-08 with `scripts/ai-eval.ts`. Models: `gpt-5.6-sol-low`, `gpt-5.6-luna-high`, `gemini-3.8-flash-low`, `gemini-4-argon-low`, `grok-4.7-low`, `composer-2.5` (cursor).

The Cursor source has no budget: it is a subscription, so no dollar cost is counted and no call is stopped for one.

## Results

| Model | Names | Arms | Tools | Proposals | Language | Vision | Overall | Latency | Cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `gpt-5.6-sol-low` | 8/9 | 3/3 | 3/3 | 3/3 | 2/2 | skipped | 98% | 8146 ms | n/a |
| `gpt-5.6-luna-high` | 9/9 | 2/3 | 2/3 | 3/3 | 2/2 | skipped | 87% | 10634 ms | n/a |
| `gemini-3.8-flash-low` | 8/9 | 3/3 | 3/3 | 3/3 | 2/2 | skipped | 98% | 10682 ms | n/a |
| `gemini-4-argon-low` | 9/9 | 3/3 | 3/3 | 3/3 | 2/2 | skipped | 100% | 10886 ms | n/a |
| `grok-4.7-low` | 8/9 | 2/3 | 3/3 | 3/3 | 2/2 | skipped | 91% | 18778 ms | n/a |
| `composer-2.5` | 5/9 | 3/3 | 0/3 | 0/3 | 0/2 | skipped | 31% | 13502 ms | n/a |

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
- **Cursor source.** Each call is `agent -p --trust --mode ask --output-format json --model <id>`, run from an empty temporary folder that is removed after the run. No key is used. The prompt holds the system text and the conversation, and the JSON shape or the tool list is written into it; the reply is read from the CLI’s result, with a code fence stripped. A CLI error is retried once; a call that takes more than 120 s is not. Vision and web-search tasks are skipped for this source, and a skipped item is left out of the score.
- **Latency.** The mean time of each successful call.
- **Raw answers are not kept here.** Only the scores and short notes are written.

## Notes

- `gpt-5.6-sol-low`, names Petrov: missing: peter; 1 stated as certain
- `gpt-5.6-luna-high`, arms Sjöberg: 4 designs, not valid: tincture rule
- `gpt-5.6-luna-high`, tools kinship: no matching tool call; missing: jonas, lena
- `gemini-3.8-flash-low`, names Zorbelwitz-Quabbe: 1 stated as certain
- `grok-4.7-low`, names Zorbelwitz-Quabbe: 1 stated as certain
- `grok-4.7-low`, arms Heer: bad-output: Cursor’s answer was not the JSON shape asked for.
- `composer-2.5`, names Heer: bad-output: Cursor’s answer was not the JSON shape asked for.
- `composer-2.5`, names Bauer: 1 stated as certain
- `composer-2.5`, names Petrov: missing: peter
- `composer-2.5`, names Zorbelwitz-Quabbe: 2 stated as certain
- `composer-2.5`, tools right-tool: bad-output: Cursor’s answer was not the tool reply asked for: not JSON.
- `composer-2.5`, tools kinship: bad-output: Cursor’s answer was not the tool reply asked for: not JSON.
- `composer-2.5`, tools not-recorded: bad-output: Cursor’s answer was not the tool reply asked for: not JSON.
- `composer-2.5`, proposals memory: bad-output: Cursor’s answer was not the tool reply asked for: not JSON.
- `composer-2.5`, proposals phone: bad-output: Cursor’s answer was not the tool reply asked for: not JSON.
- `composer-2.5`, proposals birth: bad-output: Cursor’s answer was not the tool reply asked for: not JSON.
- `composer-2.5`, language de: bad-output: Cursor’s answer was not the tool reply asked for: not JSON.
- `composer-2.5`, language af: bad-output: Cursor’s answer was not the tool reply asked for: not JSON.
