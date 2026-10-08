import { Router } from 'express';
import ExcelJS from 'exceljs';
import { db } from '../db/sqlite.js';
export const exportRouter = Router();
function getTariffExportData(chapterId, query) {
    const conditions = [];
    const params = [];
    if (chapterId) {
        conditions.push('tl.chapter_id = ?');
        params.push(parseInt(chapterId, 10));
    }
    if (query && query.trim()) {
        const q = `%${query.trim()}%`;
        conditions.push('(tl.hs_code LIKE ? OR tl.description LIKE ?)');
        params.push(q, q);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    return db.all(`SELECT tl.*, c.chapter_number, c.section_number
     FROM tariff_lines tl
     LEFT JOIN chapters c ON tl.chapter_id = c.id
     ${whereClause}
     ORDER BY tl.chapter_id ASC, tl.id ASC`, ...params);
}
// GET /api/v1/export/csv
exportRouter.get('/csv', (req, res) => {
    try {
        const { chapter_id, query } = req.query;
        const lines = getTariffExportData(chapter_id, query);
        const headers = [
            'Chapter', 'Section', 'HS Code', 'Description', 'Unit',
            'General Duty Rate', 'VAT Rate', 'PAL Rate', 'CESS Rate', 'SSCL Rate', 'Verified'
        ];
        const csvRows = [headers.join(',')];
        for (const l of lines) {
            const escape = (val) => `"${String(val || '').replace(/"/g, '""')}"`;
            csvRows.push([
                escape(l.chapter_number),
                escape(l.section_number),
                escape(l.hs_code),
                escape(l.description),
                escape(l.unit),
                escape(l.general_duty_rate),
                escape(l.vat_rate),
                escape(l.pal_rate),
                escape(l.cess_rate),
                escape(l.sscl_rate),
                escape(l.is_verified ? 'Yes' : 'No'),
            ].join(','));
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="sri_lanka_customs_tariff.csv"');
        res.send(csvRows.join('\n'));
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/v1/export/excel
exportRouter.get('/excel', async (req, res) => {
    try {
        const { chapter_id, query } = req.query;
        const lines = getTariffExportData(chapter_id, query);
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Import Tariff');
        sheet.columns = [
            { header: 'Chapter', key: 'chap', width: 10 },
            { header: 'Section', key: 'sec', width: 10 },
            { header: 'HS Code', key: 'hs', width: 15 },
            { header: 'Description', key: 'desc', width: 45 },
            { header: 'Unit', key: 'unit', width: 10 },
            { header: 'General Duty', key: 'gen', width: 15 },
            { header: 'VAT', key: 'vat', width: 10 },
            { header: 'PAL', key: 'pal', width: 10 },
            { header: 'CESS', key: 'cess', width: 10 },
            { header: 'SSCL', key: 'sscl', width: 10 },
            { header: 'Verified', key: 'ver', width: 10 },
        ];
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        for (const l of lines) {
            sheet.addRow({
                chap: l.chapter_number,
                sec: l.section_number,
                hs: l.hs_code || '',
                desc: l.description || '',
                unit: l.unit || '',
                gen: l.general_duty_rate || '',
                vat: l.vat_rate || '',
                pal: l.pal_rate || '',
                cess: l.cess_rate || '',
                sscl: l.sscl_rate || '',
                ver: l.is_verified ? 'Yes' : 'No',
            });
        }
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="sri_lanka_customs_tariff.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
