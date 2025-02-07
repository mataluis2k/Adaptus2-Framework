const fs = require("fs").promises;
const path = require("path");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const { create, read, update, delete: deleteRecord, query } = require('./db');
const logger = require('./logger');

// CMS table schema definition
const CMS_TABLE_SCHEMA = {
    routeType: 'def',
    dbType: process.env.DEFAULT_DBTYPE || 'mysql',
    dbConnection: process.env.DEFAULT_DBCONNECTION || 'MYSQL_1',
    dbTable: 'cms_content',
    allowWrite: ['content_type', 'title', 'slug', 'content', 'file_path', 'metadata', 'status', 'author_id'],
    allowRead: ['id', 'content_type', 'title', 'slug', 'content', 'file_path', 'metadata', 'status', 'author_id', 'created_at', 'updated_at'],
    keys: ['id'],
    acl: ['adminAccess'],
    cache: 0,
    columnDefinitions: {
        id: 'VARCHAR(36) PRIMARY KEY',
        content_type: 'VARCHAR(50) NOT NULL',
        title: 'VARCHAR(255) NOT NULL',
        slug: 'VARCHAR(255) NOT NULL',
        content: 'TEXT',
        file_path: 'TEXT',
        metadata: 'JSON',
        status: 'VARCHAR(20) DEFAULT "draft"',
        author_id: 'VARCHAR(36)',
        created_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
        updated_at: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
        INDEX: ['idx_content_type(content_type)', 'idx_slug(slug)', 'idx_status(status)']
    }
};

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

    async createContent(ctx, params) {
        try {
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

            let filePath = null;
            let processedMetadata = metadata;

            // Handle file upload if present
            if (file && ['image', 'video', 'document'].includes(contentType)) {
                filePath = await this.handleFileUpload(ctx, file, contentType);
                processedMetadata = await this.extractMetadata(filePath, contentType);
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
                author_id: ctx.user?.id
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
                result.metadata = JSON.parse(result.metadata);
            }

            return result;
        } catch (error) {
            logger.error('Error retrieving content:', error);
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
                text: `SELECT * FROM ${CMS_TABLE_SCHEMA.dbTable}
                       ${Object.keys(filters).length > 0 ? 'WHERE ' + Object.keys(filters).map(key => `${key} = ?`).join(' AND ') : ''}
                       ORDER BY created_at DESC
                       LIMIT ? OFFSET ?`,
                values: [...Object.values(filters), pageSize, offset]
            };

            const result = await query(this.dbConfig, listQuery.text, listQuery.values);

            // Parse metadata for each item
            return result.map(item => ({
                ...item,
                metadata: item.metadata ? JSON.parse(item.metadata) : null
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
}

module.exports = CMSManager;
