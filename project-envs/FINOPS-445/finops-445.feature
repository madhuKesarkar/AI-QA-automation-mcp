# Feature: FINOPS-445 — Bulk Raise Rates
# Covers: Flow A (bulk adjust rates on plans) and Flow B (bulk adjust rates on templates)
# Flag gate: billing_bulk_raise_rates (FlagSmith)

Feature: Bulk Raise Rates

  Background:
    Given the FlagSmith feature flag "billing_bulk_raise_rates" is enabled
    And I am logged in as a user with the "Admin" role
    And the school has at least 5 active billing plans with rate-bearing charges

  # ---------------------------------------------------------------------------
  # §1.3 — Feature flag gate
  # ---------------------------------------------------------------------------

  @p0 @smoke @functional
  # requirement: §1.3
  Scenario: "Edit plan rates" option is hidden when feature flag is OFF
    Given the FlagSmith feature flag "billing_bulk_raise_rates" is disabled
    When I navigate to Students › Student plans table
    And I check at least one plan row
    And I open the "Select an action" dropdown
    # selector: billing.selectAnActionButton
    Then I should NOT see the "Edit plan rates" menu item

  @p0 @smoke @functional
  # requirement: §1.3
  Scenario: "Edit template rates" action bar is hidden when feature flag is OFF
    Given the FlagSmith feature flag "billing_bulk_raise_rates" is disabled
    When I navigate to Library › Bill plan templates table
    And I check at least one template row
    Then the floating bottom action bar should NOT be visible

  # ---------------------------------------------------------------------------
  # §1.6 — Access control
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §1.6
  Scenario: Staff role cannot access Flow A entry point
    Given I am logged in as a user with the "Staff" role
    When I navigate to Students › Student plans table
    And I check at least one plan row
    And I open the "Select an action" dropdown
    # selector: billing.selectAnActionButton
    Then I should NOT see the "Edit plan rates" menu item

  @p1 @functional
  # requirement: §1.6
  Scenario: Billing Only role can access Flow A entry point
    Given I am logged in as a user with the "Billing Only" role
    When I navigate to Students › Student plans table
    And I check at least one plan row
    And I open the "Select an action" dropdown
    # selector: billing.selectAnActionButton
    Then I should see the "Edit plan rates" menu item

  # ---------------------------------------------------------------------------
  # §1.4 / §2.1.1 — Flow A entry point and wizard structure
  # ---------------------------------------------------------------------------

  @p0 @smoke @functional
  # requirement: §1.4, §2.1.1
  Scenario: Flow A modal opens as a two-step wizard via "Edit plan rates" action
    Given I am on the Students › Student plans table
    And I check 3 plan rows
    When I open the "Select an action" dropdown
    # selector: billing.selectAnActionButton
    And I click "Edit plan rates"
    Then a modal wizard opens
    And Step 1 "Edit rates" is displayed
    And a "Review" step indicator is visible but not yet active

  @p1 @functional
  # requirement: §1.4
  Scenario: "Edit plan rates" option is disabled when no plan rows are checked
    Given I am on the Students › Student plans table
    And no plan rows are checked
    When I open the "Select an action" dropdown
    # selector: billing.selectAnActionButton
    Then the "Edit plan rates" menu item should be disabled or absent

  # ---------------------------------------------------------------------------
  # §1.5 — Flow B entry point
  # ---------------------------------------------------------------------------

  @p0 @smoke @functional
  # requirement: §1.5
  Scenario: Flow B floating action bar appears when at least one template is checked
    Given I am on the Library › Bill plan templates table
    When I check 2 template rows
    Then a floating bottom action bar is displayed
    And it shows "2 of {M} × Edit template rates"

  @p1 @functional
  # requirement: §1.5
  Scenario: Flow B floating action bar is hidden when no templates are checked
    Given I am on the Library › Bill plan templates table
    And no template rows are checked
    Then the floating bottom action bar should NOT be visible

  @p0 @smoke @functional
  # requirement: §1.5, §3.1.1
  Scenario: Flow B modal opens as a three-step wizard via the action bar
    Given I am on the Library › Bill plan templates table
    And I have checked 2 school-owned template rows
    When I click "Edit template rates" in the floating action bar
    Then a modal wizard opens
    And Step 1 "Edit rates" is displayed
    And step indicators for "Update plans?" and "Review" are visible but not yet active

  # ---------------------------------------------------------------------------
  # §2.1.2 / §2.1.3 — In-modal sub-selection (Flow A)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §2.1.2, §2.1.3
  Scenario: Unchecking a row inside the Flow A modal excludes it from preview but does not affect parent table selection
    Given I have opened the Flow A modal with 3 plan rows selected
    When I uncheck one plan row inside the modal
    Then that row shows "—" in the "New rate" and "Change" columns
    And the parent plans table still shows 3 rows checked after modal interactions

  # ---------------------------------------------------------------------------
  # §2.1.4 — Search does not mutate checked set (Flow A)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §2.1.4
  Scenario: Searching in Flow A Step 1 hides rows but preserves their checked state in the payload
    Given I have opened the Flow A modal with plans for students "Alice", "Bob", and "Carol" all checked
    When I type "Alice" in the modal search input
    Then only Alice's plan row is visible
    And Bob's and Carol's rows are hidden but remain checked
    When I click "Next" to advance to Step 2
    Then the dry-run request payload includes plan IDs for all three plans

  # ---------------------------------------------------------------------------
  # §2.2.1 — Radio card adjustment type (Flow A)
  # ---------------------------------------------------------------------------

  @p0 @sanity @functional
  # requirement: §2.2.1
  Scenario: Flow A Step 1 defaults to "Update by %" radio and allows switching to "Update by $ amount"
    Given I have opened the Flow A modal
    Then the "Update by %" radio card is selected by default
    And the "Update by $ amount" radio card is not selected
    When I click the "Update by $ amount" radio card
    Then the "Update by $ amount" radio card becomes selected
    And the "Update by %" radio card becomes deselected

  # ---------------------------------------------------------------------------
  # §2.2.3 — Table columns (Flow A)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §2.2.3
  Scenario: Flow A Step 1 table displays all required columns
    Given I have opened the Flow A modal with 2 plan rows
    Then the modal table has columns: "checkbox", "Student", "Plan", "Schedule", "Next due", "Current", "New rate", "Change"

  # ---------------------------------------------------------------------------
  # §2.2.4 — Live client-side preview recomputes on keystroke (Flow A)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §2.2.4
  Scenario: "New rate" and "Change" columns update live as the user types a percentage
    Given I have opened the Flow A modal with a plan having a current rate of $100.00
    And the "Update by %" radio card is selected
    When I type "5" into the adjustment input
    Then the "New rate" column for that plan shows "$105.00"
    And the "Change" column shows "+$5.00" or "+5%"
    When I clear the input and type "10"
    Then the "New rate" column updates to "$110.00" without a page reload

  # ---------------------------------------------------------------------------
  # §2.2.5 — Below-zero guard (Flow A client-side)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §2.2.5, §4.7, §11.2
  Scenario: Row with resulting amount ≤ $0 shows "—" in preview columns (flat decrease)
    Given I have opened the Flow A modal
    And the "Update by $ amount" radio card is selected
    And a plan has a current rate of $10.00
    When I enter "-1500" cents (i.e., a $15.00 decrease) as the flat adjustment value
    Then the "New rate" and "Change" columns for that plan show "—"
    And a tooltip is shown on that row explaining the result would be non-positive

  # ---------------------------------------------------------------------------
  # §2.2.7 — "Next" button enable state (Flow A)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §2.2.7, §4.8
  Scenario: "Next" button is disabled when adjustment value is zero
    Given I have opened the Flow A modal with 2 rows checked
    And the "Update by %" radio card is selected
    When I enter "0" into the adjustment input
    Then the "Next" button is disabled

  @p1 @functional
  # requirement: §2.2.7, §4.8
  Scenario: "Next" button is disabled when no rows are checked
    Given I have opened the Flow A modal
    When I uncheck all rows inside the modal
    And I enter "5" into the adjustment input
    Then the "Next" button is disabled

  @p0 @sanity @functional
  # requirement: §2.2.7
  Scenario: "Next" button is enabled when at least one row is checked and a non-zero value is entered
    Given I have opened the Flow A modal with 2 rows checked
    When I enter "5" into the adjustment input
    Then the "Next" button is enabled

  # ---------------------------------------------------------------------------
  # §2.2.8 — Dry-run call fired on advancing to Step 2 (Flow A)
  # ---------------------------------------------------------------------------

  @p0 @sanity @functional
  # requirement: §2.2.8, §5.2, §5.6
  Scenario: Advancing from Step 1 fires a dry-run POST with dry_run=true
    Given I have opened the Flow A modal with 3 plans checked
    And I have entered "5" in the "Update by %" input
    When I click "Next"
    Then a POST request is made to the bulk adjust charges endpoint
    And the request body contains "dry_run": true
    And the request body contains "adjustment": { "kind": "percent", "value": 5 }
    And the request body contains the 3 selected plan IDs in "plan_ids"

  # ---------------------------------------------------------------------------
  # §2.3.1 — Step 2 review cards populated from dry-run (Flow A)
  # ---------------------------------------------------------------------------

  @p0 @sanity @functional
  # requirement: §2.3.1
  Scenario: Flow A Step 2 review cards display dry-run summary values
    Given I have opened the Flow A modal
    And I have entered a valid adjustment and clicked "Next"
    And the dry-run response returns:
      | updating_count     | 4   |
      | requested_count    | 5   |
      | net_delta_cents    | 20000 |
      | net_delta_pct      | 5.0 |
      | current_total_cents  | 400000 |
      | projected_total_cents | 420000 |
    Then the Step 2 review shows "Plans updating: 4 of 5"
    And the review shows the net monthly total change as "$200.00 / 5%"
    And the review shows current plans monthly total as "$4,000.00"
    And the review shows projected plans monthly total as "$4,200.00"

  # ---------------------------------------------------------------------------
  # §2.3.2 — Tuition agreement banner in Step 2 (Flow A)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §2.3.2, §8.1
  Scenario: Tuition agreement banner appears in Flow A Step 2 when toggle is ON
    Given I have opened the Flow A modal and reached Step 2
    And the tuition-agreement toggle is ON in Step 1
    Then an info banner is displayed containing "Updated agreements will be sent for the"
    And the banner references the number of plans included in the update

  # ---------------------------------------------------------------------------
  # §2.3.3 — "Complete update" re-sends with dry_run=false (Flow A)
  # ---------------------------------------------------------------------------

  @p0 @sanity @functional
  # requirement: §2.3.3, §5.2, §5.6
  Scenario: Clicking "Complete update" in Flow A Step 2 sends apply POST with dry_run=false
    Given I have opened the Flow A modal, entered "5%" adjustment, and advanced to Step 2
    When I click "Complete update"
    Then a POST request is made to the bulk adjust charges endpoint
    And the request body contains "dry_run": false
    And the request body contains the same plan IDs and adjustment as the dry-run

  # ---------------------------------------------------------------------------
  # §3.1.2 — Org-owned template checkboxes disabled (Flow B)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §3.1.2
  Scenario: Org-owned (shared-to-school) template rows have disabled checkboxes in Flow B
    Given the Library templates table contains at least one org-owned template
    When I view the Bill plan templates table
    Then the org-owned template row's checkbox is disabled
    And I cannot select that row

  # ---------------------------------------------------------------------------
  # §3.2.1 — Flow B Step 1 shape matches Flow A Step 1
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §3.2.1
  Scenario: Flow B Step 1 has the same controls as Flow A Step 1 (radio cards, input, search, sub-selection)
    Given I have opened the Flow B modal with 2 school-owned templates checked
    Then I see the "Update by %" and "Update by $ amount" radio cards
    And I see the adjustment value input
    And I see a search input for filtering template rows

  # ---------------------------------------------------------------------------
  # §3.2.2 — No tuition-agreement toggle in Flow B Step 1
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §3.2.2
  Scenario: Tuition-agreement toggle is NOT present in Flow B Step 1
    Given I have opened the Flow B modal with 2 school-owned templates checked
    Then the tuition-agreement toggle is NOT visible in Step 1

  # ---------------------------------------------------------------------------
  # §3.3.1 / §3.3.2 — Flow B Step 2 cascade radio default and "No" path
  # ---------------------------------------------------------------------------

  @p0 @sanity @functional
  # requirement: §3.3.1, §3.3.2
  Scenario: Flow B Step 2 defaults to "No, templates only" and advancing sends cascade_to_existing_plans=false
    Given I have entered a valid adjustment in Flow B Step 1 and clicked "Next"
    Then Step 2 "Update plans?" is displayed
    And the "No, templates only" radio is selected by default
    When I click "Next" to advance to Step 3
    Then the dry-run request payload contains "cascade_to_existing_plans": false

  # ---------------------------------------------------------------------------
  # §3.3.3 — Flow B Step 2 "Yes" expands cascade controls
  # ---------------------------------------------------------------------------

  @p0 @sanity @functional
  # requirement: §3.3.3
  Scenario: Selecting "Yes, update related student plans" expands cascade controls in Flow B Step 2
    Given I am on Flow B Step 2 "Update plans?"
    When I select "Yes, update related student plans"
    Then the tuition-agreement toggle becomes visible
    And a search input for related plans becomes visible
    And a table of related student plans is displayed with columns for current and preview rates

  # ---------------------------------------------------------------------------
  # §3.3.4 — Related plans fetched via correct endpoint (Flow B)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §3.3.4, §5.14
  Scenario: Flow B Step 2 cascade table is populated by GET with pluralized plan_template_ids param
    Given I am on Flow B Step 2 and I select "Yes, update related student plans"
    Then a GET request is made to "/api/v2/billing/plans"
    And the request query string contains "plan_template_ids[]" with the selected template IDs

  # ---------------------------------------------------------------------------
  # §3.3.5 — cascade_target sent only when user sub-selects (Flow B)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §3.3.5
  Scenario: cascade_target is omitted from payload when all related plans remain checked (no sub-selection)
    Given I am on Flow B Step 2 with cascade enabled
    And the related plans table has 3 plans all checked (no sub-selection was made)
    When I advance to Step 3 and click "Complete update"
    Then the apply POST request body does NOT contain a "cascade_target" key

  @p1 @functional
  # requirement: §3.3.5
  Scenario: cascade_target.plan_ids is sent when admin unchecks some related plans (sub-selection)
    Given I am on Flow B Step 2 with cascade enabled
    And the related plans table has 3 plans
    When I uncheck 1 plan in the cascade table
    And I advance to Step 3 and click "Complete update"
    Then the apply POST request body contains "cascade_target": { "plan_ids": [<2 remaining plan IDs>] }

  # ---------------------------------------------------------------------------
  # §3.4.1 — Flow B Step 3 review cards labeled "Templates updating"
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §3.4.1
  Scenario: Flow B Step 3 review shows template-level summary sourced from BE dry-run
    Given I have completed Flow B Steps 1–2 (no cascade) with a valid adjustment
    And the dry-run response returns template-level summary with updating_count=3, requested_count=4
    When I reach Step 3 "Review"
    Then the review card shows "Templates updating: 3 of 4"

  # ---------------------------------------------------------------------------
  # §3.4.2 — Flow B Step 3 shows cascade plan counts when cascade is on
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §3.4.2
  Scenario: Flow B Step 3 displays a second set of plan counts when cascade is selected
    Given I have completed Flow B Steps 1–2 with cascade ON
    And the dry-run response returns cascade.summary with updating_count=150
    When I reach Step 3 "Review"
    Then a second summary section for "Plans" is visible
    And it displays the cascade plan updating count of 150

  # ---------------------------------------------------------------------------
  # §3.4.3 — Drift banner appears (non-blocking) when drifted_plans_count > 0
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §3.4.3
  Scenario: Drift banner is shown in Flow B Step 3 when drifted_plans_count is greater than zero
    Given I have completed Flow B Steps 1–2 with cascade ON
    And the dry-run response returns "cascade.drifted_plans_count": 20, "cascade.total_plans_count": 175
    When I reach Step 3 "Review"
    Then an informational drift banner is displayed referencing 20 drifted plans out of 175
    And the "Complete update" button is still enabled (banner is non-blocking)

  @p2 @functional
  # requirement: §3.4.3
  Scenario: Drift banner is NOT shown when drifted_plans_count equals zero
    Given I have completed Flow B Steps 1–2 with cascade ON
    And the dry-run response returns "cascade.drifted_plans_count": 0
    When I reach Step 3 "Review"
    Then NO drift banner is displayed

  # ---------------------------------------------------------------------------
  # §3.4.4 — Tuition agreement banner only when cascade ON and toggle ON
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §3.4.4
  Scenario: Tuition agreement banner appears in Flow B Step 3 only when cascade is on and toggle is on
    Given I have completed Flow B Steps 1–2 with cascade ON and tuition-agreement toggle ON
    When I reach Step 3 "Review"
    Then the tuition agreement info banner is displayed

  @p1 @functional
  # requirement: §3.4.4
  Scenario: Tuition agreement banner does NOT appear in Flow B Step 3 when cascade is off
    Given I have completed Flow B Steps 1–2 with "No, templates only" selected
    When I reach Step 3 "Review"
    Then the tuition agreement banner is NOT displayed

  # ---------------------------------------------------------------------------
  # §3.4.5 — "Complete update" re-sends with cascade flag (Flow B)
  # ---------------------------------------------------------------------------

  @p0 @sanity @functional
  # requirement: §3.4.5, §5.4
  Scenario: "Complete update" in Flow B Step 3 sends apply POST with correct cascade flag
    Given I have completed Flow B Steps 1–2 with "Yes, update related student plans" selected
    When I click "Complete update" on Step 3
    Then a POST request is made to the Flow B bulk adjust charges endpoint
    And the request body contains "cascade_to_existing_plans": true
    And the request body contains "dry_run": false

  # ---------------------------------------------------------------------------
  # §4.1 / §5.2 — Adjustment payload shape: percent kind
  # ---------------------------------------------------------------------------

  @p0 @sanity @functional
  # requirement: §4.1, §5.2
  Scenario: Percent adjustment is sent with kind=percent and integer value
    Given I have opened the Flow A modal with 2 plans checked
    And I select "Update by %" and enter "7"
    When I click "Next" (triggering the dry-run)
    Then the POST body contains "adjustment": { "kind": "percent", "value": 7 }

  # ---------------------------------------------------------------------------
  # §4.1 / §5.2 — Adjustment payload shape: flat kind in cents
  # ---------------------------------------------------------------------------

  @p0 @sanity @functional
  # requirement: §4.1, §5.2
  Scenario: Flat adjustment is sent with kind=flat and value in canonical integer cents (not dollar float)
    Given I have opened the Flow A modal with 2 plans checked
    And I select "Update by $ amount" and enter "$25.00"
    When I click "Next" (triggering the dry-run)
    Then the POST body contains "adjustment": { "kind": "flat", "value": 2500 }
    And the value is NOT sent as a float (e.g., not 25.0)

  # ---------------------------------------------------------------------------
  # §4.2 — Flat on multi-charge plan applies to largest charge
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §4.2, §2.2.6
  Scenario: Multi-charge plan row is included and shows charges comma-separated with flat adjustment tooltip
    Given I have opened the Flow A modal
    And one plan has two rate-bearing charges: $200/month (Tuition) and $50/month (Materials)
    And I select "Update by $ amount"
    When I enter "1000" cents ($10.00) as the flat value
    Then that plan row is included (not excluded) in the table
    And the charges are displayed comma-separated in the row
    And a per-row tooltip is present on that row

  # ---------------------------------------------------------------------------
  # §4.3 — Percent on multi-charge plan applies proportionally to all charges
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §4.3
  Scenario: Percent adjustment on multi-charge plan shows proportional new rates for all charges
    Given I have opened the Flow A modal
    And one plan has two rate-bearing charges: $200.00 (Tuition) and $50.00 (Materials)
    When I select "Update by %" and enter "10"
    Then the client-side "New rate" preview for that plan reflects a 10% increase applied to both charges

  # ---------------------------------------------------------------------------
  # §4.4 — Discounts/credits never adjusted
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §4.4
  Scenario: Discount and credit charge rows are excluded from rate adjustment
    Given a student plan has a $200 Tuition charge, a -$20 Discount, and a -$10 Credit
    When I run a Flow A bulk rate adjustment of 5%
    Then only the Tuition charge original_amount is updated
    And the Discount and Credit rows are unchanged

  # ---------------------------------------------------------------------------
  # §4.5 — Discount amounts preserved after rate change
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §4.5
  Scenario: Existing per-plan discount is preserved after a bulk rate adjustment
    Given a plan has a $200.00 Tuition charge and a $20.00 discount applied
    When I apply a 10% bulk rate increase via Flow A
    Then the Tuition charge original_amount becomes $220.00
    And the discount remains $20.00 (unchanged)

  # ---------------------------------------------------------------------------
  # §4.6 — Split-payer plans: increase applies to total; splits unchanged
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §4.6
  Scenario: Split-payer plan receives correct total increase with unchanged split percentages
    Given a plan is split 60/40 between two payers at a total of $200.00/month
    When I apply a 10% bulk rate increase via Flow A
    Then the new total charge is $220.00
    And payer 1 owes 60% of $220.00 ($132.00)
    And payer 2 owes 40% of $220.00 ($88.00)

  # ---------------------------------------------------------------------------
  # §4.9 — Immediate effect; unposted invoices updated; posted invoices untouched
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §4.9, §1.2
  Scenario: Posted invoices are not retro-updated after a bulk rate change
    Given a plan has a posted invoice for $200.00
    And the plan has an unposted future charge of $200.00
    When I apply a 10% bulk rate increase via Flow A
    Then the posted invoice remains at $200.00
    And the existing unposted charge is updated to $220.00

  # ---------------------------------------------------------------------------
  # §5.5 / §5.7 — Async POST response and polling
  # ---------------------------------------------------------------------------

  @p0 @sanity @functional
  # requirement: §5.5, §5.7, §6.1
  Scenario: Bulk apply POST returns a job ID and FE polls the status endpoint
    Given I have reached Flow A Step 2 and I click "Complete update"
    When the POST returns { "id": "job-123", "status": "pending" }
    Then the FE starts polling GET for job "job-123" at approximately 1-second intervals
    And a processing/spinner state is visible in the modal

  # ---------------------------------------------------------------------------
  # §6.2 / §7.1 — All-success toast (Flow A)
  # ---------------------------------------------------------------------------

  @p0 @smoke @functional
  # requirement: §6.2, §7.1
  Scenario: All-success apply in Flow A shows correct toast and closes modal
    Given I have clicked "Complete update" in Flow A Step 2
    When the job status polls to "complete" with execution.succeeded_count=5 and summary.requested_count=5
    Then the modal closes
    And a toast notification reads "Rates updated — 5 plans updated."

  # ---------------------------------------------------------------------------
  # §7.2 — Partial success toast (Flow A — some skipped, all at toast level per spec)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §7.2, §7.5
  Scenario: Partial success apply in Flow A shows partial toast with N of M format
    Given I have clicked "Complete update" in Flow A Step 2
    When the job status polls to "complete" with execution.succeeded_count=4 and summary.requested_count=5
    Then the modal closes
    And a toast notification reads "Rates updated — 4 of 5 plans updated."
    And there is NO in-modal failure list or per-plan error detail

  # ---------------------------------------------------------------------------
  # §6.3 / §7.3 — Error toast on job error
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §6.3, §7.3
  Scenario: Job error shows error toast without persisting changes
    Given I have clicked "Complete update" in Flow A Step 2
    When the job returns status "errored"
    Then a toast notification reads "Couldn't update rates. Please try again."
    And the modal remains open or closes without confirming success

  # ---------------------------------------------------------------------------
  # §6.4 — Timeout (30s) messaging
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §6.4
  Scenario: 30-second timeout shows non-error inline message and closes modal without retry option
    Given I have clicked "Complete update" in Flow A Step 2
    When 30 seconds elapse and the job is still not in "complete" status
    Then the modal closes
    And a non-error inline message is shown indicating changes are still processing
    And NO retry button is presented

  # ---------------------------------------------------------------------------
  # §6.5 — Processing state UI shown during polling
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §6.5
  Scenario: Processing spinner state is shown in the modal while polling is in progress
    Given I have clicked "Complete update" in Flow A Step 2
    And the job is in "pending" or "running" status
    Then the modal displays a processing/spinner state
    And the "Complete update" button is not clickable during processing

  # ---------------------------------------------------------------------------
  # §7.4 — Flow B all-success toast uses template count only
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §7.4
  Scenario: Flow B success toast shows template count only (not cascaded plan count)
    Given I have clicked "Complete update" in Flow B Step 3 with cascade ON
    When the job status polls to "complete" with execution.succeeded_count=3
    Then a toast notification reads "Rates updated — 3 templates updated."
    And the toast does NOT mention the number of cascaded plans

  # ---------------------------------------------------------------------------
  # §7.5 — No in-modal success panel
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §7.5
  Scenario: No in-modal success panel is displayed after a successful apply
    Given I have completed a Flow A bulk apply successfully
    Then NO in-modal success panel is shown
    And the success feedback is delivered only via the Snackpack toast

  # ---------------------------------------------------------------------------
  # §8.1 / §8.2 — Tuition agreement toggle disabled state (FINOPS-318 not landed)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §8.1, §8.2
  Scenario: Tuition agreement toggle is visible but disabled with a tooltip when FINOPS-318 has not landed
    Given FINOPS-318 has not yet landed (toggle is in disabled state)
    When I open the Flow A modal
    Then the tuition-agreement toggle is visible in Step 1
    And the toggle is disabled
    And a tooltip is shown on the disabled toggle

  @p1 @functional
  # requirement: §8.2
  Scenario: Rate change still applies successfully when tuition-agreement toggle is disabled
    Given FINOPS-318 has not yet landed
    When I complete a full Flow A bulk apply with the disabled toggle
    Then the rate change is applied successfully
    And no error occurs due to the absent tuition-agreement field

  # ---------------------------------------------------------------------------
  # §9.1 — Audit rows created with correct audit_comment (Flow A)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §9.1
  Scenario: Flow A bulk apply creates audit rows with audit_comment 'bulk_adjust_rates_on_plans'
    Given I perform a successful Flow A bulk apply affecting 3 plans
    When I inspect the audits table
    Then audit rows exist for the affected recurring charges
    And each row has audit_comment "bulk_adjust_rates_on_plans"
    And all rows for this run share the same request_uuid

  # ---------------------------------------------------------------------------
  # §9.1 — Audit rows created with correct audit_comment (Flow B)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §9.1
  Scenario: Flow B bulk apply creates audit rows with audit_comment 'bulk_adjust_rates_on_templates'
    Given I perform a successful Flow B bulk apply on 2 templates
    When I inspect the audits table
    Then audit rows exist for the affected library charges
    And each row has audit_comment "bulk_adjust_rates_on_templates"

  # ---------------------------------------------------------------------------
  # §9.3 — audit_request_uuid present in apply response
  # ---------------------------------------------------------------------------

  @p2 @functional
  # requirement: §9.3
  Scenario: Persisted apply response includes execution.audit_request_uuid
    Given I perform a successful Flow A apply
    When the job completes and the FE receives the result
    Then the response payload contains "execution.audit_request_uuid" as a non-empty string

  # ---------------------------------------------------------------------------
  # §12.1 — Parent table refreshes after successful apply
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §12.1
  Scenario: Parent plans table refreshes automatically after Flow A successful apply
    Given I have completed a Flow A bulk apply raising rates by 5%
    When the apply job completes successfully
    Then the parent Student plans table React Query cache is invalidated
    And the updated rates are visible in the table without a manual page refresh

  # ---------------------------------------------------------------------------
  # §13.1 — Inactive plans skipped with plan_not_active (Flow A)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §13.1
  Scenario: Inactive plan in Flow A selection is skipped with reason plan_not_active
    Given I open the Flow A modal with a selection that includes one inactive plan
    When I perform the dry-run
    Then the dry-run response skipped[] array contains the inactive plan's ID
    And the skip reason is "plan_not_active"

  # ---------------------------------------------------------------------------
  # §13.2 — Plans with no eligible charges skipped (Flow A)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §13.2
  Scenario: Plan with no rate-bearing charges is skipped with reason no_eligible_charges
    Given I open the Flow A modal with a selection that includes a plan having only discount charges
    When I perform the dry-run
    Then the dry-run response skipped[] array contains that plan's ID
    And the skip reason is "no_eligible_charges"

  # ---------------------------------------------------------------------------
  # §13.3 — Templates with no charges excluded from Flow B
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §13.3
  Scenario: Template with no charge line items is skipped in Flow B dry-run
    Given I open the Flow B modal with a selection that includes a template with no charges
    When I perform the dry-run
    Then the dry-run response skipped[] array contains that template's ID
    And the skip reason is "no_eligible_charges"

  # ---------------------------------------------------------------------------
  # §5.13 — Authorization: non-admin cannot POST
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §5.13, §1.6
  Scenario: Staff role receives an authorization error if they attempt a bulk rate POST directly
    Given I am authenticated as a Staff-role user
    When I send a POST to the bulk adjust charges plans endpoint directly
    Then the API returns a 403 Forbidden response

  # ---------------------------------------------------------------------------
  # §4.10 — Cascade uses delta (not snap); drifted plans receive the same signed delta
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §4.10
  Scenario: Delta cascade applies the same signed adjustment to drifted downstream plans
    Given a template charges $100/month
    And a downstream plan has drifted to $95/month (customized away from template)
    When I apply a 10% bulk rate increase via Flow B with cascade ON
    Then the template charge becomes $110.00
    And the downstream plan charge becomes $104.50 (10% of $95.00 added, not snapped to $110.00)

  # ---------------------------------------------------------------------------
  # §5.11 — Flow B cascade skips plan not in template lineage
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §5.11
  Scenario: Cascade skip reason not_derived_from_template when plan_ids contains out-of-lineage plan
    Given I am performing a Flow B apply with cascade ON
    And I have manually sub-selected cascade_target.plan_ids including one plan not linked to any selected template
    When the apply completes
    Then the cascade skipped[] array contains that plan
    And the skip reason is "not_derived_from_template"

  # ---------------------------------------------------------------------------
  # §11.3 — Review card amounts sourced from BE cents (never client-side computed)
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §11.3
  Scenario: Review card amounts are sourced from BE dry-run response cents, not client-side math
    Given I am on Flow A Step 2 (Review)
    Then the summary card dollar amounts match the values returned in the dry-run response exactly
    And the amounts are NOT independently re-calculated by the client

  # ---------------------------------------------------------------------------
  # §2.2.6 — Multi-charge plans are included (not excluded) in Flow A table
  # ---------------------------------------------------------------------------

  @p1 @functional
  # requirement: §2.2.6
  Scenario: Multi-charge plan row appears in Flow A Step 1 table (not excluded)
    Given a student has a billing plan with two rate-bearing charges
    When I open the Flow A modal with that plan selected
    Then that plan's row is visible in the Step 1 table
    And the charges are displayed inline (comma-separated)

  # ---------------------------------------------------------------------------
  # §1.7 — Web only (negative check for mobile)
  # ---------------------------------------------------------------------------

  @p2 @functional
  # requirement: §1.7
  Scenario: Bulk Raise Rates feature is not accessible on a mobile-sized viewport
    Given the feature flag is enabled
    When I access the Students › Student plans table on a mobile viewport (width < 768px)
    Then the "Edit plan rates" option is not available or the page indicates a desktop-only experience
