+++
schema_version = 1
id = "01M66MA189C974D62NW9WR62PE"
title = "Serve relatives with a simple bilingual view of the family"
date = "2026-10-30"
status = "accepted"
tags = ["web", "i18n", "layout"]
supersedes = []
superseded_by = []
depends_on = []
related_to = ["01M2XHZ7C5WNJCAG3ZCRNE9ADE"]
+++
Status: implemented on 2026-10-30 at the owner's request, as the first step towards a shared family tree for relatives in Germany and South Africa.

The viewer now serves two audiences: family historians doing research, and relatives who only want to see and read about their family, often on phones and often in German.

- **Simple and Research views.** Research is the previous behaviour and stays the default. Simple hides research controls (Path, relation and status filters, evidence, archive diagnostics, claim and evidence counts, note editing and raw facts) and shows people, life dates and places, occupations, relatives, events and stories. `?view=` selects a view and is remembered. Switching to Simple resets the hidden filters to accepted claims without evidence, so hidden controls never shape what relatives see.
- **German and English interface.** All interface strings live in `src/web/i18n.js`, with plurals through `Intl.PluralRules`. `?lang=`, then the remembered choice, then the browser's first supported language decide. Archive content is never translated. Full ISO dates are shown as localized long dates; any other wording stays exactly as written. Cards show only years, with the full date on hover and in the details panel.
- **Couple lines.** When a child's two parents are partners on the same row, the child's line starts at the middle of the partner link instead of at each parent's card, so half-siblings visibly descend from different couples. Both claims are still drawn, keeping per-claim selection and status styling. Lines from different couples that would overlap between the same rows get separate heights.
- **Touch.** A drag may start on a card (a 6 px threshold keeps taps working), two fingers pinch-zoom, and zoom is bounded between 5% and 400%.
- **Row ordering.** Ordering compares relative positions across rows of different length and ends top-down, so children follow their parents and half-siblings stay grouped by couple.

Alternatives: a separate family-facing app would duplicate the graph and layout; translating archive content was rejected because names, places and original date wording are evidence. Hand-placed cards, a minimap and viewport culling were not needed at family scale.

Verification: Node tests for layout ordering, couple anchors, rail heights and the i18n helpers; Rust web tests for the served assets; headless browser checks in both languages and views at phone and desktop widths with a real 22-person family archive. Real phone touch gestures were exercised by simulation, not on a device.
