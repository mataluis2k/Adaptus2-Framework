#!/usr/bin/env node
const { Adaptus2Server } = require('./src/server');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const args = yargs(hideBin(process.argv))
  .option('build', {
    type: 'boolean',
    describe: 'Build API configuration from the database.'
  })
  .option('init', {
    type: 'boolean',
    describe: 'Initialize database tables.'
  })
  .option('generate-swagger', {
    type: 'boolean',
    describe: 'Generate Swagger documentation.'
  })
  .option('host', {
    type: 'string',
    describe: 'Set the hostname.'
  })
  .option('port', {
    type: 'number',
    describe: 'Set the port.'
  })
  // Enable strict mode to only allow the above flags.
  .strict()
  // Custom fail handler to print a clear error message.
  .fail((msg, err, yargs) => {
    console.error('Error: Invalid parameters provided.');
    console.error('Please use one of the following flags:');
    console.error('  --build             Build API configuration from the database.');
    console.error('  --init              Initialize database tables.');
    console.error('  --generate-swagger  Generate Swagger documentation.');
    console.error('  --host <hostname>   Set the hostname.');
    console.error('  --port <port>       Set the port.');
    console.error('Or start the server without parameters to run normally.');
    process.exit(1);
  })
  .argv;


console.log('Command line arguments:', args);

// Get port from command line args, environment variable, or default to 3000
const port = args.port || process.env.PORT || 3000;

// Get host/IP from command line args, environment variable, or default to 0.0.0.0 (all interfaces)
const host = args.ip || args.host || process.env.HOST || process.env.IP || '0.0.0.0';

console.log('Command line arguments:', args, host, port);
const app = new Adaptus2Server({
  port: port,
  host: host,
  configPath: './config/apiConfig.json',
});

app.start(() => {
  console.log(`Adaptus2-Framework Server is running on ${host}:${port}`);
});
