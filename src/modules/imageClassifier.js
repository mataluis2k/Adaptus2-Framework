const fs = require('fs');
const path = require('path');
const OllamaModule = require('./ollamaModule'); // Adjust path accordingly

class ImageClassificationModule {
    constructor(globalContext) {
        this.globalContext = globalContext;
        this.registerActions();
    }

    registerActions() {
        this.globalContext.actions.classify_image = this.classifyImage.bind(this);
    }

    /**
     * Classifies a single image using OllamaModule.
     * @param {Object} ctx - Context object containing configuration.
     * @param {Object} params - Parameters including 'filePath'.
     * @returns {Promise<Object>} - Image description.
     */
    async classifyImage(ctx, params) {
        const { filePath } = params;
        if (!filePath) {
            throw new Error("filePath parameter is required.");
        }

        try {
            const imageData = fs.readFileSync(filePath, { encoding: 'base64' });
            const response = await OllamaModule.generateResponse("What is the image?", [{ role: 'system', content: imageData }]);
            return { file: filePath, description: response };
        } catch (error) {
            console.error(`Error processing ${filePath}:`, error.message);
            return { file: filePath, error: error.message };
        }
    }
}

module.exports = ImageClassificationModule;