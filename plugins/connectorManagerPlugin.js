const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');

module.exports = {
    name: 'connectorManagerPlugin',
    version: '0.1.0',
    async initialize(dependencies) {
        this.logger = dependencies.logger || console;
        this.inMemory = [];
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/adaptus2';
        try {
            this.mongoClient = new MongoClient(uri);
            await this.mongoClient.connect();
            this.collection = this.mongoClient.db().collection('connectors');
            this.logger.log('ConnectorManagerPlugin connected to MongoDB');
        } catch (err) {
            this.logger.warn(`ConnectorManagerPlugin using in-memory store: ${err.message}`);
            this.collection = null;
        }
    },
    registerRoutes({ app }) {
        const router = express.Router();
        router.use(express.json());

        const getAll = async () => this.collection ? await this.collection.find().toArray() : this.inMemory;
        const create = async (data) => {
            if (this.collection) {
                const res = await this.collection.insertOne(data);
                return { _id: res.insertedId, ...data };
            } else {
                const id = Date.now().toString();
                const conn = { id, ...data };
                this.inMemory.push(conn);
                return conn;
            }
        };
        const getById = async (id) => {
            if (this.collection) {
                return await this.collection.findOne({ _id: new ObjectId(id) });
            }
            return this.inMemory.find(c => c.id === id);
        };
        const update = async (id, data) => {
            if (this.collection) {
                await this.collection.updateOne({ _id: new ObjectId(id) }, { $set: data });
                return getById(id);
            }
            const idx = this.inMemory.findIndex(c => c.id === id);
            if (idx === -1) return null;
            this.inMemory[idx] = { ...this.inMemory[idx], ...data };
            return this.inMemory[idx];
        };
        const remove = async (id) => {
            if (this.collection) {
                await this.collection.deleteOne({ _id: new ObjectId(id) });
            } else {
                this.inMemory = this.inMemory.filter(c => c.id !== id);
            }
        };

        router.get('/', async (req, res) => {
            res.json(await getAll());
        });

        router.post('/', async (req, res) => {
            const conn = await create(req.body);
            res.status(201).json(conn);
        });

        router.get('/:id', async (req, res) => {
            const conn = await getById(req.params.id);
            if (!conn) return res.status(404).send('Not found');
            res.json(conn);
        });

        router.put('/:id', async (req, res) => {
            const conn = await update(req.params.id, req.body);
            if (!conn) return res.status(404).send('Not found');
            res.json(conn);
        });

        router.delete('/:id', async (req, res) => {
            await remove(req.params.id);
            res.status(204).send();
        });

        app.use('/connectors', router);
        this.routes = [
            { method: 'get', path: '/connectors' },
            { method: 'post', path: '/connectors' },
            { method: 'get', path: '/connectors/:id' },
            { method: 'put', path: '/connectors/:id' },
            { method: 'delete', path: '/connectors/:id' }
        ];
        return this.routes;
    },
    async cleanup() {
        if (this.mongoClient) {
            await this.mongoClient.close();
        }
    }
};
