import { Router } from 'express';
import ExcelJS from 'exceljs';
import { db } from '../db/sqlite.js';
export const documentsRouter = Router();
// GET /api/v1/shipments/:shipmentId/documents/cmb-bank-excel
documentsRouter.get('/shipments/:shipmentId/documents/cmb-bank-excel', async (req, res) => {
    try {
        const shipmentId = parseInt(req.params.shipmentId, 10);
        const s = db.get(`SELECT * FROM shipments WHERE id = ?`, shipmentId);
        if (!s)
            return res.status(404).json({ detail: 'Shipment not found' });
        const products = db.all(`SELECT * FROM shipment_products WHERE shipment_id = ? AND is_active = 1`, shipmentId);
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'A3 Express Software';
        const sheet = workbook.addWorksheet('Bank Document CMB');
        sheet.columns = [
            { header: 'SL NO', key: 'sl', width: 8 },
            { header: 'DESCRIPTION OF GOODS', key: 'desc', width: 35 },
            { header: 'HS CODE', key: 'hsn', width: 15 },
            { header: 'QUANTITY', key: 'qty', width: 12 },
            { header: 'UNIT', key: 'unit', width: 10 },
            { header: 'UNIT PRICE (LKR)', key: 'price', width: 18 },
            { header: 'TOTAL AMOUNT (LKR)', key: 'total', width: 22 },
        ];
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        let sl = 1;
        let grandTotal = 0;
        for (const p of products) {
            const qty = parseFloat(p.quantity || 1);
            const price = parseFloat(p.final_quotation_price || p.suggested_price || 0);
            const total = qty * price;
            grandTotal += total;
            sheet.addRow({
                sl: sl++,
                desc: p.product_name,
                hsn: p.hsn_code || '-',
                qty,
                unit: p.unit || 'PCS',
                price: Math.round(price * 100) / 100,
                total: Math.round(total * 100) / 100,
            });
        }
        const totalRow = sheet.addRow({
            sl: '',
            desc: 'GRAND TOTAL',
            hsn: '',
            qty: '',
            unit: '',
            price: '',
            total: Math.round(grandTotal * 100) / 100,
        });
        totalRow.font = { bold: true };
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=CMB_Bank_Doc_${s.shipment_no.replace(/\//g, '_')}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/v1/shipments/:shipmentId/documents/indian-excel
documentsRouter.get('/shipments/:shipmentId/documents/indian-excel', async (req, res) => {
    try {
        const shipmentId = parseInt(req.params.shipmentId, 10);
        const s = db.get(`SELECT * FROM shipments WHERE id = ?`, shipmentId);
        if (!s)
            return res.status(404).json({ detail: 'Shipment not found' });
        const products = db.all(`SELECT * FROM shipment_products WHERE shipment_id = ? AND is_active = 1`, shipmentId);
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Indian Commercial Invoice');
        sheet.columns = [
            { header: 'SL NO', key: 'sl', width: 8 },
            { header: 'DESCRIPTION', key: 'desc', width: 35 },
            { header: 'HSN CODE', key: 'hsn', width: 15 },
            { header: 'QTY', key: 'qty', width: 10 },
            { header: 'UNIT', key: 'unit', width: 10 },
            { header: 'RATE (INR)', key: 'rate', width: 15 },
            { header: 'AMOUNT (INR)', key: 'amount', width: 18 },
        ];
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
        let sl = 1;
        let grandTotal = 0;
        for (const p of products) {
            const qty = parseFloat(p.quantity || 1);
            const rate = parseFloat(p.indian_price || p.purchase_price || 0);
            const total = qty * rate;
            grandTotal += total;
            sheet.addRow({
                sl: sl++,
                desc: p.product_name,
                hsn: p.hsn_code || '-',
                qty,
                unit: p.unit || 'PCS',
                rate: Math.round(rate * 100) / 100,
                amount: Math.round(total * 100) / 100,
            });
        }
        const totalRow = sheet.addRow({
            sl: '',
            desc: 'TOTAL',
            hsn: '',
            qty: '',
            unit: '',
            rate: '',
            amount: Math.round(grandTotal * 100) / 100,
        });
        totalRow.font = { bold: true };
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Indian_Invoice_${s.shipment_no.replace(/\//g, '_')}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/v1/shipments/:shipmentId/documents/packing-list
documentsRouter.get('/shipments/:shipmentId/documents/packing-list', async (req, res) => {
    try {
        const shipmentId = parseInt(req.params.shipmentId, 10);
        const s = db.get(`SELECT * FROM shipments WHERE id = ?`, shipmentId);
        if (!s)
            return res.status(404).json({ detail: 'Shipment not found' });
        const products = db.all(`SELECT * FROM shipment_products WHERE shipment_id = ? AND is_active = 1`, shipmentId);
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Packing List');
        sheet.columns = [
            { header: 'SL NO', key: 'sl', width: 8 },
            { header: 'DESCRIPTION', key: 'desc', width: 35 },
            { header: 'NO OF BAGS', key: 'bags', width: 14 },
            { header: 'QUANTITY', key: 'qty', width: 12 },
            { header: 'NET WEIGHT (KG)', key: 'net', width: 18 },
            { header: 'GROSS WEIGHT (KG)', key: 'gross', width: 20 },
        ];
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
        let sl = 1;
        let totalBags = 0;
        let totalNet = 0;
        let totalGross = 0;
        for (const p of products) {
            const bags = parseInt(p.no_bags_qty || 0, 10);
            const net = parseFloat(p.net_weight_kg || p.weight_val || 0);
            const gross = parseFloat(p.gross_weight_kg || net * 1.02);
            totalBags += bags;
            totalNet += net;
            totalGross += gross;
            sheet.addRow({
                sl: sl++,
                desc: p.product_name,
                bags,
                qty: `${p.quantity} ${p.unit || 'PCS'}`,
                net: Math.round(net * 100) / 100,
                gross: Math.round(gross * 100) / 100,
            });
        }
        const totalRow = sheet.addRow({
            sl: '',
            desc: 'TOTAL',
            bags: totalBags,
            qty: '',
            net: Math.round(totalNet * 100) / 100,
            gross: Math.round(totalGross * 100) / 100,
        });
        totalRow.font = { bold: true };
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Packing_List_${s.shipment_no.replace(/\//g, '_')}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
