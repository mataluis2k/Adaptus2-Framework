// validator.js

const fs = require('fs');
const path = require('path');
const DSLParser = require('./dslparser');
const { globalContext } = require('./context');

function validateDSLFile(filePath) {
  const dslText = fs.readFileSync(filePath, 'utf-8');
  // Assuming rule blocks are separated by one or more blank lines
  const ruleBlocks = dslText.split(/\n\s*\n/);
  const errors = [];
  const validRules = [];

  ruleBlocks.forEach((block, idx) => {
    try {
      const parser = new DSLParser(globalContext);
      const rules = parser.parse(block);
      if (rules.length > 0) {
        validRules.push(...rules);
      } else {
        errors.push(`Rule block ${idx + 1}: No valid rules parsed.`);
      }
    } catch (err) {
      errors.push(`Rule block ${idx + 1}: ${err.message}`);
      console.error(`Error in rule block ${idx + 1}: ${err.message}`);
    }
  });

  console.log(`Parsed ${validRules.length} valid rule(s).`);
  if (errors.length > 0) {
    console.log('Validation errors:');
    errors.forEach(errMsg => console.log(errMsg));
  } else {
    console.log('All rules validated successfully.');
  }
}

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node validator.js <path-to-dsl-file>');
    process.exit(1);
  }
  validateDSLFile(filePath);
}

module.exports = { validateDSLFile };