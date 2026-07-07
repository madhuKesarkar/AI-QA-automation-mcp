# feat-bulk-upload-rates-org-level — Bulk upload rates (org level)

Source: [PRD: Bulk Upload Rate Sheet, Org Level](https://docs.google.com/document/d/1zykE3a2_gt3Cbo8F8ir-_-_6k2G4XmKt/edit) · App: https://schools.sandbox.bwtest.net/billing/overview/unpaid

Status: **DRAFT — pending QA review** (see open questions below before approval)

## Open questions in the PRD itself (not yet resolved — do not test these until answered)
1. **Entry point (FR-01)** — the PRD does not confirm where the "bulk upload rates" action lives at org level. The linked POC uses a secondary CTA on the templates tab, but the PRD's own Open Questions section leaves this unresolved. Confirm actual entry point against the live app before finalizing TC-01.
2. **Fixed/one-time charges** — currently the POC drops one-time charges entirely when creating templates. The PRD says this is "expected behavior" only if fixed charges stay out of scope, and explicitly leaves that decision open. TC-05 depends on this being resolved.

## Test cases

| ID | Tier | Scenario | Source |
|---|---|---|---|
| TC-01 | smoke | Bulk upload rates entry point is reachable at org level | PRD Functional Requirements FR-01 (entry point itself unconfirmed — see open question 1) |
| TC-02 | sanity | Upload a valid org rate sheet through both steps (upload → review) and confirm | PRD FR-02 |
| TC-03 | sanity | Confirming creates bill plan templates from recurring rates | PRD FR-03 |
| TC-04 | functional | Created templates use the same default location-sharing as a manually-created template | PRD FR-03 |
| TC-05 | functional | One-time charges are not carried into the created templates | PRD Proposed Solution (dropped charges behavior) — depends on open question 2 |
| TC-06 | functional | Post-creation, a template behaves identically to a manually-created one (editable, deletable, same defaults) | PRD FR-03 |

## Explicitly out of scope (per PRD — do not write tests for these)
- The "schedule billing" step (3rd step at single-site level) — not present at org level
- Any changes to single-site bulk upload flow
- Any changes to rate sheet parsing itself

## Not yet testable
- Entry point location (TC-01) and one-time-charge handling (TC-05) are blocked on the two open PRD questions above. Draft scenarios below use the best-known current POC behavior and are marked accordingly — confirm with PM before treating as approved.
