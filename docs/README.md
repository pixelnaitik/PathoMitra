# PathoMitra Documentation Directory

Internal ledgers: store-submission material, the UI design contract, and the history archive.
`PROJECT_MEMORY.md` (repo root) is the working cross-session context and **references** these files
rather than duplicating them. Every dated ledger below is a snapshot of what was true on its review
date — read the "status" column before acting on a finding.

## Directory structure

```
docs/
├── design/
│   └── design.md                                   # UI design contract: token architecture, typography, components, motion
├── history/
│   └── PROJECT_MEMORY-2026-10-18-pre-cleanup.md    # ARCHIVE — verbatim pre-cleanup project memory (2.7.2 → 2.8.5 rounds)
└── store/
    ├── play/
    │   ├── play-listing.md                         # Google Play listing copy + policy + pre-upload gates
    │   └── play-console-submission.md              # Every Play Console field with its exact answer
    └── ms-store/
        ├── ms-store-review-2026-10-17.md           # Windows certification review, round 3 — CURRENT
        ├── ms-store-remediation-plan-2026-10-17.md # Execution plan behind round 3 (phases + "Done when")
        ├── ms-store-listing-and-cert-notes-2026-10-17.md # Draft Store listing + per-clause cert notes (not yet submitted)
        └── ms-store-review-2026-10-16.md           # Round 2 — SUPERSEDED by the 10-17 review
```

## Status of each ledger (checked 2026-10-18)

| File                                                           | Status                 | Notes                                                                                                                               |
| -------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `design/design.md`                                             | current                | rules only — token **values** live in `src/index.css`, never here                                                                   |
| `store/play/play-listing.md`                                   | current, not submitted | Data Safety + key-storage wording corrected 2026-10-18                                                                              |
| `store/play/play-console-submission.md`                        | current, not submitted | same corrections; the **Health apps declaration** is now in §4                                                                      |
| `store/ms-store/ms-store-review-2026-10-17.md`                 | current (round 3)      | scores and PEs measured on the 2.7.7 artifact — the product is 2.8.6 now, so re-run `check-desktop-package.mjs` before quoting them |
| `store/ms-store/ms-store-remediation-plan-2026-10-17.md`       | live plan              | T-1.1 and T-1.3 are done; most phases still gated on owner inputs                                                                   |
| `store/ms-store/ms-store-listing-and-cert-notes-2026-10-17.md` | draft                  | nothing has been entered in Partner Center                                                                                          |
| `store/ms-store/ms-store-review-2026-10-16.md`                 | superseded             | kept as the round-2 evidence record; round 3 restates its scores                                                                    |
| `history/PROJECT_MEMORY-2026-10-18-pre-cleanup.md`             | archive                | do not use as working context                                                                                                       |

## Deleted from this tree (2026-10-17, commit `0bd338c`)

`docs/audits/feature-audit-2026-10.md`, `docs/audits/catalogue-audit-2026-10.md`,
`docs/audits/play-audit-2026-10-16.md`, `docs/audits/play-audit-2026-10-17.md`,
`docs/audits/store-compliance-audit-2026-10.md`. Their surviving conclusions are in the history
archive above; recover the originals with `git show 23fabeb:docs/audits/<file>`.
