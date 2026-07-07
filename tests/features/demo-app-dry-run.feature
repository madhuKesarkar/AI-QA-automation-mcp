Feature: Demo app login and todos
  # This is a framework dry-run fixture, not a real product spec.
  # Used to validate the Gherkin -> playwright-bdd -> Playwright pipeline
  # end to end before wiring it against a real feature.

  Background:
    Given I am on the login screen

  @smoke
  Scenario: Login screen loads
    Then the login button should be visible

  @sanity
  Scenario: Log in with valid credentials
    When I log in with "user@example.com" and "password123"
    Then I should see the todo app screen

  @functional
  Scenario: Log in with invalid credentials shows an error
    When I log in with "user@example.com" and "wrongpassword"
    Then I should see the login error "Invalid credentials"

  @functional
  Scenario: Log in with missing password shows an error
    When I log in with "user@example.com" and ""
    Then I should see the login error "Email and password are required"

  @sanity
  Scenario: Add a todo
    Given I am logged in
    When I add a todo "Buy milk"
    Then "Buy milk" should appear in the todo list
    And I should see a success toast for the todo

  @functional
  Scenario: Adding an empty todo shows an error
    Given I am logged in
    When I add a todo ""
    Then I should see the add-todo error "Todo text cannot be empty"

  @functional
  Scenario: Clicking a todo marks it done
    Given I am logged in
    And I have added a todo "Walk the dog"
    When I click the todo "Walk the dog"
    Then the todo "Walk the dog" should be marked done
