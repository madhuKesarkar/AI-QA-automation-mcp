Feature: Bulk upload rates (single site)
  # Verified directly against the live app (schools.qa.bwtest.net) via
  # accessibility tree inspection before writing these scenarios.
  # This is existing, shipped single-site behavior — not the org-level
  # feature from the PRD, which is not yet built anywhere we have access to.
  # See bulk-upload-rates-single-site.md for scope notes.

  Background:
    Given I am on the billing at-a-glance page

  @smoke
  Scenario: Bulk upload rates is reachable from Select an action
    When I open the "Select an action" menu
    Then I should see the "Bulk upload rates" menu item

  @smoke
  Scenario: The wizard shows all three steps
    When I open the bulk upload rates wizard
    Then I should see the wizard steps "Upload rate sheet", "Review rates", "Schedule billing"

  @sanity
  Scenario: The upload step offers a file drop zone with expected file types
    When I open the bulk upload rates wizard
    Then I should see a file drop zone
    And the accepted file types should include "csv" and "xlsx"

  @sanity
  Scenario: Create rates manually is offered as an alternative
    When I open the bulk upload rates wizard
    Then the "Create rates manually" option should be visible

  @sanity
  Scenario: Cancel closes the wizard
    Given I have opened the bulk upload rates wizard
    When I click Cancel
    Then I should be back on the at-a-glance page
