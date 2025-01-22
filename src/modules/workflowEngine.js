const consolelog = require('./logger');
const parseCommand = require('./parser');


class WorkflowDSLParser {
  constructor(globalContext = {}) {
    this.globalContext = globalContext;

    // Keywords specific to workflow DSL
    this.keywords = {
      WORKFLOW: 'WORKFLOW',
      UPDATE: 'UPDATE',
      WITH: 'WITH',
      DO: 'DO'    
    };
  }

  /**
   * Parse the DSL text for workflows.
   */
  parse(dslText) {
    // Clean the DSL by removing comments and empty lines
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

    return this._parseWorkflows(lines);
  }

  _containsWithClause(lines) {
    return lines.some((line) => line.toUpperCase().startsWith(this.keywords.WITH));
  }
  /**
   * Parse multiple workflows in the DSL script.
   */
  _parseWorkflows(lines) {
    const workflows = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.toUpperCase().startsWith(this.keywords.WORKFLOW)) {
        const workflowName = this._extractWorkflowName(line);
        const workflowLines = [];
        let j = i + 1;

        // Collect lines until the next WORKFLOW or end of file
        while (j < lines.length) {
          const nextLine = lines[j];
          if (nextLine.toUpperCase().startsWith(this.keywords.WORKFLOW)) {
            break;
          }
          workflowLines.push(nextLine);
          j++;
        }

        const workflow = this._parseSingleWorkflow(workflowName, workflowLines);
        workflows.push(workflow);

        i = j; // Move pointer to the next workflow
      } else {
        console.warn(`Skipping unrecognized line: ${line}`);
        i++;
      }
    }

    return workflows;
  }

  /**
   * Extract workflow name from the WORKFLOW line.
   */
  _extractWorkflowName(line) {
    const match = line.match(/^WORKFLOW\s+(\S+)/i);
    if (!match) {
      throw new Error(`Invalid WORKFLOW definition: ${line}`);
    }
    return match[1];
  }

  /**
   * Parse a single workflow block.
   */
  _parseSingleWorkflow(name, lines) {
    const workflow = { name, actions: [], dbConfig: null };

    for (const line of lines) {
      // Parse database configuration
      if (line.toUpperCase().startsWith(this.keywords.WITH)) {
        const dbConfig = this._parseDbConfig(line);
        workflow.dbConfig = dbConfig;
      } else {
        // Parse individual actions
        const action = this._parseActionLine(line);
        workflow.actions.push(action);
      }
    }

    return workflow;
  }

  /**
   * Parse a database configuration line.
   */
  _parseDbConfig(line) {
    const match = line.match(/WITH\s+(\S+)\s+(\S+)\s+DO/i);
    if (!match) {
      throw new Error(`Invalid WITH syntax: ${line}`);
    }
    return { dbType: match[1], dbConnection: match[2] };
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
      // Split the line into tokens: action type and arguments
      const tokens = line.split(/\s+/);
      if (tokens.length < 2) {
          throw new Error(`Invalid action line: ${line}`);
      }
      var data = {};
      const action = tokens[0];

      if( action === 'update' ) { 
          data = this._parseUpdateExpression(line);
      } else{
        if (!this.globalContext.actions[action]) {
            throw new Error(`Unknown action '${action}'. Please register in globalContext.actions.`);
        }       
          data = parseCommand(line);
      }
    
      return data;
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
  

  /**
   * Extract JSON payload from an action line.
   */
  _extractJson(line, keyword) {
    const jsonPart = line.replace(keyword, '').trim();
    try {
      return JSON.parse(jsonPart);
    } catch (error) {
      throw new Error(`Invalid JSON in action line: ${line}`);
    }
  }

}


class WorkflowEngine {
    constructor(parser, globalContext) {
        this.parser = new WorkflowDSLParser(globalContext);
        this.globalContext = globalContext;
        this.workflows = {};
    }

    loadWorkflows(dslText) {
        const workflowDefinitions = this.parser.parse(dslText);
        console.log('workflowDefinitions', workflowDefinitions);
        workflowDefinitions.forEach(wf => {
            this.workflows[wf.name] = wf.steps;
        });
    }

    async executeWorkflow(name, data, context = {}) {
        const workflow = this.workflows[name];
        if (!workflow) throw new Error(`Workflow ${name} not found.`);
        for (const step of workflow) {
            await this.globalContext.actions[step.action](context, step.params);
        }
    }
}

module.exports = { WorkflowDSLParser, WorkflowEngine };

