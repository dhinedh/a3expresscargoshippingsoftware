import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { db } from '../db/sqlite.js';
import { recalculateShipment } from '../services/calculationEngine.js';

export const allocationsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

// GET /api/v1/shipments/:id/allocations
allocationsRouter.get('/:id/allocations', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const rows = db.all<any>(
      `SELECT sva.*, v.name as vendor_name, scr.product_name
       FROM shipment_vendor_allocations sva
       LEFT JOIN vendors v ON sva.vendor_id = v.id
       LEFT JOIN shipment_customer_requirements scr ON sva.requirement_id = scr.id
       WHERE sva.shipment_id = ?
       ORDER BY sva.id ASC`,
      shipmentId
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/shipments/:id/allocations
allocationsRouter.post('/:id/allocations', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const body = req.body;

    const result = db.run(
      `INSERT INTO shipment_vendor_allocations (
        shipment_id, requirement_id, vendor_id, allocated_quantity,
        allocated_unit, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      shipmentId,
      body.requirement_id,
      body.vendor_id,
      body.allocated_quantity || 1.0,
      body.allocated_unit || 'KG',
      body.status || 'PENDING_PI',
      body.notes || null
    );

    const created = db.get<any>(`SELECT * FROM shipment_vendor_allocations WHERE id = ?`, result.lastInsertRowid);
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/shipments/:id/proforma-items
allocationsRouter.get('/:id/proforma-items', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const rows = db.all<any>(
      `SELECT svpi.*, v.name as vendor_name
       FROM shipment_vendor_proforma_items svpi
       LEFT JOIN vendors v ON svpi.vendor_id = v.id
       WHERE svpi.shipment_id = ?
       ORDER BY svpi.id ASC`,
      shipmentId
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/shipments/:id/proforma-items
allocationsRouter.post('/:id/proforma-items', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const body = req.body;

    const result = db.run(
      `INSERT INTO shipment_vendor_proforma_items (
        shipment_id, vendor_id, allocation_id, product_name, hsn_code,
        proforma_qty, proforma_unit, proforma_price, currency,
        net_weight_kg, gross_weight_kg, unit_weight_val, unit_weight_unit,
        no_bags_qty, pkt_size_g, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      shipmentId,
      body.vendor_id,
      body.allocation_id || null,
      body.product_name,
      body.hsn_code || null,
      body.proforma_qty || 1.0,
      body.proforma_unit || 'PCS',
      body.proforma_price || 0.0,
      body.currency || 'INR',
      body.net_weight_kg || 0.0,
      body.gross_weight_kg || 0.0,
      body.unit_weight_val || 0.0,
      body.unit_weight_unit || 'KG',
      body.no_bags_qty || 0,
      body.pkt_size_g || 0,
      body.remarks || null
    );

    const created = db.get<any>(`SELECT * FROM shipment_vendor_proforma_items WHERE id = ?`, result.lastInsertRowid);
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/v1/shipments/:id/proforma-items/:itemId
allocationsRouter.put('/:id/proforma-items/:itemId', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.itemId, 10);
    const body = req.body;

    db.run(
      `UPDATE shipment_vendor_proforma_items SET
        product_name = COALESCE(?, product_name),
        hsn_code = COALESCE(?, hsn_code),
        proforma_qty = COALESCE(?, proforma_qty),
        proforma_unit = COALESCE(?, proforma_unit),
        proforma_price = COALESCE(?, proforma_price),
        currency = COALESCE(?, currency),
        net_weight_kg = COALESCE(?, net_weight_kg),
        gross_weight_kg = COALESCE(?, gross_weight_kg),
        unit_weight_val = COALESCE(?, unit_weight_val),
        unit_weight_unit = COALESCE(?, unit_weight_unit),
        no_bags_qty = COALESCE(?, no_bags_qty),
        pkt_size_g = COALESCE(?, pkt_size_g),
        remarks = COALESCE(?, remarks)
      WHERE id = ? AND shipment_id = ?`,
      body.product_name, body.hsn_code, body.proforma_qty, body.proforma_unit,
      body.proforma_price, body.currency, body.net_weight_kg, body.gross_weight_kg,
      body.unit_weight_val, body.unit_weight_unit, body.no_bags_qty, body.pkt_size_g,
      body.remarks, itemId, shipmentId
    );

    const updated = db.get<any>(`SELECT * FROM shipment_vendor_proforma_items WHERE id = ?`, itemId);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/v1/shipments/:id/proforma-items/:itemId
allocationsRouter.delete('/:id/proforma-items/:itemId', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.itemId, 10);
    db.run(`DELETE FROM shipment_vendor_proforma_items WHERE id = ? AND shipment_id = ?`, itemId, shipmentId);
    res.json({ message: 'Proforma item deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/shipments/:id/convert-to-products
allocationsRouter.post('/:id/convert-to-products', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const pItems = db.all<any>(`SELECT * FROM shipment_vendor_proforma_items WHERE shipment_id = ?`, shipmentId);
    const s = db.get<any>(`SELECT * FROM shipments WHERE id = ?`, shipmentId);
    if (!s) return res.status(404).json({ detail: 'Shipment not found' });

    const custRows = db.all<any>(`SELECT customer_id FROM shipment_customers WHERE shipment_id = ?`, shipmentId);
    const defaultCustId = custRows.length > 0 ? custRows[0].customer_id : 1;

    for (const item of pItems) {
      db.run(
        `INSERT INTO shipment_products (
          shipment_id, customer_id, product_name, hsn_code, quantity,
          unit, purchase_price, currency, weight_val, weight_unit,
          net_weight_kg, gross_weight_kg, no_bags_qty, pkt_size_g, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'KG', ?, ?, ?, ?, 1)`,
        shipmentId, defaultCustId, item.product_name, item.hsn_code,
        item.proforma_qty, item.proforma_unit, item.proforma_price, item.currency,
        item.unit_weight_val, item.net_weight_kg, item.gross_weight_kg,
        item.no_bags_qty, item.pkt_size_g
      );
    }

    recalculateShipment(shipmentId);
    res.json(s);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/shipments/:id/preliminary-quotation
allocationsRouter.get('/:id/preliminary-quotation', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const items = db.all<any>(`SELECT * FROM customer_quotation_items WHERE shipment_id = ?`, shipmentId);
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
