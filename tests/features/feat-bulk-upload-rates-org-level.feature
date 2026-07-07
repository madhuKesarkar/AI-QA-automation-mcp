Feature: Bulk upload rates (org level)
  # Source: PRD "Bulk Upload Rate Sheet, Org Level"
  #   https://docs.google.com/document/d/1zykE3a2_gt3Cbo8F8ir-_-_6k2G4XmKt/edit
  # App: https://schools.sandbox.bwtest.net/billing/overview/unpaid
  # STATUS: DRAFT — pending QA review. Two PRD questions are still open (see
  # feat-bulk-upload-rates-org-level.md) and TC-01 / TC-05 below reflect the
  # best-known current POC behavior, not a confirmed spec. Do not approve
  # until those are resolved with PM.

  Background:
    Given I am logged in as an org admin
    And I am on the billing overview page for the org

  @smoke
  Scenario: Bulk upload rates entry point is reachable
    # PRD FR-01 does not confirm the entry point location — using the
    # known POC location (secondary CTA on templates tab) as a placeholder.
    # CONFIRM against live app / with PM before treating this as approved.
    When I navigate to the billing templates tab
    Then the "Bulk upload rates" action should be visible

  @sanity
  Scenario: Upload a valid org rate sheet and confirm
    Given I open the bulk upload rates flow
    When I upload a valid org rate sheet
    Then I should be taken to the review rates step
    And the parsed recurring rates should be listed for review
    When I confirm the upload
    Then I should see a success confirmation

  @sanity
  Scenario: Confirming creates bill plan templates from recurring rates
    Given I have uploaded and confirmed a valid org rate sheet
    Then a bill plan template should exist for each recurring rate
    And each template should be visible in the billing template library

  @functional
  Scenario: Created templates use the same default location sharing as a manually created template
    Given I have uploaded and confirmed a valid org rate sheet
    And a bill plan template already exists that was created manually
    Then the templates created from the upload should share the same default location-sharing settings as the manually created template

  @functional
  Scenario: One-time charges are not carried into created templates
    # Depends on the PRD's open "fixed charges in scope?" question.
    # Current known POC behavior: one-time charges are dropped entirely.
    # Re-verify once that question is resolved.
    Given I upload an org rate sheet containing both recurring and one-time charges
    When I confirm the upload
    Then only the recurring charges should appear as bill plan templates
    And the one-time charges should not appear anywhere in the created templates

  @functional
  Scenario: A template created via bulk upload behaves like a manually created template
    Given I have uploaded and confirmed a valid org rate sheet
    When I open a template that was created from the upload
    Then I should be able to edit it the same way as a manually created template
    And I should be able to delete it the same way as a manually created template
