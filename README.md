# process-code-coverage-summary

This action works in conjunction with [im-open/code-coverage-report-generator].  If a `Summary.md` file is created in the report generator action by including `MarkdownSummary` in the `reporttypes` input, this action will take the contents of that file and create a Status Check or PR Comment depending on the flags set.  This action does not create code coverage reports and it only processes one summary report at a time.

## Index <!-- omit in toc -->

- [process-code-coverage-summary](#process-code-coverage-summary)
  - [Thresholds](#thresholds)
  - [Limitations](#limitations)
  - [Action Outputs](#action-outputs)
    - [Pull Request Comment](#pull-request-comment)
    - [Pull Request Status Check](#pull-request-status-check)
    - [Workflow Run](#workflow-run)
    - [Code Coverage Details](#code-coverage-details)
  - [Inputs](#inputs)
  - [Outputs](#outputs)
  - [Usage Examples](#usage-examples)
  - [Contributing](#contributing)
    - [Incrementing the Version](#incrementing-the-version)
    - [Source Code Changes](#source-code-changes)
    - [Recompiling Manually](#recompiling-manually)
    - [Updating the README.md](#updating-the-readmemd)
  - [Code of Conduct](#code-of-conduct)
  - [License](#license)
  
## Thresholds

The coverage status & action's conclusion can be viewed in multiple places:

- In the body of a PR comment this action generates
- Next to the name of one of the status checks under the `Checks` section of a PR
- Next to the name of one of the status checks under the `Jobs` section of the workflow run
- In the body of a status check listed on the workflow run

If thresholds for line or branch coverage have been provided and the actual branch or line coverage does not meet or exceed the threshold, the status check will be marked as `failed`.  Having the status check marked as `failed` will prevent PRs from being merged.  If this status check behavior is not desired, the `ignore-threshold-failures` input can be set and the outcome will be marked as `neutral` if threshold failures are detected.  The status badge that is shown in the comment or status check body will still indicate it was a failure though.

If you want the code coverage to be reported without indicating whether it was a success or failure, leave the `line-threshold` and `branch-threshold` inputs as the default `0`.

There are several factors will contribute to the final disposition:

| Scenario:                                      | `ignore-threshold-`<br/>`failures` input | status check<br/>conclusion | `coverage-outcome`<br/>output | PR Comment or<br/>Status Check<br/>Results Badge |
|------------------------------------------------|------------------------------------------|-----------------------------|-------------------------------|--------------------------------------------------|
| `line-threshold:0`<br/>or `branch-threshold:0` | `true` or `false`                        | `neutral`                   | `Passed`                      | N/A                                              |
| actualCoverage < threshold                     | `false`                                  | `failure`                   | `Failed`                      | `FAILED`                                         |
| actualCoverage < threshold                     | `true`                                   | `neutral`                   | `Passed`                      | `FAILED`                                         |
| actualCoverage >= threshold                    | `true` or `false`                        | `success`                   | `Passed`                      | `PASSED`                                         |

## Limitations

GitHub does have a size limitation of 65535 characters for a Status Check body or a PR Comment. This action would fail if the test results exceeded the GitHub [limit]. To mitigate this size issue only details for failed tests are included in the output in addition to a badge, duration info and outcome info. If the comment still exceeds that size, it will be truncated with a note to see the remaining output in the log.

If you have multiple workflows triggered by the same `pull_request` or `push` event, GitHub creates one checksuite for that commit.  The checksuite gets assigned to one of the workflows randomly and all status checks for that commit are reported to that checksuite. That means if there are multiple workflows with the same trigger, your status checks may show on a different workflow run than the run that created them.

## Action Outputs

### Pull Request Comment

This is shown on the pull request when the `create-pr-comment` is set to `true` and there is a PR associated with the commit.
<kbd><img src="./docs/pull_request_comment.png"></img></kbd>

### Pull Request Status Check

This is shown on the pull request when the `create-status-check` is set to `true` and there is a PR associated with the commit.
<kbd><img src="./docs/pull_request_status_check.png"></img></kbd>

### Workflow Run

This is shown on the workflow run when the `create-status-check` is set to `true`.
<kbd><img src="./docs/status_check.png"></img></kbd>

### Code Coverage Details

If the `Code Coverage Details` in the Status Check body or PR Comment are expanded a summary similar to this is shown:
<kbd><img src="./docs/code_coverage_details.png"></img></kbd>

## Inputs

| Parameter                      | Is Required | Default                                             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
|--------------------------------|-------------|-----------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `github-token`                 | true        | N/A                                                 | Token used to interact with the repository. Generally `secrets.GITHUB_TOKEN.`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `summary-file`                 | true        | N/A                                                 | The summary file generated by the report-generator action.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `report-name`                  | false       | `Code Coverage Results`                             | The desired name of the report that is shown on the PR Comment and inside the Status Check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `create-status-check`          | false       | `true`                                              | Flag indicating whether a status check with code coverage results should be generated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `check-name`                   | false       | `code coverage`                                     | The desired name of the status check.<br/><br/>*Only applicable when `create-status-check` is true.*                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `create-pr-comment`            | false       | `true`                                              | Flag indicating whether a PR comment with code coverage results should be generated.  When `true` the default behavior is to update an existing comment if one exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `update-comment-if-one-exists` | false       | `true`                                              | This flag determines whether a new comment is created or if the action updates an existing comment (*if one is found*).<br/><br/>*Only applicable when `create-pr-comment` is true.*                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `update-comment-key`           | false       | `${{env.GITHUB-JOB}}_`<br/>`${{env.GITHUB-ACTION}}` | A unique identifier which will be added to the generated markdown as a comment (*it will not be visible in the PR comment*).<br/><br/>This identifier enables creating then updating separate results comments on the PR if more than one instance of this action is included in a single job. This can be helpful when there are multiple coverage projects that run separately but are part of the same job. Each instance of the action should have a different key and this value should be static so it remains the same each time the workflow is run.<br/><br/>*Only applicable when `create-pr-comment` and `update-comment-if-one-exists` are true.* |
| `ignore-threshold-failures`    | false       | `false`                                             | If the coverage falls below the threshold and this is set to `true` the status check's conclusion will be set to `neutral` and the `coverage-outcome` output will be set to `Passed`.<br/><br/>This is useful if you want coverage reported but do not want a failing status check to block pull requests.                                                                                                                                                                                                                                                                                                                                                    |
| `line-threshold`               | false       | `0`                                                 | Minimum threshold for line coverage. The status check conclusion will be `failure`and `coverage-outcome` will be `Failed` if the actual coverage amount is less than this.<br/><br/>Set to `0` to disable line coverage checks. When `0`, the status check will always be `neutral` and the `coverage-outcome` will be `Passed`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `branch-threshold`             | false       | `0`                                                 | Minimum threshold for branch coverage. The status check conclusion will be `failure`and `coverage-outcome` will be `Failed` if the actual coverage amount is less than this.<br/><br/>Set to `0` to disable branch coverage checks. When `0`, the status check will always be `neutral` and the `coverage-outcome` will be `Passed`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Outputs

| Output                       | Description                                                                                                                                                                                                                            |
|------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `coverage-outcome`           | Coverage outcome based on Threshold comparisons: *Failed,Passed* <br/>If exceptions are thrown or if it exits early because of argument errors, this is set to *Failed*.<br/>If thresholds are set to 0, this will be set to *Passed*. |
| `coverage-results-truncated` | Flag indicating whether coverage results were truncated due to markdown exceeding character limit of 65535.                                                                                                                            |
| `coverage-results-file-path` | File path for the file that contains the coverage results in markdown format.  This is the same output that is posted in the PR comment.                                                                                               |
| `status-check-id`            | The ID of the Status Check that was created.  This is only set if `create-status-check` is `true` and a status check was created successfully.                                                                                         |
| `pr-comment-id`              | The ID of the PR comment that was created.  This is only set if `create-pr-comment` is `true` and a PR was created successfully.                                                                                                       |

## Usage Examples

```yml
name: CI Build

on:
  pull_request:
    types: [opened, reopened, synchronize]

jobs:
  ci:
    runs-on: [ubuntu-20.04]

    steps:
      - uses: actions/checkout@v4

      # dotnet tests
      - name: Setup .NET Core
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: ${{ env.DOTNET_VERSION }}

      - name: dotnet test with coverage
        continue-on-error: true
        run: dotnet test './src/MyProj.sln' --logger trx --configuration Release /property:CollectCoverage=True /property:CoverletOutputFormat=opencover 

      - name: ReportGenerator
        uses: im-open/code-coverage-report-generator@4
        with:
          reports: '*/**/coverage.opencover.xml'
          targetdir: './coverage-results'
          title: dotnet code coverage
          reporttypes: 'MarkdownSummary;'
          assemblyfilters: '-xunit*;-Dapper;-MyProj.Tests.Shared;'
          
      - name: Create a status check for the code coverage results
        id: dotnet-coverage-check
        # You may also reference just the major or major.minor version
        uses: im-open/process-code-coverage-summary@v2.3.0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}     
          summary-file: './coverage-results/dotnet-summary.md'
          report-name: 'MyProj .NET Code Coverage'      # Default: Code Coverage Results
          check-name: 'dotnet code coverage'            # Default: code coverage
          create-status-check: true                     # Default: true
          create-pr-comment: true                       # Default: true
          update-comment-if-one-exists: true            # Default: true
          update-comment-key: 'dotnet'                  # Default: N/A, used to further identify a comment to update if this action is used more than once in a workflow
          ignore-threshold-failures: false              # Default: false
          line-threshold: 99                            # Default: 0, which means thresholds are not applied
          branch-threshold: 98                          # Default: 0, which means thresholds are not applied
      
      # jest tests
      - name: jest test with coverage
        continue-on-error: true
        working-directory: ./tests
        run: npm run test -- --outputFile=jest-results.json

      - name: create code coverage report
        uses: im-open/code-coverage-report-generator@4
        with:
          reports: '*/**/lcov.info'
          targetdir: ./tests
          title: jest code coverage

      - name: create status check/comment for code coverage results
        id: jest_coverage_check
        uses: im-open/process-code-coverage-summary@v2.3.0
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          summary-file: './coverage-results/jest-summary.md'
          create-pr-comment: true
          update-comment-if-one-exists: true
          update-comment-key: 'jest'                

      - name: Fail if there were coverage failures
        if: steps.dotnet-coverage-check.outputs.coverage-outcome == 'Failed'
        run: |
          echo "There were code coverage threshold failures."
          exit 1
```

## Contributing

When creating PRs, please review the following guidelines:

- [ ] The action code does not contain sensitive information.
- [ ] At least one of the commit messages contains the appropriate `+semver:` keywords listed under [Incrementing the Version] for major and minor increments.
- [ ] The action has been recompiled.  See [Recompiling Manually] for details.
- [ ] The README.md has been updated with the latest version of the action.  See [Updating the README.md] for details.

### Incrementing the Version

This repo uses [git-version-lite] in its workflows to examine commit messages to determine whether to perform a major, minor or patch increment on merge if [source code] changes have been made.  The following table provides the fragment that should be included in a commit message to active different increment strategies.

| Increment Type | Commit Message Fragment                     |
|----------------|---------------------------------------------|
| major          | +semver:breaking                            |
| major          | +semver:major                               |
| minor          | +semver:feature                             |
| minor          | +semver:minor                               |
| patch          | *default increment type, no comment needed* |

### Source Code Changes

The files and directories that are considered source code are listed in the `files-with-code` and `dirs-with-code` arguments in both the [build-and-review-pr] and [increment-version-on-merge] workflows.  

If a PR contains source code changes, the README.md should be updated with the latest action version and the action should be recompiled.  The [build-and-review-pr] workflow will ensure these steps are performed when they are required.  The workflow will provide instructions for completing these steps if the PR Author does not initially complete them.

If a PR consists solely of non-source code changes like changes to the `README.md` or workflows under `./.github/workflows`, version updates and recompiles do not need to be performed.

### Recompiling Manually

This command utilizes [esbuild] to bundle the action and its dependencies into a single file located in the `dist` folder.  If changes are made to the action's [source code], the action must be recompiled by running the following command:

```sh
# Installs dependencies and bundles the code
npm run build
```

### Updating the README.md

If changes are made to the action's [source code], the [usage examples] section of this file should be updated with the next version of the action.  Each instance of this action should be updated.  This helps users know what the latest tag is without having to navigate to the Tags page of the repository.  See [Incrementing the Version] for details on how to determine what the next version will be or consult the first workflow run for the PR which will also calculate the next version.

## Code of Conduct

This project has adopted the [im-open's Code of Conduct](https://github.com/im-open/.github/blob/main/CODE_OF_CONDUCT.md).

## License

Copyright &copy; 2024, Extend Health, LLC. Code released under the [MIT license](LICENSE).

<!-- Links -->
[Incrementing the Version]: #incrementing-the-version
[Recompiling Manually]: #recompiling-manually
[Updating the README.md]: #updating-the-readmemd
[source code]: #source-code-changes
[usage examples]: #usage-examples
[build-and-review-pr]: ./.github/workflows/build-and-review-pr.yml
[increment-version-on-merge]: ./.github/workflows/increment-version-on-merge.yml
[esbuild]: https://esbuild.github.io/getting-started/#bundling-for-node
[git-version-lite]: https://github.com/im-open/git-version-lite
[im-open/code-coverage-report-generator]: https://github.com/im-open/code-coverage-report-generator
