const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const winston = require('winston');
const Ajv = require('ajv');
const swaggerJsdoc = require('swagger-jsdoc');
const yaml = require('js-yaml');

class DevTools {
    constructor() {
        // Initialize logger for development
        this.logger = winston.createLogger({
            level: 'debug',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message }) => {
                    return `[${timestamp}] ${level}: ${message}`;
                })
            ),
            transports: [
                new winston.transports.Console(),
                new winston.transports.File({ 
                    filename: 'dev.log',
                    maxsize: 5242880, // 5MB
                    maxFiles: 5
                })
            ]
        });

        // Initialize JSON Schema validator
        this.ajv = new Ajv({ allErrors: true });

        // Swagger configuration
        this.swaggerOptions = {
            definition: {
                openapi: '3.0.0',
                info: {
                    title: 'API Documentation',
                    version: '1.0.0',
                    description: 'Automatically generated API documentation'
                },
                servers: [{
                    url: process.env.API_URL || 'http://localhost:3000',
                    description: 'Development server'
                }]
            },
            apis: ['./src/routes/*.js', './src/modules/*.js']
        };
    }

    // Generate API documentation
    async generateDocs() {
        try {
            const specs = swaggerJsdoc(this.swaggerOptions);
            await fs.writeFile(
                path.join(process.cwd(), 'docs', 'api-docs.yaml'),
                yaml.dump(specs)
            );
            return specs;
        } catch (error) {
            this.logger.error('Error generating API documentation:', error);
            throw error;
        }
    }

    // Test endpoint with various scenarios
    async testEndpoint(method, url, options = {}) {
        const {
            payload,
            headers = {},
            expectedStatus = 200,
            expectedSchema,
            auth
        } = options;

        try {
            const startTime = Date.now();
            const response = await axios({
                method,
                url,
                data: payload,
                headers: {
                    ...headers,
                    Authorization: auth ? `Bearer ${auth}` : undefined
                },
                validateStatus: null
            });
            const duration = Date.now() - startTime;

            const result = {
                success: response.status === expectedStatus,
                duration,
                status: response.status,
                headers: response.headers,
                data: response.data
            };

            if (expectedSchema) {
                const validate = this.ajv.compile(expectedSchema);
                result.schemaValid = validate(response.data);
                result.schemaErrors = validate.errors;
            }

            this.logger.debug(`Endpoint test result for ${method} ${url}:`, result);
            return result;
        } catch (error) {
            this.logger.error(`Endpoint test failed for ${method} ${url}:`, error);
            throw error;
        }
    }

    // Validate configuration files
    async validateConfig(configPath, schema) {
        try {
            const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
            const validate = this.ajv.compile(schema);
            const valid = validate(config);

            return {
                valid,
                errors: validate.errors,
                config
            };
        } catch (error) {
            this.logger.error(`Config validation failed for ${configPath}:`, error);
            throw error;
        }
    }

    // Monitor development mode metrics
    async getDevMetrics() {
        const metrics = {
            timestamp: new Date().toISOString(),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage(),
            uptime: process.uptime(),
            env: process.env.NODE_ENV,
            versions: process.versions
        };

        this.logger.debug('Development metrics:', metrics);
        return metrics;
    }

    // Generate test data for development
    generateTestData(schema, count = 1) {
        try {
            const results = [];
            for (let i = 0; i < count; i++) {
                const data = this._generateDataFromSchema(schema);
                results.push(data);
            }
            return results;
        } catch (error) {
            this.logger.error('Error generating test data:', error);
            throw error;
        }
    }

    // Helper method to generate data from schema
    _generateDataFromSchema(schema) {
        const data = {};
        for (const [key, value] of Object.entries(schema.properties)) {
            switch (value.type) {
                case 'string':
                    data[key] = this._generateString(value);
                    break;
                case 'number':
                    data[key] = this._generateNumber(value);
                    break;
                case 'boolean':
                    data[key] = Math.random() > 0.5;
                    break;
                case 'array':
                    data[key] = this._generateArray(value);
                    break;
                case 'object':
                    data[key] = this._generateDataFromSchema(value);
                    break;
            }
        }
        return data;
    }

    // Helper methods for generating different types of test data
    _generateString(schema) {
        if (schema.enum) {
            return schema.enum[Math.floor(Math.random() * schema.enum.length)];
        }
        if (schema.format === 'email') {
            return `test${Math.random().toString(36).substring(7)}@example.com`;
        }
        if (schema.format === 'date-time') {
            return new Date().toISOString();
        }
        return `test_${Math.random().toString(36).substring(7)}`;
    }

    _generateNumber(schema) {
        const min = schema.minimum || 0;
        const max = schema.maximum || 1000;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    _generateArray(schema) {
        const minItems = schema.minItems || 1;
        const maxItems = schema.maxItems || 5;
        const itemCount = Math.floor(Math.random() * (maxItems - minItems + 1)) + minItems;
        const items = [];
        for (let i = 0; i < itemCount; i++) {
            items.push(this._generateDataFromSchema({ properties: { item: schema.items } }).item);
        }
        return items;
    }

    // Development environment checks
    async checkDevEnvironment() {
        const checks = {
            nodeVersion: process.version,
            environment: process.env.NODE_ENV,
            debugMode: process.env.DEBUG,
            requiredDependencies: await this._checkDependencies(),
            configFiles: await this._checkConfigFiles(),
            permissions: await this._checkPermissions(),
            ports: await this._checkPorts()
        };

        this.logger.debug('Development environment check results:', checks);
        return checks;
    }

    // Helper methods for environment checks
    async _checkDependencies() {
        try {
            const packageJson = JSON.parse(
                await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8')
            );
            return {
                valid: true,
                dependencies: packageJson.dependencies,
                devDependencies: packageJson.devDependencies
            };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }

    async _checkConfigFiles() {
        const configFiles = ['.env', 'package.json', 'tsconfig.json'];
        const results = {};
        for (const file of configFiles) {
            try {
                await fs.access(path.join(process.cwd(), file));
                results[file] = true;
            } catch {
                results[file] = false;
            }
        }
        return results;
    }

    async _checkPermissions() {
        const dirsToCheck = ['logs', 'docs', 'config'];
        const results = {};
        for (const dir of dirsToCheck) {
            try {
                await fs.access(path.join(process.cwd(), dir), fs.constants.W_OK);
                results[dir] = true;
            } catch {
                results[dir] = false;
            }
        }
        return results;
    }

    async _checkPorts() {
        const portsToCheck = [3000, 6379, 27017]; // Add your required ports
        const results = {};
        for (const port of portsToCheck) {
            try {
                const response = await axios.get(`http://localhost:${port}`).catch(() => null);
                results[port] = !!response;
            } catch {
                results[port] = false;
            }
        }
        return results;
    }
}

module.exports = DevTools;
