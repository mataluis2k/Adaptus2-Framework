// dslParser.js

/**
 * DSL Format:
 * IF <EVENT> <ENTITY> [WHEN <CONDITION EXPRESSION>] THEN
 *    <ACTION>
 *    <ACTION>
 * [ELSE
 *    <ACTION>]
 *
 * EVENT: NEW | UPDATE | DELETE
 * ENTITY: "order", "customer", "fulfillment", etc.
 * CONDITIONS: 
 *   <field> <operator> <value>, combined with AND/OR
 *   Operators: =, !=, >, <, >=, <=, IS NULL, IS NOT NULL, CONTAINS
 *
 * ACTIONS:
 *   send <entity> to action.<something>
 *   update <entity>.<field> = <value>
 *   log <message>
 *   notify <team>
 *   invoke <function>(args)
 *   ...
 */

class DSLParser {
    constructor() {
        this.keywords = {
            IF: 'IF',
            WHEN: 'WHEN',
            THEN: 'THEN',
            ELSE: 'ELSE',
            NEW: 'NEW',
            UPDATE: 'UPDATE',
            DELETE: 'DELETE'
        };
    }

      /**
     * Public method: parse multiple lines of DSL into a rule set.
     * @param {string} dslText - The entire DSL script as a string.
     * @returns {Array} An array of rule objects or an empty array if invalid.
     */
      parse(dslText) {
        // Remove comments and empty lines
        const lines = dslText
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0 && !l.startsWith('#')); // Remove empty and comment lines

        if (lines.length === 0) {
            console.warn('DSL file contains no valid rules after removing comments and empty lines.');
            return [];
        }

        try {
            return this._parseRules(lines);
        } catch (error) {
            console.error(`Error parsing DSL: ${error.message}`);
            return [];
        }
    }

    /**
     * Internal method: Parse multiple rules from given lines.
     */
    _parseRules(lines) {
        const rules = [];
        let currentRuleLines = [];

        // We assume each rule starts with IF and can contain multiple lines until another IF or EOF.
        for (const line of lines) {
            if (line.toUpperCase().startsWith(this.keywords.IF) && currentRuleLines.length > 0) {
                // Parse the previous rule
                rules.push(this._parseSingleRule(currentRuleLines));
                currentRuleLines = [];
            }
            currentRuleLines.push(line);
        }

        // Parse the last accumulated rule
        if (currentRuleLines.length > 0) {
            rules.push(this._parseSingleRule(currentRuleLines));
        }

        return rules;
    }

    /**
     * Internal method: Parse a single rule from a set of lines.
     */
    _parseSingleRule(lines) {
        // The first line should define the condition block: IF <EVENT> <ENTITY> [WHEN ...] THEN
        // Subsequent lines until ELSE or EOF are THEN actions, after ELSE are ELSE actions.
        const firstLine = lines[0];

        const { event, entity, conditions } = this._parseIfLine(firstLine);

        // Find THEN index and optionally ELSE index
        let thenIndex = -1;
        let elseIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toUpperCase().endsWith(this.keywords.THEN)) {
                thenIndex = i;
            }
            if (lines[i].toUpperCase().startsWith(this.keywords.ELSE)) {
                elseIndex = i;
            }
        }

        if (thenIndex === -1) {
            throw new Error("THEN keyword missing in rule: " + firstLine);
        }

        const thenActions = [];
        const elseActions = [];

        // Actions appear after the THEN line
        const startThen = thenIndex + 1;
        const endThen = elseIndex === -1 ? lines.length : elseIndex;
        for (let i = startThen; i < endThen; i++) {
            thenActions.push(this._parseActionLine(lines[i]));
        }

        if (elseIndex !== -1) {
            const startElse = elseIndex + 1;
            for (let i = startElse; i < lines.length; i++) {
                elseActions.push(this._parseActionLine(lines[i]));
            }
        }

        return {
            event,
            entity,
            conditions,
            then: thenActions,
            else: elseActions
        };
    }

    /**
     * Parse the IF line.
     * Example: "IF NEW order WHEN order.status = "paid" THEN"
     * We extract event: NEW, entity: order, conditions: [{field:'order.status',op:'=',value:'"paid"'}]
     */
    _parseIfLine(line) {
        // Break down by known keywords
        // Potential structure:
        // IF <EVENT> <ENTITY> [WHEN <CONDITIONS>] THEN
        const upperLine = line.toUpperCase();
        let [ifPart, ...rest] = line.split(' ');
        if (ifPart.toUpperCase() !== this.keywords.IF) {
            throw new Error("Rule must start with IF");
        }

        // Find WHEN and THEN
        const whenIndex = rest.map(r => r.toUpperCase()).indexOf(this.keywords.WHEN);
        const thenIndex = rest.map(r => r.toUpperCase()).indexOf(this.keywords.THEN);

        let event, entity, conditionString = "";

        if (whenIndex === -1) {
            // No WHEN clause
            event = rest[0];
            entity = rest[1];
        } else {
            event = rest[0];
            entity = rest[1];
            conditionString = rest.slice(whenIndex + 1, thenIndex).join(' ');
        }

        // Clean event and entity
        event = event.toUpperCase();
        // entity could be just "order" or "table:order"
        // For simplicity, store as-is
        const conditions = conditionString ? this._parseConditions(conditionString) : [];

        return { event, entity, conditions };
    }

    /**
     * Parse conditions from a condition string, e.g.:
     * "order.status = \"paid\" AND order.total > 100"
     * We'll split by AND/OR first and parse each condition.
     */
    _parseConditions(conditionString) {
        // This is a simplistic parser that assumes conditions are well-formed.
        // For a robust solution, consider a proper grammar.
        const logicalParts = this._splitByLogicalOperators(conditionString);
        const conditions = [];

        // Each part is either a single condition or the operator
        // We'll build a structure like [cond, 'AND', cond, 'OR', cond]
        // cond: {field, op, value}
        let currentCondition = null;
        let logicOp = null;

        for (const part of logicalParts) {
            if (part.toUpperCase() === 'AND' || part.toUpperCase() === 'OR') {
                logicOp = part.toUpperCase();
            } else {
                // Parse condition
                const cond = this._parseSingleCondition(part.trim());
                if (currentCondition == null) {
                    currentCondition = cond;
                } else {
                    // Multiple conditions chain as [currentCondition, op, nextCondition]
                    conditions.push(currentCondition);
                    conditions.push(logicOp);
                    currentCondition = cond;
                }
            }
        }

        if (currentCondition) {
            conditions.push(currentCondition);
        }

        return conditions;
    }

    _splitByLogicalOperators(conditionString) {
        // Splits condition string by 'AND' / 'OR' while keeping the operators.
        // A simple approach: replace AND/OR with a delimiter and then re-insert them.
        // Or use a regex split with capture groups.
        const tokens = conditionString.split(/\b(AND|OR)\b/i).map(t => t.trim()).filter(t => t.length > 0);
        return tokens;
    }

    _parseSingleCondition(condStr) {
        // Conditions can be:
        // field op value
        // e.g. order.status = "paid"
        // order.shipped_date IS NOT NULL
        // customer.email CONTAINS "gmail"

        // Handle IS NULL / IS NOT NULL first
        let match = condStr.match(/^(.+?)\s+(IS NOT NULL|IS NULL)$/i);
        if (match) {
            return { field: match[1].trim(), op: match[2].toUpperCase(), value: null };
        }

        // Handle operators like =, !=, >, <, >=, <=, CONTAINS
        match = condStr.match(/^(.+?)\s+(=|!=|>|<|>=|<=|CONTAINS)\s+(.*)$/i);
        if (match) {
            return { field: match[1].trim(), op: match[2].toUpperCase(), value: match[3].trim() };
        }

        throw new Error("Unable to parse condition: " + condStr);
    }

    /**
     * Parse action lines after THEN or ELSE.
     * Example: "send order to action.fulfillment"
     * Result: { type:'send', target:'order', to:'action.fulfillment' }
     */
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

// Example usage:

if (require.main === module) {
    const dslScript = `
IF NEW order WHEN order.status = "paid" THEN
    send order to action.fulfillment
    send order to action.email

IF UPDATE fulfillment WHEN fulfillment.shipped_date IS NOT NULL THEN
    send customer to action.email.tracking_info

IF UPDATE order WHEN order.status = "paid" AND order.total > 500 THEN
    update order.status = "premium"
    send order to action.notify.vip_team
ELSE
    send order to action.email.standard_confirmation

IF NEW customer WHEN customer.email CONTAINS "gmail" THEN
    update customer.segment = "gmail_offers"
`;

    const parser = new DSLParser();
    const rules = parser.parse(dslScript);

    console.log(JSON.stringify(rules, null, 2));
}

module.exports = DSLParser;
