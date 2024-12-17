'use strict';
const consolelog = require('./logger');
/**
 * @fileoverview A production-ready DSL interpreter for business rules.
 * It compiles DSL rules and executes them in real-time as events occur.
 *
 * DSL Format:
 * IF <EVENT> <ENTITY> [WHEN <CONDITION EXPRESSION>] THEN
 *    <ACTION>
 *    <ACTION>
 * [ELSE
 *    <ACTION>]
 *
 * EVENT: NEW | UPDATE | DELETE
 * ENTITY: e.g. "order", "customer"
 * CONDITIONS: <field> <op> <value>, combined with AND/OR
 * ACTIONS: e.g. send, update, notify, log, invoke...
 *
 * Example:
 * IF NEW order WHEN order.status = "paid" THEN
 *    send order to action.fulfillment
 *    send order to action.email
 */

class Rule {
    /**
     * @param {string} eventType - "NEW", "UPDATE", or "DELETE".
     * @param {string} entity - The entity name like "order" or "table:order".
     * @param {Array} conditions - Array representing parsed conditions, e.g. [{field, op, value}, 'AND', {field, op, value}]
     * @param {Array} thenActions - Array of actions to execute if conditions match.
     * @param {Array} elseActions - Array of actions if conditions do not match.
     */
    constructor(eventType, entity, conditions, thenActions, elseActions) {
        this.eventType = eventType;
        this.entity = entity;
        this.conditions = conditions || [];
        this.thenActions = thenActions || [];
        this.elseActions = elseActions || [];
        this.defaultActions = {
            update: (context, entity, field, value) => {
                consolelog.log(`Updating ${entity}.${field} to: ${value}`);
                if (context && context.data) {
                    context.data[field] = value;
                }
            },
            send: (context, entity, destination) => {
                consolelog.log(`Sending ${entity} to ${destination}`);
            },
            log: (context, message) => {
                consolelog.log(`Rule Log: ${message}`);
            },
            notify: (context, target) => {
                consolelog.log(`Notifying target: ${target}`);
            },
            invoke: (context, functionName, args) => {
                consolelog.log(`Invoking function: ${functionName} with args:`, args);
            },
            unknown: (context, action) => {
                console.warn(`Unknown action encountered: ${JSON.stringify(action)}`);
            },
        };
    }
    

    /**
     * Determine if this rule matches the given event and data.
     * @param {string} eventType
     * @param {string} entityName
     * @param {object} data
     * @returns {boolean}
     */
    match(eventType, entityName, data) {
        consolelog.log(`Checking rule match for event: ${eventType} on entity: ${entityName} this event type: ${this.eventType} this entity: ${this.entity}`);
        if (this.eventType !== eventType) return false;
        consolelog.log(`Event type matched: ${eventType}`);
        const ruleEntityName = this.entity.includes(':') ? this.entity.split(':')[1] : this.entity;
        if (ruleEntityName !== entityName) return false;
        consolelog.log(`Entity name matched: ${entityName}`);
        if (!this.conditions || this.conditions.length === 0) {
            // No conditions means always match
            return true;
        }
        consolelog.log(`Evaluating conditions...`);
        // Evaluate conditions with AND/OR logic
        let result = null;
        let currentOp = null;
        consolelog.log(`Conditions:`, this.conditions);
        for (const cond of this.conditions) {
            consolelog.log(`Evaluating condition:`, cond);
            if (typeof cond === 'string') {               
                currentOp = cond; // 'AND' or 'OR'
            } else {
                const c = this._evaluateCondition(cond, data);
                if (result === null) {
                    result = c;
                } else if (currentOp === 'AND') {
                    result = result && c;
                } else if (currentOp === 'OR') {
                    result = result || c;
                }
            }
        }
        consolelog.log(`Conditions evaluated: ${result}`);
        return !!result;
    }

    /**
     * Execute the rule's actions if matched or else-actions if not matched.
     * @param {object} context - Additional context (e.g. services, db connections).
     * @param {object} data - The entity data triggering the rule.
     * @param {boolean} matched - true if conditions matched, false otherwise.
     */
    execute(context, data, matched) {
        const actionsToRun = matched ? this.thenActions : this.elseActions;
        for (const action of actionsToRun) {
            this._executeAction(context, data, action);
        }
    }

    _evaluateCondition(cond, data) {
        const { field, op, value } = cond;
        const fieldValue = this._resolveFieldValue(data, field);

        const cleanedValue = this._stripQuotes(value);
        consolelog.log(`Evaluating condition: ${field} ${op} ${cleanedValue} with value: ${fieldValue}`);
        switch (op) {
            case '=': return fieldValue == cleanedValue;
            case '!=': return fieldValue != cleanedValue;
            case '>': return Number(fieldValue) > Number(cleanedValue);
            case '<': return Number(fieldValue) < Number(cleanedValue);
            case '>=': return Number(fieldValue) >= Number(cleanedValue);
            case '<=': return Number(fieldValue) <= Number(cleanedValue);
            case 'IS NULL': return fieldValue == null;
            case 'IS NOT NULL': return fieldValue != null;
            case 'CONTAINS': return (fieldValue + '').includes(cleanedValue);
            default:
                console.warn(`Unknown operator: ${op} in condition ${JSON.stringify(cond)}`);
                return false;
        }
    }

    _stripQuotes(val) {
        if (!val) return val;
        return val.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }

    _resolveFieldValue(data, fieldPath) {
        // Supports nested fields: e.g. "order.customer.email"
        consolelog.log(`Resolving field value for: ${fieldPath}`);
        consolelog.log(`Data:`, data);
        const parts = fieldPath.split('.');
        let current = data;
        for (const p of parts) {
            if (current == null) return null;
            if (!Object.prototype.hasOwnProperty.call(current, p)) return null;
            current = current[p];
        }
        return current;
    }

    _executeAction(context, data, action) {
        // Dispatch action to a handler function
        try {
            consolelog.log(`Executing action:`, action);
            switch (action.action) {
                case 'delete':
                    context.actions.delete(context, action.entity, action.query);
                    break;
                case 'create':
                    context.actions.create(context, action.entity, action.data);
                    break;
                case 'read':
                    context.actions.read(context, action.entity, action.query);
                    break;
                case 'update':
                        // Handle dynamic value assignment (virtual column)
                        const targetField = action.field || action.entity; // Fallback to entity if field is not provided
                        if (targetField && action.value) {
                            try {
                                const computedValue = new Function('data', `
                                    with(data) { return ${action.value}; }
                                `)(data);
                                data[targetField] = computedValue; // Assign computed value to new/existing field
                                consolelog.log(`Assigned ${targetField} = ${computedValue}`);
                            } catch (err) {
                                console.error(`Error evaluating expression for field "${targetField}": ${err.message}`);
                            }
                        }
                        break;
                case 'assign':
                    // Handle dynamic value assignment for the specified field
                    if (action.field && action.value) {
                        try {
                            const computedValue = new Function('data', `
                                with(data) { return ${action.value}; }
                            `)(data);
                            data[action.field] = computedValue; // Assign computed value to the specified field
                            consolelog.log(`Assigned: ${action.field} = ${data[action.field]}`);
                        } catch (err) {
                            console.error(`Error evaluating expression for field "${action.field}": ${err.message}`);
                        }
                    }
                    break;
                case 'send':
                    context.actions.send(context, action.entity, action.destination);
                    break;
                case 'notify':
                    context.actions.notify(context, action.target);
                    break;
                case 'log':
                    context.actions.log(context, action.message);
                    break;
                case 'invoke':
                    context.actions.invoke(context, action.functionName, action.arguments);
                    break;
                default:
                    context.actions.unknown(context, action.line);
                    break;
            }
        } catch (err) {
            console.error(`Error executing action ${JSON.stringify(action)}: ${err.message}`);
        }
    }
}

class RuleEngine {
    /**
     * @param {Array<Rule>} rules
     */
    constructor(rules) {
        this.rules = rules || [];
    }

    /**
     * Process an event in real-time:
     * @param {string} eventType - "NEW", "UPDATE", "DELETE"
     * @param {string} entityName - entity name e.g. "order"
     * @param {object} data - the data object representing the entity
     * @param {object} context - {actions: {update,send,notify,log,invoke,unknown}, ...}
     */
    processEvent(eventType, entityName, data, context) {
        if (!context || !context.actions) {
            const context = { data, actions: this.defaultActions };
        }
    
        consolelog.log(`Processing event: ${eventType} on entity: ${entityName}`);
        
        // Check if data is an array (e.g., GET with multiple records)
        if (Array.isArray(data)) {
            consolelog.log(`Processing multiple records (${data.length})...`);
            
            data.forEach((record, index) => {
                consolelog.log(`Processing record ${index + 1}:`, record);
                for (const rule of this.rules) {
                    const matched = rule.match(eventType, entityName, record);
                    if (matched) {
                        consolelog.log(`Rule Matched for record ${index + 1}:`, rule);
                        rule.execute(context, record, true);
                    } else if (rule.elseActions && rule.elseActions.length > 0) {
                        consolelog.log(`Rule Did Not Match for record ${index + 1}: Executing ELSE actions`, rule);
                        rule.execute(context, record, false);
                    }
                }
            });
        } else {
            // Single data object (e.g., POST, PUT, DELETE)
            consolelog.log(`Processing single record...`);
            for (const rule of this.rules) {
                const matched = rule.match(eventType, entityName, data);
                if (matched) {
                    consolelog.log(`Rule Matched:`, rule);
                    rule.execute(context, data, true);
                } else if (rule.elseActions && rule.elseActions.length > 0) {
                    consolelog.log(`Rule Did Not Match: Executing ELSE actions`, rule);
                    rule.execute(context, data, false);
                }
            }
        }
    }
    

    /**
     * Create a RuleEngine from a DSL script.
     * @param {string} dslText
     * @param {object} options - future use for custom logging, etc.
     * @returns {RuleEngine}
     */
    
    static fromDSL(dslText) {
        consolelog.log('Parsing rules from DSL text...');
        DSLParser = require('./dslparser');
        const parser = new DSLParser();
        const parsedRules = parser.parse(dslText);

        // Ensure all parsed rules are instances of Rule
        const rules = parsedRules.map(ruleData => new Rule(
            ruleData.event,
            ruleData.entity,
            ruleData.conditions,
            ruleData.then,
            ruleData.else
        ));
       
        consolelog.log('Initialized rules:', rules.map( rule => ({
            type: rule.constructor.name,
            details: rule
        }))); 
        return new RuleEngine(rules);
    }
}

class DSLParser {
    constructor(options={}) {
        this.options = options;
        this.keywords = {
            IF: 'IF',
            WHEN: 'WHEN',
            THEN: 'THEN',
            ELSE: 'ELSE'
        };
    }

    /**
     * Parse the DSL and compile into Rule objects.
     * @param {string} dslText
     * @returns {Array<Rule>}
     */
    parseAndCompile(dslText) {
        if (typeof dslText !== 'string') {
            throw new Error("DSL input must be a string");
        }

        const lines = dslText
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.length > 0); // Ignore empty lines

        // Skip comments and locate the first valid rule
        const validLines = [];
        let hasFoundRule = false;

        for (const line of lines) {
            if (line.startsWith('#') && !hasFoundRule) {
                // Ignore comments before any rules
                continue;
            }
            if (line.toUpperCase().startsWith('IF')) {
                hasFoundRule = true;
            }
            validLines.push(line);
        }

        if (validLines.length === 0) {
            return []; // No rules found
        }
        consolelog.log('Valid lines:', validLines);
        const ruleBlocks = this._extractRuleBlocks(validLines);
        return ruleBlocks.map((block) => this._parseSingleRule(block));
    }

    _extractRuleBlocks(lines) {
        const blocks = [];
        let currentBlock = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.toUpperCase().startsWith('IF') && currentBlock.length > 0) {
                blocks.push(currentBlock);
                currentBlock = [];
            }
            currentBlock.push(line);
        }

        if (currentBlock.length > 0) {
            blocks.push(currentBlock);
        }

        return blocks;
    }

    _parseSingleRule(lines) {
        const firstLine = lines[0];
        const { eventType, entity, conditions } = this._parseIfLine(firstLine);

        let thenIndex = -1;
        let elseIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            const upper = lines[i].toUpperCase();
            if (upper.endsWith('THEN')) thenIndex = i;
            if (upper.startsWith('ELSE')) elseIndex = i;
        }

        if (thenIndex === -1) {
            throw new Error(`THEN keyword missing in rule starting with: ${firstLine}`);
        }

        const thenActions = this._parseActions(lines.slice(thenIndex + 1, elseIndex === -1 ? lines.length : elseIndex));
        const elseActions = elseIndex !== -1 ? this._parseActions(lines.slice(elseIndex + 1)) : [];

        return new Rule(eventType, entity, conditions, thenActions, elseActions);
    }

    _parseIfLine(line) {
        const parts = line.split(/\s+/);
        if (parts[0].toUpperCase() !== 'IF') {
            throw new Error(`Rule must start with IF: ${line}`);
        }

        const eventType = parts[1].toUpperCase();
        const entity = parts[2];
        const rest = parts.slice(3).join(' ');

        // Validate event type
        if (!['NEW', 'UPDATE', 'DELETE'].includes(eventType)) {
            throw new Error(`Invalid event type: ${eventType} in line: ${line}`);
        }

        let conditions = [];
        const whenPos = rest.toUpperCase().indexOf('WHEN ');
        const thenPos = rest.toUpperCase().indexOf('THEN');

        if (whenPos !== -1) {
            if (thenPos === -1) {
                throw new Error(`WHEN found but THEN not found in: ${line}`);
            }
            const conditionString = rest.substring(whenPos + 5, thenPos).trim();
            conditions = this._parseConditions(conditionString);
        }

        return { eventType, entity, conditions };
    }

    _parseConditions(conditionString) {
        if (!conditionString) return [];
        const tokens = conditionString.split(/\b(AND|OR)\b/i)
            .map(t => t.trim())
            .filter(t => t.length > 0);

        const conditions = [];
        for (const token of tokens) {
            if (['AND', 'OR'].includes(token.toUpperCase())) {
                conditions.push(token.toUpperCase());
            } else {
                conditions.push(this._parseSingleCondition(token));
            }
        }
        return conditions;
    }

    _parseSingleCondition(condStr) {
        let match = condStr.match(/^(.+?)\s+(IS NOT NULL|IS NULL)$/i);
        if (match) {
            return { field: match[1].trim(), op: match[2].toUpperCase(), value: null };
        }

        match = condStr.match(/^(.+?)\s+(=|!=|>|<|>=|<=|CONTAINS)\s+(.*)$/i);
        if (match) {
            return { field: match[1].trim(), op: match[2].toUpperCase(), value: match[3].trim() };
        }

        throw new Error(`Unable to parse condition: "${condStr}"`);
    }

    _parseActions(actionLines) {
        return actionLines.map(line => this._parseActionLine(line));
    }

    _parseActionLine(line) {
        let match;
    
        // Create
        match = line.match(/^create\s+([^\s]+)\s+with\s+(.+)$/i);
        if (match) {
            return { action: 'create', entity: match[1], data: JSON.parse(match[2]) };
        }
    
        // Read
        match = line.match(/^read\s+([^\s]+)\s+where\s+(.+)$/i);
        if (match) {
            return { action: 'read', entity: match[1], query: JSON.parse(match[2]) };
        }
    
        // Update with WHERE clause
        match = line.match(/^update\s+([^\s]+)\s+where\s+(.+)\s+set\s+(.+)$/i);
        if (match) {
            return { action: 'update', entity: match[1], query: JSON.parse(match[2]), data: JSON.parse(match[3]) };
        }
    
        // Delete
        match = line.match(/^delete\s+([^\s]+)\s+where\s+(.+)$/i);
        if (match) {
            return { action: 'delete', entity: match[1], query: JSON.parse(match[2]) };
        }
    
            // Update entity = value (NEW REGEX - THIS IS THE KEY FIX)
        match = line.match(/^update\s+([^\s]+)\s*=\s*(.+)$/i);
        if (match) {
            return { action: 'update', entity: match[1], value: match[2] };
        }

        // Update entity.field = value (This is still needed for field updates)
        match = line.match(/^update\s+([^.]+)\.([^\s]+)\s*=\s*(.+)$/i);
        if (match) {
            return { action: 'update', entity: match[1], field: match[2], value: match[3] };
        }
        
    
        // Send
        match = line.match(/^send\s+([^\s]+)\s+to\s+(action\..+)$/i);
        if (match) {
            return { action: 'send', entity: match[1], destination: match[2] };
        }
    
        // Notify
        match = line.match(/^notify\s+(.+)$/i);
        if (match) {
            return { action: 'notify', target: match[1] };
        }
    
        // Log
        match = line.match(/^log\s+(.+)$/i);
        if (match) {
            return { action: 'log', message: match[1] };
        }
    
        // Invoke function
        match = line.match(/^invoke\s+([^(]+)\((.*)\)$/i);
        if (match) {
            return {
                action: 'invoke',
                functionName: match[1].trim(),
                arguments: match[2].split(',').map((a) => a.trim()),
            };
        }

        // Simple assignment: discount = price * 0.1
        match = line.match(/^(\w+)\s*=\s*(.+)$/i);
        if (match) {
            return { action: 'assign', field: match[1], value: match[2] };
        }
    
        // Unknown action
        return { action: 'unknown', line };
    }
}

module.exports = RuleEngine;
