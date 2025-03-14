'use strict';
const consolelog = require('./logger');
const { setContext } = require('./context');
const DSLParser = require('./dslparser');

// Define sha256 function in the global scope
const crypto = require('crypto');
const { getApiConfig } = require('./apiConfig');
const { getContext, globalContext  } = require('./context'); // Shared global context
const bcrypt = require('bcrypt');

global.sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
global.bcrypt = async (value) => {
  const saltRounds = 10; 
  return await bcrypt.hash(value, saltRounds);
};
/**
 * A single rule, representing:
 *   IF <event> <entity> WHEN <conditions> THEN <thenActions>
 *   ELSE IF <conditions> <actions> ...
 *   ELSE <elseActions>
 */
class Rule {
  /**
   * @param {string} eventType - e.g. "NEW", "UPDATE", "DELETE"
   * @param {string} entity - e.g. "order", "customer"
   * @param {Array} conditions - Top-level conditions array (AST with AND/OR)
   * @param {Array} thenActions - Actions if the top-level conditions match
   * @param {Array} elseIfs - Array of blocks: [{ conditions, actions }, ...]
   * @param {Array} elseActions - Actions if main conditions & elseIfs all fail
   * @param {object} dbConfig - Optional DB config from "WITH ... DO" block
   */
  constructor(eventType, entity, conditions, thenActions, elseIfs, elseActions, dbConfig = null,direction = 'OUT') {
    this.eventType = eventType;         // e.g. "NEW"
    this.entity = entity;               // e.g. "order"
    this.conditions = conditions || []; // e.g. [..., 'AND', ...]
    this.thenActions = thenActions || [];
    this.elseIfs = elseIfs || [];       // Array of { conditions, actions }
    this.elseActions = elseActions || [];
    this.dbConfig = dbConfig;
    this.direction = direction;
    this.response = { status: 200, message: 'Success', error: null };

    // Fallback action handlers if not found in context
    this.defaultActions = {
      update: (ctx, action) => {
        // Example: action might be { type:'update', field:'order.total', expression:'order.total - (order.total * 0.1)' }
        const { field, expression } = action;
        if (!field || !expression) {
          consolewarn(`update action missing field/expression: ${JSON.stringify(action)}`);
          return;
        }
        consolelog.log(`Running update for field "${field}" using expression "${expression}".`);

        // Evaluate the expression with "data"
        try {
          const computedValue = new Function('data', `
            with (data) { return ${expression}; }
          `)(ctx.data); // data is merged in the context

          // Assign the computedValue back to ctx.data at the correct field path
          this._setNestedValue(ctx.data, field, computedValue);
          consolelog.log(`Assigned ${field} = ${computedValue}`);
        } catch (err) {
          console.error(`Error evaluating update expression for field "${field}": ${err.message}`);
        }
      },
      send: (ctx, action) => {
        // Example: action might be { type:'send', raw:'order to action.notify' }
        consolelog.log(`Sending ${action.raw}`);
      },
      log: (ctx, action) => {
        consolelog.log(`Rule Log: ${action.raw}`);
        return action.raw;
      },
      notify: (ctx, action) => {
        consolelog.log(`Notifying: ${action.raw}`);
      },
      invoke: (ctx, action) => {
        consolelog.log(`Invoking function ${action.raw} , ${action}`);
      },
      create_record: (ctx, action) => {
        consolelog.log(`Creating record with: ${action.raw}`);
      },
      // Fallback if no recognized action
      unknown: (ctx, action) => {
        console.warn(`Unknown action encountered: ${JSON.stringify(action)}`);
      }
    };
  }


  /**
   * Check if this rule is relevant based on eventType + entity.
   * Then evaluate top-level conditions.
   * 
   * @param {string} eventType - "NEW", "UPDATE", "DELETE"
   * @param {string} entityName - e.g. "order"
   * @param {object} data - The data triggering the rule
   * @returns {boolean} true if top-level conditions match
   */
  match(eventType, entityName, data, direction = null) {
    console.log(`Matching rule: eventType=${this.eventType}, entity=${this.entity}, direction=${this.direction}`);
    console.log(`Against: eventType=${eventType}, entityName=${entityName}, direction=${direction}`);
    
    // Check if event type matches
    if (this.eventType !== eventType) {
      console.log(`Event type mismatch: ${this.eventType} !== ${eventType}`);
      return false;
    }

    // For GET requests, check if direction matches when specified
    if (eventType === 'GET' && this.direction && this.direction !== direction) {
      console.log(`Direction mismatch: ${this.direction} !== ${direction}`);
      return false;
    }

    // Normalize entity by removing numeric IDs or UUIDs (to match 'videos' for 'videos/:id')
    const normalizedEntity = entityName.replace(/\/[^/]+$/, ''); // Removes the last segment if it's an ID
    console.log(`Normalized entity: ${normalizedEntity}`);
 
    if (this.entity !== normalizedEntity) {
      console.log(`Entity mismatch: ${this.entity} !== ${normalizedEntity}`);
      return false;
    }

    if (!this.conditions.length) {
      console.log(`No conditions, rule matches!`);
      return true;
    }

    const conditionsMatch = this._evaluateConditionArray(this.conditions, data);
    console.log(`Conditions match: ${conditionsMatch}`);
    return conditionsMatch;
  }



  /**
   * If main conditions fail, we check each elseIf in order.
   * If none match, we run elseActions if present.
   * 
   * @param {object} context - e.g. { data, actions, config... }
   * @param {object} data - The entity data
   */
  async execute(context, data) {
    //if data is null return
    if (data == null) {
      return;
    }
   
    if (this._evaluateConditionArray(this.conditions, data.data)) {
    
        await this._runActions(context, data.data, this.thenActions);
    } else {
        for (const elseIfBlock of this.elseIfs) {
            if (this._evaluateConditionArray(elseIfBlock.conditions, data.data)) {
                await this._runActions(context, data.data, elseIfBlock.actions);
                return; // Stop after first matching else-if
            }
        }
        if (this.elseActions.length > 0) {
            await this._runActions(context, data.data, this.elseActions);
        }
    }
  }

  /**
   * Evaluate an array-based condition AST, e.g.:
   * [
   *   { type: 'condition', field, op, value },
   *   'AND',
   *   [ ... nested conditions ... ],
   *   'OR',
   *   { type: 'condition', field, op, value }
   * ]
   */
  _evaluateConditionArray(conditionArray, data) {
    let result = null;
    let currentOp = null;
  
    for (const item of conditionArray) {
     
      if (typeof item === 'string') {
        // AND / OR
        currentOp = item.toUpperCase();
      } else if (Array.isArray(item)) {
        // Nested parentheses
        const nested = this._evaluateConditionArray(item, data);
        if (result === null) {
          result = nested;
        } else if (currentOp === 'AND') {
          result = result && nested;
        } else if (currentOp === 'OR') {
          result = result || nested;
        }
      } else if (typeof item === 'object' && item.type === 'condition') {
        const c = this._evaluateSingleCondition(item, data);
        if (result === null) {
          result = c;
        } else if (currentOp === 'AND') {
          result = result && c;
        } else if (currentOp === 'OR') {
          result = result || c;
        }
      }
    }
    return result === null ? true : !!result;
  }

  /**
   * Evaluate a single condition object: { field, op, value }
   * e.g. order.status = "paid", op='=', field='order.status', value='"paid"'
   */
  _evaluateSingleCondition(cond, data) {
 
    const { field, op, value } = cond;
    const actualValue = this._getNestedValue(data, field);
   
    // Strip quotes from the condition's value if it's a string
    const expectedValue = typeof value === 'string'
      ? value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
      : value;

    switch (op) {
      case '=':
        return actualValue == expectedValue;
      case '!=':
        return actualValue != expectedValue;
      case '>':
     
        return Number(actualValue) > Number(expectedValue);
      case '<':
        return Number(actualValue) < Number(expectedValue);
      case '>=':
        return Number(actualValue) >= Number(expectedValue);
      case '<=':
        return Number(actualValue) <= Number(expectedValue);
      case 'IS NULL':
        return actualValue == null;
      case 'IS NOT NULL':
        return actualValue != null;
      case 'CONTAINS':
        return String(actualValue || '').includes(expectedValue);
      case 'IN':
        // e.g. value might be [ "US", "CA" ]
        if (!Array.isArray(expectedValue)) return false;
        return expectedValue.includes(actualValue);
      default:
        console.warn(`Unknown operator '${op}' in condition`, cond);
        return false;
    }
  }

  /**
   * Execute an array of actions in sequence.
   * Merges rule-specific dbConfig into context.
   */
  async _runActions(context, data, actions) {
    const actionContext = {
      ...context,
      config: this.dbConfig || context.config || {},
      data
    };
    
    // const actionPromises  = [];

    for (const action of actions) {
      await this._executeAction(actionContext, action,data);
    }
    // parallel execution of actions;
    // await Promise.all(actionPromises);

    return this.response;
  }

  parseCommandString(commandString) {
    const splitIndex = commandString.indexOf('data:');
    if (splitIndex === -1) {
        throw new Error(`Invalid command string format: ${commandString}`);
    }

    // Extract command and data parts
    const commandPart = commandString.slice(0, splitIndex).trim(); // e.g., "rawQuery"
    const dataPart = commandString.slice(splitIndex + 5).trim(); // e.g., "{ ... }"

    let data;
    try {
        data = dataPart; // Parse the JSON string in the data part
    } catch (err) {
        throw new Error(`Failed to parse data as JSON: ${err.message}`);
    }

    return {
        type: commandPart, // The command name
        data: data,        // Parsed JSON object
    };
}


  /**
   * Looks for an action handler in:
   *   1) actionContext.actions (global or custom)
   *   2) fallback this.defaultActions
   * Then calls it if found.
   */
  async _executeAction(actionContext, action, data) {
    const req = getContext('req');
    const method = req.method.toUpperCase(); // "GET", "POST", etc.
    if (!data.user) {
      console.log("User missing in data, restoring from req.user", req.user);
      setContext('user', req.user);      
      data.user = req.user;
    }
 
 
    // Handle custom actions
    const customHandler = actionContext.actions[action.type];
    if (typeof customHandler === 'function') {
      let localData = null;
        if (action.data) {
          const template  = JSON.parse(action.data);
          localData = {};
          for (const key of Object.keys(template)) {
            // Pass only a single value to _interpolatePlaceholders
            localData[key] = this._interpolatePlaceholders(
              template[key],
              data
            );
          }
        }
        consolelog.log("JSON DATA========================>:", localData);
        await customHandler(actionContext, { entity: action.entity, data: localData });
        return; // Ensure only the custom action executes
    }

    // Handle specific action cases
    switch (action.action) {
      case 'update':
        if (action.expression && action.field) {
          try {
            consolelog.log("ExecuteActions ========================>:", action);
            consolelog.log("Data before update:", data);
            
            // Check if there's a custom update handler in the context
            if (typeof actionContext.actions.update === 'function' && 
                actionContext.actions.update.toString().includes('customUpdateAction')) {
                // Use the custom update handler directly
                actionContext.actions.update(actionContext, action);
                return; // Skip the rest of the processing
            }
            
            // Check if the expression contains a command marker
            const isCommand = /^\s*command:\s*(.+)/i.exec(action.expression);
            let computedValue;
 
             if (isCommand) {
                    const command = isCommand[1].trim();
                    consolelog.log(`Detected command: ${command}`);

                      // Split at the first occurrence of "data:"
                    const commandAction = this.parseCommandString(command);                            

                    console.log("Command Action:",commandAction);
                    // Execute the command action using executeAction
                    await this._executeAction(actionContext, commandAction, data);
                    console.log("Returned result:",actionContext.data.response);
                    // Assume the command stores its result in `data[commandAction.outputKey]`
                    computedValue = actionContext.data.response;
                  
                  try{
                    computedValue = JSON.parse(computedValue);
                  } catch (err) {
                    console.error(`Error parsing JSON:`, err.message);
                  }
                  // Parse computedValue to JSON if it's a string
                  let parsedValue = typeof computedValue === 'string' ? JSON.parse(computedValue) : computedValue;
              } else {
        
                      // Check if the expression contains any global functions
                    const globalFunctionNames = Object.keys(global);
                    const containsGlobalFunction = globalFunctionNames.some((fnName) =>
                      new RegExp(`\\b${fnName}\\b`).test(action.expression)
                    );

                    let interpolatedExpression;
                    if (containsGlobalFunction) {
                      // Do not stringify if global function is present
                      interpolatedExpression = this._interpolatePlaceholders(action.expression, data);
                    } else {
                      // Stringify the interpolated object otherwise
                      interpolatedExpression = JSON.stringify(this._interpolatePlaceholders(action.expression, data));
                    }
                  
                      consolelog.log("Interpolated Expression ========================>:", interpolatedExpression);
                  
                      // Dynamically evaluate the expression
                      // computedValue = new Function(
                      //   'data',
                      //   'globals',
                      //   `
                      //     with (data) {
                      //       with (globals) {
                      //         return ${interpolatedExpression};
                      //       }
                      //     }
                      //   `
                      // )(data, global);
                    computedValue = this._safeEvaluate(interpolatedExpression, data);
        
            }
              // Check if parsedValue is JSON and has a template property
            if (typeof parsedValue === 'object' && parsedValue !== null && parsedValue.hasOwnProperty(action.field)) {
                data[action.field] = parsedValue[action.field]; // Assign value from JSON template property
                console.log(`Updated1: ${action.field} = `,data[action.field]);
            } else {
              data[action.field] = computedValue; // Assign computedValue directly if not JSON or no template property
              console.log(`Updated2: ${action.field} = `,data[action.field]);
            }
            consolelog.log("Data after update:", data);
          } catch (err) {
            console.error(`Error updating field "${action.field}":`, err.message);
          }
        }
          break;
        case 'assign':
          if (action.field && action.expression) {
            try {
              // Same idea: interpolate locally, do not overwrite the original
              const expression = this._interpolatePlaceholders(action.expression, data);
              const computedValue =  new Function(
                'data',
                'globals',
                `
                  with (data) {
                    with (globals) {
                      return ${expression};
                    }
                  }
                `
              )(data, global);
              try{
                computedValue = JSON.parse(computedValue);
              } catch (err) {
                console.error(`Error parsing JSON:`, err.message);
              }
              // Check if computedValue is JSON and action.field is a key in it
              if (typeof computedValue === 'object' && computedValue !== null) {
                if (computedValue.hasOwnProperty(action.field)) {
                  data[action.field] = computedValue[action.field]; // Assign value from JSON
                } else {
                  data[action.field] = computedValue; // Assign the whole JSON if field not present
                }
              } else {
                data[action.field] = computedValue; // Assign computedValue directly if not JSON
              }
              console.log(`Assigned: ${action.field} = ${computedValue}`);
            } catch (err) {
              console.error(`Error assigning field "${action.field}":`, err.message);
            }
          }
            break;

        default:
            console.warn(`Unknown action type: ${action.action}`);
            break;
    }
}

// Add this new safe evaluation method to the Rule class:
_safeEvaluate(expression, context) {
  // Define a limited set of safe functions and operations
  const safeGlobals = {
    // Only expose specific global functions that are needed
    sha256: global.sha256,
    bcrypt: global.bcrypt,
    // Add other necessary global functions here, but be selective!
  };
  
  // Create a sandboxed environment with only the variables we want to expose
  const sandbox = {
    ...context,  // User data context
    ...safeGlobals, // Limited set of global functions
  };
  
  // Use vm module for safer evaluation
  const vm = require('vm');
  const script = new vm.Script(`result = ${expression}`);
  const vmContext = vm.createContext({ result: null, ...sandbox });
  
  try {
    script.runInContext(vmContext);
    return vmContext.result;
  } catch (error) {
    console.error(`Safe evaluation error: ${error.message}`);
    throw error;
  }
}
  /**
   * Utility to get nested values like "order.total" from data { order:{ total:123 }}
   */
  _getNestedValue(obj, path) {
    if (!path) return obj;
    const parts = path.split('.');
    let current = obj;
    for (const p of parts) {
      if (current == null) return null;
      if (!Object.prototype.hasOwnProperty.call(current, p)) return null;
      current = current[p];
    }
    return current;
  }

  _setNestedValue

  /**
   * (Optional) Interpolate placeholders like ${data.field} in a string.
   */
  _interpolatePlaceholders(obj, dataObj) {
    consolelog.log("Interpolating placeholders in:", obj, dataObj);
    // 1) If it's a string, do the placeholder replacement.
    if (typeof obj === 'string') {
      return obj.replace(/\${([^}]+)}/g, (match, inner) => {
        try {
          // Safely evaluate the placeholder expression in the context of dataObj
          const fn = new Function('data', `with(data) { return ${inner}; }`);
          const value = fn(dataObj);
          return value !== undefined && value !== null ? value : match;
        } catch (e) {
          console.warn(`Failed to resolve placeholder ${match}: ${e.message}`);
          return match; // Fallback if there's an error
        }
      });
    }
  
    // 2) If it's an array, map over its elements recursively.
    if (Array.isArray(obj)) {
      return obj.map(item => this._interpolatePlaceholders(item, dataObj));
    }
  
    // 3) If it's a non-null object, recursively interpolate each value.
    if (obj && typeof obj === 'object') {
      const newObj = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          newObj[key] = this._interpolatePlaceholders(obj[key], dataObj);
        }
      }
      consolelog.log("Interpolated NEW Object result:", newObj);
      return newObj;
    }
   consolelog.log("Interpolated result:", obj);
    // 4) If it's neither a string, array, nor object, just return as-is (e.g., number, boolean, null).
    return obj;
  }
}

class RuleEngine {
  /**
   * @param {Array<Rule>} rules
   * @param {object} globalContext
   */
  constructor(rules, globalContext) {
    this.rules = rules || [];
    this.globalContext = globalContext || {};
    this.response = { status: 200, message: 'Success', error: null };
  }

  getRules() {
    return this.rules;
  }

    /**
   * Reload the rules in the engine.
   * @param {Array} newRules - New set of rules to replace the current rules.
   */
    reloadRules(newRules) {
      consolelog.log('Reloading rules...');
      this.rules = newRules || [];
      this.response = { status: 200, message: 'Success', error: null };
      consolelog.log('Rules reloaded successfully.');
    }

  /**
   * Process an event (e.g. "NEW order" with some data).
   * We check each rule in turn.
   */
  async processEvent(eventType, entityName, data, context = {}) {
    // Extract direction from context if provided
    const direction = context.direction || null;
    
    const rsp = [];
    const combinedContext = {
      ...context,
      actions: {
        ...(this.globalContext.actions || {}),
        ...(context.actions || {})
      }
    };
  
    console.log(`Processing event: ${eventType} on entity: ${entityName}${direction ? ` (direction: ${direction})` : ''}`);
  
    // If data is an array, handle each record
    if (Array.isArray(data)) {
      // Sequentially handle each item in the array
      for (let i = 0; i < data.length; i++) {
        const record = data[i];
        consolelog.log(`Record #${i + 1}:`, record);
        await this._runMatchingRules(eventType, entityName, record, combinedContext, direction);
      }
    } else {
      // Single record
      await this._runMatchingRules(eventType, entityName, data, combinedContext, direction);
    }
    
    return this.response;
  }

  async _runMatchingRules(eventType, entityName, record, combinedContext, direction) {
    var buffer = "";
    var message = "";
    consolelog.log(`Checking rules for entity: ${entityName} with data:`, record); 
    for (const rule of this.rules) {
      if (rule.match(eventType, entityName, record, direction)) {
        consolelog.log(`Rule MATCHED, executing THEN actions:`, rule);        
        await rule.execute(combinedContext, { rule, data : record });        
        if (rule.response.status == 400){           
          this.response = rule.response;
          break;
        }
      }
      // elseIf blocks & elseActions are handled inside rule.execute()
      // if top-level conditions fail, rule.execute() checks elseIf & else
    }
    
  }

  /**
   * Quick helper to see if we have any rules for a given entity
   */
  hasRulesForEntity(entityName) {
    return this.rules.some((r) => r.entity === entityName);
  }

  /**
   * Create a RuleEngine from DSL text.
   * Matches the updated DSLParser which returns:
   *   { 
   *     event, 
   *     entity, 
   *     conditions, 
   *     thenActions, 
   *     elseIfs, 
   *     elseActions, 
   *     dbConfig
   *   }
   */
  static fromDSL(dslText, globalContext) {
    consolelog.log('Parsing rules from DSL text...');
    const parser = new DSLParser(globalContext); 
    const parsedRules = parser.parse(dslText);
    consolelog.log('Parsed rules:', parsedRules);
  
    // Convert parser objects into Rule instances
    const rules = parsedRules.map(ruleData => {
      return new Rule(
        ruleData.event,
        ruleData.resource,           // renamed 'resource' → 'entity'
        ruleData.conditions,
        ruleData.thenActions,      // parse returns thenActions
        ruleData.elseIfs,          // new
        ruleData.elseActions,
        ruleData.dbConfig,
        ruleData.direction         // Pass the direction if available
      );
    });
  
    consolelog.log(
      'Initialized rules:',
      rules.map((rule) => ({
        ruleType: rule.constructor.name,
        entity: rule.entity,
        event: rule.eventType,
        direction: rule.direction
      }))
    );
  
    return new RuleEngine(rules, globalContext);
  }
}

module.exports = RuleEngine;
