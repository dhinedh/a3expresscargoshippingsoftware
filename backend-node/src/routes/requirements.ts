import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { db } from '../db/sqlite.js';
import { formatSubHsn } from './shipments.js';
import { recalculateShipment } from '../services/calculationEngine.js';

export const requirementsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

// GET /api/v1/shipments/:id/requirements
requirementsRouter.get('/:id/requirements', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const rows = db.all<any>(
      `SELECT scr.*, c.name as customer_name
       FROM shipment_customer_requirements scr
       LEFT JOIN customers c ON scr.customer_id = c.id
       WHERE scr.shipment_id = ?
       ORDER BY scr.id ASC`,
      shipmentId
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/shipments/:id/requirements
requirementsRouter.post('/:id/requirements', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const body = req.body;
    const prodName = String(body.product_name || '').trim();
    if (!prodName) return res.status(400).json({ error: 'product_name is required' });

    let hsn = body.hsn_code ? String(body.hsn_code).trim() : null;

    const result = db.run(
      `INSERT INTO shipment_customer_requirements (
        shipment_id, customer_id, product_name, hsn_code,
        required_quantity, unit, notes, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_ALLOCATION', CURRENT_TIMESTAMP)`,
      shipmentId,
      body.customer_id,
      prodName,
      hsn,
      body.required_quantity || 1.0,
      body.unit || 'KG',
      body.notes || null
    );

    const created = db.get<any>(`SELECT * FROM shipment_customer_requirements WHERE id = ?`, result.lastInsertRowid);
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/v1/shipments/:id/requirements/:reqId
requirementsRouter.put('/:id/requirements/:reqId', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const reqId = parseInt(req.params.reqId, 10);
    const body = req.body;

    db.run(
      `UPDATE shipment_customer_requirements SET
        product_name = COALESCE(?, product_name),
        hsn_code = COALESCE(?, hsn_code),
        required_quantity = COALESCE(?, required_quantity),
        unit = COALESCE(?, unit),
        notes = COALESCE(?, notes),
        status = COALESCE(?, status)
      WHERE id = ? AND shipment_id = ?`,
      body.product_name, body.hsn_code, body.required_quantity,
      body.unit, body.notes, body.status, reqId, shipmentId
    );

    const updated = db.get<any>(`SELECT * FROM shipment_customer_requirements WHERE id = ?`, reqId);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/v1/shipments/:id/requirements/:reqId
requirementsRouter.delete('/:id/requirements/:reqId', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const reqId = parseInt(req.params.reqId, 10);
    db.run(`DELETE FROM shipment_customer_requirements WHERE id = ? AND shipment_id = ?`, reqId, shipmentId);
    res.json({ message: 'Requirement deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/shipments/:id/requirements/bulk-delete
requirementsRouter.post('/:id/requirements/bulk-delete', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const { requirement_ids = [] } = req.body;
    for (const rid of requirement_ids) {
      db.run(`DELETE FROM shipment_customer_requirements WHERE id = ? AND shipment_id = ?`, rid, shipmentId);
    }
    res.json({ message: 'Requirements deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/v1/shipments/:id/requirements/clear-all
requirementsRouter.delete('/:id/requirements/clear-all', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    db.run(`DELETE FROM shipment_customer_requirements WHERE shipment_id = ?`, shipmentId);
    res.json({ message: 'All requirements cleared' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/shipments/:id/requirements/upload-excel
requirementsRouter.post('/:id/requirements/upload-excel', upload.single('file'), (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const s = db.get<any>(`SELECT * FROM shipments WHERE id = ?`, shipmentId);
    if (!s) return res.status(404).json({ detail: 'Shipment not found' });

    const customers = db.all<any>(`SELECT c.* FROM shipment_customers sc JOIN customers c ON sc.customer_id = c.id WHERE sc.shipment_id = ?`, shipmentId);
    const defaultCustId = customers.length > 0 ? customers[0].id : 1;

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet);

    for (const r of rows) {
      const pName = r.product_name || r.product || r.item_name || r.description;
      if (!pName) continue;

      db.run(
        `INSERT INTO shipment_customer_requirements (
          shipment_id, customer_id, product_name, hsn_code,
          required_quantity, unit, notes, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING_ALLOCATION', CURRENT_TIMESTAMP)`,
        shipmentId,
        defaultCustId,
        String(pName).trim(),
        r.hsn_code || r.hs_code || null,
        parseFloat(r.quantity || r.qty || 1.0),
        r.unit || 'KG',
        r.notes || null
      );
    }

    const allReqs = db.all<any>(`SELECT * FROM shipment_customer_requirements WHERE shipment_id = ?`, shipmentId);
    res.json(allReqs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/shipments/:id/requirements/sync-to-products
requirementsRouter.post('/:id/requirements/sync-to-products', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const reqs = db.all<any>(`SELECT * FROM shipment_customer_requirements WHERE shipment_id = ?`, shipmentId);

    for (const r of reqs) {
      const existing = db.get<any>(
        `SELECT id FROM shipment_products WHERE shipment_id = ? AND LOWER(product_name) = LOWER(?)`,
        shipmentId, r.product_name.trim()
      );

      if (!existing) {
        db.run(
          `INSERT INTO shipment_products (
            shipment_id, customer_id, product_name, hsn_code,
            quantity, unit, weight_val, weight_unit, is_active, stage_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'KG', 1, 'REQUESTED')`,
          shipmentId, r.customer_id, r.product_name, r.hsn_code,
          r.required_quantity, r.unit || 'KG', r.required_quantity
        );
      }
    }

    recalculateShipment(shipmentId);
    const s = db.get<any>(`SELECT * FROM shipments WHERE id = ?`, shipmentId);
    res.json(s);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/shipments/:id/requirements/history
requirementsRouter.get('/:id/requirements/history', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const history = db.all<any>(`SELECT * FROM customer_requirement_history WHERE shipment_id = ? ORDER BY id DESC`, shipmentId);
    res.json(history);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
