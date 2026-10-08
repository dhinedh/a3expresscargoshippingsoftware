import { Router, Request, Response } from 'express';
import { db } from '../db/sqlite.js';

export const customersRouter = Router();

// GET /api/v1/customers
customersRouter.get('', (req: Request, res: Response) => {
  try {
    const customers = db.all<any>(`SELECT * FROM customers ORDER BY name ASC`);
    res.json(customers);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/customers
customersRouter.post('', (req: Request, res: Response) => {
  try {
    const body = req.body;
    const name = String(body.name || '').trim();
    const code = String(body.code || '').trim().toUpperCase();

    if (!name || !code) {
      return res.status(400).json({ error: 'Name and Code are required' });
    }

    const existing = db.get<any>(`SELECT id FROM customers WHERE code = ?`, code);
    if (existing) {
      return res.status(400).json({ detail: 'Customer code already exists' });
    }

    const result = db.run(
      `INSERT INTO customers (name, code, email, phone, address, country, tax_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      name,
      code,
      body.email || null,
      body.phone || null,
      body.address || null,
      body.country || 'Sri Lanka',
      body.tax_id || null
    );

    const created = db.get<any>(`SELECT * FROM customers WHERE id = ?`, result.lastInsertRowid);
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/customers/:id
customersRouter.get('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const customer = db.get<any>(`SELECT * FROM customers WHERE id = ?`, id);
    if (!customer) return res.status(404).json({ detail: 'Customer not found' });
    res.json(customer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/v1/customers/:id
customersRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = req.body;

    const existing = db.get<any>(`SELECT * FROM customers WHERE id = ?`, id);
    if (!existing) return res.status(404).json({ detail: 'Customer not found' });

    db.run(
      `UPDATE customers SET
        name = COALESCE(?, name),
        code = COALESCE(?, code),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        address = COALESCE(?, address),
        country = COALESCE(?, country),
        tax_id = COALESCE(?, tax_id)
      WHERE id = ?`,
      body.name ? String(body.name).trim() : null,
      body.code ? String(body.code).trim().toUpperCase() : null,
      body.email,
      body.phone,
      body.address,
      body.country,
      body.tax_id,
      id
    );

    const updated = db.get<any>(`SELECT * FROM customers WHERE id = ?`, id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/v1/customers/:id
customersRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    db.run(`DELETE FROM customers WHERE id = ?`, id);
    res.json({ message: 'Customer deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
