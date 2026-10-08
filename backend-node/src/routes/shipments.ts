import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { db } from '../db/sqlite.js';
import { recalculateShipment } from '../services/calculationEngine.js';

export const shipmentsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

function getCurrentFinancialYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  if (now.getMonth() >= 3) {
    return `${year}-${String(year + 1).slice(-2)}`;
  } else {
    return `${year - 1}-${String(year).slice(-2)}`;
  }
}

export function formatSubHsn(baseHsn: string, index: number): string {
  if (!baseHsn) return '';
  const clean = baseHsn.trim();
  if (clean.includes('.')) {
    const parts = clean.split('.');
    const prefix = parts.slice(0, -1).join('.');
    const lastPart = parts[parts.length - 1];
    if (/^\d+$/.test(lastPart)) {
      const width = Math.max(2, lastPart.length);
      let baseVal = parseInt(lastPart, 10);
      if (baseVal % 10 !== 0 && baseVal > 10) {
        baseVal = Math.floor(baseVal / 10) * 10;
      } else if (baseVal < 10 && baseVal > 0) {
        baseVal = 0;
      }
      const newVal = baseVal + index;
      return `${prefix}.${String(newVal).padStart(width, '0')}`;
    }
    return `${clean}.${String(index).padStart(2, '0')}`;
  } else {
    if (/^\d+$/.test(clean) && clean.length >= 6) {
      let baseVal = parseInt(clean, 10);
      const width = clean.length;
      if (baseVal % 10 !== 0) {
        baseVal = Math.floor(baseVal / 10) * 10;
      }
      const newVal = baseVal + index;
      return String(newVal).padStart(width, '0');
    }
    return `${clean}.${String(index).padStart(2, '0')}`;
  }
}

function getFullShipment(id: number) {
  const s = db.get<any>(`SELECT * FROM shipments WHERE id = ?`, id);
  if (!s) return null;

  const customers = db.all<any>(
    `SELECT c.* FROM shipment_customers sc
     JOIN customers c ON sc.customer_id = c.id
     WHERE sc.shipment_id = ?`,
    id
  );

  const products = db.all<any>(
    `SELECT sp.*, c.name as customer_name
     FROM shipment_products sp
     LEFT JOIN customers c ON sp.customer_id = c.id
     WHERE sp.shipment_id = ?
     ORDER BY sp.id ASC`,
    id
  );

  const actuals = db.get<any>(`SELECT * FROM shipment_actuals WHERE shipment_id = ?`, id);
  const requirements = db.all<any>(`SELECT * FROM shipment_customer_requirements WHERE shipment_id = ? ORDER BY id ASC`, id);
  const purchaseOrders = db.all<any>(`SELECT * FROM shipment_purchase_orders WHERE shipment_id = ? ORDER BY id ASC`, id);

  return {
    ...s,
    is_deleted: Boolean(s.is_deleted),
    customers,
    products,
    actuals: actuals || null,
    requirements,
    purchase_orders: purchaseOrders,
  };
}

// GET /api/v1/shipments/next-number
shipmentsRouter.get('/next-number', (req: Request, res: Response) => {
  try {
    const fy = (req.query.financial_year as string) || getCurrentFinancialYear();
    const seqRecord = db.get<any>(`SELECT * FROM shipment_sequences WHERE financial_year = ?`, fy);
    const nextSeq = seqRecord ? seqRecord.last_sequence + 1 : 1;
    res.json({
      financial_year: fy,
      next_sequence: nextSeq,
      shipment_no: `AEC/${nextSeq}/${fy}`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/shipments
shipmentsRouter.get('', (req: Request, res: Response) => {
  try {
    const rows = db.all<any>(`SELECT id FROM shipments WHERE is_deleted = 0 ORDER BY id DESC`);
    const shipments = rows.map((r) => getFullShipment(r.id)).filter(Boolean);
    res.json(shipments);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/shipments
shipmentsRouter.post('', (req: Request, res: Response) => {
  try {
    const body = req.body;
    const fy = body.financial_year || getCurrentFinancialYear();

    let seqRecord = db.get<any>(`SELECT * FROM shipment_sequences WHERE financial_year = ?`, fy);
    let nextSeq = 1;
    if (!seqRecord) {
      db.run(`INSERT INTO shipment_sequences (financial_year, last_sequence) VALUES (?, 1)`, fy);
      nextSeq = 1;
    } else {
      nextSeq = seqRecord.last_sequence + 1;
      db.run(`UPDATE shipment_sequences SET last_sequence = ? WHERE id = ?`, nextSeq, seqRecord.id);
    }

    const shipmentNo = `AEC/${nextSeq}/${fy}`;
    const dateStr = body.shipment_date || new Date().toISOString().slice(0, 10);

    const result = db.run(
      `INSERT INTO shipments (
        shipment_no, sequence_number, financial_year, shipment_date, status,
        destination, currency, current_stage, usd_rate, lkr_inr_rate,
        profit_margin_pct, indian_invoice_margin_pct, colombo_invoice_margin_pct,
        common_expenses_inr, common_expenses_lkr, port_expenses_lkr,
        margin_mode, freight_allocation_mode, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, '1_SHIPMENT_CREATION', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      shipmentNo,
      nextSeq,
      fy,
      dateStr,
      body.destination || 'Colombo Port, Sri Lanka',
      body.currency || 'INR',
      body.usd_rate || 1.0,
      body.lkr_inr_rate || 1.0,
      body.profit_margin_pct || 15.0,
      body.indian_invoice_margin_pct || 15.0,
      body.colombo_invoice_margin_pct || 15.0,
      body.common_expenses_inr || 0.0,
      body.common_expenses_lkr || 0.0,
      body.port_expenses_lkr || 0.0,
      body.margin_mode || 'MARGIN_ON_REVENUE',
      body.freight_allocation_mode || 'WEIGHT',
      body.notes || null
    );

    const shipmentId = result.lastInsertRowid;

    // Resolve and link customers
    let customerIds: number[] = body.customer_ids || [];
    if (body.customer_details && Array.isArray(body.customer_details)) {
      for (const cd of body.customer_details) {
        if (!cd.name) continue;
        let c = db.get<any>(`SELECT id FROM customers WHERE LOWER(name) = LOWER(?)`, cd.name.trim());
        if (!c) {
          const cRes = db.run(
            `INSERT INTO customers (name, code, phone, email, address, country, tax_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            cd.name.trim(), cd.code || `CUST-${Date.now().toString().slice(-4)}`, cd.phone || null,
            cd.email || null, cd.address || null, cd.country || 'Sri Lanka', cd.tax_id || null
          );
          customerIds.push(cRes.lastInsertRowid);
        } else {
          customerIds.push(c.id);
        }
      }
    }

    for (const cid of Array.from(new Set(customerIds))) {
      db.run(`INSERT INTO shipment_customers (shipment_id, customer_id) VALUES (?, ?)`, shipmentId, cid);
    }

    // Init actuals
    db.run(`INSERT INTO shipment_actuals (shipment_id) VALUES (?)`, shipmentId);

    res.status(201).json(getFullShipment(shipmentId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/shipments/reports/dashboard
shipmentsRouter.get('/reports/dashboard', (req: Request, res: Response) => {
  try {
    const shipments = db.all<any>(`SELECT * FROM shipments WHERE is_deleted = 0`);
    const products = db.all<any>(`SELECT * FROM shipment_products WHERE is_active = 1`);

    let totalSalesLkr = 0.0;
    let totalDutyLkr = 0.0;
    let totalCostLkr = 0.0;
    let totalProfitLkr = 0.0;
    let totalLossLkr = 0.0;

    const customerStats: Record<number, any> = {};
    const yearStats: Record<string, any> = {};

    for (const s of shipments) {
      const fy = s.financial_year || 'Unknown';
      if (!yearStats[fy]) {
        yearStats[fy] = { shipments_count: 0, sales_lkr: 0.0, cost_lkr: 0.0, profit_lkr: 0.0 };
      }
      yearStats[fy].shipments_count += 1;
    }

    for (const p of products) {
      const qty = parseFloat(p.quantity || 1.0);
      const sales = (parseFloat(p.final_quotation_price || 0.0)) * qty;
      const cost = (parseFloat(p.total_cost_lkr || 0.0)) * qty;
      const duty = (parseFloat(p.calculated_duty_lkr || 0.0)) * qty;
      const profit = (parseFloat(p.predicted_profit || 0.0)) * qty;

      totalSalesLkr += sales;
      totalDutyLkr += duty;
      totalCostLkr += cost;

      if (profit >= 0) totalProfitLkr += profit;
      else totalLossLkr += Math.abs(profit);

      const cId = p.customer_id;
      if (cId) {
        if (!customerStats[cId]) {
          const cObj = db.get<any>(`SELECT * FROM customers WHERE id = ?`, cId);
          customerStats[cId] = {
            customer_id: cId,
            customer_name: cObj?.name || 'Unknown',
            customer_code: cObj?.code || 'UNKNOWN',
            total_shipments: new Set(),
            total_sales_lkr: 0.0,
            total_cost_lkr: 0.0,
            total_profit_lkr: 0.0,
          };
        }
        customerStats[cId].total_shipments.add(p.shipment_id);
        customerStats[cId].total_sales_lkr += sales;
        customerStats[cId].total_cost_lkr += cost;
        customerStats[cId].total_profit_lkr += profit;
      }
    }

    const customerSummaries = Object.values(customerStats).map((stats: any) => ({
      customer_id: stats.customer_id,
      customer_name: stats.customer_name,
      customer_code: stats.customer_code,
      total_shipments: stats.total_shipments.size,
      total_sales_lkr: Math.round(stats.total_sales_lkr * 100) / 100,
      total_cost_lkr: Math.round(stats.total_cost_lkr * 100) / 100,
      total_profit_lkr: Math.round(stats.total_profit_lkr * 100) / 100,
      pending_amount_lkr: Math.round(stats.total_sales_lkr * 0.2 * 100) / 100,
    }));

    res.json({
      total_shipments: shipments.length,
      total_sales_lkr: Math.round(totalSalesLkr * 100) / 100,
      total_duty_lkr: Math.round(totalDutyLkr * 100) / 100,
      total_cost_lkr: Math.round(totalCostLkr * 100) / 100,
      total_profit_lkr: Math.round(totalProfitLkr * 100) / 100,
      total_loss_lkr: Math.round(totalLossLkr * 100) / 100,
      customer_summaries: customerSummaries,
      year_wise_summary: yearStats,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/shipments/:id
shipmentsRouter.get('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const s = getFullShipment(id);
    if (!s) return res.status(404).json({ detail: 'Shipment not found' });
    res.json(s);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/v1/shipments/:id/config
shipmentsRouter.put('/:id/config', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = req.body;
    const existing = db.get<any>(`SELECT * FROM shipments WHERE id = ?`, id);
    if (!existing) return res.status(404).json({ detail: 'Shipment not found' });

    db.run(
      `UPDATE shipments SET
        shipment_date = COALESCE(?, shipment_date),
        status = COALESCE(?, status),
        destination = COALESCE(?, destination),
        currency = COALESCE(?, currency),
        current_stage = COALESCE(?, current_stage),
        usd_rate = COALESCE(?, usd_rate),
        lkr_inr_rate = COALESCE(?, lkr_inr_rate),
        profit_margin_pct = COALESCE(?, profit_margin_pct),
        indian_invoice_margin_pct = COALESCE(?, indian_invoice_margin_pct),
        colombo_invoice_margin_pct = COALESCE(?, colombo_invoice_margin_pct),
        margin_mode = COALESCE(?, margin_mode),
        common_expenses_inr = COALESCE(?, common_expenses_inr),
        common_expenses_lkr = COALESCE(?, common_expenses_lkr),
        port_expenses_lkr = COALESCE(?, port_expenses_lkr),
        notes = COALESCE(?, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      body.shipment_date, body.status, body.destination, body.currency,
      body.current_stage, body.usd_rate, body.lkr_inr_rate, body.profit_margin_pct,
      body.indian_invoice_margin_pct, body.colombo_invoice_margin_pct, body.margin_mode,
      body.common_expenses_inr, body.common_expenses_lkr, body.port_expenses_lkr,
      body.notes, id
    );

    recalculateShipment(id);
    res.json(getFullShipment(id));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/shipments/:id/products
shipmentsRouter.post('/:id/products', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const body = req.body;
    const cleanName = String(body.product_name || '').trim();
    if (!cleanName) return res.status(400).json({ error: 'product_name is required' });

    let assignedHsn = body.hsn_code ? String(body.hsn_code).trim() : null;
    if (assignedHsn) {
      const basePrefix = assignedHsn.includes('.') ? assignedHsn.split('.').slice(0, 2).join('.') : assignedHsn.slice(0, 6);
      const countRow = db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM shipment_products WHERE shipment_id = ? AND hsn_code LIKE ?`,
        shipmentId, `${basePrefix}%`
      );
      assignedHsn = formatSubHsn(assignedHsn, (countRow?.count || 0) + 1);
    }

    db.run(
      `INSERT INTO shipment_products (
        shipment_id, customer_id, product_name, product_category, hsn_code,
        quantity, weight_val, weight_unit, unit, purchase_price, currency,
        is_active, stage_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'REQUESTED')`,
      shipmentId,
      body.customer_id,
      cleanName,
      body.product_category || null,
      assignedHsn,
      body.quantity || 1.0,
      body.weight_val || 0.0,
      body.weight_unit || 'KG',
      body.unit || 'PCS',
      body.purchase_price || 0.0,
      body.currency || 'INR'
    );

    recalculateShipment(shipmentId);
    res.json(getFullShipment(shipmentId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/v1/shipments/:id/products/:productId
shipmentsRouter.put('/:id/products/:productId', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const productId = parseInt(req.params.productId, 10);
    const body = req.body;

    db.run(
      `UPDATE shipment_products SET
        customer_id = COALESCE(?, customer_id),
        product_name = COALESCE(?, product_name),
        product_category = COALESCE(?, product_category),
        hsn_code = COALESCE(?, hsn_code),
        quantity = COALESCE(?, quantity),
        weight_val = COALESCE(?, weight_val),
        weight_unit = COALESCE(?, weight_unit),
        unit = COALESCE(?, unit),
        purchase_price = COALESCE(?, purchase_price),
        currency = COALESCE(?, currency),
        final_quotation_price = COALESCE(?, final_quotation_price)
      WHERE id = ? AND shipment_id = ?`,
      body.customer_id, body.product_name, body.product_category, body.hsn_code,
      body.quantity, body.weight_val, body.weight_unit, body.unit, body.purchase_price,
      body.currency, body.final_quotation_price, productId, shipmentId
    );

    recalculateShipment(shipmentId);
    res.json(getFullShipment(shipmentId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/v1/shipments/:id/products/:productId
shipmentsRouter.delete('/:id/products/:productId', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const productId = parseInt(req.params.productId, 10);
    db.run(`DELETE FROM shipment_products WHERE id = ? AND shipment_id = ?`, productId, shipmentId);
    recalculateShipment(shipmentId);
    res.json(getFullShipment(shipmentId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/shipments/:id/products/:productId/remove
shipmentsRouter.post('/:id/products/:productId/remove', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const productId = parseInt(req.params.productId, 10);
    const reason = (req.query.reason as string) || 'Customer requested removal from quotation';

    db.run(
      `UPDATE shipment_products SET is_active = 0, stage_status = 'REMOVED' WHERE id = ? AND shipment_id = ?`,
      productId, shipmentId
    );

    recalculateShipment(shipmentId);
    res.json(getFullShipment(shipmentId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/shipments/:id/products/bulk-soft-remove
shipmentsRouter.post('/:id/products/bulk-soft-remove', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const { product_ids = [] } = req.body;
    for (const pid of product_ids) {
      db.run(
        `UPDATE shipment_products SET is_active = 0, stage_status = 'REMOVED' WHERE id = ? AND shipment_id = ?`,
        pid, shipmentId
      );
    }
    recalculateShipment(shipmentId);
    res.json(getFullShipment(shipmentId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/v1/shipments/:id/actuals
shipmentsRouter.put('/:id/actuals', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    const body = req.body;

    let actual = db.get<any>(`SELECT * FROM shipment_actuals WHERE shipment_id = ?`, shipmentId);
    if (!actual) {
      db.run(`INSERT INTO shipment_actuals (shipment_id) VALUES (?)`, shipmentId);
    }

    db.run(
      `UPDATE shipment_actuals SET
        actual_duty_inr = COALESCE(?, actual_duty_inr),
        actual_duty_lkr = COALESCE(?, actual_duty_lkr),
        actual_cost_inr = COALESCE(?, actual_cost_inr),
        actual_cost_lkr = COALESCE(?, actual_cost_lkr),
        actual_revenue_inr = COALESCE(?, actual_revenue_inr),
        actual_revenue_lkr = COALESCE(?, actual_revenue_lkr),
        actual_profit_lkr = COALESCE(?, actual_profit_lkr),
        notes = COALESCE(?, notes)
      WHERE shipment_id = ?`,
      body.actual_duty_inr, body.actual_duty_lkr, body.actual_cost_inr,
      body.actual_cost_lkr, body.actual_revenue_inr, body.actual_revenue_lkr,
      body.actual_profit_lkr, body.notes, shipmentId
    );

    const updated = db.get<any>(`SELECT * FROM shipment_actuals WHERE shipment_id = ?`, shipmentId);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/shipments/:id/upload-excel
shipmentsRouter.post('/:id/upload-excel', upload.single('file'), (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.id, 10);
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const s = getFullShipment(shipmentId);
    if (!s) return res.status(404).json({ detail: 'Shipment not found' });

    const defaultCustId = s.customers && s.customers.length > 0 ? s.customers[0].id : 1;

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet);

    for (const r of rows) {
      const pName = r.product_name || r.product || r.description || r.item_name;
      if (!pName) continue;

      db.run(
        `INSERT INTO shipment_products (
          shipment_id, customer_id, product_name, product_category, hsn_code,
          quantity, weight_val, weight_unit, unit, purchase_price, currency, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'KG', ?, ?, ?, 1)`,
        shipmentId,
        defaultCustId,
        String(pName).trim(),
        r.category || r.product_category || null,
        r.hsn_code || r.hs_code || null,
        parseFloat(r.quantity || r.qty || 1.0),
        parseFloat(r.weight || r.weight_val || 0.0),
        r.unit || 'PCS',
        parseFloat(r.purchase_price || r.price || 0.0),
        r.currency || 'INR'
      );
    }

    recalculateShipment(shipmentId);
    res.json(getFullShipment(shipmentId));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/v1/shipments/:id
shipmentsRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    db.run(`UPDATE shipments SET is_deleted = 1, status = 'CANCELLED' WHERE id = ?`, id);
    res.json({ message: `Shipment #${id} soft-cancelled successfully` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
