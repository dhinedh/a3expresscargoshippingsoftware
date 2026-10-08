import { MongoClient, Db } from 'mongodb';
import dotenv from 'dotenv';
import dns from 'node:dns';

dotenv.config();

// Ensure Node's DNS resolver uses reliable public DNS for Atlas SRV record lookups
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Ignore if custom DNS cannot be set
}

const MONGODB_URL = process.env.MONGODB_URL ||
  "mongodb+srv://thenna44ck_db_user:2dWQ2jrV762IvKs6@cluster0.phdzsgq.mongodb.net/a3_express?retryWrites=true&w=majority&appName=Cluster0";

let client: MongoClient | null = null;
let mongoDb: Db | null = null;

export async function connectMongo(): Promise<Db | null> {
  if (mongoDb) return mongoDb;
  try {
    client = new MongoClient(MONGODB_URL, {
      serverSelectionTimeoutMS: 5000,
    });
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    mongoDb = client.db('a3_express');
    console.log('[MongoDB] Connected to MongoDB Atlas successfully!');
    return mongoDb;
  } catch (err) {
    console.warn('[MongoDB] Direct connection failed, trying with tlsAllowInvalidCertificates fallback...', err);
    try {
      client = new MongoClient(MONGODB_URL, {
        serverSelectionTimeoutMS: 10000,
        tlsAllowInvalidCertificates: true,
      });
      await client.connect();
      mongoDb = client.db('a3_express');
      console.log('[MongoDB] Connected to MongoDB Atlas via Fallback successfully!');
      return mongoDb;
    } catch (fallbackErr) {
      console.error('[MongoDB] Atlas connection failed:', fallbackErr);
      return null;
    }
  }
}

export function getMongoDb(): Db | null {
  return mongoDb;
}
