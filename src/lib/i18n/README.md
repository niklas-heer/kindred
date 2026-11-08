# Contributing translations

English (`en.ts`) is the typed source of truth; German (`de.ts`) may be partial. Missing German
entries fall back to English and warn once per key in development. German consistently uses **du**.
Translate interface copy, never names, notes, occupations or other family-authored content.

```tsx
import { useT, formatDate, formatNumber, relativeTime, kinshipLabel } from '~/lib/i18n';
const t = useT(); // callable, with t.locale and t.setLocale('de')
t('common.people', { count: 3 }); // 3 people / 3 Personen
formatDate('2026-11-08', t.locale); // 8 November 2026 / 8. November 2026
relativeTime(timestamp, t.locale); // 3 days ago / vor 3 Tagen
kinshipLabel(kinship(f, me, id), t.locale); // accepts graph.ts's unchanged return type
```

Add a meaningful `surface.snake_case_key` to both dictionaries. Share `common.*` keys where suitable.
Messages interpolate `{name}` variables; numeric variables use locale-aware formatting. Plural entries
use `{one, other}` selected by `Intl.PluralRules` from numeric `count`. `ordinal` gives English ordinal
words (then numeric suffixes) or German `2.`; `ordinalWord` gives `second` / `zweite`.
Pure `translate(locale, key, vars)` supports SSR and non-React callers. Always pass a request-specific
locale to server formatters. There is no process-global current language.

The root route resolves each request's account cookie, then Accept-Language, then English, and
serializes that value for hydration. Browser choices are stored as `kindred:locale:<account-id>` in
localStorage and `kindred_locale_<account-id>` cookies (guest uses `guest`). The provider reconciles
localStorage after hydration, then keeps the document language and section titles current. A switch
updates React immediately without reloading. `LanguageSwitch` is shared by auth, Account and More;
the palette has one toggle command.

## Wave 2

Add nullable `locale TEXT CHECK(locale IN ('en','de'))` to the **account/user**, never tree membership.
Expose locale in `SessionInfo.user`, and provide an authenticated `setMyLocale({locale})` server
function. Server preference should override cookie/browser; save optimistically on switch, retain
localStorage/cookie for first render and signed-out use. No data-layer files were changed here.
Auth error codes should map to message keys; `translateMessage` temporarily translates known legacy
errors and leaves unknown diagnostic messages intact.

## Later translation sweep

- `src/routes/$tree/{index,access,almanac,atlas,chronicle,contacts,houses,house.$house,needed,people}.tsx`
- `src/components/{Canvas,Card,PersonPanel,QuickAdd,PlaceInput,ArmsEditor,ThemeSwitch,Toasts}.tsx`
- `src/components/Palette.tsx`: remaining commands, headings, search hints and person kinship hints
- `src/lib/{graph,dates,gaps,roles,traits}.ts`, `src/lib/auth/{today,client,errors}.ts` and server
  validation/auth errors: replace generated English strings and hard-coded date formatters at callers
- `src/routes/ui.tsx` and `src/routes/ui_.character.tsx` if the design-system demos are user-facing

Shell navigation, More, account/passkeys, home, sign-in, setup, invitations, first run, access/not-found
states and shared UI defaults are covered. Home's `today[].label` is still server-generated English
and belongs to the `auth/today.ts` sweep. Graph's existing `label` remains backward compatible; callers
must use `kinshipLabel(k, t.locale)` to show German kinship.
