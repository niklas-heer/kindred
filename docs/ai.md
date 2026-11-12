# The AI assistant and image features

Kindred has an optional AI layer: a chat assistant for the family, face finding in photographs, a portrait look from a
photo, and a coat of arms suggested from a surname. Nothing runs until a steward adds a provider and a key, and each
feature is switched on separately. This page says what each feature sends, to whom, what it costs, and how the key is kept.

## Turning it on

A steward opens the family's AI settings (`/settings/ai`). The page has these parts, in order:

1. **Providers.** One card for each of Anthropic, OpenAI and OpenRouter. Paste a provider's key and save it; each card links to that provider's key page. A connected card shows the key's last four characters, and can test the connection, replace the key, or remove it. A family may connect several providers at once. Each key is used only for its own provider.
2. **What uses what.** One row per job: the assistant chat, name research and arms, finding people in photos, an avatar from a photo, painted portraits, and the four background tasks (arms review, occupation translations, Chronicle translations, name meanings). Each row has the job's switch, its provider and its model, and a rough cost estimate. The default is **same as the assistant**, which follows the assistant's provider and model. A job may pick another connected provider and a model that provider lists, or type a model id. Painted portraits offer only providers that can paint (OpenRouter's image models, today). Web search is one switch for the family, and its privacy line names the provider the assistant uses.
3. **Monthly budget.** A budget in US dollars, a bar for this month's spend, and the day the budget starts again. One budget covers every job, whatever provider it uses.
4. **Privacy.** One line for each job, naming the provider it goes to, or saying that it is off and sends nothing.
5. **Background work** (schedules, the cap for background spending, Run now) and **Painted portraits** (what a painting sends).

Each family has its own settings, so one family's keys are never used for another.

**A job whose provider is removed waits.** When a steward removes a provider, every job that uses it reports that it needs a provider, and nothing is sent. The job's choice is kept, so connecting the provider again restores it. Nothing is rerouted to another provider, and a job that follows the assistant waits for the assistant's provider in the same way. Saving a job on a provider that is not connected is refused.

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
**How they were chosen.** The Anthropic and OpenRouter picks were measured on 2026-11-08 with `scripts/ai-eval.ts`, on made-up
family data: names research, arms, tool use, proposals, languages, photo questions and web research. The default model per provider
(`DEFAULT_MODEL` in `src/lib/ai/types.ts`) is Anthropic `claude-haiku-5-5` (it passed every check at about a twelfth of Sonnet's cost),
OpenAI `gpt-6.1-sol`, and OpenRouter `google/gemini-3.8-flash`. The OpenAI picks are still provisional, first picks that no one has
measured; the settings page marks which is which. The tables are in [evals/](evals/README.md), with how to run them again
(`mise run ai-eval`; a real run costs money). They test made-up data, not your family, so they are a start, not a promise.
**Recommended painters** are there too, from a bake-off of 21 image models: GPT Image 2.6 Flare is the best and the portrait route's default when no model is chosen (about $0.048 a portrait), and FLUX 3 Image Klein is the budget pick (about $0.009); one OpenRouter no longer lists is not offered.

**The family's portrait style.** A steward sets it in Painted portraits, in AI settings, with a Reset to default; it is bounded to 800 characters. Every portrait in the family uses it, so they stay uniform, and the text goes to the painter as style only. Framing, likeness and a gentle touch-up are fixed rules the style cannot change: a square head-and-shoulders portrait with room above the hair, the whole head inside the app's circle even from a tightly cropped photo, the person kept as they are at their apparent age. Requests ask for `aspect_ratio: 1:1`, because some models refuse pixel sizes.

**A person's own portraits.** An editor, or the member whose account is linked to that person, may paint and tweak a portrait; the server checks this on every call. Tweaks are fixed choices (closer or farther, warmer or cooler, a gentle smile) and a note of up to 140 characters, added after the family style and before the fixed limits, so they never replace it. A person keeps up to 6 portraits: the oldest unused one goes first, and never the one shown. Drafts are separate, are not listed, and are swept after an hour. Nothing changes what a person shows until someone chooses "Use this portrait" or "Show this one". Portraits are in the family's monthly budget.

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

## Operator-funded AI

On a server that hosts many families, the operator decides where the AI's key comes from (`ai.source`, in the operator
console's Policies; [hosting-many-families.md](hosting-many-families.md#policies)): each family's own key (the default, and
everything above), only the operator's key, either, or no AI. The operator can also turn the assistant and its helpers, or
painted portraits, off for some or all families (`feature.assistant`, `feature.portraits`). These are checked in
`routeAdapter` (`policyGate` in `settings.server.ts`) before any key is opened, so every job, foreground or background, is
refused on the server when the operator says no; the page hides what is off, and the background tasks are skipped with
"turned off by the operator". Nothing a family set up is deleted: its keys, routes and switches come back as they were.

**Never on by itself.** When the operator offers their AI, a steward opts in under **This server's AI** at the top of the AI
settings (`ai_settings.funding = 'operator'`). Until then nothing changes: under *either* the family keeps its own key, under
*only the operator's key* it has no AI. Opting in means the operator's provider handles the family's requests on the
operator's behalf, so the page says so before the switch. Opting out goes back to the family's own keys at once.

**What changes for an opted-in family.** Every job except painting goes to the operator's provider and model, with the
operator's key (`operator-funding.server.ts`, `operatorAdapter`); the family's own routes and keys are kept for later and the
settings page saves no route changes meanwhile. A steward's per-chat model choice does not apply. Painted portraits are never on
the operator's money: they wait until the family is back on its own key. The page shows "Provided by this server: $1.20 of
$2.00 this month".

**The operator's money is booked like the family's budget, twice over:**

- **Two limits.** Each family's monthly budget from the operator, and a server-wide monthly ceiling for all families together
  (UTC months). Changing a budget never resets what was spent.
- **Reserved before the call, atomically, as a strict maximum.** A family's own budget may estimate; the operator's money may
  not. So an operator-funded call reserves the most it can cost: the reply's cap (sent to the provider as the call's
  `max_tokens`, so the reply stops there) and its input bounded by its bytes (a tokenizer makes at most one token of a byte,
  plus a little for each message's framing). One batch of statements adds that to the family's operator spend
  (`ai_operator_family_month`, kept by the family's id, so deleting a family and making it again under the same id does not
  start it at 0) and the month's total (`ai_operator_month`) behind two guards, one per limit, and writes a booking row
  (`ai_operator_booking`). Two calls racing for the last of either limit cannot both get it. One call may not take more than a
  fifth of the family's operator budget.
- **Nothing that cannot be bounded.** A web search (the pages it reads in cannot be counted beforehand, and it is billed per
  use) and a picture (each provider counts an image its own way) are refused on the operator's money; the assistant offers no
  web search while a family is operator-funded, and the background tasks' name research runs without one.
- **Settled once, at what it cost.** After the call the booking is replaced by what it cost (the provider's reported cost, or
  its usage at the model's price; a failure as described above). Should a provider bill more than was reserved (a price that
  changed, a provider counting differently), the whole cost is booked, so the month's figures and both limits count it, and
  the difference is kept in `ai_operator_overage`, logged and shown on the console's Health tab. The bound did not hold, so
  the operator's AI is **paused for that family and model** (its calls are refused) until the operator acknowledges it on the
  Health tab (logged). The settlement is guarded on the booking not being settled yet, so settling it twice changes nothing. A
  booking that is never settled (the server stopped mid-call) keeps its reservation.
- **Only known prices.** The operator's model must have a price in Kindred's table or OpenRouter's list: a model without one is
  refused when the operator saves it and again when a call is made. A family's own prices never count for the operator's money.
- **The family's own budget still applies** on top, as the family's own cap: a call needs room in both.

`src/lib/operator/policy.test.ts` checks the racing reservations against both limits (also when the provider bills more than
any reservation), the byte bound on input, the refusal of searches and pictures, that deleting a family keeps its month's spend,
the idempotent settlement, a model with no price, the opt-in, and a call end to end on the fake provider.

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
  fields, and family links. **Fields at the Editors level are included only for editors and stewards, and a Personal field is never included, not even for its author**, the same rule the rest of the
  app follows, and the reader's role decides what is returned.
- life events and sources: `read_person` also returns a person's life events (at most 20) and the sources cited for their
  facts (at most 20); `list_events` finds events across the family (at most 30); `list_sources` and `read_source` return the
  family's sources and what each is cited for (at most 30), with the transcriptions cut short. Every member may read them, as
  in the app. A source's link to a private research document is named only for editors and stewards.
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
and the person, link, date, memory and detail proposals that were there before. The assistant never manages access or
invitations, and never changes AI settings or keys: no tool offers those. Removals are cards too, and only when the reader
asked for one.

**Life events and sources.** Editors and stewards (the roles that may change them by hand) are offered
`propose_life_event` (add or change an event, optionally citing a source), `propose_source` (add or change a source in the
family's list), `propose_citation` (cite a source for a birth, death, name, event, partnership or parent link, or change a
citation) and `propose_remove_life_record` (an event with its citations, a source with its citations, or one citation).
Approving sends the card to the same server functions as the Edit tab and the Sources page (`events.functions.ts`,
`sources.functions.ts`), so their checks, the change history and the retry key apply as for the forms; a change card keeps
its starting point and is refused if the record moved on since. A source the reader names but the family does not have
yet is its own card, and the event or citation card cites it by its title: approve the source first (Apply all does them
in order), otherwise the card says so and writes nothing. The prompt tells the assistant to cite a source when the reader
names one and never to invent a source, a page or a transcription. In the fake provider, "add that she emigrated in 1952,
according to the passenger list" on a person's page proposes both cards (`src/lib/ai/fake-abilities.ts`).

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
- **Occupations and name meanings.** Each occupation the family wrote that the vocabulary does not know, into the languages the
  steward chose. It sends the occupation's text as written, and the answer is kept in `occupation_translation`, as for "Translate".
  The same task translates researched name meanings (their text, language labels, ideas and note) and the arms check's reason and
  advice, into `house_translation`. It sends only those words: root words, the surname, source links, the family's own words and
  anything about a person stay out. Until a text is translated the reader sees the original, and a text edited or researched
  again is translated afresh. Needs the assistant on.
- **Chronicle translations.** Each story, into the chosen languages. The translation is stored beside the original in
  `story_translation`. The original is never changed. A story edited since it was translated is shown in its original text
  until the next run translates it again. The Chronicle shows a translation in the reader's language with the label
  "Translated by AI", and the original one click away. Needs the assistant on.
- **Collect name meanings.** Up to four house names per run that have no collected or saved meanings. Sends only the surname and the house's country, through the same research step a steward uses, with its web search only when the family has web search on. Results are stored as collected, with nothing chosen (`house_meaning`, unchosen rows): no saved meaning and no arms check until a steward chooses. Only stewards see them, on the house page, where one click on one meaning saves it and the arms check follows; the steward can pick more in the research panel or dismiss them all. A name that fails is tried three times at most, and a problem that is not the name's (the budget, the key, a rate limit) does not count. Needs the arms feature on.

What background work never does:

- **It never changes the family's record by itself.** It fills the caches and the translations, and it raises suggestions.
  An arms review that suggests a change is listed on the AI activity page under "Waiting for a steward", and it changes
  nothing until a steward acts on it (or keeps the arms, which is the existing "Keep these arms").
- **It never sends a person's field, at any level.** The background tasks do not read `person_field` at all. A test sends every task through a
  real adapter behind a stubbed `fetch` and checks that a private value is not in any request body.
- **It searches the web only for name meanings.** That task may, and only when the family has web search on; any other background call that asks for a search is refused before it is sent.

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
What leaves the app, per job, is listed above and on the settings page, and each line names the provider it goes to. In short: a question, a photo, a surname, or the names and facts the assistant reads from the tree goes to the provider that job uses, with that provider's key. A photo reaches a provider only when the assistant looks at it (faces on), a drawn avatar is made from it, or a portrait is painted from it; a photo's date, place and caption travel as text. A family session's transcript goes once, when the reader finishes it. Speech is turned into text by the browser before anything reaches Kindred, and the text goes to the provider only when the reader sends it. For arms, the family's own words about a name and the meanings the reader chose go to the provider too, in the steps without web search. Web search adds the search queries to that list: for arms, the surname and country only. Kindred adds nothing else. The provider keeps requests under its own terms, which apply to those requests and not to Kindred. An editor's or steward's private fields may reach the provider when they use the assistant. Turn a job off to stop it sending anything.

## How the key is kept
- Each connected provider's key is stored in `accounts.db`, in table `ai_provider` (one row per family and provider), never in the family's database and never in a file in the repository.
- It is sealed with **AES-GCM (256-bit)**. The key for sealing is derived with **HKDF-SHA-256** from the server secret `KINDRED_SECRET`, with the salt `kindred-ai-keys/v1` and the info `tree:<family id>|provider:<provider>`. So a sealed key cannot be moved to another family, and it cannot be opened as another provider's key. The stored form is `v2.<iv>.<ciphertext>`, with a fresh random 12-byte IV for each save.
- Keys sealed before several providers existed (`v1.`, bound to the family only) still open. Migration `0010_ai_providers` moved them into their providers' rows unchanged; a key is sealed as `v2` again when it is next saved.
- `keyFor(tree, provider)` in `src/lib/ai/providers.server.ts` is the only place a key is opened, and it opens the key of the provider it is asked for. A route never falls back to another provider's key.
- On Node the secret comes from `KINDRED_SECRET`, or else from `data/secret`, which is made on first use with mode 600. On Cloudflare it must be set as a Worker secret (see [deploy-cloudflare.md](deploy-cloudflare.md)).
- Changing `KINDRED_SECRET` makes the saved keys unreadable. The settings page then shows each affected provider as unreadable, and asks for its key again. Nothing else is lost.
- A key typed on the settings page is used for the checks and the model list, and is stored only when the steward saves it. Keys are never written to logs, and the server's error messages do not include them. The settings page and its status receive each provider's state and last four characters, never the key.

The keys are the only secrets the AI layer holds. Their sealed form is useless without the secret, so back up the secret with the database.

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
`src/lib/ai-life-edits.test.ts` checks the life-event, source and citation cards: who is offered them and who is refused,
what they say, approving through the forms' server path with its history, a stale card, and taking a change back.
`src/lib/jobs/ai-tasks.test.ts` checks the background tasks: off by default, the schedule and the daily call limit, the cap (it
stops the work, and stays stopped on the next run), batches that resume, the outgoing request bodies (no private value),
originals that are never altered, a stale translation that is not shown, web search refused, the arms review run only when its
fingerprint changes, and the role checks on the server functions. Its fetch is replaced by a guard, so a test that reaches a
provider fails instead.

`src/lib/ai-providers.test.ts` checks that each route's request goes to its own provider with that provider's key (the stub reads the URL and the key), that removing a provider disables its jobs without rerouting them, that the settings page, the status and a failed check carry no key, and that a viewer and an editor can't reach the settings. `src/lib/ai-migration.test.ts` runs migration 0010 on a database holding today's shape, with a family that has both keys, one with a conflicting OpenRouter pair, one whose portrait reuses the family key, and one with only a portrait key, and checks that the switches, budget, prices and spend are kept and that every moved key still opens for its family and for no other.

## Where the code is
- `src/lib/ai/providers.server.ts`: the connected providers and their keys (`keyFor` is the only opener), the routes (which provider and model each job uses), and the route checks.
- `src/lib/ai/page.server.ts`: what the settings page shows and what one save changes, in order; each switch is checked against its route before anything is written.
- `src/lib/ai/settings.server.ts`: the feature switches, the monthly budget (reserve and settle), web search, each route's adapter (`routeAdapter`, `adapterForFeature`), the operator's policies for the AI (`policyGate`, `aiPolicyOn`), and the status.
- `src/lib/ai/operator-funding.server.ts`: operator-funded AI: the operator's keys, the reservation against the family's operator budget and the server's ceiling, the idempotent settlement, the steward's opt-in.
- `src/lib/ai/testing.server.ts`: one call that connects a provider and sets the assistant, for the tests and the browser harness.
- `src/lib/ai/prices.ts`: model prices, their sources and the cost calculation. Pure, so the browser can read it too.
- `src/lib/ai/recommended.ts`: the recommended models, per provider.
- `src/lib/ai/models.server.ts`: listing a provider's models, with a short in-memory cache.
- `src/lib/ai/secret.server.ts`: sealing and opening a provider's key (`v2`, and `v1` for the older form).
- `src/lib/ai/adapters.ts`: the three providers, behind one interface (`api.anthropic.com`, `api.openai.com`, `openrouter.ai`), with web search for each.
- `src/lib/ai/chat.server.ts` and `tools.server.ts`: the assistant's loop and its tools.
- `src/lib/ai/family.server.ts`: the family draft's checks (duplicates, loops) and its approval, one step at a time.
- `src/lib/ai/background.ts`: the background tasks' names, schedules, batch and call limits, and the settings' shape. Pure.
- `src/lib/ai/background.server.ts`: a task's readiness (its route, its switch, the budget), the background cap and its booking, the run log, the daily run (`runScheduled`, called by `src/lib/jobs/ai-tasks.ts`), and the activity page's data.
- `src/lib/ai/background-tasks.server.ts`: what each task has waiting and how one item is done.
- `src/lib/ai/background.functions.ts`: the server functions for the background settings, Run now, the activity page and the badge.
- `src/lib/ai/portrait.server.ts`: painting: the switch, the image list, one portrait's booking and call, and the candidate review. The painter's provider and model are the portrait route's.
- `src/lib/ai/vision.server.ts`: faces and portrait looks.
- `src/lib/ai/arms.server.ts`: arms from a surname, in its web search, research and design requests.
- `src/lib/ai/lookup.server.ts`: the assistant's web lookup and the guard that checks its query.
- `src/lib/ai.functions.ts`: the server functions the settings page and the assistant call, including `aiListModels` and `aiSaveProvider`.
- `src/components/assistant/AiSettings.tsx`: the settings page: the providers, "What uses what", the budget, the privacy lines. `PortraitSettings.tsx` and `BackgroundSettings.tsx` hold what is specific to painting and to the background tasks.
- `migrations/accounts/0010_ai_providers.sql`: the tables `ai_provider` and `ai_route`, and the move from the single key.
