#!/usr/bin/env node
const { Adaptus2Server } = require('./src/server');

const app = new Adaptus2Server({
  port: 3000,
  configPath: '../config/apiConfig.json',
});

app.start(() => {
  console.log('FlexAPI Server is running on port 3000');
});
