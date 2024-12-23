const express = require('express');
const path = require('path');
const apiConfig = require('./config/apiConfig.json'); // Adjust path as needed

function initializeAdminInterface(app, config = { enableAdmin: true }) {
    if (!config.enableAdmin) {
        console.log("Admin interface is disabled via configuration.");
        return;
    }

    const adminRouter = express.Router();

    // Serve static assets for the admin UI
    app.use('/static', express.static(path.join(__dirname, 'static')));

    // Build dynamic menu from API Config
    const tables = apiConfig.map(config => ({
        name: config.dbTable,
        route: `/view/x1/${config.dbTable}`
    }));

    // Admin dashboard route
    adminRouter.get('/', (req, res) => {
        const menuHtml = tables.map(table => `<li><a href="${table.route}" class="list-group-item">${table.name}</a></li>`).join('');
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Admin Interface</title>
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
            </head>
            <body>
                <div class="container-fluid">
                    <div class="row">
                        <nav class="col-md-3 col-lg-2 d-md-block bg-light sidebar">
                            <div class="position-sticky">
                                <ul class="nav flex-column">
                                    ${menuHtml}
                                </ul>
                            </div>
                        </nav>
                        <main class="col-md-9 ms-sm-auto col-lg-10 px-md-4">
                            <h1 class="mt-3">Welcome to the Admin Interface</h1>
                            <p>Select a table from the menu to view or manage its data.</p>
                        </main>
                    </div>
                </div>
            </body>
            </html>
        `);
    });

    // Dynamic browse table routes with pagination
    tables.forEach(({ name, route }) => {
        adminRouter.get(`/${name}`, async (req, res) => {
            const tableConfig = apiConfig.find(config => config.dbTable === name);
            if (!tableConfig) return res.status(404).send("Table not found");

            const page = parseInt(req.query.page || "1", 10);
            const limit = 10; // Items per page
            const offset = (page - 1) * limit;

            try {
                const connection = await getDbConnection({ dbType: tableConfig.dbType, dbConnection: tableConfig.dbConnection });
                const [data] = await connection.execute(`SELECT * FROM ${name} LIMIT ${limit} OFFSET ${offset}`);
                const [[{ total }]] = await connection.execute(`SELECT COUNT(*) as total FROM ${name}`);

                const totalPages = Math.ceil(total / limit);

                const tableHtml = `
                    <h2>${name}</h2>
                    <table class="table table-bordered table-striped">
                        <thead>
                            <tr>${Object.keys(data[0] || {}).map(key => `<th>${key}</th>`).join('')}</tr>
                        </thead>
                        <tbody>
                            ${data.map(row => `<tr>${Object.values(row).map(value => `<td>${value}</td>`).join('')}</tr>`).join('')}
                        </tbody>
                    </table>
                    <nav>
                        <ul class="pagination">
                            ${Array.from({ length: totalPages }, (_, i) => `
                                <li class="page-item ${i + 1 === page ? 'active' : ''}">
                                    <a class="page-link" href="${route}?page=${i + 1}">${i + 1}</a>
                                </li>`).join('')}
                        </ul>
                    </nav>
                `;

                res.send(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>${name} Management</title>
                        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
                    </head>
                    <body>
                        <div class="container mt-4">
                            <a href="/view/x1" class="btn btn-secondary mb-3">Back to Menu</a>
                            ${tableHtml}
                        </div>
                    </body>
                    </html>
                `);
            } catch (error) {
                console.error(error);
                res.status(500).send("Internal Server Error");
            }
        });
    });

    app.use('/view/x1', adminRouter);
}

module.exports = initializeAdminInterface;

// Usage in server2.js
const initializeAdminInterface = require('./modules/adminInterface');
initializeAdminInterface(app, { enableAdmin: true });
