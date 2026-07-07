Feature: Bulk upload rates (org level)
  # Source: Linear feat-bulk-upload-rates-org-level | PRD: <paste link/content>
  # App: https://schools.sandbox.bwtest.net/billing/overview/unpaid
  # STATUS: DRAFT — scenarios below are placeholders, not yet derived from the PRD.
  # Do not treat as an approved test plan until filled in from real acceptance criteria.

  Background:
    Given I am logged in as an org admin
    And I am on the billing overview page

  @smoke
  Scenario: Bulk upload rates entry point is visible
    # TODO: confirm exact entry point (button/menu item) once PRD/UI is reviewed
    Then the "Bulk upload rates" action should be visible

  @sanity
  Scenario: Upload a valid rates file
    # TODO: fill in from PRD — expected file format, required columns, success state
    Given I open the bulk upload rates modal
    When I upload a valid rates file
    Then I should see a success confirmation

  @functional
  Scenario: Upload a file with invalid rows
    # TODO: fill in from PRD — what counts as invalid, partial success vs. full rejection
    Given I open the bulk upload rates modal
    When I upload a file containing invalid rows
    Then I should see an error summary listing the invalid rows

  @functional
  Scenario: Upload a file with an unsupported format
    # TODO: confirm supported formats (csv/xlsx?) from PRD or FE spec
    Given I open the bulk upload rates modal
    When I upload a file in an unsupported format
    Then I should see an error message rejecting the file
