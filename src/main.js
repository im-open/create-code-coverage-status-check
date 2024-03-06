const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');

const requiredArgOptions = {
  required: true,
  trimWhitespace: true
};

const ghToken = core.getInput('github-token', requiredArgOptions);
const summaryFile = core.getInput('summary-file', requiredArgOptions);
const reportName = core.getInput('report-name');
const checkName = core.getInput('check-name');
const shouldCreateStatusCheck = core.getBooleanInput('create-status-check');
const shouldCreatePRComment = core.getBooleanInput('create-pr-comment');
const updateCommentIfOneExists = core.getBooleanInput('update-comment-if-one-exists');
const ignoreFailures = core.getBooleanInput('ignore-threshold-failures');
const lineThreshold = parseInt(core.getInput('line-threshold'));
const branchThreshold = parseInt(core.getInput('branch-threshold'));

const octokit = github.getOctokit(ghToken);
const owner = github.context.repo.owner;
const repo = github.context.repo.repo;

const jobAndStep = `${process.env.GITHUB_JOB}_${process.env.GITHUB_ACTION}`;
const commentIdentifier = core.getInput('update-comment-key') || jobAndStep;

function createResultsFile(results, jobAndStep) {
  const resultsFileName = `coverage-results-${jobAndStep}.md`;

  core.info(`\nWriting results to ${resultsFileName}`);
  let resultsFilePath = null;

  fs.writeFile(resultsFileName, results, err => {
    if (err) {
      core.info(`Error writing results to file. Error: ${err}`);
    } else {
      core.info('Successfully created results file.');
      core.info(`File: ${resultsFileName}`);
    }
  });
  resultsFilePath = path.resolve(resultsFileName);
  return resultsFilePath;
}

async function lookForExistingComment(octokit, markdownPrefix) {
  let commentId = null;

  await octokit
    .paginate(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: github.context.payload.pull_request.number
    })
    .then(comments => {
      if (comments.length === 0) {
        core.info('There are no comments on the PR.  A new comment will be created.');
      } else {
        const existingComment = comments.find(c => c.body.startsWith(markdownPrefix));
        if (existingComment) {
          core.info(`An existing code coverage summary comment (${existingComment.id}) was found and will be updated.`);
          commentId = existingComment.id;
        } else {
          core.info('No comments were found.  A new comment will be created.');
        }
      }
    })
    .catch(error => {
      core.info(`Failed to list PR comments. Error code: ${error.message}.  A new comment will be created.`);
    });

  core.info(`Finished getting comments for PR #${github.context.payload.pull_request.number}.`);

  return commentId;
}

async function createPrComment(markdown, updateCommentIfOneExists, commentIdentifier) {
  if (github.context.eventName != 'pull_request') {
    core.info('This event was not triggered by a pull_request.  No comment will be created or updated.');
    return;
  }

  const markdownPrefix = `<!-- im-open/process-code-coverage-summary ${commentIdentifier} -->`;
  core.info(`The markdown prefix will be: '${markdownPrefix}'`);

  let commentIdToReturn;
  let existingCommentId = null;
  if (updateCommentIfOneExists) {
    core.info('Checking for existing comment on PR....');
    existingCommentId = await lookForExistingComment(octokit, markdownPrefix);
  }

  if (existingCommentId) {
    core.info(`Updating existing PR #${existingCommentId} comment...`);
    commentIdToReturn = existingCommentId;

    await octokit.rest.issues
      .updateComment({
        owner,
        repo,
        body: `${markdownPrefix}\n${markdown}`,
        comment_id: existingCommentId
      })
      .then(response => {
        core.info(`PR comment was updated.  ID: ${response.data.id}.`);
      })
      .catch(error => {
        core.setFailed(`An error occurred trying to update the PR comment: ${error.message}`);
      });
  } else {
    core.info(`Creating a new PR comment...`);
    await octokit.rest.issues
      .createComment({
        owner,
        repo,
        body: `${markdownPrefix}\n${markdown}`,
        issue_number: github.context.payload.pull_request.number
      })
      .then(response => {
        core.info(`PR comment was created.  ID: ${response.data.id}.`);
        commentIdToReturn = response.data.id;
      })
      .catch(error => {
        core.setFailed(`An error occurred trying to create the PR comment: ${error.message}`);
      });
  }
  return commentIdToReturn;
}

async function createStatusCheck(reportName, checkName, markdown, conclusion) {
  core.info(`\nCreating Status check for ${reportName}...`);

  const git_sha =
    github.context.eventName === 'pull_request' ? github.context.payload.pull_request.head.sha : github.context.sha;
  const name = `status check - ${checkName}`;
  const status = 'completed';
  const checkTime = new Date().toUTCString();
  const summary = `This run completed at \`${checkTime}\``;

  const propMessage = `  Name: ${name}
  GitSha: ${git_sha}
  Event: ${github.context.eventName}
  Status: ${status}
  Conclusion: ${conclusion}
  Check time: ${checkTime}
  Title: ${reportName}
  Summary: ${summary}`;
  core.info(propMessage);

  let statusCheckId;
  await octokit.rest.checks
    .create({
      owner,
      repo,
      name: name,
      head_sha: git_sha,
      status: status,
      conclusion: conclusion,
      output: {
        title: reportName,
        summary: summary,
        text: markdown
      }
    })
    .then(response => {
      core.info(`Created check: '${response.data.name}' with id '${response.data.id}'`);
      statusCheckId = response.data.id;
    })
    .catch(error => {
      core.setFailed(`An error occurred trying to create the status check: ${error.message}`);
    });
  return statusCheckId;
}

function getBadge(conclusion) {
  const badgeStatusText = conclusion === 'success' ? 'PASSED' : 'FAILED';
  const badgeColor = conclusion === 'success' ? 'brightgreen' : 'red';

  return `![Generic badge](https://img.shields.io/badge/${badgeStatusText}-${badgeColor}.svg)`;
}

function getMarkdownFromSummary(summaryInputData, reportName, coverageInfo) {
  const regex = /# Summary/i;
  const markdownDetails = summaryInputData.replace(regex, '');
  const line = coverageInfo.line;
  const branch = coverageInfo.branch;

  const markdown = `# ${reportName}

| Coverage Type | Threshold            | Actual Coverage           |  Status         |
|-------------- |----------------------|---------------------------|-----------------|
| Line          | ${line.threshold}%   | ${line.actualCoverage}%   | ${line.badge}   |
| Branch        | ${branch.threshold}% | ${branch.actualCoverage}% | ${branch.badge} |

## Code Coverage Summary

<details>
<summary>Code Coverage Details</summary>

${markdownDetails.trim()}
</details>
`;
  return markdown;
}

function getIndividualCoverageInfo(summaryInputData, coverageType, threshold, ignoreFailures) {
  let infoToReturn = {
    badge: 'N/A',
    threshold: threshold,
    actualCoverage: 0,
    conclusion: 'success'
  };

  let regex;
  switch (coverageType) {
    case 'line':
      regex = /Line coverage: \| ([\d.]*)\%/;
      break;
    case 'branch':
      regex = /Branch coverage: \| ([\d.]*)\%/;
      break;
  }

  const itemFound = summaryInputData.match(regex);
  infoToReturn.actualCoverage = itemFound && itemFound[1] ? parseInt(itemFound[1]) : 0;
  if (infoToReturn.threshold === 0) {
    infoToReturn.conclusion = 'neutral';
  } else {
    if (infoToReturn.actualCoverage < infoToReturn.threshold) {
      infoToReturn.conclusion = ignoreFailures ? 'neutral' : 'failure';
    }

    infoToReturn.badge = getBadge(infoToReturn.conclusion); // success = PASSED, everything else = FAILED
  }

  return infoToReturn;
}

function getCoverageInfo(summaryInputData, lineThreshold, branchThreshold, ignoreFailures) {
  const info = {
    statusCheckConclusion: 'success',
    coverageOutcome: 'Passed',
    line: getIndividualCoverageInfo(summaryInputData, 'line', lineThreshold, ignoreFailures),
    branch: getIndividualCoverageInfo(summaryInputData, 'branch', branchThreshold, ignoreFailures)
  };

  if (info.branch.conclusion == 'failure' || info.line.conclusion == 'failure') {
    info.statusCheckConclusion = 'failure';
    info.coverageOutcome = 'Failed';
  } else if (info.branch.conclusion == 'neutral' || info.line.conclusion == 'neutral') {
    info.statusCheckConclusion = 'neutral';
    info.coverageOutcome = 'Passed';
  }

  return info;
}

async function run() {
  try {
    let summaryInput;
    if (fs.existsSync(summaryFile)) {
      summaryInput = fs.readFileSync(summaryFile, 'utf8');
      if (!summaryInput) {
        core.info('The summary file does not contain any data.  No status check or pr comment will be created.');
        core.setOutput('coverage-outcome', 'Failed');
        return;
      }
    } else {
      core.setFailed(`The summary file '${summaryFile}' does not exist.  No status check or PR comment will be created.`);
      core.setOutput('coverage-outcome', 'Failed');
      return;
    }

    // |Scenario:                            | check conclusion | badge  | coverage-outcome |
    // |-------------------------------------|------------------|--------|------------------|
    // |threshold=0                          | neutral          | FAILED | Passed           |
    // |actual < threshold & !ignoreFailures | failure          | FAILED | Failed           |
    // |actual < threshold & ignoreFailures  | neutral          | FAILED | Passed           |
    // |actual >= threshold                  | success          | PASSED | Passed           |
    const coverageInfo = getCoverageInfo(summaryInput, lineThreshold, branchThreshold, ignoreFailures);
    core.setOutput('coverage-outcome', coverageInfo.coverageOutcome);

    const markdownResults = getMarkdownFromSummary(summaryInput, reportName, coverageInfo);

    if (shouldCreateStatusCheck) {
      const checkId = await createStatusCheck(reportName, checkName, markdownResults, coverageInfo.statusCheckConclusion);
      core.setOutput('status-check-id', checkId); // This is mainly for testing purposes
    }

    if (shouldCreatePRComment) {
      core.info(`\nCreating a PR comment with length ${markdownResults.length}...`);

      // GitHub API has a limit of 65535 characters for a comment so truncate the markup if we need to
      const characterLimit = 65535;
      let truncated = false;
      let mdForPrComment = markdownResults;

      if (mdForPrComment.length > characterLimit) {
        const message = `Truncating markdown data due to character limit exceeded for GitHub API.  Markdown data length: ${mdForPrComment.length}/${characterLimit}`;
        core.info(message);

        truncated = true;
        const truncatedMessage = `> [!Important]\n> Coverage results truncated due to character limit.  See full report in output.\n`;
        mdForPrComment = `${truncatedMessage}\n${mdForPrComment.substring(0, characterLimit - 100)}`;
      }
      core.setOutput('coverage-results-truncated', truncated);

      const commentId = await createPrComment(markdownResults, updateCommentIfOneExists, commentIdentifier);
      core.setOutput('pr-comment-id', commentId); // This is mainly for testing purposes
    }

    // Create this automatically to facilitate testing
    const resultsFilePath = createResultsFile(markdownResults, jobAndStep);
    core.setOutput('coverage-results-file-path', resultsFilePath);
  } catch (error) {
    core.setFailed(`An error occurred processing the summary file: ${error.message}`);
    core.setOutput('coverage-outcome', 'Failed');
  }
}

run();
