# The AI assistant and image features

Kindred has an optional AI layer: a chat assistant for the family, face finding in photographs, a portrait look from a
photo, and a coat of arms suggested from a surname. Nothing runs until a steward adds a provider and a key, and each
feature is switched on separately. This page says what each feature sends, to whom, and how the key is kept.

## Turning it on

A steward opens the family's AI settings (`/settings/ai`) and chooses:

- **A provider and a model.** Anthropic (default model `claude-sonnet-5-5`), OpenAI (default `gpt-6.1-sol`), or
  OpenRouter (default `anthropic/claude-sonnet-5-5`, and any model OpenRouter lists). The model can be changed.
- **The key** for that provider. It is saved for the family, and the page shows only its last four characters.
- **Which features are on.** Assistant, faces, avatar and arms. All four are off by default.
- **A daily token budget.** The default is 300,000 tokens per UTC day, shared by the family. A budget of 0 turns the
  AI off. A call that would go over the budget is refused before it is sent.

Each family has its own settings, so one family's key is never used for another.

## What each feature sends

Every provider call is made by the server. The browser never talks to a provider, and the key never reaches it.

**The assistant** (chat). Each turn sends the provider:

- a system prompt, in the reader's language, that describes the assistant's job and its tools;
- the conversation so far, which is the reader's own messages and the assistant's replies (stored per reader and family);
- the results of the read tools the model asked for. `search_people`, `read_person` and `relatives` return the people
  the reader is allowed to see: names, dates, places, occupation, the biography (cut to 1,500 characters), up to 40
  fields, and family links. **Private fields are included only for editors and stewards**, the same rule the rest of the
  app follows, and the reader's role decides what is returned.

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
- Keys are never written to logs, and the server's error messages do not include them.

The key is the only secret the AI layer holds. Its sealed form is useless without the secret, so back up the secret
with the database.

## Limits and failures

- The daily budget counts tokens used per family per UTC day, in `ai_usage`. A call made after the budget is spent is
  refused with a message that says so.
- Failures are typed: not configured, out of budget, a wrong key, rate limited, a timeout, the provider unreachable,
  a provider error, a reply that does not match the expected shape, or a key that cannot be read. The page says which
  one, and what to do.
- Each feature validates the provider's answer against a schema before it uses it. An answer that does not fit is
  refused, not guessed at.

## Testing without a provider

`KINDRED_AI_FAKE=1` makes every AI feature use scripted answers instead of a provider. It is for the tests, and it sends
nothing anywhere.

## Where the code is

- `src/lib/ai/settings.server.ts`: the settings, the budget and the adapter for each feature.
- `src/lib/ai/secret.server.ts`: sealing the key.
- `src/lib/ai/adapters.ts`: the three providers, behind one interface (`api.anthropic.com`, `api.openai.com`,
  `openrouter.ai`).
- `src/lib/ai/chat.server.ts` and `tools.server.ts`: the assistant's loop and its tools.
- `src/lib/ai/vision.server.ts`: faces, portrait looks and arms.
