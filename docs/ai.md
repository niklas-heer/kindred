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
  with their surname, current or birth, in either order, with umlauts and ß folded, and with punctuation ignored; a surname's
  particles such as "van" or "de" do not count on their own), uses a nickname of one, carries a private detail
  the reader may see (street and postcode, a medical note, a phone number; a city or a country is not private), carries a web
  address or a search operator such as `site:`, or carries a long number such as a telephone number. The reader is told why,
  never what the detail was. A second lookup in the same reply is not run.
- **Anthropic:** the server web search tool (`web_search_20250305`), with at most two searches per lookup. Anthropic runs the
  searches and cites them. A search turn that pauses is continued at most twice; the budget reserves for every request that
  may be made.
- **OpenAI:** the hosted `web_search` tool of the Responses API, with `max_tool_calls` as its ceiling.
- **OpenRouter:** its server tool `openrouter:web_search`, with `max_tool_calls` as its ceiling. The model decides whether to
  search. Every `:online` is removed from an OpenRouter model id, wherever it sits (`:online:nitro` becomes `:nitro`), because
  `:online` would switch on OpenRouter's web plugin for every request.
- **Models that search by themselves** are refused on OpenAI and OpenRouter alike: a model id that contains `-search` or
  `deep-research` (OpenAI's search and deep-research models, such as `gpt-4o-search-preview` or `o3-deep-research`), and any
  `perplexity/` model on OpenRouter. The refusal applies when a steward saves a model and when an adapter is made, so a model
  saved before this rule is refused too. The model list leaves these models out.
- **Reasoning models** are capped at 8,000 tokens with a low reasoning effort. OpenRouter's list says which models reason; the
  name is the guess for the rest. A reply that runs out of room is an error, not a partial answer.
- **Anthropic** replies are capped at 8,000 tokens too, since Claude's newer models think by default and the thinking counts
  against the cap. Those models take low effort. A JSON answer uses Anthropic's structured outputs (the schema's unsupported
  bounds are dropped, and zod checks them on the answer); older models keep a forced tool. A refusal is reported as a
  refusal, not as a bad answer, and the thinking blocks of a tool turn go back to Anthropic unchanged.

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

- with a family session (see below), the transcript the reader finished, once: the words they spoke or typed, each line with
  the speaker's name and id, up to 20,000 characters. A long session is refused with a message, not cut short.
- the photos the assistant lists (`list_photos`): dates, places, captions, album names and the people confirmed in each,
  at most 15 a list. A picture itself is sent only when the family's faces feature is on and the assistant asks to look at
  one (`describe_photo`, at most two a reply). With faces off, the assistant works from those details and says so.
- what is still missing (`missing_info`), for the people the reader can see, at most 12 a reply.
- the houses (`list_houses`), for stewards: names, succession law, head, heir and country.

The reader's role decides which of these the assistant is offered. A viewer gets only the reads.

The propose tools write nothing. Each proposal appears as a card for the reader to approve. Approving it calls the same
server function the reader would use by hand, under the reader's own role, or for a family draft `applyFamilyBatch`, which
checks each step the same way. A contributor's approval cannot make an editor's change. The cards are: a family draft
(new people, their facts and links, approved row by row or all at once), a photo's date, place and caption, an album for
several photos (new or existing), people tagged in a photo, a drawn avatar (`avatar`, when the avatar feature is on: the
drawing is shown before anything is kept), an occupation, a house's succession law, head, heir and country (stewards),
and the person, link, date, memory and detail proposals that were there before. The assistant never deletes anything,
never manages access or invitations, and never changes AI settings or keys: no tool offers those.

**A family draft.** The draft is checked before it is shown: a person who may already be in the tree (same given name, a
compatible surname, and the same birth year or an unknown one) is flagged, and a link that would make someone their own
ancestor is marked. On approval each new person is created first, then each link runs the same rules as the form that
links two people (`src/lib/relations.server.ts`). Every step has its own retry key, so a repeated approval replays what
already happened instead of writing twice. A step that cannot apply is reported and the rest carry on. A date stays as it
was given: "about 1938" is stored as `~1938`, and a date the calendar does not have is refused before the card appears.

**Speech.** The microphone button and a family session use the browser's own speech recognition (the Web Speech API). The
browser's speech service turns the voice into text. That service is the browser's, not Kindred's and not the AI provider's.
Kindred never records or keeps the sound. The microphone is asked for only when the reader presses the button, and it stops
when they press it again. Some browsers have no speech recognition (Firefox, for one): there the assistant says so, and the
reader types or pastes the words.

**A family session.** The reader chooses who is speaking (by default, themselves), so "my sister" means the right person
even when a parent is talking. The transcript stays on screen while it grows, and nothing is sent until the reader finishes
it. The whole transcript is then sent once, as one request, and the reply is one family draft with its questions.

**Faces in a photo.** The photo itself is sent as an image, to find faces and suggest where each person is. The result is
a suggestion: a face is never tagged to a person until someone confirms it.

**A portrait look.** The chosen photo is sent as an image, and the provider suggests a look (skin, hair and eye colour
from fixed lists). Nothing is saved without the reader keeping it.

**Arms from a surname.** Arms make up to three requests, and only the first one searches the web:

- **The web search** (only when web search is on) sends the provider the surname and the country, and nothing else. It is a
  request of its own, with a fixed instruction. Its notes and the pages it cites come back to Kindred.
- **The research** asks what the name may mean. This request has no web search, and it is where the family's own words about
  the name go: the text typed into the arms research for what the family says the name means, if any. It also gets the
  search notes, when there were any.
  Without web search, this is the only research request, and it sends the surname, the country and the family's words.
- **The designs** send the surname, the country, the family's words, and the meanings the reader chose. This request has no
  web search.

So the family's words and the chosen meanings do go to the provider, in the steps without web search. Only the web search
step is limited to the surname and the country. The provider suggests designs, and the reader chooses whether to keep one.

Kindred does not send a family's whole database. Each call is a response to a reader's action, except the background tasks a
steward has switched on, which are described in [Background tasks](#background-tasks) below.

**Does the arms still fit the name?** A steward who saves a name's research (or asks to check again) sends one request to the family's model, without web search: the chosen meanings, the family's own words about the name, and the arms as a blazon and as what each colour and charge stands for. Nothing else from the tree is sent. The answer is kept with a fingerprint of the arms and the meanings, so it is asked again only when one of them changes. Nothing asks on a page view.

## Background tasks

Three tasks can run on a schedule, without a reader present: the arms review, the occupation translations and the Chronicle
translations. A steward turns each one on in the AI settings, with its schedule (every day, or once a week). **All three are
off by default**, and each one says on its settings line what it sends.

- **Arms review.** For each house whose chosen meanings are saved, the same check the steward runs by hand, when the arms or
  the chosen meanings have changed since the last check. It sends what that check sends (see "Does the arms still fit the
  name?" above) and nothing else. Needs the arms feature on.
- **Occupation translations.** Each occupation the family wrote that the vocabulary does not know, into the languages the
  steward chose. It sends the occupation's text as written, and the answer is kept in `occupation_translation`, as for "Translate".
  Needs the assistant on.
- **Chronicle translations.** Each story, into the chosen languages. The translation is stored beside the original in
  `story_translation`. The original is never changed. A story edited since it was translated is shown in its original text
  until the next run translates it again. The Chronicle shows a translation in the reader's language with the label
  "Translated by AI", and the original one click away. Needs the assistant on.

What background work never does:

- **It never changes the family's record by itself.** It fills the caches and the translations, and it raises suggestions.
  An arms review that suggests a change is listed on the AI activity page under "Waiting for a steward", and it changes
  nothing until a steward acts on it (or keeps the arms, which is the existing "Keep these arms").
- **It never sends a private field.** The three tasks do not read `person_field` at all. A test sends every task through a
  real adapter behind a stubbed `fetch` and checks that a private value is not in any request body.
- **It never searches the web.** A background call that asks for a search is refused before it is sent.

How the work is done: each task works through its items in batches of four provider calls per run, and the lists are
recomputed from the record each time, so a run that stops early leaves the rest for the next run (nothing is done twice).
All families together make at most eight provider calls in one daily run, so the Cloudflare Free plan's limits hold; work
left over waits for the next day. **Run now** does one batch of one task, with the same limits, and is available only when
the task is on and the family's AI is set up.

The spending cap: background work may use a share of the monthly budget, a fifth by default (5 to 100 per cent, in the
settings). Each background call is booked against that share (`ai_background_spend`) and against the whole budget
(`ai_spend`), before it is sent. Whichever runs out first stops the work, with a message that says so. The AI settings
show what the month has spent in all.

The AI activity page (for stewards, from the account menu, which shows a small badge when something waits) lists each task's
state and what it still has to do, what is waiting for a steward, the spending against the cap, and the last runs: when, what
started it, what it did, what it cost, and any failure. Viewers and contributors never see the page or the badge.

## Privacy

What leaves the app, per feature, is listed above and on the settings page. In short: a question, a photo, a surname, or
the names and facts the assistant reads from the tree goes to the chosen provider, using the family's key. A photo reaches the
provider only when the assistant looks at it (faces on) or a drawn avatar is made from it; a photo's date, place and caption
travel as text. A family session's transcript goes once, when the reader finishes it. Speech is turned into text by the
browser before anything reaches Kindred, and the text goes to the provider only when the reader sends it. For arms, the
family's own words about a name and the meanings the reader chose go to the provider too, in the steps without web search.
Web search adds the search queries to that list: for arms, the surname and country only. Kindred adds nothing else. The provider keeps requests under its own terms, which apply to
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
`src/lib/ai-budget.test.ts` checks the budget: racing calls, refused calls, settlement and failures. `src/lib/ai-family.test.ts`
checks a family draft (links between new and existing people, retries, loops, dates, duplicates), each role's tools, and that
no tool deletes or manages access or settings. In the fake, a line `FAKE-FAMILY {json}` in a family session is the draft it proposes.
`src/lib/jobs/ai-tasks.test.ts` checks the background tasks: off by default, the schedule and the daily call limit, the cap (it
stops the work, and stays stopped on the next run), batches that resume, the outgoing request bodies (no private value),
originals that are never altered, a stale translation that is not shown, web search refused, the arms review run only when its
fingerprint changes, and the role checks on the server functions. Its fetch is replaced by a guard, so a test that reaches a
provider fails instead.

## Where the code is

- `src/lib/ai/settings.server.ts`: the settings, the monthly budget (reserve and settle), and the adapter for each feature.
- `src/lib/ai/prices.ts`: model prices, their sources and the cost calculation. Pure, so the browser can read it too.
- `src/lib/ai/recommended.ts`: the recommended models, per provider.
- `src/lib/ai/models.server.ts`: listing a provider's models, with a short in-memory cache.
- `src/lib/ai/secret.server.ts`: sealing the key.
- `src/lib/ai/adapters.ts`: the three providers, behind one interface (`api.anthropic.com`, `api.openai.com`,
  `openrouter.ai`), with web search for each.
- `src/lib/ai/chat.server.ts` and `tools.server.ts`: the assistant's loop and its tools.
- `src/lib/ai/family.server.ts`: the family draft's checks (duplicates, loops) and its approval, one step at a time.
- `src/lib/ai/background.ts`: the background tasks' names, schedules, batch and call limits, and the settings' shape. Pure.
- `src/lib/ai/background.server.ts`: a task's readiness, the background cap and its booking, the run log, the daily run
  (`runScheduled`, called by `src/lib/jobs/ai-tasks.ts`), and the activity page's data.
- `src/lib/ai/background-tasks.server.ts`: what each task has waiting and how one item is done.
- `src/lib/ai/background.functions.ts`: the server functions for the settings, Run now, the activity page and the badge.
- `src/components/assistant/BackgroundSettings.tsx` and `AiActivity.tsx`: the settings section and the activity page.
- `src/lib/relations.server.ts`: the rules for linking two people, shared by the form and the family draft.
- `src/lib/family-batch.functions.ts`: the server function a family draft is approved through.
- `src/components/assistant/ProposalCard.tsx`, `FamilyDraft.tsx`, `FamilySession.tsx`, `dictation.ts`: the cards, the session and the browser's speech.
- `src/lib/ai/vision.server.ts`: faces and portrait looks.
- `src/lib/ai/arms.server.ts`: arms from a surname, in its web search, research and design requests.
- `src/lib/ai/lookup.server.ts`: the assistant's web lookup and the guard that checks its query.
- `src/components/assistant/AiSettings.tsx`: the settings page, in five steps.
- `src/lib/ai.functions.ts`: the server functions the page and the assistant call, including `aiListModels`.
