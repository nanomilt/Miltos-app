import dotenv from 'dotenv'
import fs from 'fs'
import { App } from 'octokit'
import { createNodeMiddleware } from '@octokit/webhooks'
import http from 'http'

// Load environment variables from .env file
dotenv.config()

// Set up GitHub App details
const appId = process.env.APP_ID
const privateKey = fs.readFileSync(process.env.PRIVATE_KEY_PATH, 'utf8')
const secret = process.env.WEBHOOK_SECRET
const repoOwner = process.env.REPO_OWNER
const repoName = process.env.REPO_NAME
const baseBranch = process.env.BASE_BRANCH
const sourceBranch = process.env.SOURCE_BRANCH

// Create the GitHub App instance
const app = new App({
  appId,
  privateKey,
  webhooks: {
    secret
  }
})

app.webhooks.on('push', async ({ octokit, payload }) => {
  console.log(`Received push event from ${payload.repository.full_name}`)

  // Get repository details
  const { owner:repoOwner } = payload.repository
  const branch = payload.ref.replace('refs/heads/', '')

  // Only process events from the source branch
  if (branch !== sourceBranch) {
    console.log(`Push was to ${branch}, not to ${sourceBranch}. Skipping.`)
    return
  }

  // Check if the push contains any changes to the README.md
  const modifiedFiles = payload.commits
    .flatMap((commit) => commit.modified || [])
    .filter((file) => file === 'README.md')

  if (modifiedFiles.length > 0) {
    console.log('README.md modified. Processing...')

    try {
      // Check for existing PRs to avoid duplicates
      const existingPRs = await octokit.rest.pulls.list({
        owner: repoOwner,
        repo: repoName,
        head: `${repoOwner}:${sourceBranch}`,
        base: baseBranch,
        state: 'open'
      })

      if (existingPRs.data.length > 0) {
        console.log('A pull request already exists. Skipping PR creation.')
        return
      }

      // Get the current README.md file
      const { data: readme } = await octokit.rest.repos.getContent({
        owner: repoOwner,
        repo: repoName,
        path: 'README.md',
        ref: sourceBranch
      })

      // Decode the existing content
      const existingContent = Buffer.from(readme.content, 'base64').toString('utf8')

      // Prepare new content - appending to existing content rather than replacing
      const newContent = `${existingContent}\n\nThis repository has been updated after a push event on ${new Date().toISOString()}!`

      // Update the content of the README.md in the source branch
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: repoOwner,
        repo: repoName,
        path: 'README.md',
        message: 'Update README.md after push event [automated]',
        content: Buffer.from(newContent).toString('base64'),
        sha: readme.sha,
        branch: sourceBranch
      })

      console.log('README.md updated. Creating a pull request...')

      // Create a pull request for the new changes
      if (sourceBranch !== baseBranch) {
        const pr = await octokit.rest.pulls.create({
          owner: repoOwner,
          repo: repoName,
          title: 'Update README.md [Automated]',
          head: sourceBranch,
          base: baseBranch,
          body: 'This is an automated PR to update the README.md after a push event.'
        })

        console.log(`Pull request created successfully! PR #${pr.data.number}`)
      } else {
        console.log('Source and base branches are the same. Skipping PR creation.')
      }
    } catch (error) {
      console.error('Error handling push event:', error)
    }
  } else {
    console.log('README.md was not modified in this push. No action needed.')
  }
})

// Set up the server to listen for GitHub webhooks
const port = process.env.PORT || 3000
const path = '/api/webhook'
const middleware = createNodeMiddleware(app.webhooks, { path })

http.createServer(middleware).listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}${path}`)
  console.log(`Monitoring ${repoOwner}/${repoName} for changes to README.md on ${sourceBranch}`)
})
