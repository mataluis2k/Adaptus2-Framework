const { v4: uuidv4 } = require("uuid");

class IHealthDataModule {
    constructor(globalContext, dbConfig) {
        this.globalContext = globalContext;
        this.dbConfig = dbConfig;
        this.registerActions();
    }

    registerActions() {
        this.globalContext.actions.create_ihealth_data = this.createIHealthData.bind(this);
        this.globalContext.actions.update_ihealth_data = this.updateIHealthData.bind(this);
        this.globalContext.actions.get_ihealth_data = this.getIHealthData.bind(this);
        this.globalContext.actions.list_ihealth_data = this.listIHealthData.bind(this);
    }

    /**
     * Action: Create IHealth Data
     */
    async createIHealthData(ctx, params) {
        const { userId, date, steps, heartRate, calories, sleepDuration, metadata = {} } = params;

        if (!userId || !date) {
            throw new Error("Missing required fields: userId or date.");
        }

        const connection = await this.dbConfig.getDbConnection(ctx.config.db);
        try {
            const id = uuidv4();

            const query = `
                INSERT INTO IHealthData (id, userId, date, steps, heartRate, calories, sleepDuration, metadata, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `;
            await connection.execute(query, [
                id,
                userId,
                date,
                steps || 0,
                heartRate || null,
                calories || 0,
                sleepDuration || 0,
                JSON.stringify(metadata),
            ]);

            return { success: true, id, message: "IHealth data created successfully." };
        } catch (error) {
            console.error("Error in createIHealthData:", error.message);
            throw new Error("Failed to create IHealth data.");
        } finally {
            connection.release();
        }
    }

    /**
     * Action: Update IHealth Data
     */
    async updateIHealthData(ctx, params) {
        const { id, steps, heartRate, calories, sleepDuration, metadata } = params;

        if (!id) {
            throw new Error("Missing required field: id.");
        }

        const connection = await this.dbConfig.getDbConnection(ctx.config.db);
        try {
            const fields = [];
            const values = [];
            if (steps !== undefined) fields.push("steps = ?"), values.push(steps);
            if (heartRate !== undefined) fields.push("heartRate = ?"), values.push(heartRate);
            if (calories !== undefined) fields.push("calories = ?"), values.push(calories);
            if (sleepDuration !== undefined) fields.push("sleepDuration = ?"), values.push(sleepDuration);
            if (metadata) fields.push("metadata = ?"), values.push(JSON.stringify(metadata));
            values.push(id);

            const query = `UPDATE IHealthData SET ${fields.join(", ")}, updatedAt = NOW() WHERE id = ?`;
            await connection.execute(query, values);

            return { success: true, message: "IHealth data updated successfully." };
        } catch (error) {
            console.error("Error in updateIHealthData:", error.message);
            throw new Error("Failed to update IHealth data.");
        } finally {
            connection.release();
        }
    }

    /**
     * Action: Get IHealth Data
     */
    async getIHealthData(ctx, params) {
        const { id } = params;

        if (!id) {
            throw new Error("Missing required field: id.");
        }

        const connection = await this.dbConfig.getDbConnection(ctx.config.db);
        try {
            const query = `SELECT * FROM IHealthData WHERE id = ?`;
            const [rows] = await connection.execute(query, [id]);

            return rows[0] || null;
        } catch (error) {
            console.error("Error in getIHealthData:", error.message);
            throw new Error("Failed to retrieve IHealth data.");
        } finally {
            connection.release();
        }
    }

    /**
     * Action: List IHealth Data
     */
    async listIHealthData(ctx, params) {
        const { userId, startDate, endDate, page = 1, pageSize = 10 } = params;

        if (!userId) {
            throw new Error("Missing required field: userId.");
        }

        const connection = await this.dbConfig.getDbConnection(ctx.config.db);
        try {
            const conditions = ["userId = ?"];
            const values = [userId];

            if (startDate) {
                conditions.push("date >= ?");
                values.push(startDate);
            }
            if (endDate) {
                conditions.push("date <= ?");
                values.push(endDate);
            }

            const offset = (page - 1) * pageSize;
            const query = `
                SELECT * FROM IHealthData
                WHERE ${conditions.join(" AND ")}
                ORDER BY date DESC
                LIMIT ? OFFSET ?
            `;
            values.push(pageSize, offset);

            const [rows] = await connection.execute(query, values);
            return rows;
        } catch (error) {
            console.error("Error in listIHealthData:", error.message);
            throw new Error("Failed to list IHealth data.");
        } finally {
            connection.release();
        }
    }
}

module.exports = IHealthDataModule;
