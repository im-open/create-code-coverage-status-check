const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');

const requiredArgOptions = {
  required: true,
  trimWhitespace: true
};

const ghToken = core.getInput('github-token', requiredArgOptions);
const summaryFile = core.getInput('summary-file', requiredArgOptions);
const reportName = core.getInput('report-name');
const checkName = core.getInput('check-name');
const shouldCreateStatusCheck = core.getInput('create-status-check') == 'true';
const shouldCreatePRComment = core.getInput('create-pr-comment') == 'true';
const updateCommentIfOneExists = core.getInput('update-comment-if-one-exists') == 'true';
const ignoreFailures = core.getInput('ignore-threshold-failures') == 'true';
const lineThreshold = parseInt(core.getInput('line-threshold'));
const branchThreshold = parseInt(core.getInput('branch-threshold'));

const octokit = github.getOctokit(ghToken);
const owner = github.context.repo.owner;
const repo = github.context.repo.repo;
const markupPrefix = '<!-- im-open/process-code-coverage-summary -->';

async function lookForExistingComment(octokit) {
  const commentsResponse = await octokit.rest.issues.listComments({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: github.context.payload.pull_request.number
  });

  if (commentsResponse.status !== 200) {
    core.info(`Failed to list PR comments. Error code: ${commentsResponse.status}.  Will create new comment instead.`);
    return null;
  }

  const existingComment = commentsResponse.data.find(c => c.body.startsWith(markupPrefix));
  if (!existingComment) {
    core.info('An existing code coverage summary comment was not found, creating a new one instead.');
  }
  return existingComment ? existingComment.id : null;
}

async function createPrComment(markupData, updateCommentIfOneExists) {
  try {
    if (github.context.eventName != 'pull_request') {
      core.info('This event was not triggered by a pull_request.  No comment will be created or updated.');
      return;
    }

    let existingCommentId = null;
    if (updateCommentIfOneExists) {
      core.info('Checking for existing comment on PR....');
      existingCommentId = await lookForExistingComment(octokit);
    }

    let response;
    let success;
    if (existingCommentId) {
      core.info(`Updating existing PR #${existingCommentId} comment...`);
      response = await octokit.rest.issues.updateComment({
        owner,
        repo,
        body: `${markupPrefix}\n${markupData}`,
        comment_id: existingCommentId
      });
      success = response.status === 200;
    } else {
      core.info(`Creating a new PR comment...`);
      response = await octokit.rest.issues.createComment({
        owner,
        repo,
        body: `${markupPrefix}\n${markupData}`,
        issue_number: github.context.payload.pull_request.number
      });
      success = response.status === 201;
    }

    const action = existingCommentId ? 'create' : 'update';
    if (success) {
      core.info(`PR comment was ${action}d.  ID: ${response.data.id}.`);
    } else {
      core.setFailed(`Failed to ${action} PR comment. Error code: ${response.status}.`);
    }
  } catch (error) {
    core.setFailed(`An error occurred trying to create or update the PR comment: ${error}`);
  }
}

async function createStatusCheck(markupData, checkTime, conclusion) {
  try {
    let git_sha =
      github.context.eventName === 'pull_request' ? github.context.payload.pull_request.head.sha : github.context.sha;
    core.info(`Creating status check for GitSha: ${git_sha} on a ${github.context.eventName} event.`);

    const response = await octokit.rest.checks.create({
      owner,
      repo,
      name: `status check - ${checkName}`,
      head_sha: git_sha,
      status: 'completed',
      conclusion: conclusion,
      output: {
        title: reportName,
        summary: `This run completed at \`${checkTime}\``,
        text: markupData
      }
    });

    if (response.status !== 201) {
      core.setFailed(`Failed to create status check. Error code: ${response.status}`);
    } else {
      core.info(`Created check: ${response.data.name} with response status ${response.status}`);
    }
  } catch (error) {
    core.setFailed(`An error occurred trying to create the status check: ${error}`);
  }
}

function getBadge(conclusion) {
  const badgeStatusText = conclusion === 'success' ? 'PASSED' : 'FAILED';
  const badgeColor = conclusion === 'success' ? 'brightgreen' : 'red';

  return `![Generic badge](https://img.shields.io/badge/${badgeStatusText}-${badgeColor}.svg)`;
}

function getModifiedMarkup(markupData, ci) {
  const regex = /# Summary/i;
  const updatedMarkup = markupData.replace(regex, '');

  const modifiedMarkup = `
# ${reportName}    

|Coverage Type|Threshold|Actual Coverage| Status |
|-------------|---------|---------------|--------|
|Line         |${ci.line.threshold}%|${ci.line.actualCoverage}%|${ci.line.badge} |
|Branch       |${ci.branch.threshold}%|${ci.branch.actualCoverage}%|${ci.branch.badge}|

### Code Coverage Summary
<details>
<summary>Code Coverage Details</summary>

${updatedMarkup.trim()}
</details>
`.trim();
  return modifiedMarkup;
}

function getCoverageInfo(markupData) {
  let info = {
    statusConclusion: 'success',
    line: {
      badge: 'N/A',
      threshold: lineThreshold,
      actualCoverage: 0,
      conclusion: 'success',
      regex: /Line coverage: \| ([\d.]*)\%/
    },
    branch: {
      badge: 'N/A',
      threshold: branchThreshold,
      actualCoverage: 0,
      conclusion: 'success',
      regex: /Branch coverage: \| ([\d.]*)\%/
    }
  };

  const lineFound = markupData.match(info.line.regex);
  info.line.actualCoverage = lineFound && lineFound[1] ? parseInt(lineFound[1]) : 0;
  if (info.line.threshold === 0) {
    info.line.conclusion = 'neutral';
  } else {
    if (info.line.actualCoverage < info.line.threshold) {
      info.line.conclusion = ignoreFailures ? 'neutral' : 'failure';
    }

    info.line.badge = getBadge(info.line.conclusion);
  }

  const branchFound = markupData.match(info.branch.regex);
  info.branch.actualCoverage = branchFound && branchFound[1] ? parseInt(branchFound[1]) : 0;
  if (info.branch.threshold === 0) {
    info.branch.conclusion = 'neutral';
  } else {
    if (info.branch.actualCoverage < info.branch.threshold) {
      info.branch.conclusion = ignoreFailures ? 'neutral' : 'failure';
    }

    info.branch.badge = getBadge(info.branch.conclusion);
  }

  if (info.branch.conclusion == 'failure' || info.line.conclusion == 'failure') {
    info.statusConclusion = 'failure';
  } else if (info.branch.conclusion == 'neutral' || info.line.conclusion == 'neutral') {
    info.statusConclusion = 'neutral';
  }
  return info;
}

async function run() {
  try {
    let markupData;
    if (fs.existsSync(summaryFile)) {
      markupData = fs.readFileSync(summaryFile, 'utf8');
      if (!markupData) {
        core.info('The summary file does not contain any data.  No status check or pr comment will be created.');
        core.setOutput('coverage-outcome', 'Failed');
        return;
      }
    } else {
      core.setFailed(`The summary file '${summaryFile}' does not exist.  No status check or PR comment will be created.`);
      core.setOutput('coverage-outcome', 'Failed');
      return;
    }

    let coverageInfo = getCoverageInfo(markupData);
    const modifiedMarkup = getModifiedMarkup(markupData, coverageInfo);

    const checkTime = new Date().toUTCString();
    core.info(`Check time is: ${checkTime}`);

    if (shouldCreateStatusCheck) {
      await createStatusCheck(modifiedMarkup, checkTime, coverageInfo.statusConclusion);
    }
    if (shouldCreatePRComment && github.context.eventName == 'pull_request') {
      await createPrComment(modifiedMarkup, updateCommentIfOneExists);
    }

    core.setOutput('coverage-outcome', coverageInfo.statusConclusion == 'failure' ? 'Failed' : 'Passed');
  } catch (error) {
    core.setFailed(`An error occurred processing the summary file: ${error}`);
    core.setOutput('coverage-outcome', 'Failed');
  }
}

run();
