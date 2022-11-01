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
const shouldCreateStatusCheck = core.getBooleanInput('create-status-check');
const shouldCreatePRComment = core.getBooleanInput('create-pr-comment');
const updateCommentIfOneExists = core.getBooleanInput('update-comment-if-one-exists');
const updateCommentKey = core.getInput('update-comment-key') || '';
const ignoreFailures = core.getBooleanInput('ignore-threshold-failures');
const lineThreshold = parseInt(core.getInput('line-threshold'));
const branchThreshold = parseInt(core.getInput('branch-threshold'));

const octokit = github.getOctokit(ghToken);
const owner = github.context.repo.owner;
const repo = github.context.repo.repo;

let commentKey = '';
if (updateCommentKey && updateCommentKey.trim().length > 0) {
  commentKey = `-${updateCommentKey.trim().replace(/[^a-zA-Z0-9]/g, '')}`;
}
const markupPrefix = `<!-- im-open/process-code-coverage-summary${commentKey} -->`;

async function lookForExistingComment(octokit) {
  let commentId = null;

  await octokit
    .paginate(octokit.rest.issues.listComments, {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: github.context.payload.pull_request.number
    })
    .then(comments => {
      if (comments.length === 0) {
        core.info('There are no comments on the PR.  A new comment will be created.');
      } else {
        const existingComment = comments.find(c => c.body.startsWith(markupPrefix));
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

async function createPrComment(markupData, updateCommentIfOneExists) {
  if (github.context.eventName != 'pull_request') {
    core.info('This event was not triggered by a pull_request.  No comment will be created or updated.');
    return;
  }

  let existingCommentId = null;
  if (updateCommentIfOneExists) {
    core.info('Checking for existing comment on PR....');
    existingCommentId = await lookForExistingComment(octokit);
  }

  if (existingCommentId) {
    core.info(`Updating existing PR #${existingCommentId} comment...`);
    await octokit.rest.issues
      .updateComment({
        owner,
        repo,
        body: `${markupPrefix}\n${markupData}`,
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
        body: `${markupPrefix}\n${markupData}`,
        issue_number: github.context.payload.pull_request.number
      })
      .then(response => {
        core.info(`PR comment was created.  ID: ${response.data.id}.`);
      })
      .catch(error => {
        core.setFailed(`An error occurred trying to create the PR comment: ${error.message}`);
      });
  }
}

async function createStatusCheck(markupData, checkTime, conclusion) {
  const git_sha =
    github.context.eventName === 'pull_request' ? github.context.payload.pull_request.head.sha : github.context.sha;
  core.info(`Creating status check for GitSha: ${git_sha} on a ${github.context.eventName} event.`);

  await octokit.rest.checks
    .create({
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
    })
    .then(response => {
      core.info(`Created check: ${response.data.name}`);
    })
    .catch(error => {
      core.setFailed(`An error occurred trying to create the status check: ${error.message}`);
    });
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
    core.setFailed(`An error occurred processing the summary file: ${error.message}`);
    core.setOutput('coverage-outcome', 'Failed');
  }
}

run();
