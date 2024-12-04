const express = require('express');
const BusinessRules = require('./business_rules');

const app = express();
const businessRules = new BusinessRules('./config/businessRules.json');

businessRules.loadRules(); // Load rules from the JSON file
app.use(businessRules.middleware()); // Apply the middleware

// Example endpoint
app.get('/api/products', (req, res) => {
    const products = [
        { id: 1, name: 'Product A', price: 25 },
        { id: 2, name: 'Product B', price: 15 }
    ];
    res.json({ data: products });
});

app.listen(3000, () => console.log('Server running on port 3000'));