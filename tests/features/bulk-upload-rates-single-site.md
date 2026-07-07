# Bulk upload rates (single site) — basic scenarios

Source: verified directly against the live app via Claude in Chrome + accessibility tree inspection (no PRD needed for these — this is existing, shipped behavior, not the new org-level feature).

App: `https://schools.qa.bwtest.net` (QA env) — single-site view, Billing → At a Glance → Select an action → Bulk upload rates

Status: **Approved** — every step below was directly observed in the live app before being written, not assumed.

## What this covers
The existing single-site "Bulk upload rates" wizard entry point and its first step only (Upload rate sheet). This is real, shipped functionality — distinct from the org-level bulk upload feature discussed in the PRD, which is not yet built in any environment we have access to.

## What this deliberately does NOT cover
- Actually uploading a file and verifying parsed rates (Review rates step) — would require a real test rate-sheet file and creates real data in the QA env; out of scope for this basic pass
- The "Schedule billing" step
- The org-level (multi-site) version of this feature — see open questions from the PRD; not yet built

## Test cases

| ID | Tier | Scenario | Verified against |
|---|---|---|---|
| TC-01 | smoke | "Bulk upload rates" is reachable from At a Glance → Select an action | Live app, confirmed menu item exists |
| TC-02 | smoke | The wizard shows all three steps: Upload rate sheet, Review rates, Schedule billing | Live app accessibility tree — confirmed exact step labels |
| TC-03 | sanity | The upload step offers a file drop zone with the expected accepted file types | Live app — confirmed accepted types: .png, .jpg, .jpeg, .csv, .doc, .docx, .pdf, .xls, .xlsx |
| TC-04 | sanity | "Create rates manually" is offered as an alternative to uploading a file | Live app, confirmed button present |
| TC-05 | sanity | Cancel closes the wizard and returns to At a Glance | Live app, confirmed by direct interaction |
