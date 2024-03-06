module.exports = async (core, statusCheck, expectedValues) => {
  function assertValuesMatch(variableName, expectedValue, actualValue, multiline) {
    if (multiline) {
      core.startGroup(`\nExpected ${variableName}`);
      core.info(expectedValue);
      core.endGroup();

      core.startGroup(`Actual ${variableName}`);
      core.info(actualValue);
      core.endGroup();
    } else {
      core.info(`\nExpected ${variableName}: '${expectedValue}'`);
      core.info(`Actual ${variableName}:   '${actualValue}'`);
    }

    if (expectedValue != actualValue) {
      core.setFailed(`The expected ${variableName} does not match the actual ${variableName}.`);
    } else {
      core.info(`The expected and actual ${variableName} values match.`);
    }
  }

  function assertValueContainsSubstring(valueName, value, substringName, substring) {
    if (value.includes(substring)) {
      core.info(`\nChecking ${valueName} contains the ${substringName} substring.`);
      core.info(`The ${valueName} string contains the substring.`);
    } else {
      core.info(`\nChecking ${valueName} contains the ${substringName} substring.`);
      core.setFailed(`The ${valueName} string does not contain the ${substringName} substring.`);
      core.startGroup('String and substring Details');
      core.info(`\n${valueName}: '${value}'`);
      core.info(`${substringName}: '${substring}'`);
      core.endGroup();
    }
  }

  function validateProps() {
    core.info(`\nAsserting that Status Check properties match the expected values.`);
    core.info(`Status Check: ${statusCheck.id}`);

    assertValuesMatch('Name', expectedValues['name'], statusCheck.name);
    assertValuesMatch('Status', expectedValues['status'], statusCheck.status);
    assertValuesMatch('Conclusion', expectedValues['conclusion'], statusCheck.conclusion);
    assertValuesMatch('Title', expectedValues['title'], statusCheck.title);
    assertValuesMatch('Text', expectedValues['text'], statusCheck.text, true);

    // The summary should be something like: 'This test run completed at `Wed, 21 Feb 2024 20:21:48 GMT`'
    // so just check that it contains the static portion.
    assertValueContainsSubstring('Summary', statusCheck.summary, 'Partial Test Run Text', 'This run completed at `');
  }

  validateProps();
};
