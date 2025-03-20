import dotenv from 'dotenv'
import fs from 'fs'
import { App } from 'octokit'
import { createNodeMiddleware } from '@octokit/webhooks'
import http from 'http'

// Load environment variables from .env file
dotenv.config()

// Validate environment variables
const appId = process.env.APP_ID
const privateKeyPath = process.env.PRIVATE_KEY_PATH
const secret = process.env.WEBHOOK_SECRET
const repoOwner = process.env.REPO_OWNER
const repoName = process.env.REPO_NAME
const baseBranch = process.env.BASE_BRANCH
const sourceBranch = process.env.SOURCE_BRANCH
const port = process.env.PORT || 3000
const privateKey = fs.readFileSync(privateKeyPath, 'utf8')

// Create the GitHub App instance
const app = new App({
  appId,
  privateKey,
  webhooks: { secret }
})

// Generic function to handle rate limiting
async function withRateLimitHandling(apiCall, maxRetries = 3) {
  let attempt = 0
  while (attempt < maxRetries) {
    try {
      return await apiCall()
    } catch (error) {
      if (error.status === 403 && error.response?.headers['x-ratelimit-remaining'] === '0') {
        const resetTime = error.response.headers['x-ratelimit-reset']
        const waitTime = resetTime - Math.floor(Date.now() / 1000) + 1
        console.warn(`Rate limit exceeded. Retrying in ${waitTime} seconds...`)
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000))
      } else {
        throw error
      }
    }
    attempt++
  }
  throw new Error('Exceeded max retries due to rate limits')
}

app.webhooks.on('push', async ({ octokit, payload }) => {
  // Log the entire payload to inspect the structure
  console.log('Received push event payload:', JSON.stringify(payload, null, 2)) 

  if (!payload.commits || payload.commits.length === 0) {
    console.log('No commits found in the push event payload');
    return;
  }

  const commitInfo = payload.commits.map(commit => {
    console.log(`Processing commit: ${commit.id}`);  // Log each commit's ID while processing
    return `Commit: ${commit.id}\nMessage: ${commit.message}\nAuthor: ${commit.author.name}`;
  }).join('\n\n');
  
  console.log('Formatted Commit Info:\n', commitInfo);  // Log the final formatted commit info

  // Extract branch name
  const branch = payload.ref.replace('refs/heads/', '')
  console.log(`Push event to branch: ${branch}`);
  
  if (branch !== sourceBranch) {
    console.log(`Push was to ${branch}, not ${sourceBranch}. Skipping.`);
    return
  }

  // Check if README.md was modified
  const readmeModified = payload.commits.some(commit => (commit.modified || []).includes('README.md'))
  if (!readmeModified) {
    console.log('README.md was not modified in this push. No action needed.');
    return
  }

  console.log('README.md modified. Processing...')

  try {
    // Check for existing PRs
    const existingPRs = await withRateLimitHandling(() =>
      octokit.rest.pulls.list({
        owner: repoOwner,
        repo: repoName,
        head: `${repoOwner}:${sourceBranch}`,
        base: baseBranch,
        state: 'open'
      })
    )

    if (existingPRs.data.length > 0) {
      console.log('A pull request already exists. Skipping PR creation.');
      return
    }

    // Get the latest commit SHA for README.md
    const readme = await withRateLimitHandling(() =>
      octokit.rest.repos.getContent({
        owner: repoOwner,
        repo: repoName,
        path: 'README.md',
        ref: sourceBranch
      })
    )

    const existingContent = Buffer.from(readme.data.content, 'base64').toString('utf8')
    const newContent = `${existingContent}\n\n### Update Info:\n${commitInfo}\n\nThis repository has been updated after a push event on ${new Date().toISOString()}!`

    // Attempt to update README.md with retry logic for conflicts
    const maxRetries = 2
    let attempt = 0
    while (attempt < maxRetries) {
      try {
        await withRateLimitHandling(() =>
          octokit.rest.repos.createOrUpdateFileContents({
            owner: repoOwner,
            repo: repoName,
            path: 'README.md',
            message: `Automated Update: README.md modified on ${new Date().toISOString()}`,
            content: Buffer.from(newContent).toString('base64'),
            sha: readme.data.sha,
            branch: sourceBranch
          })
        )
        console.log('README.md updated successfully.');
        break
      } catch (error) {
        if (error.status === 409) { // Conflict error due to outdated SHA
          console.warn(`Conflict detected, retrying... (Attempt ${attempt + 1})`)
          const updatedReadme = await withRateLimitHandling(() =>
            octokit.rest.repos.getContent({
              owner: repoOwner,
              repo: repoName,
              path: 'README.md',
              ref: sourceBranch
            })
          )
          readme.data.sha = updatedReadme.data.sha
        } else {
          console.error('Error updating README.md:', error)
          throw error
        }
      }
      attempt++
    }

    // Create a pull request
    if (sourceBranch !== baseBranch) {
      const pr = await withRateLimitHandling(() =>
        octokit.rest.pulls.create({
          owner: repoOwner,
          repo: repoName,
          title: `Update README.md [Automated] - ${new Date().toISOString()}`,
          head: sourceBranch,
          base: baseBranch,
          body: `This is an automated PR to update the README.md after a push event.\n\n### Commit Details:\n${commitInfo}`
        })
      )
      console.log(`Pull request created successfully! PR #${pr.data.number}`)
    } else {
      console.log('Source and base branches are the same. Skipping PR creation.')
    }
  } catch (error) {
    console.error('Error handling push event:', error)
  }
})

// Set up the webhook server
const middleware = createNodeMiddleware(app.webhooks, { path: '/api/webhook' })
const server = http.createServer(middleware)

server.listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}/api/webhook`)
})

server.on('error', (err) => {
  console.error('Server error:', err)
})
