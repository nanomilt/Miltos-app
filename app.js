import dotenv from 'dotenv';
import fs from 'node:fs';
import { App } from 'octokit';
import { createNodeMiddleware } from '@octokit/webhooks';
import http from 'node:http';

// Load environment variables from .env file
dotenv.config();

// Validate environment variables
const appId = process.env.APP_ID;
const privateKeyPath = process.env.PRIVATE_KEY_PATH;
const secret = process.env.WEBHOOK_SECRET;
const repoOwner = process.env.REPO_OWNER;
const repoName = process.env.REPO_NAME;
const baseBranch = process.env.BASE_BRANCH;
const sourceBranch = process.env.SOURCE_BRANCH;
const port = process.env.PORT || 3000;
const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

// Create the GitHub App instance
const app = new App({
	appId,
	privateKey,
	webhooks: { secret }
});

// Generic function to handle rate limiting
async function withRateLimitHandling(apiCall, maxRetries = 3) {
	let attempt = 0;
	while (attempt < maxRetries) {
		try {
			return await apiCall();
		} catch (error) {
			if (error.status === 403 && error.response?.headers['x-ratelimit-remaining'] === '0') {
				const resetTime = error.response.headers['x-ratelimit-reset'];
				const waitTime = resetTime - Math.floor(Date.now() / 1000) + 1;
				console.warn(`Rate limit exceeded. Retrying in ${waitTime} seconds...`);
				await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
			} else {
				throw error;
			}
		}
		attempt++;
	}
	throw new Error('Exceeded max retries due to rate limits');
}

app.webhooks.on('push', async ({ octokit, payload }) => {
	console.log('Received push event');

	const commitInfo = payload.commits.map(commit => {
		console.log(`Processing commit: ${commit.id}`); // Log each commit's ID while processing
		return `Commit: ${commit.id}\nMessage: ${commit.message}\nAuthor: ${commit.author.name}`;
	}).join('\n\n');

	// Extract branch name
	const branch = payload.ref.replace('refs/heads/', '');
	console.log(`Push event to branch: ${branch}`);

	if (branch !== sourceBranch) {
		console.log(`Push was to ${branch}, not ${sourceBranch}. Skipping.`);
		return;
	}

	// Collect all modified files
	const modifiedFiles = payload.commits.flatMap(commit => commit.modified || []);
  
	if (modifiedFiles.length === 0) {
		console.log('No modified files detected. Skipping.');
		return;
	}

	console.log(`Modified files detected: ${modifiedFiles.join(', ')}`);

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
		);

		if (existingPRs.data.length > 0) {
			console.log('A pull request already exists. Skipping PR creation.');
			return;
		}

		// Create a pull request
		if (sourceBranch === baseBranch) {
			console.log('Source and base branches are the same. Skipping PR creation.');
		} else {
			const pr = await withRateLimitHandling(() =>
				octokit.rest.pulls.create({
					owner: repoOwner,
					repo: repoName,
					title: `Automated Update - ${new Date()}`,
					head: sourceBranch,
					base: baseBranch,
					body: `This is an automated PR after a push event.\n\n### Modified Files:\n${modifiedFiles.join('\n')}\n\n### Commit Details:\n${commitInfo}`
				})
			);
			console.log(`Pull request created successfully! PR #${pr.data.number}`);
		}
	} catch (error) {
		console.error('Error handling push event:', error);
	}
});

// Set up the webhook server
const middleware = createNodeMiddleware(app.webhooks, { path: '/api/webhook' });
const server = http.createServer(middleware);

server.listen(port, () => {
	console.log(`Server is listening at http://localhost:${port}/api/webhook`);
});

server.on('error', (err) => {
	console.error('Server error:', err);
});
