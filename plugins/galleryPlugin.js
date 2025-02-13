const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const AWS = require('aws-sdk');

module.exports = {
    name: 'galleryPlugin',
    version: '1.0.0',

    /**
     * Initialize the plugin and register actions in the global context.
     * @param {Object} dependencies - Dependencies provided by the server.
     */
    initialize(dependencies) {
        const { context } = dependencies;

        if (!context || !context.actions) {
            throw new Error('Global context with actions is required for galleryPlugin.');
        }

        /**
         * Resizes an image (if needed) and uploads it to S3.
         * @param {Object} ctx - Context object containing configuration.
         * @param {Object} params - Parameters for the operation.
         * @param {string} params.imagePath - Path to the local image file.
         * @param {string} params.s3Bucket - Target S3 bucket name.
         * @param {string} [params.s3Key] - Optional key name for the uploaded image.
         */
        async function resizeAndUpload(ctx, params) {
            if (!params || typeof params !== 'object') {
                throw new Error('Invalid parameters. Ensure params is a valid object.');
            }

            const { imagePath, s3Bucket, s3Key } = params;

            if (!imagePath || !s3Bucket) {
                throw new Error('Missing required parameters: imagePath and s3Bucket.');
            }

            const s3AccessKey = ctx.config.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
            const s3SecretKey = ctx.config.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
            const s3Region = ctx.config.AWS_REGION || process.env.AWS_REGION || 'us-east-1';

            if (!s3AccessKey || !s3SecretKey) {
                throw new Error('AWS credentials are missing. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.');
            }

            const s3 = new AWS.S3({
                accessKeyId: s3AccessKey,
                secretAccessKey: s3SecretKey,
                region: s3Region,
            });

            try {
                // Read the image file
                const imageBuffer = fs.readFileSync(imagePath);
                const image = sharp(imageBuffer);

                // Get metadata
                const metadata = await image.metadata();

                let finalBuffer = imageBuffer;

                // Check if resizing is needed
                if (metadata.height > 1920) {
                    console.log(`Resizing image ${imagePath} (Original height: ${metadata.height}px)...`);
                    finalBuffer = await image.resize({ height: 1920 }).toBuffer();
                } else {
                    console.log(`Skipping resize. Image height (${metadata.height}px) is within limit.`);
                }

                // Determine S3 key (file name)
                const fileName = s3Key || path.basename(imagePath);

                // Upload to S3
                const uploadParams = {
                    Bucket: s3Bucket,
                    Key: fileName,
                    Body: finalBuffer,
                    ContentType: metadata.format,
                };

                await s3.upload(uploadParams).promise();

                console.log(`Image successfully uploaded to S3: s3://${s3Bucket}/${fileName}`);

                return {
                    success: true,
                    message: `Image uploaded to s3://${s3Bucket}/${fileName}`,
                    url: `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${fileName}`,
                };
            } catch (error) {
                console.error(`Error in resizeAndUpload:`, error.message);
                throw new Error(`Failed to process image: ${error.message}`);
            }
        }

        // Register the function to the global context
        if (!context.actions.resizeAndUpload) {
            context.actions.resizeAndUpload = resizeAndUpload;
        }

        console.log('galleryPlugin action registered in global context.');
    },
};