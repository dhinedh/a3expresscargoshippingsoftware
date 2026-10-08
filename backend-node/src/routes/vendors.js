import { Router } from 'express';
import { db } from '../db/sqlite.js';
export const vendorsRouter = Router();
// GET /api/v1/vendors
vendorsRouter.get('', (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        let rows;
        if (q) {
            const pattern = `%${q}%`;
            rows = db.all(`SELECT * FROM vendors
         WHERE name LIKE ? OR code LIKE ? OR legal_name LIKE ? OR trade_name LIKE ?
         ORDER BY name ASC`, pattern, pattern, pattern, pattern);
        }
        else {
            rows = db.all(`SELECT * FROM vendors ORDER BY name ASC`);
        }
        const vendors = rows.map((v) => ({
            ...v,
            sub_categories: typeof v.sub_categories === 'string' ? JSON.parse(v.sub_categories || '[]') : v.sub_categories || [],
            products_supplied: typeof v.products_supplied === 'string' ? JSON.parse(v.products_supplied || '[]') : v.products_supplied || [],
        }));
        res.json(vendors);
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/v1/vendors/products/all
vendorsRouter.get('/products/all', (req, res) => {
    try {
        const q = (req.query.q || '').trim().toLowerCase();
        const productSet = new Set();
        const popularDefaults = [
            "Ragi", "Maida", "Atta (Wheat Flour)", "Turmeric Powder", "Black Pepper",
            "White Sugar", "Urad Dal", "Toor Dal", "Chana Dal", "Cardamom",
            "Coriander Seeds", "Mustard Seeds", "Refined Sunflower Oil", "Coconut Oil",
            "Basmati Rice", "Raw Cashew Nuts", "Cloves", "Cinnamon", "Red Chilli"
        ];
        popularDefaults.forEach((p) => productSet.add(p));
        const vendors = db.all(`SELECT products_supplied FROM vendors WHERE products_supplied IS NOT NULL`);
        for (const v of vendors) {
            try {
                const prods = typeof v.products_supplied === 'string' ? JSON.parse(v.products_supplied) : v.products_supplied;
                if (Array.isArray(prods)) {
                    prods.forEach((p) => { if (p && String(p).trim())
                        productSet.add(String(p).trim()); });
                }
            }
            catch { }
        }
        const reqProducts = db.all(`SELECT product_name FROM shipment_customer_requirements WHERE product_name IS NOT NULL`);
        reqProducts.forEach((r) => { if (r.product_name && r.product_name.trim())
            productSet.add(r.product_name.trim()); });
        const itemEntries = db.all(`SELECT item_name FROM item_entries WHERE item_name IS NOT NULL`);
        itemEntries.forEach((it) => { if (it.item_name && it.item_name.trim())
            productSet.add(it.item_name.trim()); });
        const all = Array.from(productSet);
        let resultList = all;
        if (q) {
            const prefix = all.filter((p) => p.toLowerCase().startsWith(q)).sort();
            const other = all.filter((p) => !p.toLowerCase().startsWith(q) && p.toLowerCase().includes(q)).sort();
            resultList = [...prefix, ...other];
        }
        else {
            resultList.sort();
        }
        res.json(resultList.slice(0, 50));
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// GET /api/v1/vendors/matching-for-product
vendorsRouter.get('/matching-for-product', (req, res) => {
    try {
        const productName = (req.query.product_name || '').trim();
        const cleanP = productName.toLowerCase();
        const allRows = db.all(`SELECT * FROM vendors ORDER BY name ASC`);
        const allVendors = allRows.map((v) => ({
            ...v,
            sub_categories: typeof v.sub_categories === 'string' ? JSON.parse(v.sub_categories || '[]') : v.sub_categories || [],
            products_supplied: typeof v.products_supplied === 'string' ? JSON.parse(v.products_supplied || '[]') : v.products_supplied || [],
        }));
        const matching = allVendors.filter((v) => {
            const supplied = (v.products_supplied || []).map((p) => String(p).toLowerCase());
            const subCats = (v.sub_categories || []).map((sc) => String(sc).toLowerCase());
            if (supplied.some((item) => cleanP.includes(item) || item.includes(cleanP)))
                return true;
            if (subCats.some((item) => cleanP.includes(item) || item.includes(cleanP)))
                return true;
            if (v.main_category && (cleanP.includes(v.main_category.toLowerCase()) || v.main_category.toLowerCase().includes(cleanP)))
                return true;
            return false;
        });
        const lastAlloc = db.get(`SELECT sva.vendor_id FROM shipment_vendor_allocations sva
       JOIN shipment_customer_requirements scr ON sva.requirement_id = scr.id
       WHERE scr.product_name LIKE ?
       ORDER BY sva.id DESC LIMIT 1`, `%${productName}%`);
        let lastVendor = null;
        if (lastAlloc) {
            lastVendor = allVendors.find((v) => v.id === lastAlloc.vendor_id) || null;
        }
        res.json({
            product_name: productName,
            last_allocated_vendor: lastVendor,
            matching_vendors: matching,
            all_vendors: allVendors,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// POST /api/v1/vendors
vendorsRouter.post('', (req, res) => {
    try {
        const body = req.body;
        let cleanCode = (body.code || '').trim().toUpperCase();
        if (!cleanCode) {
            const countRow = db.get(`SELECT COUNT(*) as count FROM vendors`);
            const count = (countRow?.count || 0) + 1;
            const words = (body.name || '').trim().split(/\s+/);
            let namePart = words.map((w) => w[0]).join('').toUpperCase().slice(0, 3);
            if (namePart.length < 2)
                namePart = 'VEND';
            cleanCode = `${namePart}-${String(count).padStart(3, '0')}`;
        }
        const subCats = JSON.stringify(body.sub_categories || []);
        const prodsSupplied = JSON.stringify(body.products_supplied || []);
        const result = db.run(`INSERT INTO vendors (
        name, code, legal_name, trade_name, company_type, contact_person,
        email, phone, address, country, gstin, pan_number, bank_account_number,
        bank_ifsc_code, bank_name, bank_branch, main_category, sub_categories,
        products_supplied, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, String(body.name || '').trim(), cleanCode, body.legal_name || null, body.trade_name || null, body.company_type || 'Proprietorship', body.contact_person || null, body.email || null, body.phone || null, body.address || null, body.country || 'India', body.gstin || null, body.pan_number || null, body.bank_account_number || null, body.bank_ifsc_code || null, body.bank_name || null, body.bank_branch || null, body.main_category || null, subCats, prodsSupplied, body.status || 'Active Supplier');
        const created = db.get(`SELECT * FROM vendors WHERE id = ?`, result.lastInsertRowid);
        res.status(201).json({
            ...created,
            sub_categories: body.sub_categories || [],
            products_supplied: body.products_supplied || [],
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// PUT /api/v1/vendors/:id
vendorsRouter.put('/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const body = req.body;
        const existing = db.get(`SELECT * FROM vendors WHERE id = ?`, id);
        if (!existing)
            return res.status(404).json({ detail: 'Vendor not found' });
        const subCats = body.sub_categories ? JSON.stringify(body.sub_categories) : existing.sub_categories;
        const prodsSupplied = body.products_supplied ? JSON.stringify(body.products_supplied) : existing.products_supplied;
        db.run(`UPDATE vendors SET
        name = COALESCE(?, name),
        code = COALESCE(?, code),
        legal_name = COALESCE(?, legal_name),
        trade_name = COALESCE(?, trade_name),
        company_type = COALESCE(?, company_type),
        contact_person = COALESCE(?, contact_person),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        address = COALESCE(?, address),
        country = COALESCE(?, country),
        gstin = COALESCE(?, gstin),
        pan_number = COALESCE(?, pan_number),
        bank_account_number = COALESCE(?, bank_account_number),
        bank_ifsc_code = COALESCE(?, bank_ifsc_code),
        bank_name = COALESCE(?, bank_name),
        bank_branch = COALESCE(?, bank_branch),
        main_category = COALESCE(?, main_category),
        sub_categories = ?,
        products_supplied = ?,
        status = COALESCE(?, status)
      WHERE id = ?`, body.name, body.code, body.legal_name, body.trade_name, body.company_type, body.contact_person, body.email, body.phone, body.address, body.country, body.gstin, body.pan_number, body.bank_account_number, body.bank_ifsc_code, body.bank_name, body.bank_branch, body.main_category, subCats, prodsSupplied, body.status, id);
        const updated = db.get(`SELECT * FROM vendors WHERE id = ?`, id);
        res.json({
            ...updated,
            sub_categories: typeof updated.sub_categories === 'string' ? JSON.parse(updated.sub_categories || '[]') : updated.sub_categories || [],
            products_supplied: typeof updated.products_supplied === 'string' ? JSON.parse(updated.products_supplied || '[]') : updated.products_supplied || [],
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// DELETE /api/v1/vendors/:id
vendorsRouter.delete('/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        db.run(`DELETE FROM vendors WHERE id = ?`, id);
        res.json({ message: 'Vendor deleted successfully' });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
