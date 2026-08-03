| ID | Priority | Severity | Tier | Scenario | Requirement Section | Notes |
|----|----------|----------|------|----------|--------------------|----|
| TC-001 | P0 | Critical | Smoke + Functional | "Edit plan rates" option hidden when flag is OFF | §1.3 | Rollback path validation |
| TC-002 | P0 | Critical | Smoke + Functional | "Edit template rates" action bar hidden when flag is OFF | §1.3 | Rollback path validation |
| TC-003 | P1 | High | Functional | Staff role cannot access Flow A entry point | §1.6 | RBAC guard |
| TC-004 | P1 | High | Functional | Billing Only role can access Flow A entry point | §1.6 | RBAC happy path |
| TC-005 | P0 | Critical | Smoke + Functional | Flow A modal opens as two-step wizard via "Edit plan rates" | §1.4, §2.1.1 | Core happy path |
| TC-006 | P1 | Medium | Functional | "Edit plan rates" disabled when no rows checked | §1.4 | Entry point guard |
| TC-007 | P0 | Critical | Smoke + Functional | Flow B floating action bar appears with ≥1 template checked | §1.5 | Core happy path |
| TC-008 | P1 | Medium | Functional | Flow B floating action bar hidden when no templates checked | §1.5 | Entry point guard |
| TC-009 | P0 | Critical | Smoke + Functional | Flow B modal opens as three-step wizard | §1.5, §3.1.1 | Core happy path |
| TC-010 | P1 | Medium | Functional | Unchecking row inside Flow A modal excludes it from preview; parent table unaffected | §2.1.2, §2.1.3 | Sub-selection isolation |
| TC-011 | P1 | High | Functional | Search hides rows but preserves checked state in dry-run payload | §2.1.4 | Critical payload integrity |
| TC-012 | P0 | High | Sanity + Functional | Flow A Step 1 defaults to "Update by %" radio; can switch to flat | §2.2.1 | Adjustment type switching |
| TC-013 | P1 | Low | Functional | Flow A Step 1 table shows all required columns | §2.2.3 | Column completeness |
| TC-014 | P1 | Medium | Functional | New rate and Change columns update live on keystroke (percent) | §2.2.4 | Preview responsiveness |
| TC-015 | P1 | High | Functional | Row with non-positive resulting amount shows "—" and tooltip | §2.2.5, §4.7, §11.2 | Below-zero guard |
| TC-016 | P1 | High | Functional | "Next" disabled when adjustment is zero | §2.2.7, §4.8 | Zero-value guard |
| TC-017 | P1 | High | Functional | "Next" disabled when no rows are checked | §2.2.7 | Empty selection guard |
| TC-018 | P0 | Critical | Sanity + Functional | "Next" enabled when ≥1 row checked and non-zero value entered | §2.2.7 | Core enable state |
| TC-019 | P0 | Critical | Sanity + Functional | Advancing from Step 1 fires dry-run POST with dry_run=true | §2.2.8, §5.2, §5.6 | Dry-run payload verification |
| TC-020 | P0 | Critical | Sanity + Functional | Step 2 review cards display dry-run summary values correctly | §2.3.1 | Review card accuracy |
| TC-021 | P1 | Medium | Functional | Tuition agreement banner appears in Flow A Step 2 when toggle ON | §2.3.2, §8.1 | Toggle-linked banner |
| TC-022 | P0 | Critical | Sanity + Functional | "Complete update" sends apply POST with dry_run=false | §2.3.3, §5.2, §5.6 | Apply payload verification |
| TC-023 | P1 | High | Functional | Org-owned template checkboxes are disabled in Flow B table | §3.1.2 | Template eligibility guard |
| TC-024 | P1 | Medium | Functional | Flow B Step 1 has same controls as Flow A Step 1 | §3.2.1 | Shape parity |
| TC-025 | P1 | Medium | Functional | Tuition-agreement toggle NOT in Flow B Step 1 | §3.2.2 | Step placement correctness |
| TC-026 | P0 | Critical | Sanity + Functional | Flow B Step 2 defaults to "No" and sends cascade_to_existing_plans=false | §3.3.1, §3.3.2 | Default cascade behavior |
| TC-027 | P0 | Critical | Sanity + Functional | Selecting "Yes" in Flow B Step 2 expands cascade controls | §3.3.3 | Cascade expansion |
| TC-028 | P1 | High | Functional | Related plans fetched via GET with plan_template_ids[] param | §3.3.4, §5.14 | API contract |
| TC-029 | P1 | High | Functional | cascade_target omitted when no sub-selection in cascade table | §3.3.5 | Payload contract |
| TC-030 | P1 | High | Functional | cascade_target.plan_ids sent when admin sub-selects cascade plans | §3.3.5 | Payload contract |
| TC-031 | P1 | Medium | Functional | Flow B Step 3 review shows template-level summary | §3.4.1 | Review accuracy |
| TC-032 | P1 | Medium | Functional | Flow B Step 3 shows cascade plan counts when cascade on | §3.4.2 | Cascade review accuracy |
| TC-033 | P1 | Medium | Functional | Drift banner shown in Step 3 when drifted_plans_count > 0 | §3.4.3 | Drift disclosure |
| TC-034 | P2 | Low | Functional | Drift banner NOT shown when drifted_plans_count = 0 | §3.4.3 | Negative drift case |
| TC-035 | P1 | Medium | Functional | Tuition agreement banner in Flow B Step 3 only when cascade ON + toggle ON | §3.4.4 | Conditional banner |
| TC-036 | P1 | Medium | Functional | Tuition agreement banner NOT shown in Flow B Step 3 when cascade off | §3.4.4 | Negative banner case |
| TC-037 | P0 | Critical | Sanity + Functional | "Complete update" in Flow B sends cascade_to_existing_plans=true with dry_run=false | §3.4.5, §5.4 | Apply payload verification |
| TC-038 | P0 | Critical | Sanity + Functional | Percent adjustment sent as kind=percent with integer value | §4.1, §5.2 | Payload type |
| TC-039 | P0 | Critical | Sanity + Functional | Flat adjustment sent as kind=flat with integer cents (not float) | §4.1, §5.2 | Payload encoding |
| TC-040 | P1 | Medium | Functional | Multi-charge plan row included; charges comma-separated; flat tooltip present | §4.2, §2.2.6 | Multi-charge inclusion |
| TC-041 | P1 | Medium | Functional | Percent on multi-charge plan shows proportional new rates for all charges | §4.3 | Math correctness |
| TC-042 | P1 | High | Functional | Discount/credit rows excluded from rate adjustment | §4.4 | Business rule |
| TC-043 | P1 | High | Functional | Existing discount preserved after bulk rate adjustment | §4.5 | Discount integrity |
| TC-044 | P1 | High | Functional | Split-payer plan total increases correctly; split percentages unchanged | §4.6 | Split-payer correctness |
| TC-045 | P1 | High | Functional | Posted invoices not updated; unposted future charge updated | §4.9, §1.2 | Invoice boundary |
| TC-046 | P0 | Critical | Sanity + Functional | Apply POST returns job ID; FE polls status endpoint; spinner shown | §5.5, §5.7, §6.1 | Async lifecycle |
| TC-047 | P0 | Critical | Smoke + Functional | All-success apply shows correct toast and closes modal (Flow A) | §6.2, §7.1 | Success path |
| TC-048 | P1 | High | Functional | Partial success shows "N of M plans updated" toast; no in-modal error list | §7.2, §7.5 | Partial outcome |
| TC-049 | P1 | High | Functional | Job error shows "Couldn't update rates" toast | §6.3, §7.3 | Error path |
| TC-050 | P1 | High | Functional | 30s timeout shows non-error message; modal closes; no retry button | §6.4 | Timeout path |
| TC-051 | P1 | Medium | Functional | Processing spinner shown during polling; Complete update not clickable | §6.5 | UX during polling |
| TC-052 | P1 | High | Functional | Flow B success toast shows template count only (not cascade count) | §7.4 | Toast content |
| TC-053 | P1 | Medium | Functional | No in-modal success panel after successful apply | §7.5 | Absence of stale state |
| TC-054 | P1 | Medium | Functional | Tuition toggle visible but disabled with tooltip when FINOPS-318 not landed | §8.1, §8.2 | Toggle disabled state |
| TC-055 | P1 | High | Functional | Rate change succeeds without error when tuition toggle is disabled | §8.2 | Graceful degradation |
| TC-056 | P1 | High | Functional | Flow A apply creates audit rows with correct audit_comment and shared request_uuid | §9.1 | Audit trail |
| TC-057 | P1 | High | Functional | Flow B apply creates audit rows with correct audit_comment | §9.1 | Audit trail |
| TC-058 | P2 | Low | Functional | Persisted apply response contains execution.audit_request_uuid | §9.3 | Audit reference |
| TC-059 | P1 | Medium | Functional | Parent plans table refreshes automatically after Flow A successful apply | §12.1 | Cache invalidation |
| TC-060 | P1 | High | Functional | Inactive plan skipped with reason plan_not_active in dry-run | §13.1 | Skip eligibility |
| TC-061 | P1 | High | Functional | Plan with no rate-bearing charges skipped with no_eligible_charges | §13.2 | Skip eligibility |
| TC-062 | P1 | High | Functional | Template with no charges skipped in Flow B dry-run | §13.3 | Skip eligibility |
| TC-063 | P1 | High | Functional | Staff role POST to bulk adjust endpoint returns 403 | §5.13, §1.6 | API-level auth |
| TC-064 | P1 | High | Functional | Delta cascade applies same signed delta to drifted plans (not snap) | §4.10 | Delta cascade math |
| TC-065 | P1 | Medium | Functional | Out-of-lineage plan in cascade_target skipped with not_derived_from_template | §5.11 | Cascade skip reason |
| TC-066 | P1 | Medium | Functional | Review card amounts match BE dry-run response cents (not client-side computed) | §11.3 | Data source |
| TC-067 | P1 | Medium | Functional | Multi-charge plan row visible and not excluded from Flow A Step 1 | §2.2.6 | Inclusion rule |
| TC-068 | P2 | Low | Functional | Bulk Raise Rates feature not accessible on mobile viewport | §1.7 | Platform scope |

---
