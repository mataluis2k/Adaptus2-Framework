class DatabaseService {
    static async createUser(data) {
        // Simulate database user creation
        console.log(`Creating user in DB: ${JSON.stringify(data)}`);
        return { id: 1, ...data };
    }
}

module.exports = DatabaseService;
