import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { db } from '../db/sqlite.js';

export const itemsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

// GET /api/v1/items/search-tariff
itemsRouter.get('/search-tariff', (req: Request, res: Response) => {
  try {
    const q = ((req.query.q as string) || '').trim();
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 10));
    if (!q) return res.json([]);

    const queryPattern = `%${q}%`;
    const rows = db.all<any>(
      `SELECT tl.*, c.chapter_number, c.chapter_title, c.section_number
       FROM tariff_lines tl
       JOIN chapters c ON tl.chapter_id = c.id
       WHERE tl.hs_code IS NOT NULL
         AND (tl.hs_code LIKE ? OR tl.description LIKE ?)
       ORDER BY tl.hs_code ASC
       LIMIT ?`,
      queryPattern, queryPattern, limit * 2
    );

    const results: any[] = [];
    const seenIds = new Set<number>();

    for (const line of rows) {
      if (seenIds.has(line.id)) continue;
      seenIds.add(line.id);

      results.push({
        tariff_line_id: line.id,
        hs_code: line.hs_code,
        description: line.description,
        unit: line.unit,
        chapter_number: line.chapter_number,
        chapter_title: line.chapter_title,
        section_number: line.section_number,
        general_duty_rate: line.general_duty_rate,
        vat_rate: line.vat_rate,
        pal_rate: line.pal_rate,
        cess_rate: line.cess_rate,
        sscl_rate: line.sscl_rate,
        excise_rate: line.excise_rate,
      });

      if (results.length >= limit) break;
    }

    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/items/search-all
itemsRouter.get('/search-all', (req: Request, res: Response) => {
  try {
    const q = ((req.query.q as string) || '').trim();
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 15));
    if (!q) return res.json([]);

    const queryPattern = `%${q}%`;
    const results: any[] = [];
    const seenKeys = new Set<string>();

    // 1. Search Item Master (Favorites)
    const favoriteItems = db.all<any>(
      `SELECT * FROM item_entries
       WHERE item_name LIKE ? OR hs_code LIKE ? OR item_category LIKE ?
       ORDER BY is_favorite DESC, item_name ASC
       LIMIT ?`,
      queryPattern, queryPattern, queryPattern, limit
    );

    for (const ie of favoriteItems) {
      const key = `FAV_${ie.id}_${ie.item_name}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      results.push({
        source: 'FAVORITE',
        id: ie.id,
        tariff_line_id: ie.tariff_line_id || ie.id,
        item_name: ie.item_name,
        hs_code: ie.hs_code,
        description: ie.tariff_description || ie.item_name,
        product_category: ie.item_category,
        unit: ie.unit || 'KG',
        currency: ie.currency || 'LKR',
        purchase_price: ie.purchase_price,
        weight_val: ie.weight_val || 1.0,
        weight_unit: ie.weight_unit || 'KG',
        general_duty_rate: ie.general_duty_rate || '20%',
        vat_rate: ie.vat_rate || '18%',
        pal_rate: ie.pal_rate || 'Ex',
        cess_rate: ie.cess_rate || '10%',
        sscl_rate: ie.sscl_rate || '2.5%',
        excise_rate: ie.excise_rate,
        scl_rate: ie.scl_rate,
      });
    }

    // 2. Search Tariff Lines
    if (results.length < limit) {
      const tariffLines = db.all<any>(
        `SELECT tl.*, c.chapter_title, c.chapter_number
         FROM tariff_lines tl
         JOIN chapters c ON tl.chapter_id = c.id
         WHERE tl.hs_code IS NOT NULL
           AND (tl.hs_code LIKE ? OR tl.description LIKE ?)
         LIMIT ?`,
        queryPattern, queryPattern, limit
      );

      for (const line of tariffLines) {
        const key = `TARIFF_${line.id}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        results.push({
          source: 'TARIFF',
          id: line.id,
          tariff_line_id: line.id,
          item_name: line.description,
          hs_code: line.hs_code,
          description: line.description,
          product_category: line.chapter_title,
          unit: line.unit || 'PCS',
          currency: 'INR',
          purchase_price: null,
          weight_val: 1.0,
          weight_unit: 'KG',
          general_duty_rate: line.general_duty_rate,
          vat_rate: line.vat_rate,
          pal_rate: line.pal_rate,
          cess_rate: line.cess_rate,
          sscl_rate: line.sscl_rate,
          excise_rate: line.excise_rate,
          scl_rate: line.scl_rate,
        });

        if (results.length >= limit) break;
      }
    }

    res.json(results.slice(0, limit));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/items/upsert-favorite
itemsRouter.post('/upsert-favorite', (req: Request, res: Response) => {
  try {
    const body = req.body;
    const cleanName = String(body.item_name || '').trim();
    if (!cleanName) return res.status(400).json({ error: 'item_name is required' });

    let entry = db.get<any>(`SELECT * FROM item_entries WHERE LOWER(item_name) = LOWER(?)`, cleanName);

    if (entry) {
      db.run(
        `UPDATE item_entries SET
          item_category = ?,
          unit = ?,
          currency = ?,
          hs_code = ?,
          tariff_line_id = ?,
          tariff_description = ?,
          general_duty_rate = ?,
          vat_rate = ?,
          pal_rate = ?,
          cess_rate = ?,
          sscl_rate = ?,
          excise_rate = ?,
          scl_rate = ?,
          weight_val = ?,
          weight_unit = ?,
          purchase_price = ?,
          is_favorite = 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        body.item_category,
        body.unit || 'PCS',
        body.currency || 'INR',
        body.hs_code,
        body.tariff_line_id,
        body.tariff_description,
        body.general_duty_rate,
        body.vat_rate,
        body.pal_rate,
        body.cess_rate,
        body.sscl_rate,
        body.excise_rate,
        body.scl_rate,
        body.weight_val || 0,
        body.weight_unit || 'KG',
        body.purchase_price,
        entry.id
      );
      entry = db.get<any>(`SELECT * FROM item_entries WHERE id = ?`, entry.id);
    } else {
      const result = db.run(
        `INSERT INTO item_entries (
          item_name, item_category, unit, currency, hs_code, tariff_line_id,
          tariff_description, general_duty_rate, vat_rate, pal_rate, cess_rate,
          sscl_rate, excise_rate, scl_rate, weight_val, weight_unit, purchase_price,
          is_favorite, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        cleanName,
        body.item_category,
        body.unit || 'PCS',
        body.currency || 'INR',
        body.hs_code,
        body.tariff_line_id,
        body.tariff_description,
        body.general_duty_rate,
        body.vat_rate,
        body.pal_rate,
        body.cess_rate,
        body.sscl_rate,
        body.excise_rate,
        body.scl_rate,
        body.weight_val || 0,
        body.weight_unit || 'KG',
        body.purchase_price
      );
      entry = db.get<any>(`SELECT * FROM item_entries WHERE id = ?`, result.lastInsertRowid);
    }

    res.json(entry);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/items/bulk-upload-excel
itemsRouter.post('/bulk-upload-excel', upload.single('file'), (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet);

    let inserted = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const r of rows) {
      try {
        const nameVal = r.product_name || r.item_name || r.name || r.description;
        if (!nameVal) continue;
        const cleanName = String(nameVal).trim();

        const hsn = r.hsn_code || r.hs_code || null;
        const category = r.product_category || r.category || null;
        const unit = r.unit || 'PCS';
        const currency = r.currency || 'INR';
        const price = r.purchase_price || r.price || 0;
        const weight = r.unit_weight || r.weight || 0;

        const existing = db.get<any>(`SELECT id FROM item_entries WHERE LOWER(item_name) = LOWER(?)`, cleanName);
        if (existing) {
          db.run(
            `UPDATE item_entries SET
              hs_code = COALESCE(?, hs_code),
              item_category = COALESCE(?, item_category),
              unit = COALESCE(?, unit),
              currency = COALESCE(?, currency),
              purchase_price = COALESCE(?, purchase_price),
              weight_val = COALESCE(?, weight_val),
              is_favorite = 1,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
            hsn, category, unit, currency, price, weight, existing.id
          );
          updated++;
        } else {
          db.run(
            `INSERT INTO item_entries (
              item_name, hs_code, item_category, unit, currency, purchase_price, weight_val, is_favorite, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            cleanName, hsn, category, unit, currency, price, weight
          );
          inserted++;
        }
      } catch (rowErr: any) {
        errors.push(rowErr.message);
      }
    }

    res.json({
      status: 'SUCCESS',
      inserted,
      updated,
      total_processed: rows.length,
      errors,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/items
itemsRouter.get('', (req: Request, res: Response) => {
  try {
    const query = ((req.query.query as string) || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.page_size as string, 10) || 25));
    const offset = (page - 1) * pageSize;

    let whereClause = '';
    const params: any[] = [];
    if (query) {
      whereClause = 'WHERE item_name LIKE ? OR hs_code LIKE ? OR item_category LIKE ?';
      const q = `%${query}%`;
      params.push(q, q, q);
    }

    const countRow = db.get<{ count: number }>(`SELECT COUNT(*) as count FROM item_entries ${whereClause}`, ...params);
    const total = countRow ? countRow.count : 0;

    const items = db.all<any>(
      `SELECT * FROM item_entries ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...params, pageSize, offset
    );

    res.json({
      total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
      items,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/items
itemsRouter.post('', (req: Request, res: Response) => {
  try {
    const body = req.body;
    const price = body.price_per_kg;
    const qty = body.total_quantity_kg;
    const monthQty = body.per_month_qty_kg;

    const totalValue = price && qty ? price * qty : null;
    const perMonthValue = price && monthQty ? price * monthQty : null;

    const result = db.run(
      `INSERT INTO item_entries (
        item_name, item_category, unit, notes, currency, tariff_line_id, hs_code,
        tariff_description, general_duty_rate, vat_rate, pal_rate, cess_rate,
        sscl_rate, excise_rate, price_per_kg, total_quantity_kg, per_month_qty_kg,
        total_value, per_month_value, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      body.item_name, body.item_category, body.unit, body.notes, body.currency || 'LKR',
      body.tariff_line_id, body.hs_code, body.tariff_description, body.general_duty_rate,
      body.vat_rate, body.pal_rate, body.cess_rate, body.sscl_rate, body.excise_rate,
      price, qty, monthQty, totalValue, perMonthValue
    );

    const created = db.get<any>(`SELECT * FROM item_entries WHERE id = ?`, result.lastInsertRowid);
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/v1/items/:id
itemsRouter.put('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = req.body;
    db.run(
      `UPDATE item_entries SET
        item_name = COALESCE(?, item_name),
        item_category = COALESCE(?, item_category),
        unit = COALESCE(?, unit),
        notes = COALESCE(?, notes),
        currency = COALESCE(?, currency),
        hs_code = COALESCE(?, hs_code),
        tariff_description = COALESCE(?, tariff_description),
        general_duty_rate = COALESCE(?, general_duty_rate),
        vat_rate = COALESCE(?, vat_rate),
        pal_rate = COALESCE(?, pal_rate),
        cess_rate = COALESCE(?, cess_rate),
        sscl_rate = COALESCE(?, sscl_rate),
        purchase_price = COALESCE(?, purchase_price),
        price_per_kg = COALESCE(?, price_per_kg),
        total_quantity_kg = COALESCE(?, total_quantity_kg),
        per_month_qty_kg = COALESCE(?, per_month_qty_kg),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      body.item_name, body.item_category, body.unit, body.notes, body.currency,
      body.hs_code, body.tariff_description, body.general_duty_rate, body.vat_rate,
      body.pal_rate, body.cess_rate, body.sscl_rate, body.purchase_price,
      body.price_per_kg, body.total_quantity_kg, body.per_month_qty_kg,
      id
    );

    const updated = db.get<any>(`SELECT * FROM item_entries WHERE id = ?`, id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/v1/items/:id
itemsRouter.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    db.run(`DELETE FROM item_entries WHERE id = ?`, id);
    res.json({ message: 'Item deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
