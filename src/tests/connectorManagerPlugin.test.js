const request = require('supertest');
const express = require('express');

const plugin = require('../../plugins/connectorManagerPlugin');

describe('connectorManagerPlugin', () => {
    let app;

    beforeAll(async () => {
        app = express();
        await plugin.initialize({ logger: console });
        plugin.registerRoutes({ app });
    });

    afterAll(async () => {
        await plugin.cleanup();
    });

    test('should create and retrieve connectors in memory', async () => {
        let res = await request(app).get('/connectors');
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBe(0);

        const payload = { name: 'TestConnector', type: 'rest' };
        res = await request(app).post('/connectors').send(payload);
        expect(res.statusCode).toBe(201);
        const created = res.body;
        expect(created.name).toBe('TestConnector');
        const id = created.id || created._id;

        res = await request(app).get(`/connectors/${id}`);
        expect(res.statusCode).toBe(200);
        expect(res.body.name).toBe('TestConnector');

        res = await request(app).put(`/connectors/${id}`).send({ type: 'soap' });
        expect(res.statusCode).toBe(200);
        expect(res.body.type).toBe('soap');

        res = await request(app).delete(`/connectors/${id}`);
        expect(res.statusCode).toBe(204);

        res = await request(app).get('/connectors');
        expect(res.body.length).toBe(0);
    });
});
