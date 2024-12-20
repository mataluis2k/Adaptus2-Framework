const express = require('express');
const { google } = require('googleapis');

const router = express.Router();

// Google Play API setup
const playDeveloperApi = google.androidpublisher('v3');
const serviceAccountKeyPath = './keys/google-service-account-key.json'; // Adjust the path as needed
const SCOPES = ['https://www.googleapis.com/auth/androidpublisher'];

// Middleware to authenticate with Google API
async function authenticateGoogleAPI() {
    const auth = new google.auth.GoogleAuth({
        keyFile: serviceAccountKeyPath,
        scopes: SCOPES,
    });
    return await auth.getClient();
}

// Handlers for specific Google payment events
async function handlePurchaseValidation(packageName, productId, purchaseToken) {
    const authClient = await authenticateGoogleAPI();

    google.options({ auth: authClient });

    try {
        const response = await playDeveloperApi.purchases.products.get({
            packageName,
            productId,
            token: purchaseToken,
        });

        if (response.data.purchaseState === 0) {
            // 0 = Purchased successfully
            console.log('Purchase validated:', response.data);
            return { valid: true, data: response.data };
        }

        console.warn('Purchase not valid or pending:', response.data);
        return { valid: false, data: response.data };
    } catch (error) {
        console.error('Error validating purchase:', error.message);
        return { valid: false, error: error.message };
    }
}

// Main webhook route
router.post('/webhook/google-payment', async (req, res) => {
    try {
        const { packageName, productId, purchaseToken, userId, notificationType } = req.body;

        if (!packageName || !productId || !purchaseToken || !userId || !notificationType) {
            return res.status(400).json({ error: 'Missing required fields in the payload' });
        }

        console.log('Received Google payment notification:', req.body);

        // Validate the purchase
        const validation = await handlePurchaseValidation(packageName, productId, purchaseToken);

        if (!validation.valid) {
            console.error('Purchase validation failed:', validation.error || validation.data);
            return res.status(403).json({ error: 'Purchase validation failed' });
        }

        // Process purchase based on notificationType
        switch (notificationType) {
            case 'PURCHASE':
                console.log('Processing purchase for user:', userId);
                // Example: Update the database, enable digital entitlement
                break;

            case 'CANCEL':
                console.log('Processing cancellation for user:', userId);
                // Example: Disable digital entitlement
                break;

            default:
                console.warn('Unknown notification type:', notificationType);
        }

        return res.status(200).send('Notification received and processed successfully');
    } catch (error) {
        console.error('Error processing Google payment notification:', error.message);
        res.status(500).send('Error processing notification');
    }
});

module.exports = router;
