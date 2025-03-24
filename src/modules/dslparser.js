const consolelog = require('./logger');
const parseCommand = require('./parser');
/***************************************
 * dslParser.js
 ***************************************/
class DSLParser {
    /**
     * We assume you have a globalContext with:
     * {
     *   resources: { order: {}, customer: {}, ... },
     *   actions: { update: fn, send: fn, ... }
     * }
     */
    constructor(globalContext = {}) {
      this.globalContext = globalContext;
  
      // Keywords used in the DSL
      this.keywords = {
        IF: 'IF',
        WHEN: 'WHEN',
        THEN: 'THEN',
        ELSE: 'ELSE',
        ELSE_IF: 'ELSE IF',
        UPDATE: 'UPDATE',
        WITH: 'WITH',
        DO: 'DO'
      };
  
      // Allowed condition operators
      this.operators = [
        '=',
        '!=',
        '>',
        '<',
        '>=',
        '<=',
        'IS NULL',
        'IS NOT NULL',
        'CONTAINS',
        'IN'
      ];
  
      // Logical operators
      this.logicalOps = ['AND', 'OR'];
    }
  
    /**
     * Main entry point to parse the DSL text into a list of rule objects.
     */
    parse(dslText) {
      // Remove comments (#...) and empty lines
      const lines = dslText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
  
      if (lines.length === 0) {
        console.warn('DSL contains no valid lines after removing comments/empty lines.');
        return [];
      }
  
      if (!this._containsWithClause(lines)) {
        throw new Error(
          `DSL must contain at least one "WITH <DB> <CONNECTION> DO" block to specify the database connection.`
        );
      }

      return this._parseRules(lines);
    }
  
    _containsWithClause(lines) {
      return lines.some((line) => line.toUpperCase().startsWith(this.keywords.WITH));
    }
    /**
     * Parse multiple rules in a DSL script. 
     * Supports "WITH <DB> <CONNECTION> DO" blocks, 
     * and "IF ... THEN ... ELSE IF ... ELSE ..." blocks.
     */
    _parseRules(lines) {
      const rules = [];
      let currentDbConfig = null;
  
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        consolelog.log(`Parsing line: ${line}`);
  
        // Check for "WITH <something> DO" block
        if (line.toUpperCase().startsWith(this.keywords.WITH)) {
          const dbMatch = line.match(/WITH\s+(\S+)\s+(\S+)\s+DO/i);
          if (dbMatch) {
            const [, dbType, dbConnection] = dbMatch;
            currentDbConfig = { dbType, dbConnection };
            i++;
            continue;
          } else {
            throw new Error(`Invalid WITH syntax: ${line}`);
          }
        }
  
        // Check for IF rule
        if (line.toUpperCase().startsWith(this.keywords.IF)) {
          const ruleLines = [line];
          let j = i + 1;
  
          // Accumulate lines until we hit next IF/WITH or end of file
          while (j < lines.length) {
            const nextLine = lines[j];
            // Stop collecting if next line is a new IF or WITH
            if (
              nextLine.toUpperCase().startsWith(this.keywords.IF) ||
              nextLine.toUpperCase().startsWith(this.keywords.WITH)
            ) {
              break;
            }
            ruleLines.push(nextLine);
            j++;
          }
  
          const rule = this._parseSingleRule(ruleLines, currentDbConfig);
          consolelog.log('Parsed rule:', rule);
          if (rule) {
                rules.push(rule);
          }
  
          i = j; // Move pointer
        } else {
          // Unrecognized line
          console.log(`Skipping unrecognized line: ${line}`);
          i++;
        }
      }
  
      return rules;
    }
  
    /**
     * Parse a single rule block of the form:
     * IF <EVENT> <RESOURCE> [WHEN <CONDITIONS>] THEN
     *    <ACTIONS>
     * ELSE IF <CONDITIONS>
     *    <ACTIONS>
     * ELSE
     *    <ACTIONS>
     */
    _parseSingleRule(ruleLines, currentDbConfig) {
      // The first line is "IF ..."
      const firstLine = ruleLines[0];
      const { event, resource, conditions, direction = null } = this._parseIfLine(firstLine);
  
      // Validate resource vs. global context
      if (!this.globalContext.resources[resource]) {
        console.log(`Unknown resource '${resource}'. Please register it in globalContext.resources.`);
        if(process.env.SHUTDOWN_ON_UNCAUGHT){
          throw new Error(`Missing Resource: ${resource}`);          
        }
        return null;
      }
  
      // We'll store the final structure of the rule:
      // {
      //   event: "NEW" | "UPDATE" | "DELETE" etc.
      //   resource: "order", "customer", ...
      //   conditions: [ { type: 'condition', field, op, value }, 'AND', ... ]  (AST for conditions)
      //   thenActions: [ actionAST, ... ]
      //   elseIfs: [ { conditions: [...], actions: [...] }, ... ]
      //   elseActions: [ actionAST, ... ]
      //   dbConfig: { dbType, dbConnection }
      // }
      const rule = {
        event,
        resource,
        conditions,
        thenActions: [],
        elseIfs: [],
        elseActions: [],
        dbConfig: currentDbConfig,
        direction
      };
  
      // Find the THEN line
      let thenIndex = -1;
      for (let i = 0; i < ruleLines.length; i++) {
        if (ruleLines[i].toUpperCase().endsWith(this.keywords.THEN)) {
          thenIndex = i;
          break;
        }
      }
      if (thenIndex === -1) {
        throw new Error(`Missing THEN clause in rule: ${firstLine}`);
      }
  
      // Parse THEN actions
      let cursor = thenIndex + 1; // Lines after THEN
      while (cursor < ruleLines.length) {
        const line = ruleLines[cursor];
  
        // Break if we find ELSE or ELSE IF
        if (
          line.toUpperCase().startsWith(this.keywords.ELSE) ||
          line.toUpperCase().startsWith(this.keywords.ELSE_IF)
        ) {
          break;
        }
        const action = this._parseActionLine(line);
        if (action) {
          rule.thenActions.push(action);
        } else {
          consolelog.log(`Skipping invalid action in THEN block: ${line}`);
        }
        cursor++;
      }
  
      // Now parse any number of ELSE IF blocks
      while (
        cursor < ruleLines.length &&
        ruleLines[cursor].toUpperCase().startsWith(this.keywords.ELSE_IF)
      ) {
        const elseIfBlock = this._parseElseIfBlock(ruleLines, cursor);
        if (elseIfBlock.block.actions.length > 0) {
          rule.elseIfs.push(elseIfBlock.block);
        }
        cursor = elseIfBlock.newCursor;
      }
  
      // Finally, parse single ELSE block if present
      if (
        cursor < ruleLines.length &&
        ruleLines[cursor].toUpperCase().startsWith(this.keywords.ELSE)
      ) {
        // The line that starts with ELSE
        cursor++; // Move past the ELSE line
        const elseActions = [];
        while (cursor < ruleLines.length) {
          const nextLine = ruleLines[cursor];
          // Stop if we see an IF or WITH (means next rule)
          if (
            nextLine.toUpperCase().startsWith(this.keywords.IF) ||
            nextLine.toUpperCase().startsWith(this.keywords.WITH)
          ) {
            break;
          }
          const action = this._parseActionLine(nextLine);
          if (action) {
            elseActions.push(action);
          } else {
            consolelog.log(`Skipping invalid action in ELSE block: ${nextLine}`);
          }
          cursor++;
        }
        if (elseActions.length > 0) {
          rule.elseActions = elseActions;
        }
      }
  
      // Only return the rule if it has at least one valid action
      if (rule.thenActions.length > 0 || rule.elseIfs.length > 0 || rule.elseActions.length > 0) {
        return rule;
      } else {
        consolelog.log(`Skipping rule with no valid actions: ${firstLine}`);
        return null;
      }
    }
  
    /**
     * Parse an "ELSE IF" block: 
     * ELSE IF <CONDITIONS>
     *   <ACTIONS>
     * 
     * Returns an object with { block, newCursor } 
     * where block = { conditions: [...], actions: [...] }
     */
    _parseElseIfBlock(ruleLines, startIndex) {
      const line = ruleLines[startIndex];
      // e.g. "ELSE IF order.status = "pending" AND user.id > 100"
      const regex = /^ELSE\s+IF\s+(.*)$/i;
      const match = line.match(regex);
      if (!match) {
        throw new Error(`Invalid ELSE IF syntax: ${line}`);
      }
  
      const conditionString = match[1].trim();
      const conditions = this._parseConditionString(conditionString);
  
      const block = {
        conditions,
        actions: []
      };
  
      let cursor = startIndex + 1;
      // Collect lines until next ELSE, ELSE IF, IF or WITH
      while (cursor < ruleLines.length) {
        const nextLine = ruleLines[cursor];
        if (
          nextLine.toUpperCase().startsWith(this.keywords.ELSE) ||
          nextLine.toUpperCase().startsWith(this.keywords.IF) ||
          nextLine.toUpperCase().startsWith(this.keywords.WITH)
        ) {
          break;
        }
        const action = this._parseActionLine(nextLine);
        if (action) {
          block.actions.push(action);
        } else {
          consolelog.log(`Skipping invalid action in ELSE IF block: ${nextLine}`);
        }
        cursor++;
      }
  
      return { block, newCursor: cursor };
    }
  
    /**
     * Parse the first IF line:
     * e.g. IF NEW order WHEN order.status = "paid" AND order.total > 500 THEN
     */
    _parseIfLine(line) {
      const regex = new RegExp(
          `^IF\\s+(\\w+)\\s+([\\w/:]+)(?:\\s+${this.keywords.WHEN}\\s+(.*))?\\s+${this.keywords.THEN}$`,
          'i'
      );
      const match = line.match(regex);
      if (!match) {
          throw new Error(`Invalid IF syntax: ${line}`);
      }
      let [, event, resource, rawConditions] = match;
  
      // Normalize dynamic routes (e.g., videos/:id -> videos)
      // resource = resource.replace(/\/[^/]+$/, ''); // Remove last segment if it's an ID

      let direction = null;
      
      if (event === 'GETIN') {
          event = 'GET';
          direction = 'in';
      } else if (event === 'GETOUT') {
          event = 'GET';
          direction = 'out';
      }
  
      let conditions = [];
      if (rawConditions) {
          conditions = this._parseConditionString(rawConditions);
      }
  
      return { event, resource, conditions, direction };
  }
  
  
    /**
     * Parse a raw condition string with optional parentheses, 
     * multiple conditions, AND/OR, and operators.
     * e.g. "order.status = "paid" AND order.total > 500"
     * 
     * We'll produce an array-based AST, like:
     * [
     *   { type:'condition', field:'order.status', op:'=', value:'paid' }, 
     *   'AND',
     *   { type:'condition', field:'order.total', op:'>', value:'500' }
     * ]
     * 
     * If parentheses exist, we recursively parse them.
     */
    _parseConditionString(raw) {
      // We'll do a small tokenization with parentheses, AND, OR, and operators.
      return this._tokenizeConditions(raw);
    }
  
    /**
     * Tokenize condition string into an array-based AST,
     * also handling parentheses via recursion.
     */
    _tokenizeConditions(conditionString) {
      const tokens = [];
      let i = 0;
  
      const str = conditionString.trim();
  
      while (i < str.length) {
        const c = str[i];
  
        // Skip whitespace
        if (/\s/.test(c)) {
          i++;
          continue;
        }
  
        // Parentheses -> we parse sub-expression
        if (c === '(') {
          // find matching ')'
          let depth = 1;
          let j = i + 1;
          while (j < str.length && depth > 0) {
            if (str[j] === '(') depth++;
            if (str[j] === ')') depth--;
            j++;
          }
          if (depth !== 0) {
            throw new Error(`Unmatched '(' in condition: ${conditionString}`);
          }
          const subExpr = str.substring(i + 1, j - 1);
          tokens.push(this._tokenizeConditions(subExpr));
          i = j;
          continue;
        }
  
        if (c === ')') {
          // Should be handled by recursion
          throw new Error(`Unexpected ')' in condition: ${conditionString}`);
        }
  
        // If it's a letter or quote, parse a token
        const token = this._parseNextToken(str, i);
        tokens.push(token.value);
        i = token.nextIndex;
      }
  
      // Now we have a flat array of tokens and nested arrays for parentheses
      // e.g. ["order.status", "=", "paid", "AND", ["order.total", ">", "500"]]
  
      // Next, we convert the top-level array of tokens to an AST: 
      return this._buildConditionAST(tokens);
    }
  
    /**
     * Parse the next token, which could be an operator, 
     * a string, or something in quotes.
     */
    _parseNextToken(str, startIndex) {
      // If the substring starts with a quote, read until the matching quote
      if (str[startIndex] === '"' || str[startIndex] === "'") {
        const quoteChar = str[startIndex];
        let j = startIndex + 1;
        let result = '';
        while (j < str.length && str[j] !== quoteChar) {
          result += str[j];
          j++;
        }
        if (j >= str.length) {
          throw new Error(`Unterminated string at: ${str.substring(startIndex)}`);
        }
        return { value: `"${result}"`, nextIndex: j + 1 };
      }
  
      // Otherwise, read until space or parentheses or quote
      let j = startIndex;
      let buffer = '';
      while (
        j < str.length &&
        !/\s|\(|\)|'|"/.test(str[j])
      ) {
        buffer += str[j];
        j++;
      }
  
      return { value: buffer, nextIndex: j };
    }
  
    /**
     * Convert a flat array of tokens (and nested arrays for parentheses) into 
     * an array-based AST with condition objects + 'AND'/'OR' strings.
     */
    _buildConditionAST(tokens) {
      // We'll produce something like:
      // [
      //   { type: 'condition', field, op, value },
      //   'AND',
      //   [ ...subtree... ],
      //   'OR',
      //   { type: 'condition', ... }
      // ]
      // This method is simplified; it won't do "precedence" beyond parentheses.
  
      const ast = [];
      let i = 0;
  
      while (i < tokens.length) {
        const token = tokens[i];
  
        if (Array.isArray(token)) {
          // This is a nested parentheses array, recursively built
          ast.push(this._buildConditionAST(token));
          i++;
          continue;
        }
  
        // Check if token is AND/OR
        if (this.logicalOps.includes(token.toUpperCase())) {
          ast.push(token.toUpperCase());
          i++;
          continue;
        }
  
        // If it's an operator from operators[] 
        // or we suspect it's part of field op value...
        // We'll do a minimal 3-token parse for field OP value:
        // e.g. "order.status", "=", "\"paid\""
        const field = token;
        i++;
        if (i >= tokens.length) {
          // single token leftover
          ast.push({ type: 'condition', field, op: null, value: null });
          break;
        }
  
        const possibleOp = tokens[i];
        if (this.operators.includes(possibleOp.toUpperCase())) {
          // It's an operator
          const op = possibleOp.toUpperCase();
          i++;
          let value = null;
  
          // For operators that do not require a value (IS NULL, IS NOT NULL)
          if (op === 'IS NULL' || op === 'IS NOT NULL') {
            ast.push({ type: 'condition', field, op, value: null });
            continue;
          }
  
          // If it's an 'IN' operator, parse up to bracket or parentheses
          if (op === 'IN') {
            // e.g. IN ["US","CA"]
            // We'll read the next token, hopefully something like ["US","CA"] or ('US','CA')
            const inArrayToken = tokens[i];
            if (inArrayToken.startsWith('[') || inArrayToken.startsWith('(')) {
              value = this._parseInValue(inArrayToken);
              i++;
            } else {
              throw new Error(`Expected array/list after IN operator, got: ${inArrayToken}`);
            }
            ast.push({ type: 'condition', field, op, value });
            continue;
          }
  
          // else parse normal "value"
          if (i < tokens.length) {
            value = tokens[i];
            i++;
          }
          ast.push({
            type: 'condition',
            field,
            op,
            value: this._stripQuotes(value)
          });
        } else {
          // It's not recognized as an operator, interpret it as a single token condition
          ast.push({ type: 'condition', field, op: null, value: possibleOp });
        }
      }
  
      return ast;
    }
  
    // If we see IN ["US","CA"] or IN ('US','CA'), parse it into an array
    _parseInValue(token) {
      // Remove bracket or parentheses
      let raw = token;
      if (raw.startsWith('(') || raw.startsWith('[')) {
        raw = raw.slice(1);
      }
      if (raw.endsWith(')') || raw.endsWith(']')) {
        raw = raw.slice(0, -1);
      }
      // Split by comma
      const items = raw.split(',').map((x) => this._stripQuotes(x.trim()));
      return items;
    }
  
    _stripQuotes(val) {
      if (!val) return val;
      return val.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  
    /**
     * Parse an action line, e.g.:
     *   send order to action.fulfillment
     *   update order.total = order.total - (order.total * 0.1)
     *   create_record user to entity:users with data: {...}
     *
     * We'll do a simple approach:
     *   - check the first token => action name
     *   - check if it's in globalContext.actions (optional validation)
     *   - parse the rest as the "args" or "expression"
     */
    _parseActionLine(line) {
      try {
        // Split the line into tokens: action type and arguments
        const tokens = line.split(/\s+/);
        if (tokens.length < 2) {
          consolelog.log(`Invalid action line (too few tokens): ${line}`);
          return null;
        }
        
        const action = tokens[0];
        let data = null;

        if (action === 'update') { 
          try {
            data = this._parseUpdateExpression(line);
          } catch (error) {
            consolelog.log(`Error parsing update expression: ${error.message}`);
            return null;
          }
        } else {
          if (!this.globalContext.actions[action]) {
            consolelog.log(`Unknown action '${action}'. Please register in globalContext.actions`);
            return null;
          }       
          try {
            data = parseCommand(line);
          } catch (error) {
            consolelog.log(`Error parsing command: ${error.message}`);
            return null;
          }
        }
        
        return data;
      } catch (error) {
        consolelog.log(`Error parsing action line: ${error.message}`);
        return null;
      }
    }

    /**
     * Parse a line like:
     *  "order.total = order.total - (order.total * 0.1)"
     * We extract the field (order.total) and the expression (order.total - (order.total * 0.1))
     * We'll store them so we can evaluate at runtime.
     */
    _parseUpdateExpression(line) {
      // We need to remove "update" from the start
      line = line.replace(/^update\s+/, '');
      // line might be: order.total = order.total - (order.total * 0.1)
      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) {
        throw new Error(`Invalid update syntax (missing '='): ${line}`);
      }
      const leftSide = line.slice(0, eqIndex).trim(); // "order.total"
      const rightSide = line.slice(eqIndex + 1).trim(); // "order.total - (order.total * 0.1)"
  
      // Validate that the left side is something like "<resource>.<field>"
      // We skip advanced checks here, but you could.
      return {
        action: 'update',
        field: leftSide,
        expression: rightSide
      };
    }
  }
  
  module.exports = DSLParser;
  
  /***************************************
   * Example usage (test it directly)
   ***************************************/
  
  if (require.main === module) {
    // A sample globalContext to demonstrate resource/action validation
    const globalContext = {
      resources: {
        order: {},
        customer: {},
        fulfillment: {}
      },
      actions: {
        send: () => {},
        update: () => {},
        create_record: () => {},
        log: () => {},
        notify: () => {},
        invoke: () => {}
      }
    };
  
    const parser = new DSLParser(globalContext);
  
    const dslScript = `
  # Example with parentheses, placeholders, arithmetic, ELSE IF, and ELSE
  WITH MYSQL myConnection DO
  
  IF NEW order WHEN (order.status = "paid" AND order.total > 500) OR (order.vip IS NOT NULL) THEN
      update order.total = order.total - (order.total * 0.1)
      send order to action.notify
  ELSE IF order.status = "pending"
      log "Order is pending, no discount"
  ELSE
      send order to action.fulfillment
  
  IF UPDATE customer WHEN customer.email CONTAINS "gmail" THEN
      update customer.segment = "gmail_user"
  
  IF UPDATE order WHEN order.country IN [ "US","CA" ] THEN
      update order.tax = (order.total * 0.07)
  `;
  
    const parsedRules = parser.parse(dslScript);
    consolelog.log(JSON.stringify(parsedRules, null, 2));
  }
