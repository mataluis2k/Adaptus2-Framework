const axios = require('axios');

class UniversalApiClient {
    constructor({ baseUrl, headers = {}, authType, authValue, authHeader = 'Authorization' }) {
        if (!baseUrl) {
            throw new Error('Base URL is required for the API client.');
        }

        this.defaultHeaders = { ...headers }; // Store default headers

        if (authType === 'token') {
            this.defaultHeaders[authHeader] = `Bearer ${authValue}`;
        } else if (authType === 'apiKey') {
            this.defaultHeaders[authHeader] = authValue;
        }

        this.axiosInstance = axios.create({
            baseURL: baseUrl,
        });
    }

    /**
     * Merge default headers with custom headers.
     * @param {Object} customHeaders - Headers to merge with defaults.
     * @returns {Object} - Merged headers.
     */
    mergeHeaders(customHeaders) {
        return { ...this.defaultHeaders, ...customHeaders };
    }

    async get(endpoint, params = {}, headers = {}) {
        try {
            const response = await this.axiosInstance.get(endpoint, {
                params,
                headers: this.mergeHeaders(headers),
            });
            return response.data;
        } catch (error) {
            this.handleError(error);
        }
    }

    async post(endpoint, data, headers = {}) {
        try {
            const response = await this.axiosInstance.post(endpoint, data, {
                headers: this.mergeHeaders(headers),
            });
            return response.data;
        } catch (error) {
            this.handleError(error);
        }
    }

    async put(endpoint, data, headers = {}) {
        try {
            const response = await this.axiosInstance.put(endpoint, data, {
                headers: this.mergeHeaders(headers),
            });
            return response.data;
        } catch (error) {
            this.handleError(error);
        }
    }

    async delete(endpoint, headers = {}) {
        try {
            const response = await this.axiosInstance.delete(endpoint, {
                headers: this.mergeHeaders(headers),
            });
            return response.data;
        } catch (error) {
            this.handleError(error);
        }
    }

    handleError(error) {
        if (error.response) {
            console.error('API Error:', error.response.status, error.response.data);
        } else if (error.request) {
            console.error('API Error: No response received', error.request);
        } else {
            console.error('API Error:', error.message);
        }
        throw error;
    }
}
module.exports = UniversalApiClient