import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectMongo } from './db/mongo.js';
import { tariffRouter } from './routes/tariff.js';
import { itemsRouter } from './routes/items.js';
import { customersRouter } from './routes/customers.js';
import { vendorsRouter } from './routes/vendors.js';
import { shipmentsRouter } from './routes/shipments.js';
import { requirementsRouter } from './routes/requirements.js';
import { allocationsRouter } from './routes/allocations.js';
import { traceabilityRouter } from './routes/traceability.js';
import { documentsRouter } from './routes/documents.js';

import { ingestRouter } from './routes/ingest.js';
import { exportRouter } from './routes/export.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['*'],
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ONLINE',
    service: 'A3 Express Logistics & Customs Tariff Digitizer API',
    version: '2.0.0 (Node.js Express + TypeScript)',
    timestamp: new Date().toISOString(),
  });
});

// Mount Routes matching frontend API_BASE: /api/v1/...
app.use('/api/v1/tariff', tariffRouter);
app.use('/api/v1/items', itemsRouter);
app.use('/api/v1/customers', customersRouter);
app.use('/api/v1/vendors', vendorsRouter);
app.use('/api/v1/shipments', shipmentsRouter);
app.use('/api/v1/shipments', requirementsRouter);
app.use('/api/v1/shipments', allocationsRouter);
app.use('/api/v1/ingest', ingestRouter);
app.use('/api/v1/export', exportRouter);
app.use('/api/v1', traceabilityRouter);
app.use('/api/v1', documentsRouter);

// Start server
app.listen(PORT, async () => {
  console.log(`====================================================`);
  console.log(`🚀 A3 Cargo Node.js API Server running on port ${PORT}`);
  console.log(`📍 Local API URL: http://localhost:${PORT}`);
  console.log(`====================================================`);

  // Connect to MongoDB Atlas in background
  connectMongo().catch((err) => {
    console.warn('[MongoDB Atlas Notice] Running in local SQLite mode:', err.message);
  });
});
