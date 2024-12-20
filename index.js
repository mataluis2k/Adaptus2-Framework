const FlexAPIServer = require('./src/server');

const app = new FlexAPIServer({
  port: 3000,
  configPath: './config/apiConfig.json',
});

app.start(() => {
  console.log('FlexAPI Server is running on port 3000');
});

