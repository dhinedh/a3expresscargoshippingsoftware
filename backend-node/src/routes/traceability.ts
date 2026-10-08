import { Router, Request, Response } from 'express';
import { db } from '../db/sqlite.js';

export const traceabilityRouter = Router();

const INDIA_COLOMBO_MILESTONES = [
  ["1_FOCUS_BILL", "Focus Bill Filing", 1],
  ["2_SHIPPING_BILL", "Shipping Bill / ICEGATE Filing", 2],
  ["3_WAY_BILL", "Way Bill / E-Way Bill", 3],
  ["4_TRANSPORT", "Transport Movement", 4],
  ["5_CONTAINER_PROC", "LCL / FCL Container Process", 5],
  ["6_CRO", "CRO (Container Release Order)", 6],
  ["7_EXAMINATION", "Customs Examination", 7],
  ["8_STUFFING", "Container Stuffing", 8],
  ["9_SEAL", "Container Seal Verification", 9],
  ["10_GATE_OUT", "Port Gate Out", 10],
  ["11_FORM_13", "Form 13 Issuance", 11],
  ["12_VGM", "VGM (Verified Gross Mass)", 12],
  ["13_BL_DRAFT", "BL Draft & Checklist Verification", 13],
  ["14_PO_CREATED", "Purchase Orders Issued to Vendors", 14],
  ["15_VENDOR_DELIVERY", "Vendor Goods Dispatched & Delivered", 15],
  ["16_PACKING_LIST", "Packing List (PL-001) Generated", 16],
  ["17_INDIAN_INVOICE", "Indian Commercial Invoice Issued", 17],
  ["18_COLOMBO_INVOICE", "Colombo Invoice Prepared", 18],
  ["19_COO_PREFERENCE", "COO & Tariff Preferences (ISFTA/SAFTA)", 19],
  ["20_BL_FINAL", "BL Confirmation & Final BL Issued", 20],
  ["21_CLEARING_EXPENSE", "Vinayaka Clearing Expense Invoice", 21],
  ["22_DELIVERY_ORDER", "Delivery Order (DO) Issued", 22],
  ["23_EGM_CLOSURE", "EGM Filing & Shipment Closure", 23]
] as const;

export function initShipmentMilestones(shipmentId: number, workflowMode: string = "SEA_FCL") {
  const existing = db.all<any>(`SELECT * FROM shipment_milestones WHERE shipment_id = ?`, shipmentId);
  if (existing.length > 0) return existing;

  for (const [code, name, seq] of INDIA_COLOMBO_MILESTONES) {
    db.run(
      `INSERT INTO shipment_milestones (
        shipment_id, milestone_code, milestone_name, sequence,
        status, workflow_mode, owner_person
      ) VALUES (?, ?, ?, ?, 'PENDING', ?, 'Operations Manager')`,
      shipmentId, code, name, seq, workflowMode
    );
  }

  return db.all<any>(`SELECT * FROM shipment_milestones WHERE shipment_id = ? ORDER BY sequence ASC`, shipmentId);
}

// GET /api/v1/traceability/search
traceabilityRouter.get('/traceability/search', (req: Request, res: Response) => {
  try {
    const q = ((req.query.q as string) || '').trim();
    if (!q) return res.json([]);

    const pattern = `%${q}%`;
    const results: any[] = [];

    // Search shipments
    const shipments = db.all<any>(`SELECT id, shipment_no, destination, status FROM shipments WHERE shipment_no LIKE ? LIMIT 5`, pattern);
    for (const s of shipments) {
      results.push({ entity_type: 'SHIPMENT', entity_id: s.id, title: s.shipment_no, subtitle: `${s.destination} (${s.status})` });
    }

    // Search customers
    const customers = db.all<any>(`SELECT id, name, code FROM customers WHERE name LIKE ? OR code LIKE ? LIMIT 5`, pattern, pattern);
    for (const c of customers) {
      results.push({ entity_type: 'CUSTOMER', entity_id: c.id, title: c.name, subtitle: c.code });
    }

    // Search vendors
    const vendors = db.all<any>(`SELECT id, name, code FROM vendors WHERE name LIKE ? OR code LIKE ? LIMIT 5`, pattern, pattern);
    for (const v of vendors) {
      results.push({ entity_type: 'VENDOR', entity_id: v.id, title: v.name, subtitle: v.code });
    }

    // Search products
    const products = db.all<any>(`SELECT id, product_name, hsn_code FROM shipment_products WHERE product_name LIKE ? OR hsn_code LIKE ? LIMIT 5`, pattern, pattern);
    for (const p of products) {
      results.push({ entity_type: 'PRODUCT', entity_id: p.id, title: p.product_name, subtitle: p.hsn_code });
    }

    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/traceability/:entity_type/:entity_id
traceabilityRouter.get('/traceability/:entity_type/:entity_id', (req: Request, res: Response) => {
  try {
    const { entity_type, entity_id } = req.params;
    const id = parseInt(entity_id, 10);

    const nodes: any[] = [];
    const edges: any[] = [];

    if (entity_type.toUpperCase() === 'SHIPMENT') {
      const s = db.get<any>(`SELECT * FROM shipments WHERE id = ?`, id);
      if (!s) return res.status(404).json({ error: 'Shipment not found' });

      nodes.push({ id: `shipment_${s.id}`, label: s.shipment_no, type: 'SHIPMENT' });

      const custs = db.all<any>(`SELECT c.* FROM shipment_customers sc JOIN customers c ON sc.customer_id = c.id WHERE sc.shipment_id = ?`, id);
      for (const c of custs) {
        nodes.push({ id: `customer_${c.id}`, label: c.name, type: 'CUSTOMER' });
        edges.push({ from: `shipment_${s.id}`, to: `customer_${c.id}`, relationship: 'CONSIGNEE' });
      }

      const prods = db.all<any>(`SELECT * FROM shipment_products WHERE shipment_id = ?`, id);
      for (const p of prods) {
        nodes.push({ id: `prod_${p.id}`, label: p.product_name, type: 'PRODUCT' });
        edges.push({ from: `shipment_${s.id}`, to: `prod_${p.id}`, relationship: 'CONTAINS' });
      }
    }

    res.json({ entity_type, entity_id: id, nodes, edges });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/tracking/dashboard
traceabilityRouter.get('/tracking/dashboard', (req: Request, res: Response) => {
  try {
    const shipments = db.all<any>(`SELECT * FROM shipments WHERE is_deleted = 0 ORDER BY id DESC`);
    let totalShipments = shipments.length;
    let inProgress = 0;
    let completed = 0;
    let blocked = 0;
    let delayed = 0;
    let attentionRequired = 0;

    const shipmentRows = [];

    for (const s of shipments) {
      let msList = db.all<any>(`SELECT * FROM shipment_milestones WHERE shipment_id = ? ORDER BY sequence ASC`, s.id);
      if (msList.length === 0) {
        msList = initShipmentMilestones(s.id);
      }

      const msTotal = msList.length;
      const msCompleted = msList.filter((m) => m.status === 'COMPLETED').length;
      const msBlocked = msList.filter((m) => m.status === 'BLOCKED').length;
      const isDelayed = msList.some((m) => (m.delay_days || 0) > 0);

      if (isDelayed) delayed++;
      if (msBlocked > 0) {
        blocked++;
        attentionRequired++;
      }

      if (s.status === 'COMPLETED' || (msTotal > 0 && msCompleted === msTotal)) {
        completed++;
      } else if (s.status !== 'CANCELLED') {
        inProgress++;
      }

      const custs = db.all<any>(`SELECT c.name FROM shipment_customers sc JOIN customers c ON sc.customer_id = c.id WHERE sc.shipment_id = ?`, s.id);
      const custStr = custs.map((c) => c.name).join(', ') || 'Unassigned Customer';
      const progressPct = msTotal > 0 ? Math.round((msCompleted / msTotal) * 1000) / 10 : 0.0;

      shipmentRows.push({
        shipment_id: s.id,
        shipment_no: s.shipment_no,
        financial_year: s.financial_year,
        customer_names: custStr,
        destination: s.destination,
        status: s.status,
        current_stage: s.current_stage || '1_SHIPMENT_CREATION',
        progress_pct: progressPct,
        total_milestones: msTotal,
        completed_milestones: msCompleted,
        is_delayed: isDelayed,
        is_blocked: msBlocked > 0,
        created_at: s.created_at,
      });
    }

    res.json({
      kpis: {
        total_shipments: totalShipments,
        in_progress: inProgress,
        completed: completed,
        blocked: blocked,
        delayed: delayed,
        attention_required: attentionRequired,
      },
      shipments: shipmentRows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/shipments/:shipment_id/milestones
traceabilityRouter.get('/shipments/:shipment_id/milestones', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.shipment_id, 10);
    let msList = db.all<any>(`SELECT * FROM shipment_milestones WHERE shipment_id = ? ORDER BY sequence ASC`, shipmentId);
    if (msList.length === 0) {
      msList = initShipmentMilestones(shipmentId);
    }
    res.json(msList);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/shipments/:shipment_id/milestones/init
traceabilityRouter.post('/shipments/:shipment_id/milestones/init', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.shipment_id, 10);
    const mode = (req.query.workflow_mode as string) || 'SEA_FCL';
    db.run(`DELETE FROM shipment_milestones WHERE shipment_id = ?`, shipmentId);
    const created = initShipmentMilestones(shipmentId, mode);
    res.json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/v1/shipments/:shipment_id/milestones/:milestone_id
traceabilityRouter.put('/shipments/:shipment_id/milestones/:milestone_id', (req: Request, res: Response) => {
  try {
    const shipmentId = parseInt(req.params.shipment_id, 10);
    const milestoneId = parseInt(req.params.milestone_id, 10);
    const body = req.body;

    db.run(
      `UPDATE shipment_milestones SET
        status = COALESCE(?, status),
        delay_days = COALESCE(?, delay_days),
        delay_reason = COALESCE(?, delay_reason),
        owner_person = COALESCE(?, owner_person),
        remarks = COALESCE(?, remarks)
      WHERE id = ? AND shipment_id = ?`,
      body.status ? String(body.status).toUpperCase() : null,
      body.delay_days !== undefined ? parseInt(body.delay_days, 10) : null,
      body.delay_reason,
      body.owner_person,
      body.remarks,
      milestoneId,
      shipmentId
    );

    const updated = db.get<any>(`SELECT * FROM shipment_milestones WHERE id = ?`, milestoneId);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
