import dotenv from 'dotenv';
import fs from 'fs';
import { App } from 'octokit';
import { createNodeMiddleware } from '@octokit/webhooks';
import http from 'http';

// Load environment variables from .env file
dotenv.config();

// Set up GitHub App details
const appId = process.env.APP_ID;
const privateKey = fs.readFileSync(process.env.PRIVATE_KEY_PATH, 'utf8');
const secret = process.env.WEBHOOK_SECRET;
const repoOwner = process.env.REPO_OWNER;  // Get repo owner from the env file
const repoName = process.env.REPO_NAME;    // Get repo name from the env file
const baseBranch = process.env.BASE_BRANCH; // Get the base branch (e.g., 'main')
const sourceBranch = process.env.SOURCE_BRANCH; // Get the source branch (e.g., 'otherbranch')

// Create the GitHub App instance
const app = new App({
  appId,
  privateKey,
  webhooks: {
    secret,
  },
});

app.webhooks.on('push', async ({ octokit, payload }) => {
  console.log(`Received push event from ${payload.repository.full_name}`);

  // Get repository details
  const { owner, name} = payload.repository;
  const branch = payload.ref.replace('refs/heads/', '');

  // Check if the push contains any changes to the README.md
  const modifiedFiles = payload.commits
    .flatMap((commit) => commit.modified)
    .filter((file) => file === 'README.md');

  if (modifiedFiles.length > 0) {
    console.log('README.md modified. Updating the file...');

    // Modify README.md (you can add any content here)
    const newContent = 'This repository has been updated after a push event!';
    
    // Get existing pull requests between the source and base branches
    const existingPRs = await octokit.rest.pulls.list({
      owner:repoOwner,
      repo:repoName,
      head: `${owner}:${process.env.SOURCE_BRANCH}`, // The source branch (e.g., 'otherbranch')
      base: process.env.BASE_BRANCH, // The target branch (e.g., 'main')
    });

    if (existingPRs.data.length > 0) {
      console.log('A pull request already exists. Skipping PR creation.');
      return; // Skip the creation of a new PR if one already exists
    }

    // Update README.md directly on the same branch (no new branch needed)
    console.log('Updating README.md directly on the same branch...');
    // Get the current README.md file
    const { data: readme } = await octokit.rest.repos.getContent({
      owner: repoOwner,  // Using the repo owner from .env
      repo: repoName,    // Using the repo name from .env
      path: 'README.md',
    });

    // Update the content of the README.md in the same branch
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: repoOwner,  // Using the repo owner from .env
      repo: repoName,    // Using the repo name from .env
      path: 'README.md',
      message: 'Update README.md after push event',
      content: Buffer.from(newContent).toString('base64'),
      sha: readme.sha,
      branch: branch,    // Use the same branch as the push event
    });

    console.log('README.md updated. Creating a pull request...');

    // Create a pull request for the new changes
    await octokit.rest.pulls.create({
      owner: repoOwner,     // Using the repo owner from .env
      repo: repoName,       // Using the repo name from .env
      title: 'Update README.md',
      head: sourceBranch,   // Using the source branch from .env (e.g., 'otherbranch')
      base: baseBranch,     // The target branch (e.g., 'main')
      body: 'This is an automated PR to update the README.md after a push event.',
    });

    console.log('Pull request created successfully!');
  }
});

// Set up the server to listen for GitHub webhooks
const port = process.env.PORT || 3000;
const path = '/api/webhook';
const middleware = createNodeMiddleware(app.webhooks, { path });

http.createServer(middleware).listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}${path}`);
});
