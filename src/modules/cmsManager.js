const fs = require("fs").promises;
const path = require("path");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const { create, read, update, delete: deleteRecord, query } = require('./db');
const logger = require('./logger');


const express = require('express');
const CMS_TABLE_SCHEMA = require('./cmsDefinition');
const crypto = require('crypto');
const { aarMiddleware } = require('../middleware/aarMiddleware');
const defaultUnauthorized = { httpCode: 403, message: 'Access Denied', code: null };



class CMSManager {
    constructor(globalContext, dbConfig) {
        this.globalContext = globalContext;
        this.dbConfig = dbConfig;
        this.uploadDir = path.join(process.cwd(), 'uploads', 'cms');
        this.registerActions();
        this.initialize().catch(err => {
            logger.error('Failed to initialize CMS:', err);
            throw err;
        });
    }

    async initialize() {
        try {
            logger.info('Initializing CMS Manager...');

            // Create uploads directory if it doesn't exist
            await fs.mkdir(this.uploadDir, { recursive: true });

            // Check if CMS table exists
            const tableExistsQuery = {
                text: 'SELECT 1 FROM information_schema.tables WHERE table_name = ?',
                values: [CMS_TABLE_SCHEMA.dbTable]
            };

            const result = await query(this.dbConfig, tableExistsQuery.text, tableExistsQuery.values);
            
            if (result.length === 0) {
                logger.info('Creating CMS table...');
                await this.createCMSTable();
            }

            logger.info('CMS Manager initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize CMS Manager:', error);
            throw error;
        }
    }

    async createCMSTable() {
        try {
            const { createTable } = require('./db');
            await createTable(
                this.dbConfig,
                CMS_TABLE_SCHEMA.dbTable,
                CMS_TABLE_SCHEMA.columnDefinitions
            );
            logger.info('CMS table and indexes created successfully');
        } catch (error) {
            logger.error('Failed to create CMS table:', error);
            throw error;
        }
    }

    registerActions() {
        this.globalContext.actions.cms_create_content = this.createContent.bind(this);
        this.globalContext.actions.cms_get_content = this.getContent.bind(this);
        this.globalContext.actions.cms_update_content = this.updateContent.bind(this);
        this.globalContext.actions.cms_delete_content = this.deleteContent.bind(this);
        this.globalContext.actions.cms_list_content = this.listContent.bind(this);
        this.globalContext.actions.cms_search_content = this.searchContent.bind(this);
    }

    

    generateFingerprint(user) {
    // Create a shallow clone of the user object
    const userClone = { ...user };
    
    // Remove the properties we want to ignore
    delete userClone.iat;
    delete userClone.exp;
    
    // Create a canonical (sorted) JSON string
    const canonicalString = JSON.stringify(this.sortKeys(userClone));
    
    // Generate a hash (SHA-256)
    return crypto.createHash('sha256').update(canonicalString).digest('hex');
    }

    // Helper function to sort object keys recursively
    sortKeys(obj) {
    if (Array.isArray(obj)) {
        return obj.map(sortKeys);
    } else if (obj !== null && typeof obj === 'object') {
        return Object.keys(obj)
        .sort()
        .reduce((sorted, key) => {
            sorted[key] = sortKeys(obj[key]);
            return sorted;
        }, {});
    }
    return obj;
    }

    async createContent(ctx, params) {
        try {
            console.log(ctx);
            const { contentType, title, slug, content, file, metadata = {}, status = "draft" } = params;

            // Input validation
            if (!title || !contentType || !slug) {
                throw new Error("Missing required fields: title, contentType, or slug");
            }

            if (!['page', 'post', 'image', 'video', 'document'].includes(contentType)) {
                throw new Error("Invalid content type");
            }

            // Validate slug format
            if (!/^[a-z0-9-]+$/.test(slug)) {
                throw new Error("Invalid slug format. Use only lowercase letters, numbers, and hyphens");
            }

            // Check for duplicate slug
            const existingContent = await read(this.dbConfig, CMS_TABLE_SCHEMA.dbTable, { slug });
            if (existingContent && existingContent.length > 0) {
                throw new Error("Content with this slug already exists");
            }

            let filePath = "";
            let processedMetadata = metadata;

            // Handle file upload if present
            if (file && ['image', 'video', 'document'].includes(contentType)) {
                filePath = await this.handleFileUpload(ctx, file, contentType);
                processedMetadata = await this.extractMetadata(filePath, contentType);
            }

            let author_id = 'missing';
            if(ctx.user){
            // Find an unique identifier for the author_id field , either ctx.user.id or ctx.user.email or ctx.user.username or generate fingerprint from ctx.user
                author_id = ctx.user.id || ctx.user.email || ctx.user.username || this.generateFingerprint(ctx.user);
            }

            const contentData = {
                id: uuidv4(),
                content_type: contentType,
                title,
                slug,
                content,
                file_path: filePath,
                metadata: JSON.stringify(processedMetadata),
                status,
                author_id: author_id
            };

            const result = await create(this.dbConfig, CMS_TABLE_SCHEMA.dbTable, contentData);
            logger.info('Content created successfully', { id: contentData.id, type: contentType });

            return { success: true, id: contentData.id };
        } catch (error) {
            logger.error('Error creating content:', error);
            throw error;
        }
    }

    async getContent(ctx, params) {
        try {
            const { id, slug } = params;

            if (!id && !slug) {
                throw new Error("Missing required field: id or slug");
            }

            const query = id ? { id } : { slug };
            const content = await read(this.dbConfig, CMS_TABLE_SCHEMA.dbTable, query);

            if (!content || content.length === 0) {
                throw new Error("Content not found");
            }

            // Parse metadata JSON
            const result = content[0];
            
            if (result.metadata) {
                result.metadata = typeof result.metadata === 'string' ? JSON.parse(result.metadata) : result.metadata;
            }

            return result;
        } catch (error) {
            logger.error('Error retrieving content:', error);
            throw error;
        }
    }

    async fetchContent(ctx, params) {
        try {
          // Single record retrieval
          if (params.id || params.slug) {
            const { id, slug } = params;
            if (!id && !slug) {
              throw new Error("Missing required field: id or slug");
            }
            const queryObj = id ? { id } : { slug };
            const content = await read(this.dbConfig, CMS_TABLE_SCHEMA.dbTable, queryObj);
            if (!content || content.length === 0) {
              throw new Error("Content not found");
            }
            let result = content[0];
            if (result.metadata) {
              result.metadata = typeof result.metadata === 'string' ? JSON.parse(result.metadata) : result.metadata;
            }
            return result;
          }
          
          // Multiple records listing with filters and pagination
          const { filters = {}, page = 1, pageSize = 10 } = params;
          const offset = (page - 1) * pageSize;
          const filterKeys = Object.keys(filters);
          const whereClause = filterKeys.length > 0 
            ? 'WHERE ' + filterKeys.map(key => `${key} = ?`).join(' AND ')
            : '';
          const listQuery = {
            text: `SELECT * FROM ${CMS_TABLE_SCHEMA.dbTable} ${whereClause}
                   ORDER BY created_at DESC
                   LIMIT ${pageSize} OFFSET ${offset}`,
            values: [...Object.values(filters)]
          };
          const results = await query(this.dbConfig, listQuery.text, listQuery.values);
          return results.map(item => ({
            ...item,
            metadata: item.metadata && typeof item.metadata === 'string'
                      ? JSON.parse(item.metadata)
                      : item.metadata
          }));
        } catch (error) {
          logger.error('Error fetching content:', error);
          throw error;
        }
      }
      

    async updateContent(ctx, params) {
        try {
            const { id, ...updates } = params;

            if (!id) {
                throw new Error("Missing required field: id");
            }

            // Check if content exists
            const existing = await read(this.dbConfig, CMS_TABLE_SCHEMA.dbTable, { id });
            if (!existing || existing.length === 0) {
                throw new Error("Content not found");
            }

            // Handle file updates if present
            if (updates.file) {
                const content = existing[0];
                // Delete old file if it exists
                if (content.file_path) {
                    await this.deleteFile(content.file_path);
                }
                updates.file_path = await this.handleFileUpload(ctx, updates.file, content.content_type);
                delete updates.file;
            }

            // Handle metadata updates
            if (updates.metadata) {
                updates.metadata = JSON.stringify(updates.metadata);
            }

            const result = await update(this.dbConfig, CMS_TABLE_SCHEMA.dbTable, { id }, updates);
            logger.info('Content updated successfully', { id });

            return { success: true, id };
        } catch (error) {
            logger.error('Error updating content:', error);
            throw error;
        }
    }

    async deleteContent(ctx, params) {
        try {
            const { id } = params;

            if (!id) {
                throw new Error("Missing required field: id");
            }

            // Get content to check file path
            const content = await read(this.dbConfig, CMS_TABLE_SCHEMA.dbTable, { id });
            if (!content || content.length === 0) {
                throw new Error("Content not found");
            }

            // Delete associated file if it exists
            if (content[0].file_path) {
                await this.deleteFile(content[0].file_path);
            }

            await deleteRecord(this.dbConfig, CMS_TABLE_SCHEMA.dbTable, { id });
            logger.info('Content deleted successfully', { id });

            return { success: true };
        } catch (error) {
            logger.error('Error deleting content:', error);
            throw error;
        }
    }

    async listContent(ctx, params) {
        try {
            const { filters = {}, page = 1, pageSize = 10 } = params;
            const offset = (page - 1) * pageSize;

            // Build query with pagination
            const listQuery = {
                text: `SELECT * FROM ${CMS_TABLE_SCHEMA.dbTable} ${Object.keys(filters).length > 0 ? 'WHERE ' + Object.keys(filters).map(key => `${key} = ?`).join(' AND ') : ''}
                       ORDER BY created_at DESC
                       LIMIT ${pageSize} OFFSET ${offset}`,
                values: [...Object.values(filters)]
            };

            console.log(listQuery);

            const result = await query(this.dbConfig, listQuery.text, listQuery.values);
            console.log(result);

            // Parse metadata for each item
            return result.map(item => ({
                ...item,
                metadata: typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata
            }));
        } catch (error) {
            logger.error('Error listing content:', error);
            throw error;
        }
    }

    async searchContent(ctx, params) {
        try {
            const { searchQuery, contentType } = params;

            if (!searchQuery) {
                throw new Error("Search query is required");
            }

            const searchSql = {
                text: `SELECT * FROM ${CMS_TABLE_SCHEMA.dbTable}
                       WHERE (title LIKE ? OR content LIKE ?)
                       ${contentType ? 'AND content_type = ?' : ''}
                       ORDER BY created_at DESC`,
                values: [`%${searchQuery}%`, `%${searchQuery}%`, ...(contentType ? [contentType] : [])]
            };

            const result = await query(this.dbConfig, searchSql.text, searchSql.values);

            // Parse metadata for each item
            return result.map(item => ({
                ...item,
                metadata: item.metadata ? JSON.parse(item.metadata) : null
            }));
        } catch (error) {
            logger.error('Error searching content:', error);
            throw error;
        }
    }

    async handleFileUpload(ctx, file, contentType) {
        try {
            const uploadDir = path.join(this.uploadDir, contentType);
            const fileName = `${uuidv4()}-${file.originalname}`;
            const filePath = path.join(uploadDir, fileName);

            await fs.mkdir(uploadDir, { recursive: true });
            await fs.writeFile(filePath, file.buffer);

            return filePath;
        } catch (error) {
            logger.error('Error handling file upload:', error);
            throw new Error('Failed to upload file');
        }
    }

    async extractMetadata(filePath, contentType) {
        try {
            if (contentType === 'image') {
                const metadata = await sharp(filePath).metadata();
                return {
                    width: metadata.width,
                    height: metadata.height,
                    format: metadata.format,
                    size: metadata.size
                };
            }
            return {};
        } catch (error) {
            logger.error('Error extracting metadata:', error);
            return {};
        }
    }

    async deleteFile(filePath) {
        try {
            await fs.unlink(filePath);
        } catch (error) {
            logger.warn('Failed to delete file:', filePath, error);
        }
    }
    registerRoutes(app) {
        // Load CMS configuration from the /config folder at the project root
        const cmsConfig = require(path.join(process.cwd(), 'config', 'cmsManager.json'));
        const router = express.Router();
      
        // Ensure that the CMS configuration is loaded and its JSON structure is valid before proceeding
        if (!cmsConfig || !cmsConfig.routes) {
          throw new Error('Invalid CMS configuration');
        }
      
        for (const key in cmsConfig.routes) {
          const routeConfig = cmsConfig.routes[key];
          const { auth, acl, errorCodes } = routeConfig;
          const unauthorized = (errorCodes && errorCodes.unauthorized)
            ? errorCodes.unauthorized
            : defaultUnauthorized;
      
          // Define routes based on the key
          if (key === 'cms') {
            // Create Content: POST /cms
            router.post(
              routeConfig.route,
              aarMiddleware(auth, { acl, unauthorized }, app.locals.ruleEngineMiddleware),
              async (req, res) => {
                try {
                  const result = await this.createContent(req, req.body);
                  res.json(result);
                } catch (error) {
                  res.status(500).json({ error: error.message });
                }
              }
            );
      
            // Retrieve Content: GET /cms/:id? (by id or slug)
            router.get(
              routeConfig.route + '/:id?',
              aarMiddleware(auth, { acl, unauthorized }, app.locals.ruleEngineMiddleware),
              async (req, res) => {
                try {
                  const result = await this.fetchContent(req, req.query);
                  res.json(result);
                } catch (error) {
                  res.status(500).json({ error: error.message });
                }
              }
            );
      
            // Update Content: PUT /cms/:id?
            router.put(
              routeConfig.route + '/:id?',
              aarMiddleware(auth, { acl, unauthorized }, app.locals.ruleEngineMiddleware),
              async (req, res) => {
                try {
                  const result = await this.updateContent(req, req.body);
                  res.json(result);
                } catch (error) {
                  res.status(500).json({ error: error.message });
                }
              }
            );
      
            // Delete Content: DELETE /cms/:id?
            router.delete(
              routeConfig.route + '/:id?',
              aarMiddleware(auth, { acl, unauthorized }, app.locals.ruleEngineMiddleware),
              async (req, res) => {
                try {
                  const result = await this.deleteContent(req, req.query);
                  res.json(result);
                } catch (error) {
                  res.status(500).json({ error: error.message });
                }
              }
            );
          } else if (key === 'list') {
            // List Content: GET /cms/list
            router.get(
              routeConfig.route,
              aarMiddleware(auth, { acl, unauthorized }, app.locals.ruleEngineMiddleware),
              async (req, res) => {
                try {
                  const result = await this.listContent(req, req.query);
                  res.json(result);
                } catch (error) {
                  res.status(500).json({ error: error.message });
                }
              }
            );
          } else if (key === 'search') {
            // Search Content: GET /cms/search
            router.get(
              routeConfig.route,
              aarMiddleware(auth, { acl, unauthorized }, app.locals.ruleEngineMiddleware),
              async (req, res) => {
                try {
                  const result = await this.searchContent(req, req.query);
                  res.json(result);
                } catch (error) {
                  res.status(500).json({ error: error.message });
                }
              }
            );
          }
        }
      
        // Mount the CMS router
        app.use(router);
      }
}

module.exports = CMSManager;
