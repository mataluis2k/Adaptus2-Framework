const consolelog = require('./logger');
const parseCommand = require('./parser');
const { Worker } = require('worker_threads');
const path = require('path');
const db = require('./db');
const cron = require('node-cron');

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
        this.dbConfig = {
            dbType: 'mysql',
            dbConnection: 'MYSQL_1'
        };
    }

    loadWorkflows(dslText) {
        const workflowDefinitions = this.parser.parse(dslText);
        console.log('workflowDefinitions', workflowDefinitions);
        workflowDefinitions.forEach(wf => {
            this.workflows[wf.name] = wf;
        });
    }

    /**
     * Schedule a workflow to run
     * @param {string} workflowName - Name of the workflow to schedule
     * @param {Object} options - Scheduling options
     * @param {string} options.scheduleType - 'once' or 'recurring'
     * @param {string} options.cronExpression - Cron expression for recurring schedules
     * @param {Date} options.nextRun - Next run date/time
     * @param {Object} options.data - Data to pass to the workflow
     */
    async scheduleWorkflow(workflowName, options) {
        if (!this.workflows[workflowName]) {
            throw new Error(`Workflow ${workflowName} not found`);
        }

        const schedule = {
            workflow_name: workflowName,
            schedule_type: options.scheduleType,
            cron_expression: options.cronExpression,
            next_run: options.nextRun,
            data: JSON.stringify(options.data || {}),
            status: 'pending'
        };

        await db.create(this.dbConfig, 'workflow_schedules', schedule);
    }

    /**
     * Execute a workflow
     */
    async executeWorkflow(name, data = {}, context = {}) {
        const workflow = this.workflows[name];
        if (!workflow) throw new Error(`Workflow ${name} not found.`);

        // Create a new worker thread to execute the workflow
        return new Promise((resolve, reject) => {
            const worker = new Worker(path.join(__dirname, 'workflow_worker.js'), {
                workerData: {
                    workflow,
                    data,
                    context: {
                        ...context,
                        actions: this.globalContext.actions
                    }
                }
            });

            worker.on('message', (result) => {
                if (result.success) {
                    resolve(result);
                } else {
                    reject(new Error(result.error));
                }
            });

            worker.on('error', reject);
            worker.on('exit', (code) => {
                if (code !== 0) {
                    reject(new Error(`Worker stopped with exit code ${code}`));
                }
            });
        });
    }

    /**
     * Process pending workflows that are due to run
     */
    async processPendingWorkflows() {
        // Get pending workflows that are due
        const pendingWorkflows = await db.read(this.dbConfig, 'workflow_schedules', {
            status: 'pending',
            next_run: { '<=': new Date() }
        });

        for (const workflow of pendingWorkflows) {
            try {
                // Update status to running
                await db.update(this.dbConfig, 'workflow_schedules', 
                    { id: workflow.id },
                    { status: 'running' }
                );

                // Execute the workflow
                await this.executeWorkflow(
                    workflow.workflow_name,
                    JSON.parse(workflow.data || '{}')
                );

                // Update status based on schedule type
                if (workflow.schedule_type === 'once') {
                    await db.update(this.dbConfig, 'workflow_schedules',
                        { id: workflow.id },
                        { status: 'completed' }
                    );
                } else {
                    // For recurring workflows, calculate next run time based on cron expression
                    const nextRun = this._calculateNextRun(workflow.cron_expression);
                    await db.update(this.dbConfig, 'workflow_schedules',
                        { id: workflow.id },
                        { 
                            status: 'pending',
                            next_run: nextRun
                        }
                    );
                }
            } catch (error) {
                console.error(`Error executing workflow ${workflow.workflow_name}:`, error);
                await db.update(this.dbConfig, 'workflow_schedules',
                    { id: workflow.id },
                    { status: 'failed' }
                );
            }
        }
    }

    /**
     * Calculate next run time based on cron expression
     */
    _calculateNextRun(cronExpression) {
        if (!cronExpression) {
            // Default to 24 hours if no cron expression
            const nextRun = new Date();
            nextRun.setHours(nextRun.getHours() + 24);
            return nextRun;
        }

        try {
            return cron.schedule(cronExpression).nextDate().toDate();
        } catch (error) {
            console.error('Error parsing cron expression:', error);
            // Fallback to 24 hours
            const nextRun = new Date();
            nextRun.setHours(nextRun.getHours() + 24);
            return nextRun;
        }
    }
}

module.exports = { WorkflowDSLParser, WorkflowEngine };
