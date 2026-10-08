import { Router } from 'express';
import { db } from '../db/sqlite.js';
export const tariffRouter = Router();
// GET /api/v1/tariff/sections
tariffRouter.get('/sections', (req, res) => {
    try {
        const chapters = db.all(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM tariff_lines tl WHERE tl.chapter_id = c.id) as total_lines
      FROM chapters c
      ORDER BY c.chapter_number ASC
    `);
        res.json(chapters);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/v1/tariff/lines
tariffRouter.get('/lines', (req, res) => {
    try {
        const { query, chapter_id, section_number, is_verified, duty_type, page = '1', page_size = '50', } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limit = Math.min(500, Math.max(1, parseInt(page_size, 10) || 50));
        const offset = (pageNum - 1) * limit;
        const conditions = [];
        const params = [];
        if (chapter_id) {
            conditions.push('tl.chapter_id = ?');
            params.push(parseInt(chapter_id, 10));
        }
        if (section_number) {
            conditions.push('c.section_number = ?');
            params.push(section_number);
        }
        if (is_verified !== undefined && is_verified !== '') {
            conditions.push('tl.is_verified = ?');
            params.push(is_verified === 'true' ? 1 : 0);
        }
        if (query && query.trim()) {
            const q = `%${query.trim()}%`;
            conditions.push('(tl.hs_code LIKE ? OR tl.description LIKE ? OR tl.raw_row_text LIKE ?)');
            params.push(q, q, q);
        }
        if (duty_type) {
            const dt = duty_type.toLowerCase();
            if (dt === 'gen') {
                conditions.push("tl.general_duty_rate IS NOT NULL AND tl.general_duty_rate != 'Free'");
            }
            else if (dt === 'vat') {
                conditions.push("tl.vat_rate IS NOT NULL AND tl.vat_rate != '-'");
            }
            else if (dt === 'cess') {
                conditions.push("tl.cess_rate IS NOT NULL AND tl.cess_rate != '-'");
            }
        }
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const countRow = db.get(`SELECT COUNT(*) as count 
       FROM tariff_lines tl 
       LEFT JOIN chapters c ON tl.chapter_id = c.id 
       ${whereClause}`, ...params);
        const totalCount = countRow ? countRow.count : 0;
        const rows = db.all(`SELECT tl.*, c.chapter_number, c.section_number
       FROM tariff_lines tl 
       LEFT JOIN chapters c ON tl.chapter_id = c.id 
       ${whereClause} 
       ORDER BY tl.chapter_id ASC, tl.id ASC 
       LIMIT ? OFFSET ?`, ...params, limit, offset);
        const items = rows.map((r) => ({
            ...r,
            preferential_rates: typeof r.preferential_rates === 'string' ? JSON.parse(r.preferential_rates || '{}') : r.preferential_rates || {},
            is_verified: Boolean(r.is_verified),
        }));
        res.json({
            items,
            total_count: totalCount,
            page: pageNum,
            page_size: limit,
            total_pages: Math.ceil(totalCount / limit) || 1,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// PUT /api/v1/tariff/lines/:id
tariffRouter.put('/lines/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const existing = db.get(`SELECT * FROM tariff_lines WHERE id = ?`, id);
        if (!existing)
            return res.status(404).json({ error: 'Tariff line not found' });
        const body = req.body;
        db.run(`UPDATE tariff_lines SET
        hs_code = COALESCE(?, hs_code),
        description = COALESCE(?, description),
        unit = COALESCE(?, unit),
        icl_slsi = COALESCE(?, icl_slsi),
        general_duty_rate = COALESCE(?, general_duty_rate),
        vat_rate = COALESCE(?, vat_rate),
        pal_rate = COALESCE(?, pal_rate),
        cess_rate = COALESCE(?, cess_rate),
        sscl_rate = COALESCE(?, sscl_rate),
        excise_rate = COALESCE(?, excise_rate),
        scl_rate = COALESCE(?, scl_rate),
        notes = COALESCE(?, notes),
        is_verified = COALESCE(?, is_verified)
      WHERE id = ?`, body.hs_code, body.description, body.unit, body.icl_slsi, body.general_duty_rate, body.vat_rate, body.pal_rate, body.cess_rate, body.sscl_rate, body.excise_rate, body.scl_rate, body.notes, body.is_verified !== undefined ? (body.is_verified ? 1 : 0) : null, id);
        const updated = db.get(`SELECT * FROM tariff_lines WHERE id = ?`, id);
        res.json(updated);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/v1/tariff/lines/:id/verify
tariffRouter.post('/lines/:id/verify', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        db.run(`UPDATE tariff_lines SET is_verified = 1 WHERE id = ?`, id);
        const updated = db.get(`SELECT * FROM tariff_lines WHERE id = ?`, id);
        res.json(updated);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
