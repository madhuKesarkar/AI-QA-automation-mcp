# ENG-482 — Bulk invite parents

Source docs: [Linear ENG-482](#) · [PRD §2.1](#) · [FE spec §Validation](#) · [BE spec §/invites/bulk](#) · [Figma "Invite flow"](#)

Status: **Approved** by QA on <!-- date -->

| ID | Tier | Scenario | Source |
|---|---|---|---|
| TC-01 | smoke | Invite modal loads | PRD §2.1 |
| TC-02 | sanity | Invite a single parent with a valid email | PRD §2.1, Figma "Invite success" |
| TC-03 | functional | Malformed email shows inline validation error | FE spec §Validation |
| TC-04 | functional | Duplicate invite shows warning | BE spec §/invites/bulk |

Automated in: `tests/features/ENG-482-bulk-invite.feature`

Not automated (manual only, and why):
- _(none yet — add here if a case is too low-value to automate)_
