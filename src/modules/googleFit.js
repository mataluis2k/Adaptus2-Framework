const { v4: uuidv4 } = require("uuid");

class GoogleFitDataModule {
    constructor(globalContext, dbConfig) {
        this.globalContext = globalContext;
        this.dbConfig = dbConfig;
        this.registerActions();
    }

    registerActions() {
        this.globalContext.actions.create_google_fit_data = this.createGoogleFitData.bind(this);
        this.globalContext.actions.update_google_fit_data = this.updateGoogleFitData.bind(this);
        this.globalContext.actions.get_google_fit_data = this.getGoogleFitData.bind(this);
        this.globalContext.actions.list_google_fit_data = this.listGoogleFitData.bind(this);
    }

    /**
     * Action: Create Google Fit Data
     */
    async createGoogleFitData(ctx, params) {
        const {
            userId,
            date,
            steps,
            caloriesBurned,
            distance,
            heartRate,
            sleepDuration,
            metadata = {},
        } = params;

        if (!userId || !date) {
            throw new Error("Missing required fields: userId or date.");
        }

        const connection = await this.dbConfig.getDbConnection(ctx.config.db);
        try {
            const id = uuidv4();

            const query = `
                INSERT INTO GoogleFitData (id, userId, date, steps, caloriesBurned, distance, heartRate, sleepDuration, metadata, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
            `;
            await connection.execute(query, [
                id,
                userId,
                date,
                steps || 0,
                caloriesBurned || 0,
                distance || 0, // Distance in meters
                heartRate || null,
                sleepDuration || 0,
                JSON.stringify(metadata),
            ]);

            return { success: true, id, message: "Google Fit data created successfully." };
        } catch (error) {
            console.error("Error in createGoogleFitData:", error.message);
            throw new Error("Failed to create Google Fit data.");
        } finally {
            connection.release();
        }
    }

    /**
     * Action: Update Google Fit Data
     */
    async updateGoogleFitData(ctx, params) {
        const { id, steps, caloriesBurned, distance, heartRate, sleepDuration, metadata } = params;

        if (!id) {
            throw new Error("Missing required field: id.");
        }

        const connection = await this.dbConfig.getDbConnection(ctx.config.db);
        try {
            const fields = [];
            const values = [];
            if (steps !== undefined) fields.push("steps = ?"), values.push(steps);
            if (caloriesBurned !== undefined) fields.push("caloriesBurned = ?"), values.push(caloriesBurned);
            if (distance !== undefined) fields.push("distance = ?"), values.push(distance);
            if (heartRate !== undefined) fields.push("heartRate = ?"), values.push(heartRate);
            if (sleepDuration !== undefined) fields.push("sleepDuration = ?"), values.push(sleepDuration);
            if (metadata) fields.push("metadata = ?"), values.push(JSON.stringify(metadata));
            values.push(id);

            const query = `UPDATE GoogleFitData SET ${fields.join(", ")}, updatedAt = NOW() WHERE id = ?`;
            await connection.execute(query, values);

            return { success: true, message: "Google Fit data updated successfully." };
        } catch (error) {
            console.error("Error in updateGoogleFitData:", error.message);
            throw new Error("Failed to update Google Fit data.");
        } finally {
            connection.release();
        }
    }

    /**
     * Action: Get Google Fit Data
     */
    async getGoogleFitData(ctx, params) {
        const { id } = params;

        if (!id) {
            throw new Error("Missing required field: id.");
        }

        const connection = await this.dbConfig.getDbConnection(ctx.config.db);
        try {
            const query = `SELECT * FROM GoogleFitData WHERE id = ?`;
            const [rows] = await connection.execute(query, [id]);

            return rows[0] || null;
        } catch (error) {
            console.error("Error in getGoogleFitData:", error.message);
            throw new Error("Failed to retrieve Google Fit data.");
        } finally {
            connection.release();
        }
    }

    /**
     * Action: List Google Fit Data
     */
    async listGoogleFitData(ctx, params) {
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
                SELECT * FROM GoogleFitData
                WHERE ${conditions.join(" AND ")}
                ORDER BY date DESC
                LIMIT ? OFFSET ?
            `;
            values.push(pageSize, offset);

            const [rows] = await connection.execute(query, values);
            return rows;
        } catch (error) {
            console.error("Error in listGoogleFitData:", error.message);
            throw new Error("Failed to list Google Fit data.");
        } finally {
            connection.release();
        }
    }
}

module.exports = GoogleFitDataModule;
