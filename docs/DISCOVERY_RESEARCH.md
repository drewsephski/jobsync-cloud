# Discovery directory research

The initial directory is a versioned snapshot of the company catalogs shipped
by [`Gsync/jobsync`](https://github.com/Gsync/jobsync/tree/ef3d7eec5c9aebaa1c6e03fc3ddd62d7dca8e37f),
upstream commit `ef3d7eec5c9aebaa1c6e03fc3ddd62d7dca8e37f` (MIT licensed).
The source files were:

- `src/lib/scraper/greenhouse/companies.json`
- `src/lib/scraper/lever/companies.json`
- `src/lib/scraper/ashby/companies.json`

That snapshot contains 602 Greenhouse, 1,160 Lever, and 1,860 Ashby boards.
Lever records preserve the EU region signal. The checked-in directory records
the source commit, raw provider tokens in `slug`, and stable provider/token
identities in `key` (`provider:token`). Raw tokens are persisted on ATS boards
because provider adapters expect them directly. Company names are shared
catalog data; user watches and match results remain private records.

## Provider behavior verified on 2026-09-30

- Greenhouse documents unauthenticated public GETs at
  `boards-api.greenhouse.io/v1/boards/{token}/jobs`; `content=true` includes
  posting description, department, and office data. Preserve `absolute_url`
  as the original link. Its content can contain HTML entities.
- Lever's public job-site API is
  `api.lever.co/v0/postings/{site}?mode=json&skip={n}&limit={n}`, with the EU
  host at `api.eu.lever.co`. The list is paginated with `skip` and `limit`.
  Public payloads include `id`, `createdAt`, `hostedUrl`, descriptions, and
  categories. `descriptionPlain` already includes the opening; append the
  responsibility/requirement `lists` sections without repeating
  `openingPlain`.
- Ashby documents the unauthenticated
  `api.ashbyhq.com/posting-api/job-board/{job-board-name}` API. It returns
  published listings with `id`, `publishedAt`, `workplaceType`, location(s),
  description, and original `jobUrl`. Honor `isListed: false`. Ashby documents
  that disabling its hosted job board also disables unauthenticated access to
  this endpoint.

Live read-only requests to Stripe's Greenhouse board, Lever's demo board on
both global and EU hosts, and 1Password's Ashby board returned HTTP 200 during
verification. Provider failures must leave existing shared postings intact;
only a successful complete snapshot can mark unseen jobs closed.

Primary provider references:

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html)
- [Lever Postings API](https://github.com/lever/postings-api/blob/master/README.md)
- [Ashby Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api)
- [Ashby `jobPosting.list` reference](https://developers.ashbyhq.com/reference/jobpostinglist)

## Upstream concepts worth carrying forward

The upstream adapters use public provider APIs, normalize provider-specific
fields into a common posting shape, bound HTTP deadlines and concurrency, and
isolate failures per board. Lever additionally protects pagination with a
page ceiling and repeat-page guard. All-location signals are retained. Its
lexical pre-ranker uses whole-term matching, title and skill evidence,
corpus-relative inverse-document-frequency weights, a minimum evidence floor,
and a top-K cap before AI. Location is an optional filter, not a job-fit
score. AI output is intentionally reduced to a match score, recommendation,
and short summary.

The cloud implementation should use the board plus provider posting ID as the
shared posting identity, retain original URLs, version content changes, and
keep per-user matches/actions separate. A user-triggered watch must not create
its own copy of public jobs or its own board fetch. Resume and preference
revisions belong in the private match input identity. Treat posting text as
untrusted input in matching prompts.

The legacy upstream runner deduplicates a user's tracker by canonical URL or
title/company/location. That is not the shared identity for cloud ingestion.
Its automation schedules and six-step automation model are also not part of
this directory snapshot.

## Upstream license

The directory catalog was copied from the MIT-licensed upstream repository.
The required upstream copyright and permission notice is retained here:

```text
MIT License

Copyright (c) 2024 gsync

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
