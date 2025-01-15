const Handlebars = require('handlebars');

module.exports = {
    name: 'mergeTemplatePlugin',
    version: '1.0.0',

    /**
     * Initialize the plugin and register the mergeTemplate action in the global context.
     * @param {Object} dependencies - Dependencies provided by the server.
     */
    initialize(dependencies) {
        const { context } = dependencies;

        if (!context || !context.actions) {
            throw new Error('Global context with actions is required for mergeTemplatePlugin.');
        }

        /**
         * Merge a Handlebars template with the provided data.
         * @param {Object} ctx - Context object containing configuration (not used here).
         * @param {Object} params - Parameters for the operation.
         * @param {Object} params.data - The object containing data to merge.
         * @param {string} params.template - The Handlebars template string.
         * @returns {string} - The merged template output.
         */
        async function mergeTemplate(ctx, params) {
            const { data, template } = params;

            // Validate parameters
            if (!template || typeof template !== 'string') {
                throw new Error('Invalid template. Ensure template is a valid string.');
            }
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid data. Ensure data is a valid object.');
            }

            try {
                // Compile the Handlebars template and merge with data
                const compiledTemplate = Handlebars.compile(template);
                const result = compiledTemplate(data);

                console.log('Template merged successfully:', result);
                return result;
            } catch (error) {
                console.error('Error merging template:', error.message);
                throw new Error(`Failed to merge template: ${error.message}`);
            }
        }

        // Register the function to the global context
        if (!context.actions.mergeTemplate) {
            context.actions.mergeTemplate = mergeTemplate;
        }

        console.log('mergeTemplate action registered in global context.');
    },
};
