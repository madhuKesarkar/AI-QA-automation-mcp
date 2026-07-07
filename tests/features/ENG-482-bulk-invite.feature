Feature: Bulk invite parents
  # Source: Linear ENG-482 | PRD §2.1 | Figma "Invite flow"
  # Generated from context brief — reviewed and approved by QA before scripting.

  Background:
    Given I am logged in as a school admin
    And I am on the parents page

  @smoke
  Scenario: Invite modal loads
    When I click "Invite parents"
    Then the invite modal should be visible

  @sanity
  Scenario: Invite a single parent with a valid email
    Given the invite modal is open
    When I enter "parent@example.com" in the email field
    And I click "Send invite"
    Then I should see a success toast
    And the parent should appear in the pending list

  @functional
  Scenario: Invite with a malformed email shows a validation error
    Given the invite modal is open
    When I enter "not-an-email" in the email field
    Then I should see an inline error "Enter a valid email"
    And the submit button should be disabled

  @functional
  Scenario: Inviting the same email twice shows a duplicate warning
    Given "parent@example.com" has already been invited
    And the invite modal is open
    When I enter "parent@example.com" in the email field
    And I click "Send invite"
    Then I should see a warning "This parent has already been invited"
