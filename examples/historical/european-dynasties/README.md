# European dynasties example archive

This read-only research fixture contains 88 deceased historical people in two
family graphs:

- 18 Pippinid, Arnulfing, and Carolingian people from roughly the sixth through
  ninth centuries;
- 70 Angevin, Plantagenet, Lancaster, Beaufort, York, Tudor, Stuart, Orange, and
  Hanover people from the twelfth through early eighteenth centuries.

Each person has one Markdown note containing their metadata, prose, source
catalog, and parent or partner claims. Claims cite compact source IDs from the
same note instead of repeating full citation metadata. Kindred projects those
claims, sources, and birth and death events into its disposable graph when the
archive loads.
The notes preserve approximate dates as text, every person has occupation
metadata, and every biological claim states whether its parent is the mother or
father. Key records also contain original `Story` and `Research notes`
sections. Seven people have locally stored public-domain portraits whose
credits, licenses, and source links remain in their person notes. The
`r_partner_pepin_herstal_alpaida` claim is deliberately `disputed`
because modern summaries differ on how to characterize Alpaida's relationship
with Pepin. `r_parent_edmund_langley_richard_conisburgh` is also `disputed`
because Edmund was Richard's recorded father but historians have questioned
the biological attribution. The traditional Arnulf-to-Ansegisel descent is
likewise disputed because the surviving accounts are late and inconsistent.
Queries include only accepted claims unless another status is requested.

This is a bounded software fixture, not a complete pedigree or a substitute for
historical research. It omits many children and partners. A missing edge means
“outside this selected archive,” not “the relationship did not exist.” Source
objects record the pages consulted on 2026-09-19 and explain what each page was
used to support.

See [`docs/HISTORICAL_EXAMPLES.md`](../../../docs/HISTORICAL_EXAMPLES.md) for
commands, expected results, and research caveats.
