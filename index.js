#!/usr/bin/env node
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const path = require('path');

yargs(hideBin(process.argv))
  // Build command
  .command(
    'build',
    'Build API configuration from the database',
    (yargs) =>
      yargs
        .option('acl', {
          type: 'string',
          default: 'publicAccess',
          describe: 'Specify a custom Access Control List (ACL)',
        })
        .option('overwrite', {
          type: 'boolean',
          describe: 'Overwrite existing configuration',
        })
        .option('refresh', {
          type: 'boolean',
          describe: 'Refresh configuration (load existing config before building)',
        })
        .option('tables', {
          type: 'string',
          describe:
            'Comma-separated list of tables to build configuration for (optional)',
        }),
    async (argv) => {
      const buildApiConfigFromDatabase = require(path.join(__dirname, './src/modules/buildConfig'));
      await buildApiConfigFromDatabase(argv);
      process.exit(0);
    }
  )
  // Init command
  .command(
    'init',
    'Initialize database tables',
    (yargs) => yargs,
    async () => {
      const { initDatabase } = require(path.join(__dirname, './src/modules/db')); // Adjust the path if needed
      await initDatabase();
      console.log('Database tables initialized successfully.');
      process.exit(0);
    }
  )
  // Generate Swagger command
  .command(
    'generate-swagger',
    'Generate Swagger documentation',
    (yargs) => yargs,
    async () => {
      const generateSwaggerDoc = require(path.join(__dirname, './src/modules/generateSwaggerDoc'));
      await generateSwaggerDoc();
      console.log('Swagger documentation generated successfully.');
      process.exit(0);
    }
  )
  // Default command: start the server
  .command(
    '$0',
    'Start the server (default command)',
    (yargs) =>
      yargs
        .option('host', {
          type: 'string',
          default: process.env.HOST || '0.0.0.0',
          describe: 'Set the hostname',
        })
        .option('port', {
          type: 'number',
          default: process.env.PORT || 3000,
          describe: 'Set the port',
        }),
    (argv) => {
      const { Adaptus2Server } = require(path.join(__dirname, './src/server'));
      const app = new Adaptus2Server({
        port: argv.port,
        host: argv.host,
        configPath: path.join(__dirname, './config/apiConfig.json'), // Also fix this path
      });
      app.start(() => {
        console.log(`Adaptus2-Framework Server is running on ${argv.host}:${argv.port}`);
      });
    }
  )
  .strict()
  .help()
  .fail((msg, err, yargs) => {
    
    console.log(yargs);
    console.error('Error: Invalid command or parameters provided.');
    console.error('Available commands:');
    console.error('  build             Build API configuration from the database.');
    console.error('  init              Initialize database tables.');
    console.error('  generate-swagger  Generate Swagger documentation.');
    console.error('  defaults to       Start the server (supports --host and --port options).');
    console.error('Use --help to view all available options.');
    if (err) {
      console.error(err);
    }
    process.exit(1);
  })
  .argv;
