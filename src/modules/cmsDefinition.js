// CMS table schema definition
const CMS_TABLE_SCHEMA = {
    routeType: 'def',
    dbType: process.env.DEFAULT_DBTYPE || 'mysql',
    dbConnection: process.env.DEFAULT_DBCONNECTION || 'MYSQL_1',
    dbTable: 'cms_content',
    allowWrite: ['id','content_type', 'title', 'slug', 'content', 'file_path', 'metadata', 'status', 'author_id'],
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

const CMS_ROUTES = [{
    routeType: 'database',
    dbType: process.env.DEFAULT_DBTYPE || 'mysql',
    dbConnection: process.env.DEFAULT_DBCONNECTION || 'MYSQL_1',
    dbTable: 'cms_content',
    route: '/cms',
    method: ['POST','GET','PUT','DELETE'],
    allowWrite: ['id','content_type', 'title', 'slug', 'content', 'file_path', 'metadata', 'status', 'author_id'],
    allowRead: ['id', 'content_type', 'title', 'slug', 'content', 'file_path', 'metadata', 'status', 'author_id', 'created_at', 'updated_at'],
    keys: ['id'],
    acl: ['adminAccess'],
    cache: 0
},{
    routeType: 'database',
    dbType: process.env.DEFAULT_DBTYPE || 'mysql',
    dbConnection: process.env.DEFAULT_DBCONNECTION || 'MYSQL_1',
    dbTable: 'cms_content',
    route: '/cms/list',
    method: ['GET'],
    allowWrite: ['id'],
    allowRead: ['id', 'content_type', 'title', 'slug', 'content', 'file_path', 'metadata', 'status', 'author_id', 'created_at', 'updated_at'],
    keys: ['id'],
    acl: ['adminAccess'],
    cache: 0

},{
    routeType: 'database',
    dbType: process.env.DEFAULT_DBTYPE || 'mysql',
    dbConnection: process.env.DEFAULT_DBCONNECTION || 'MYSQL_1',
    dbTable: 'cms_content',
    route: '/cms/search',
    method: ['GET'],
    allowWrite: ['id'],
    allowRead: ['id', 'content_type', 'title', 'slug', 'content', 'file_path', 'metadata', 'status', 'author_id', 'created_at', 'updated_at'],
    keys: ['id'],
    acl: ['adminAccess'],
    cache: 0

}
]
module.exports = CMS_TABLE_SCHEMA ;