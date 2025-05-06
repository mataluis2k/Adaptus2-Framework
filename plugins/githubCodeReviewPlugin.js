module.exports = {
    name: 'githubWebhookPlugin',
    version: '1.0.0',

    initialize(dependencies) {
        const { context, customRequire } = dependencies;
        const UniversalApiClient = customRequire('../src/modules/universalAPIClient');
        const { App } = customRequire('octokit');
        const fs = customRequire('fs');

        // Load configuration dynamically
        const appId = process.env.APP_ID || context.config.APP_ID;
        const webhookSecret = process.env.WEBHOOK_SECRET || context.config.WEBHOOK_SECRET;
        const privateKeyPath = process.env.PRIVATE_KEY_PATH || context.config.PRIVATE_KEY_PATH;

        if (!appId || !webhookSecret || !privateKeyPath) {
            throw new Error('Missing required configuration for GitHub App. Ensure APP_ID, WEBHOOK_SECRET, and PRIVATE_KEY_PATH are set.');
        }

        const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
        
        const app = new App({
            appId: appId,
            privateKey: privateKey,
            webhooks: { secret: webhookSecret },
        });

        const messageForNewPRs = "Thanks for opening a new PR! Please follow our contributing guidelines to make your PR easier to review.";

        async function handlePullRequestOpened({ octokit, payload }) {
            console.log(`Received a pull request event for #${payload.pull_request.number}`);

            try {
                await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
                    owner: payload.repository.owner.login,
                    repo: payload.repository.name,
                    issue_number: payload.pull_request.number,
                    body: messageForNewPRs,
                    headers: {
                        "x-github-api-version": "2022-11-28",
                    },
                });
            } catch (error) {
                console.error(`Error commenting on PR:`, error.message);
            }
        }

        app.webhooks.on("pull_request.opened", handlePullRequestOpened);

        app.webhooks.onError((error) => {
            console.error(`Webhook processing error:`, error);
        });

        if (!context.actions.githubWebhookHandler) {
            context.actions.githubWebhookHandler = async (ctx, params) => {
                try {
                    await app.webhooks.receive(params);
                    return { success: true };
                } catch (error) {
                    console.error("Error handling webhook:", error);
                    throw new Error("Failed to process GitHub webhook event.");
                }
            };
        }

        console.log("GitHub webhook plugin initialized.");
    },
};
