<p align="center">
  <img src="docs/brand/kindred-logo.png" alt="Kindred — an interwoven mark of family connections" width="640">
</p>

<p align="center"><strong>Your family's stories, connected.</strong></p>

<p align="center">
  <a href="docs/VISION.md">The vision</a> ·
  <a href="docs/ROADMAP.md">What's next</a> ·
  <a href="https://github.com/niklas-heer/kindred/issues">Ideas & feedback</a>
</p>

# A family archive you can explore

A photograph, a handwritten name, a story passed down, a record that doesn't
quite agree with another. Family history is full of connections—and questions.

**Kindred is being built to help you keep those stories and explore how people
belong together.** The idea is simple: an archive of readable notes and sources
on your own computer, with a graph that helps you follow the relationships.

> **Early development.** Kindred currently has a working command-line foundation
> with help and version information. Saving family records, querying relationships,
> and exploring the graph are still ahead. There isn't a usable genealogy app or
> a published release to download yet.

## What we're building

- **Start with a person, then follow the connections.** Explore ancestors,
  descendants, or the paths between two people. Expand a branch when you need
  it, or step back to see the larger family.
- **Keep the story beside the facts.** Give biographies, photographs, letters,
  and research notes a home alongside names and dates.
- **See where a claim comes from.** Follow a relationship back to its sources.
  Keep uncertain dates and conflicting accounts visible while you investigate.
- **Own an archive you can keep.** Store your work in Markdown notes, metadata,
  and attachments that remain readable without Kindred. The planned app runs
  locally, without an account or a hosted service.
- **Work your way.** Use a local browser view or the command line. Open the same
  notes in Obsidian or another editor; Obsidian is optional.

These are the goals guiding development. The [vision](docs/VISION.md) describes
the intended experience, and the [roadmap](docs/ROADMAP.md) breaks it into small,
testable milestones.

## More than a family tree

Families include shared ancestors, adoption, multiple partnerships, and links
that are still being researched. Kindred's planned graph makes room for those
relationships while letting you focus on a manageable part of the story.

You might ask: *Who were this person's ancestors? How are these two people
connected? What evidence supports this relationship?* The aim is to move easily
between a question, the relevant people, and the records behind the answer.

## Follow along or help shape it

The first milestone is a small fictional archive that Kindred can read and
validate. Relationship queries and the local graph viewer follow from there.

Have a family-history workflow you'd like to improve? [Open an
issue](https://github.com/niklas-heer/kindred/issues) and tell us what you'd like
to do. Use fictional examples or remove personal details before sharing records
in this public repository.

For development, start with [CONTRIBUTING.md](CONTRIBUTING.md). Architecture
choices live in the [decision log](docs/DECISIONS.md), and the
[release guide](docs/RELEASING.md) explains versioned builds.

<details>
<summary><strong>Build the current CLI foundation</strong></summary>

Install [mise](https://mise.jdx.dev/getting-started.html) and the
[native build prerequisites](CONTRIBUTING.md#setup-and-checks), then run:

```sh
git clone https://github.com/niklas-heer/kindred.git
cd kindred
mise trust
mise install
mise exec -- cargo run -- --help
```

The current CLI supports `--help` and `--version`. Run `mise run check` to check
the source and tests. The project pins its development tools for reproducible
setup.

</details>

## License

Kindred is open source under the [MIT license](LICENSE).
Your family records remain yours; the software license does not change their
ownership or licensing.
