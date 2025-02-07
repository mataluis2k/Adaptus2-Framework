# CMS Manager Documentation

The CMS Manager module provides a flexible content management system that supports multiple content types, file handling, and metadata management. It's designed to work with multiple database backends and provides a rich set of features for content creation, retrieval, and management.

## Table of Contents
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
- [Features](#features)
- [Content Types](#content-types)
- [API Actions](#api-actions)
  - [cms_create_content](#cms_create_content)
  - [cms_get_content](#cms_get_content)
  - [cms_update_content](#cms_update_content)
  - [cms_delete_content](#cms_delete_content)
  - [cms_list_content](#cms_list_content)
  - [cms_search_content](#cms_search_content)
- [File Handling](#file-handling)
- [Database Support](#database-support)
- [Usage Examples](#usage-examples)
  - [Creating a Blog Post](#creating-a-blog-post)
  - [Managing Image Gallery](#managing-image-gallery)
  - [Listing Published Content](#listing-published-content)
  - [Searching Content](#searching-content)
  - [Managing Document Library](#managing-document-library)
- [Error Handling](#error-handling)
- [Metadata Extraction](#metadata-extraction)
  - [Image Files](#image-files)
  - [Video Files](#video-files)
  - [Documents](#documents)
- [Best Practices](#best-practices)

## Configuration

The CMS Manager uses a schema-based configuration that defines the table structure and allowed operations:

```javascript
const CMS_TABLE_SCHEMA = {
    routeType: 'def',
    dbType: process.env.DEFAULT_DBTYPE || 'mysql',
    dbConnection: process.env.DEFAULT_DBCONNECTION || 'MYSQL_1',
    dbTable: 'cms_content',
    allowWrite: ['content_type', 'title', 'slug', 'content', 'file_path', 'metadata', 'status', 'author_id'],
    allowRead: ['id', 'content_type', 'title', 'slug', 'content', 'file_path', 'metadata', 'status', 'author_id', 'created_at', 'updated_at'],
    keys: ['id'],
    acl: ['adminAccess'],
    cache: 0
}
```

### Environment Variables
- `DEFAULT_DBTYPE`: Database type (mysql, postgres, mongodb, snowflake)
- `DEFAULT_DBCONNECTION`: Database connection name
- `UPLOAD_DIR`: Directory for file uploads (default: './uploads/cms')

## Features

- Content Type Management
- File Upload Support
- Metadata Management
- Search Functionality
- Pagination
- Access Control
- Database Agnostic

## Content Types

The CMS supports the following content types:
- `page`: Static pages
- `post`: Blog posts or articles
- `image`: Image files with metadata
- `video`: Video content
- `document`: Document files

Each content type can have:
- Title
- Slug (URL-friendly identifier)
- Content
- Metadata (JSON)
- Status
- File attachments (for image, video, document types)

## API Actions

### cms_create_content
Creates new content in the CMS.

```javascript
// Business Rule Example
RULE "Create CMS Content" {
    ON "POST /api/cms/content"
    DO {
        cms_create_content {
            data: {
                contentType: "page",
                title: "Welcome Page",
                slug: "welcome",
                content: "Welcome to our site!",
                status: "published"
            }
        }
    }
}
```

### cms_get_content
Retrieves content by ID or slug.

```javascript
RULE "Get CMS Content" {
    ON "GET /api/cms/content/:id"
    DO {
        cms_get_content {
            id: ${params.id}
        }
    }
}
```

### cms_update_content
Updates existing content.

```javascript
RULE "Update CMS Content" {
    ON "PUT /api/cms/content/:id"
    DO {
        cms_update_content {
            id: ${params.id},
            data: ${data}
        }
    }
}
```

### cms_delete_content
Deletes content and associated files.

```javascript
RULE "Delete CMS Content" {
    ON "DELETE /api/cms/content/:id"
    DO {
        cms_delete_content {
            id: ${params.id}
        }
    }
}
```

### cms_list_content
Lists content with pagination and filtering.

```javascript
RULE "List CMS Content" {
    ON "GET /api/cms/content"
    DO {
        cms_list_content {
            filters: {
                content_type: ${query.type},
                status: "published"
            },
            page: ${query.page || 1},
            pageSize: ${query.pageSize || 10}
        }
    }
}
```

### cms_search_content
Searches content by title or content.

```javascript
RULE "Search CMS Content" {
    ON "GET /api/cms/search"
    DO {
        cms_search_content {
            searchQuery: ${query.q},
            contentType: ${query.type}
        }
    }
}
```

## File Handling

The CMS Manager automatically handles file uploads for image, video, and document content types:

- Files are stored in type-specific subdirectories
- Unique filenames are generated using UUID
- Metadata is extracted from files (e.g., image dimensions)
- Old files are automatically deleted when updated

### File Upload Example

```javascript
RULE "Upload Image Content" {
    ON "POST /api/cms/images"
    DO {
        cms_create_content {
            data: {
                contentType: "image",
                title: ${data.title},
                slug: ${data.slug},
                file: ${files.image}
            }
        }
    }
}
```

## Database Support

The CMS Manager supports multiple database backends:
- MySQL
- PostgreSQL
- MongoDB
- Snowflake

Database-specific features:
- Automatic index creation
- JSON field support
- Full-text search (where available)
- Efficient pagination

## Usage Examples

### Creating a Blog Post

```javascript
RULE "Create Blog Post" {
    ON "POST /api/blog"
    DO {
        cms_create_content {
            data: {
                contentType: "post",
                title: ${data.title},
                slug: ${data.slug},
                content: ${data.content},
                metadata: {
                    author: ${user.name},
                    tags: ${data.tags},
                    category: ${data.category}
                },
                status: "draft"
            }
        }
    }
}
```

### Managing Image Gallery

```javascript
RULE "Add Gallery Image" {
    ON "POST /api/gallery"
    DO {
        cms_create_content {
            data: {
                contentType: "image",
                title: ${data.title},
                slug: ${data.slug},
                file: ${files.image},
                metadata: {
                    gallery: ${data.galleryId},
                    caption: ${data.caption}
                }
            }
        }
    }
}
```

### Listing Published Content

```javascript
RULE "List Published Posts" {
    ON "GET /api/posts"
    DO {
        cms_list_content {
            filters: {
                content_type: "post",
                status: "published"
            },
            page: ${query.page},
            pageSize: 10
        }
    }
}
```

### Searching Content

```javascript
RULE "Search All Content" {
    ON "GET /api/search"
    DO {
        cms_search_content {
            searchQuery: ${query.q}
        }
    }
}
```

### Managing Document Library

```javascript
RULE "Add Document" {
    ON "POST /api/documents"
    DO {
        cms_create_content {
            data: {
                contentType: "document",
                title: ${data.title},
                slug: ${data.slug},
                file: ${files.document},
                metadata: {
                    category: ${data.category},
                    tags: ${data.tags},
                    version: ${data.version}
                }
            }
        }
    }
}
```

## Error Handling

The CMS Manager provides detailed error messages for common scenarios:

- Invalid content type
- Duplicate slug
- Missing required fields
- File upload failures
- Permission errors

Example error handling:

```javascript
RULE "Create Content with Error Handling" {
    ON "POST /api/content"
    TRY {
        cms_create_content {
            data: ${data}
        }
    } CATCH {
        RETURN {
            status: 400,
            message: ${error.message}
        }
    }
}
```

## Metadata Extraction

The CMS Manager automatically extracts metadata from uploaded files based on their content type:

### Image Files
For image files, the following metadata is automatically extracted:
- Width
- Height
- Format
- Size
- Color space (if available)

Example metadata for an image:
```json
{
    "width": 1920,
    "height": 1080,
    "format": "jpeg",
    "size": 2048576
}
```

### Video Files
For video files, basic file information is stored:
- File size
- Upload date
- Original filename
- Duration (if available)
- Resolution (if available)

### Documents
For document files, the following is tracked:
- File size
- Upload date
- Original filename
- File extension
- MIME type

## Best Practices

1. Slug Generation
   - Use lowercase letters, numbers, and hyphens
   - Avoid special characters
   - Keep slugs short but descriptive
   - Ensure uniqueness within content type

2. Content Organization
   - Use appropriate content types
   - Leverage metadata for better organization
   - Use consistent naming conventions
   - Implement proper content hierarchies

3. File Management
   - Use appropriate file formats
   - Optimize images before upload
   - Clean up unused files
   - Implement file size limits

4. Error Handling
   - Always validate input
   - Handle file upload errors gracefully
   - Provide meaningful error messages
   - Log errors for debugging

5. Security
   - Validate file types
   - Check file size limits
   - Implement proper access control
   - Sanitize user input
   - Use secure file storage

6. Performance
   - Implement caching where appropriate
   - Use pagination for large datasets
   - Optimize database queries
   - Handle large file uploads efficiently
