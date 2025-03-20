import dotenv from 'dotenv'
import fs from 'fs'
import { App } from 'octokit'
import { createNodeMiddleware } from '@octokit/webhooks'
import http from 'http'

// Load environment variables from .env file
dotenv.config()

const appId = process.env.APP_ID
const privateKeyPath = process.env.PRIVATE_KEY_PATH
const secret = process.env.WEBHOOK_SECRET
const repoOwner = process.env.REPO_OWNER
const repoName = process.env.REPO_NAME
const baseBranch = process.env.BASE_BRANCH
const sourceBranch = process.env.SOURCE_BRANCH
const port = process.env.PORT || 3000
const privateKey = fs.readFileSync(privateKeyPath, 'utf8')

// Create GitHub App instance
const app = new App({
  appId,
  privateKey,
  webhooks: {
    secret
  }
})

app.webhooks.on('push', async ({ octokit, payload }) => {
  console.log(`Received push event from ${payload.repository.full_name}`)

  const branch = payload.ref.replace('refs/heads/', '')

  if (branch !== sourceBranch) {
    console.log(`Push was to ${branch}, not ${sourceBranch}. Skipping.`)
    return
  }

  // Check if README.md was modified, added, or removed
  const readmeModified = payload.commits.some(commit => {
    const changedFiles = [...(commit.modified || []), ...(commit.added || []), ...(commit.removed || [])]
    return changedFiles.includes('README.md')
  })

  if (!readmeModified) {
    console.log('README.md was not modified in this push. No action needed.')
    return
  }

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

    // Get the latest README.md content
    const { data: readme } = await octokit.rest.repos.getContent({
      owner: repoOwner,
      repo: repoName,
      path: 'README.md',
      ref: sourceBranch
    })

    const existingContent = Buffer.from(readme.content, 'base64').toString('utf8')
    const newContent = `${existingContent}\n\nThis repository has been updated after a push event on ${new Date().toISOString()}!`

    // Update README.md with retry logic
    const maxRetries = 2
    let attempt = 0

    while (attempt < maxRetries) {
      try {
        await octokit.rest.repos.createOrUpdateFileContents({
          owner: repoOwner,
          repo: repoName,
          path: 'README.md',
          message: 'Update README.md after push event [automated]',
          content: Buffer.from(newContent).toString('base64'),
          sha: readme.sha,
          branch: sourceBranch
        })
        console.log('README.md updated successfully.')
        break
      } catch (error) {
        if (error.status === 409) {
          console.warn(`Conflict detected, retrying... (Attempt ${attempt + 1})`)
          const { data: updatedReadme } = await octokit.rest.repos.getContent({
            owner: repoOwner,
            repo: repoName,
            path: 'README.md',
            ref: sourceBranch
          })
          readme.sha = updatedReadme.sha
        } else {
          console.error('Error updating README.md:', error)
          throw error
        }
      }
      attempt++
    }

    // Create PR if necessary
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
})

// Set up webhook server
const middleware = createNodeMiddleware(app.webhooks, { path: '/api/webhook' })
const server = http.createServer(middleware)

server.listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}/api/webhook`)
})

server.on('error', (err) => {
  console.error('Server error:', err)
})
