const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken'); // Decode Apple signedPayload
const fs = require('fs');
const path = require('path');
const { verify } = require('node-apple-receipt-verify');

const router = express.Router();

// Initialize Apple receipt verification settings
verify.config({
    secret: process.env.APPLE_SHARED_SECRET,
    environment: ['sandbox', 'production'],
});

// Middleware to verify Apple signature
const APPLE_PUBLIC_KEY_PATH = path.join(__dirname, 'keys', 'apple_public_key.pem');
const APPLE_PUBLIC_KEY = fs.readFileSync(APPLE_PUBLIC_KEY_PATH, 'utf8');

function verifyAppleSignature(req, res, next) {
    const signatureHeader = req.headers['apple-signature'];
    if (!signatureHeader) {
        return res.status(400).json({ error: 'Missing Apple signature' });
    }

    const payload = JSON.stringify(req.body);
    const verifier = crypto.createVerify('sha256');
    verifier.update(payload);

    const isValid = verifier.verify(APPLE_PUBLIC_KEY, signatureHeader, 'base64');
    if (!isValid) {
        return res.status(403).json({ error: 'Invalid signature' });
    }

    next();
}

// Handlers for specific Apple notification events
function handleInitialPurchase(decodedPayload) {
    console.log('Handling initial purchase:', decodedPayload);
    // Logic to process an initial purchase
}

function handleDidRenew(decodedPayload) {
    console.log('Handling subscription renewal:', decodedPayload);
    // Logic to process a renewal
}

function handleVoluntaryExpire(decodedPayload) {
    console.log('Handling voluntary expiration:', decodedPayload);
    // Logic to process an expiration
}

// Webhook route
router.post('/webhook/apple-payment', verifyAppleSignature, async (req, res) => {
    try {
        const { signedPayload } = req.body;

        if (!signedPayload) {
            return res.status(400).json({ error: 'Missing signedPayload in request' });
        }

        // Decode the signedPayload
        const decodedPayload = jwt.decode(signedPayload);

        if (!decodedPayload) {
            return res.status(400).json({ error: 'Failed to decode signedPayload' });
        }

        // Extract notification type and subtype
        const { notificationType, subtype } = decodedPayload;

        // Process the notification based on type and subtype
        switch (notificationType) {
            case 'SUBSCRIBED':
                if (subtype === 'INITIAL_BUY') {
                    handleInitialPurchase(decodedPayload);
                }
                break;

            case 'DID_RENEW':
                handleDidRenew(decodedPayload);
                break;

            case 'EXPIRED':
                if (subtype === 'VOLUNTARY') {
                    handleVoluntaryExpire(decodedPayload);
                }
                break;

            default:
                console.warn('Unknown notification type:', notificationType);
        }

        res.status(200).send('Notification received and processed successfully');
    } catch (error) {
        console.error('Error processing notification:', error);
        res.status(500).send('Error processing notification');
    }
});

module.exports = router;
