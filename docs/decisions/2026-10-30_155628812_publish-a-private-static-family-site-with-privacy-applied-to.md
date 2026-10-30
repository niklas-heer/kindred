+++
schema_version = 1
id = "01M66RDQRC0ASVVKMT5AH82C6P"
title = "Publish a private static family site with privacy applied to the data"
date = "2026-10-30"
status = "accepted"
tags = ["site", "privacy", "web"]
supersedes = []
superseded_by = []
depends_on = []
related_to = []
+++
Status: implemented on 2026-10-30 as `kindred site`, which writes a static, self-contained viewer for a validated archive.

The site is for family hosting behind an authenticating proxy, so living people are included. Privacy is enforced in the data before anything is written, not left to the viewer:

- Private notes, what they own, and claims touching them are omitted, and every remaining reference to an omitted record is removed. The viewer cannot edit, so the raw note text is dropped and only the Markdown story body is kept.
- Birth dates of protected people are reduced to their year. A person is protected when `date_display: year` is set, or when they are under 18 on the reference date and not marked deceased. Age uses the listed full-date forms, not only ISO, so `26.09.2017` cannot bypass the rule.
- Before publication every text file is scanned for a protected person's full birth date in common forms. A match fails the build, naming the person and file but never the date. The check is fail-closed: a non-protected record that happens to contain the same full date also fails the build.
- Only portrait images of included people are copied. Source attachments are never copied.
- Publication is staged beside the target and renamed only after the checks pass.

Alternatives: a separate family-facing app would duplicate the graph and layout; redacting in the browser would leave raw data in the published files, so the viewer could not be trusted with it. Rewriting prose to remove dates was rejected because stories are authored text. Free-text redaction of names inside stories was not attempted; authors keep private information out of the story text.

Consequences: the published directory is only as private as the hosting authentication. Story text is published as written, so dates that are not in a listed form are not reduced automatically.
