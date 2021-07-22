const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');

const ghToken = core.getInput('github-token');
const summaryFile = core.getInput('summary-file');
const reportName = core.getInput('report-name');
const checkName = core.getInput('check-name');
const shouldCreateStatusCheck = core.getInput('create-status-check') == 'true';
const shouldCreatePRComment = core.getInput('create-pr-comment') == 'true';
const ignoreFailures = core.getInput('ignore-threshold-failures') == 'true';
const lineThreshold = parseInt(core.getInput('line-threshold'));
const branchThreshold = parseInt(core.getInput('branch-threshold'));

const octokit = github.getOctokit(ghToken);
const owner = github.context.repo.owner;
const repo = github.context.repo.repo;

if (!summaryFile || summaryFile.length === 0) {
  core.setFailed('The summary-file argument is required.');
  return;
}
if (shouldCreatePRComment && (!ghToken || ghToken.length === 0)) {
  core.setFailed('The github-token argument is required.');
  return;
}

async function createPrComment(markupData) {
  try {
    const response = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: github.context.payload.pull_request.number,
      body: markupData
    });

    if (response.status !== 201) {
      core.setFailed(`Failed to create PR comment. Error code: ${response.status}`);
    } else {
      core.info(`Created PR comment: ${response.data.id} with response status ${response.status}`);
    }
  } catch (error) {
    core.setFailed(`An error occurred trying to create the PR comment: ${error}`);
  }
}

async function createStatusCheck(markupData, checkTime, conclusion) {
  try {
    let git_sha =
      github.context.eventName === 'pull_request'
        ? github.context.payload.pull_request.head.sha
        : github.context.sha;
    core.info(
      `Creating status check for GitSha: ${git_sha} on a ${github.context.eventName} event.`
    );

    const response = await octokit.rest.checks.create({
      owner,
      repo,
      name: checkName,
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
      hasCoverage: true,
      badge: 'N/A',
      threshold: lineThreshold,
      actualCoverage: 0,
      conclusion: 'success',
      regex: /Line coverage: \| ([\d.]*)\%/
    },
    branch: {
      hasCoverage: true,
      badge: 'N/A',
      threshold: branchThreshold,
      actualCoverage: 0,
      conclusion: 'success',
      regex: /Branch coverage: \| ([\d.]*)\%/
    }
  };

  if (info.line.threshold === 0) {
    info.line.conclusion('neutral');
    info.line.hasCoverage(false);
  } else {
    const lineFound = markupData.match(info.line.regex);
    info.line.actualCoverage = lineFound && lineFound[1] ? parseInt(lineFound[1]) : 0;

    if (info.line.actualCoverage < info.line.threshold) {
      info.line.conclusion = ignoreFailures ? 'neutral' : 'failure';
    }

    info.line.badge = getBadge(info.line.conclusion);
  }

  if (info.branch.threshold === 0) {
    info.branch.conclusion('neutral');
    info.branch.hasCoverage(false);
  } else {
    const branchFound = markupData.match(info.branch.regex);
    info.branch.actualCoverage = branchFound && branchFound[1] ? parseInt(branchFound[1]) : 0;

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
        core.info('The summary file does not contain any data.  No status check will be created');
        return;
      }
    } else {
      core.setFailed(`The summary file '${summaryFile}' does not exist.`);
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
      await createPrComment(modifiedMarkup);
    }
  } catch (error) {
    core.setFailed(`An error occurred processing the summary file: ${error}`);
  }
}

run();
