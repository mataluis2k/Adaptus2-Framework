const ollama = require('ollama');

class SnowflakeAuditModule {
    constructor(globalContext, dbConfig) {
        this.globalContext = globalContext;
        this.dbConfig = dbConfig;
        this.registerActions();
    }

    registerActions() {
        this.globalContext.actions.analyze_page_changes = this.analyzePageChanges.bind(this);
    }

    async analyzePageChanges(ctx, params) {
        const connection = await this.dbConfig.getDbConnection(ctx.config.db);
        try {
            // Define yesterday's date dynamically
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const formattedDate = yesterday.toISOString().split('T')[0];

            const query = `
                SELECT 
                a.created_at, 
                rr.slug, 
                a.old_values, 
                a.new_values,  
                pr.weight, 
                tt.display_count,
                (tt.conversion_count * 1.0) / tt.display_count AS CVR,
                a.auditable_id
            FROM FIVETRAN_DATABASE.LE_PROD_PUBLIC.AUDITS a
            JOIN FIVETRAN_DATABASE.LE_PROD_PUBLIC.PAGE_ROUTES pr 
                ON a.auditable_id = pr.page_id
            JOIN FIVETRAN_DATABASE.LE_PROD_PUBLIC.ROUTES rr 
                ON pr.route_id = rr.id
            JOIN FIVETRAN_DATABASE.LE_PROD_PUBLIC.SPLIT_TEST_TALLIES tt 
                ON pr.page_id = tt.page_id
            WHERE a.auditable_type = 'pages'
            AND (
                DATE(a.created_at) = CURRENT_DATE 
                OR DATE(a.updated_at) = CURRENT_DATE
                )
            AND pr.weight > 0 
            AND tt.display_count > 0
            ORDER BY tt.display_count DESC`;

            const [rows] = await connection.execute(query, [formattedDate]);

            for (const row of rows) {
                if (row.old_values && row.new_values) {
                    const reviewResult = await this.reviewChangesWithLLM(row.old_values, row.new_values);
                    if (reviewResult.includes("potential issue") || reviewResult.includes("user experience might break")) {
                        await this.notifyUser(ctx, row.slug, reviewResult);
                    }
                }
            }

            return { success: true, analyzed: rows.length };
        } catch (error) {
            console.error("Error in analyzePageChanges:", error);
            throw new Error("Failed to analyze page changes.");
        } finally {
            connection.release();
        }
    }

    async reviewChangesWithLLM(oldValues, newValues) {
        const prompt = `You are an expert in UI/UX and code quality analysis. Given the following JSON changes, determine if the modifications could negatively impact user experience. Respond with a direct assessment of potential issues. \n\nOld Values: ${JSON.stringify(oldValues, null, 2)}\nNew Values: ${JSON.stringify(newValues, null, 2)}`;
        
        try {
            const response = await ollama.chat({ model: 'codellama', messages: [{ role: 'user', content: prompt }] });
            return response.message.content;
        } catch (error) {
            console.error("Error in LLM review:", error);
            return "Error analyzing changes.";
        }
    }

    async notifyUser(ctx, slug, message) {
        console.warn(`Potential UX issue detected for ${slug}: ${message}`);
        
        if (this.globalContext.actions.sendNotification) {
            await this.globalContext.actions.sendNotification(ctx, {
                title: "User Experience Alert",
                message: `Potential issue found in ${slug}: ${message}`,
                level: "warning",
            });
        }
    }
}

module.exports = SnowflakeAuditModule;
