# The AI assistant and image features

Kindred has an optional AI layer: a chat assistant for the family, face finding in photographs, a portrait look from a
photo, and a coat of arms suggested from a surname. Nothing runs until a steward adds a provider and a key, and each
feature is switched on separately. This page says what each feature sends, to whom, what it costs, and how the key is kept.

## Turning it on

A steward opens the family's AI settings (`/settings/ai`). The page has five steps:

1. **Provider.** Anthropic, OpenAI or OpenRouter, each as a card with a "Get a key" link to that provider's key page.
2. **API key.** Paste the key. It is checked as soon as typing pauses: a key that works shows the number of models
   the provider offers, and one that does not says why. The saved key is shown only as its last four characters.
3. **Model.** A searchable list from the provider, recommended models first. Each row shows the price per 1M tokens,
   capability badges (sees images, tools, web search, context size) and how many typical conversations $1 buys. You can
   also type any model id the provider offers.
4. **Features.** One switch each: assistant, faces, portrait, arms, and web search. Each says what it does and what it sends.
5. **Monthly budget.** A budget in US dollars, a bar for this month's spend, and the day the budget starts again.

Each family has its own settings, so one family's key is never used for another.

## Models and prices

**Listing models.** The server asks the provider for its models with the key on the page, or the saved key:

- Anthropic: `GET /v1/models`, every page. Retired models are left out. The list says which models see images and
  support web search, and gives each model's context size.
- OpenAI: `GET /v1/models`, filtered to chat and reasoning models (embeddings, speech, images, moderation and codex
  models are left out). The list gives no context size or capabilities, so the page shows none.
- OpenRouter: `GET /api/v1/models`, which lists each model's prices, context size, and whether it takes images and tools.

A list is cached in memory for five minutes, per provider and key. The key is hashed for the cache and never stored or
logged by the listing. If a list cannot be read, the page says why and you can still type a model id.

**Recommended models** are in `src/lib/ai/recommended.ts`: one balanced, one cheap and one best-quality model per provider.
They are provisional. The choices are first picks, not yet measured on real family questions. A measured test comes later.

**Prices** are in `src/lib/ai/prices.ts`, with the date they were checked and the source of each provider's prices.
Anthropic and OpenAI prices are in a table there (USD per 1M tokens, input and output). OpenRouter has no table: its
prices come from its own model list. Web search costs $10 per 1,000 searches on Anthropic and OpenAI.

**A model with no known price.** Kindred cannot enforce the budget exactly for a model whose price it does not know. The
page says so, and shows two fields to enter the model's input and output price per 1M tokens. Until a price is entered,
each call is booked at a conservative default: the dearest price in the table. A price the steward enters is stored for
the family and used for that model.

Prices change. Re-check the sources listed in `prices.ts` when a model is added, and update the table and its date.

## The monthly budget

The budget is money, in US dollars, not tokens: the cost of a token depends on the model. The default is **$5 a month**,
shared by the family. A budget of 0 turns the AI off.

- **Months are UTC.** The budget starts again on the first of each month, UTC. The page shows that day.
- **Every call is booked before it is sent.** Its estimated cost is added to the month's spend with one conditional
  update that fails when the call would go past the budget. Two calls racing for the last of the budget cannot both get
  it. A refused call is never sent and spends nothing.
- **The booking is settled to the real cost.** When the provider answers, the booking is replaced by what the call
  cost: OpenRouter's reported USD cost when it reports one; otherwise the tokens the call used and its web searches, at
  the model's price. The estimate covers the input, the reply's maximum length and the searches the call may run.
- **A failed call is charged for what it billed.** Its completed requests are charged at their real cost. A request that timed
  out or gave an unreadable reply is charged its estimate, since the provider may have billed it. A refused or unbilled failure costs nothing.
- **One call may not take more than a fifth of the budget.** A call whose estimate is more than 20% of the month's budget is
  refused with a message, not run on a guess. The rule does not apply below a $1 budget. Enter the model's prices, or raise the budget.

Spend is stored in `ai_spend` (micro-dollars, one row per family per UTC month). Each family's custom prices and budget are
in `ai_settings` (migration `migrations/accounts/0007_ai_money.sql`). The older `ai_usage` table (tokens per day) is no
longer written.

## Web search

**Web search is off by default.** A steward turns it on in step 4. When it is on, the assistant may look up a general fact on
the web once per reply, through its `web_lookup` tool. Each lookup is a request of its own, and each search costs extra
(see above). The chat's own requests never enable a provider's search.

- **The lookup:** one request whose only input is a fixed instruction and the query the assistant wrote. No family data and no
  chat history go with it. Before it is sent, the query is checked: it is refused if it names a living person (a given name
  with their surname, current or birth, in any order, spelling or punctuation), uses a nickname of one, carries a private detail
  the reader may see (street and postcode, a medical note, a phone number; a city or a country is not private), carries a web
  address or a search operator such as `site:`, or carries a long number such as a telephone number. The reader is told why,
  never what the detail was. A second lookup in the same reply is not run.
- **Anthropic:** the server web search tool (`web_search_20250305`), with at most three searches per lookup. Anthropic runs the
  searches and cites them. A search turn that pauses is continued at most twice; the budget reserves for every request that
  may be made.
- **OpenAI:** the hosted `web_search` tool of the Responses API, with `max_tool_calls` as its ceiling.
- **OpenRouter:** its server tool `openrouter:web_search`, with `max_tool_calls` as its ceiling. The model decides whether to
  search. The `:online` suffix is removed from every model id, so no model searches by itself through its name, and OpenAI's
  search models and OpenRouter's Perplexity models are refused for the assistant and the research.
- **Reasoning models** are capped at 8,000 tokens with a low reasoning effort. OpenRouter's list says which models reason; the
  name is the guess for the rest. A reply that runs out of room is an error, not a partial answer.

The sources a reply drew on come back with it (`AiReply.sources`), and the assistant stores them with the reply.

The assistant is told never to search for living relatives or to put private details in a search. Its searches are for
historical and general facts only: a place's history, what a word or trade meant, a past event. Family facts still come only
from the tree's own tools.

## What each feature sends

Every provider call is made by the server. The browser never talks to a provider, and the key never reaches it.

**The assistant** (chat). Each turn sends the provider:

- a system prompt, in the reader's language, that describes the assistant's job and its tools (and, with web search on, the
  rule about what may be searched);
- the conversation so far, which is the reader's own messages and the assistant's replies (stored per reader and family);
- the results of the read tools the model asked for. `search_people`, `read_person` and `relatives` return the people
  the reader is allowed to see: names, dates, places, occupation, the biography (cut to 1,500 characters), up to 40
  fields, and family links. **Private fields are included only for editors and stewards**, the same rule the rest of the
  app follows, and the reader's role decides what is returned.
- with web search on, the query of each web lookup the assistant writes. It goes to the provider's search alone, after the
  guard above has checked it for names, private details, addresses and long numbers.

The propose tools (add a person, link relatives, set dates, add a memory, add a field) write nothing. Each proposal
appears as a card for the reader to approve, and approving it calls the same server function the reader would use by
hand, under the reader's own role. A contributor's approval cannot make an editor's change.

**Faces in a photo.** The photo itself is sent as an image, to find faces and suggest where each person is. The result is
a suggestion: a face is never tagged to a person until someone confirms it.

**A portrait look.** The chosen photo is sent as an image, and the provider suggests a look (skin, hair and eye colour
from fixed lists). Nothing is saved without the reader keeping it.

**Arms from a surname.** Only the surname is sent, and the country when one is recorded. Nothing else about the family
leaves the server for this feature. The provider suggests designs, and the reader chooses whether to keep one.

Kindred does not send a family's whole database, and it does not send anything on a schedule. Each call is a response
to a reader's action.

## Privacy

What leaves the app, per feature, is listed above and on the settings page. In short: a question, a photo, a surname, or
the names and facts the assistant reads from the tree goes to the chosen provider, using the family's key. Web search adds
the search queries to that list. Kindred adds nothing else. The provider keeps requests under its own terms, which apply to
those requests and not to Kindred. An editor's or steward's private fields may reach the provider when they use the
assistant. Turn a feature off to stop it sending anything.

## How the key is kept

- The key is stored in `accounts.db` (table `ai_settings`), never in the family's database and never in a file in the
  repository.
- It is sealed with **AES-GCM (256-bit)**. The key for sealing is derived with **HKDF-SHA-256** from the server secret
  `KINDRED_SECRET`, with the salt `kindred-ai-keys/v1` and the info `tree:<family id>`, so a sealed key cannot be moved
  to another family. The stored form is `v1.<iv>.<ciphertext>`, with a fresh random 12-byte IV for each save.
- On Node the secret comes from `KINDRED_SECRET`, or else from `data/secret`, which is made on first use with mode 600.
  On Cloudflare it must be set as a Worker secret (see [deploy-cloudflare.md](deploy-cloudflare.md)).
- Changing `KINDRED_SECRET` makes the saved keys unreadable. The settings page then asks for the key again. Nothing else
  is lost.
- A key typed on the settings page is used for the checks and the model list, and is stored only when the steward saves.
  Keys are never written to logs, and the server's error messages do not include them.

The key is the only secret the AI layer holds. Its sealed form is useless without the secret, so back up the secret
with the database.

## Limits and failures

- The monthly budget counts dollars booked per family per UTC month, in `ai_spend`. A call that would take the month past
  its budget is refused with a message that says so, and says when the budget starts again.
- Failures are typed: not configured, out of budget, a wrong key, rate limited, a timeout, the provider unreachable,
  a provider error, a reply that does not match the expected shape, or a key that cannot be read. The page says which
  one, and what to do.
- Each feature validates the provider's answer against a schema before it uses it. An answer that does not fit is
  refused, not guessed at.

## Testing without a provider

`KINDRED_AI_FAKE=1` makes every AI feature use scripted answers instead of a provider, and makes the model list return two
fixed models. It is for the tests and the browser harness, and it sends nothing anywhere. The stubbed tests in
`src/lib/ai-adapters.test.ts` replace `fetch` to check each provider's request shape, its parsing of replies, web search,
and the model lists. `src/lib/ai-prices.test.ts` checks cost calculation and price resolution, and
`src/lib/ai-budget.test.ts` checks the budget: racing calls, refused calls, settlement and failures.

## Where the code is

- `src/lib/ai/settings.server.ts`: the settings, the monthly budget (reserve and settle), and the adapter for each feature.
- `src/lib/ai/prices.ts`: model prices, their sources and the cost calculation. Pure, so the browser can read it too.
- `src/lib/ai/recommended.ts`: the recommended models, per provider.
- `src/lib/ai/models.server.ts`: listing a provider's models, with a short in-memory cache.
- `src/lib/ai/secret.server.ts`: sealing the key.
- `src/lib/ai/adapters.ts`: the three providers, behind one interface (`api.anthropic.com`, `api.openai.com`,
  `openrouter.ai`), with web search for each.
- `src/lib/ai/chat.server.ts` and `tools.server.ts`: the assistant's loop and its tools.
- `src/lib/ai/vision.server.ts`: faces, portrait looks and arms.
- `src/components/assistant/AiSettings.tsx`: the settings page, in five steps.
- `src/lib/ai.functions.ts`: the server functions the page and the assistant call, including `aiListModels`.
