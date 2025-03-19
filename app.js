import dotenv from 'dotenv';
import fs from 'fs';
import { App } from 'octokit';
import { createNodeMiddleware } from '@octokit/webhooks';
import http from 'http';

// Load environment variables
dotenv.config();

// Set up GitHub App details
const appId = process.env.APP_ID;
const privateKey = fs.readFileSync(process.env.PRIVATE_KEY_PATH, 'utf8');
const secret = process.env.WEBHOOK_SECRET;

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
  const { owner, name: repo } = payload.repository;
  const branch = payload.ref.replace('refs/heads/', '');

  // Check if the push contains any changes to the README.md
  const modifiedFiles = payload.commits
    .flatMap((commit) => commit.modified)
    .filter((file) => file === 'README.md');

  if (modifiedFiles.length > 0) {
    console.log('README.md modified. Updating the file...');

    // Modify README.md (you can add any content here)
    const newContent = 'This repository has been updated after a push event!';
    
    // Create a new branch for the changes
    const newBranchName = `update-readme-${Date.now()}`;
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${newBranchName}`,
      sha: payload.after, // The commit sha to create the new branch from
    });

    // Get the current README.md file
    const { data: readme } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: 'README.md',
    });

    // Update the content of the README.md
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: 'README.md',
      message: 'Update README.md',
      content: Buffer.from(newContent).toString('base64'),
      sha: readme.sha,
      branch: newBranchName,
    });

    console.log('README.md updated. Creating a pull request...');

    // Create a pull request for the new changes
    await octokit.rest.pulls.create({
      owner,
      repo,
      title: 'Update README.md',
      head: newBranchName,
      base: branch,
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
