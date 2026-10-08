import { db } from '../db/sqlite.js';

export function parseTariffRateVal(rateStr: any, baseValLkr: number, weightKg: number): number {
  if (!rateStr) return 0.0;
  const clean = String(rateStr).trim().toUpperCase();
  if (["FREE", "NIL", "-", "EX", "EXEMPT", "NONE", "0%", "0"].includes(clean)) {
    return 0.0;
  }

  // Composite "OR" pattern
  if (clean.includes(" OR ")) {
    const parts = clean.split(" OR ");
    const val1 = parseTariffRateVal(parts[0], baseValLkr, weightKg);
    const val2 = parseTariffRateVal(parts[1], baseValLkr, weightKg);
    return Math.max(val1, val2);
  }

  // Composite "+" pattern
  if (clean.includes("+")) {
    const parts = clean.split(/\s*\+\s*/);
    return parts.reduce((acc, p) => acc + parseTariffRateVal(p, baseValLkr, weightKg), 0);
  }

  // Specific rate per KG
  const matchKg = clean.match(/(?:RS\.?|LKR)?\s*(\d+(?:\.\d+)?)\s*(?:\/|PER)\s*KG/i);
  if (matchKg) {
    const ratePerKg = parseFloat(matchKg[1]);
    return ratePerKg * Math.max(weightKg, 0.0);
  }

  // Standard Percentage rate
  const matchPct = clean.match(/(\d+(?:\.\d+)?)\s*%/);
  if (matchPct) {
    const pct = parseFloat(matchPct[1]);
    return baseValLkr * (pct / 100.0);
  }

  // Direct numeric fallback
  const val = parseFloat(clean);
  if (!isNaN(val)) {
    return val <= 100 ? baseValLkr * (val / 100.0) : val;
  }
  return 0.0;
}

export function recalculateShipment(shipmentId: number): void {
  const shipment = db.get<any>(`SELECT * FROM shipments WHERE id = ?`, shipmentId);
  if (!shipment) return;

  const products = db.all<any>(`SELECT * FROM shipment_products WHERE shipment_id = ?`, shipmentId);
  if (!products || products.length === 0) return;

  const usdRate = parseFloat(shipment.usd_rate || 1.0);
  const lkrInrRate = parseFloat(shipment.lkr_inr_rate || 1.0);
  const targetMarginPct = parseFloat(shipment.profit_margin_pct || 15.0);
  const mode = shipment.freight_allocation_mode || 'WEIGHT';

  let commonExpLkr = parseFloat(shipment.common_expenses_lkr || 0.0);
  if (shipment.common_expenses_inr && parseFloat(shipment.common_expenses_inr) > 0) {
    commonExpLkr += parseFloat(shipment.common_expenses_inr) * (lkrInrRate !== 0 ? 1.0 / lkrInrRate : 1.0);
  }
  const portExpLkr = parseFloat(shipment.port_expenses_lkr || 0.0);

  const totalQty = products.reduce((acc, p) => acc + (parseFloat(p.quantity) || 0), 0) || 1.0;

  const productWeights: number[] = [];
  for (const p of products) {
    const q = parseFloat(p.quantity || 1.0);
    let w = parseFloat(p.net_weight_kg || p.weight_val || 0.0);
    const wUnit = String(p.weight_unit || 'KG').toUpperCase();
    if (['G', 'GRAM', 'GRAMS'].includes(wUnit)) {
      w = w / 1000.0;
    }
    productWeights.push(w > 0 ? w * q : q);
  }

  const totalShipmentWeight = productWeights.reduce((a, b) => a + b, 0) || 1.0;

  for (let idx = 0; idx < products.length; idx++) {
    const p = products[idx];
    const curr = (p.currency || 'INR').toUpperCase();
    const pPrice = parseFloat(p.purchase_price || 0.0);
    const qty = parseFloat(p.quantity || 1.0);
    const itemWeightTotal = productWeights[idx];
    const unitWeightKg = qty > 0 ? itemWeightTotal / qty : 0.0;

    let basePriceLkr = pPrice;
    if (curr === 'LKR') {
      basePriceLkr = pPrice;
    } else if (curr === 'INR') {
      basePriceLkr = lkrInrRate !== 0 ? pPrice / lkrInrRate : pPrice;
    } else if (curr === 'USD') {
      basePriceLkr = pPrice * usdRate;
    }

    let itemFreightLkr = 0.0;
    let itemPortLkr = 0.0;
    if (mode === 'WEIGHT' && totalShipmentWeight > 0) {
      const weightRatio = itemWeightTotal / totalShipmentWeight;
      itemFreightLkr = commonExpLkr * weightRatio;
      itemPortLkr = portExpLkr * weightRatio;
    } else {
      const qtyRatio = qty / totalQty;
      itemFreightLkr = commonExpLkr * qtyRatio;
      itemPortLkr = portExpLkr * qtyRatio;
    }

    const perUnitFreightLkr = qty > 0 ? itemFreightLkr / qty : 0.0;
    const perUnitPortLkr = qty > 0 ? itemPortLkr / qty : 0.0;

    // Search Tariff Database by HSN Code
    let tariffLine: any = null;
    let updatedHsn = p.hsn_code;
    if (p.hsn_code) {
      const rawHsn = String(p.hsn_code).trim();
      const cleanHsn = rawHsn.replace(/\./g, '');
      tariffLine = db.get<any>(
        `SELECT * FROM tariff_lines WHERE hs_code = ? OR hs_code = ? LIMIT 1`,
        rawHsn, cleanHsn
      );

      if (!tariffLine || (!tariffLine.general_duty_rate && !tariffLine.vat_rate && !tariffLine.pal_rate && !tariffLine.cess_rate && !tariffLine.scl_rate)) {
        const fallback = db.get<any>(
          `SELECT * FROM tariff_lines 
           WHERE (hs_code LIKE ? OR hs_code LIKE ?) 
             AND (general_duty_rate IS NOT NULL OR vat_rate IS NOT NULL OR pal_rate IS NOT NULL OR cess_rate IS NOT NULL OR scl_rate IS NOT NULL) 
           LIMIT 1`,
          `${rawHsn}%`, `${cleanHsn}%`
        );
        if (fallback) {
          tariffLine = fallback;
          if (fallback.hs_code) updatedHsn = fallback.hs_code;
        }
      }
    }

    const generalDutyRate = tariffLine?.general_duty_rate || null;
    const vatRate = tariffLine?.vat_rate || null;
    const palRate = tariffLine?.pal_rate || null;
    const cessRate = tariffLine?.cess_rate || null;
    const ssclRate = tariffLine?.sscl_rate || null;

    let itemClassification = p.item_classification || 'NORMAL';
    const isScl = itemClassification === 'SCL' || !!tariffLine?.scl_rate || (p.product_name && p.product_name.toLowerCase().includes('ghee'));
    if (isScl) itemClassification = 'SCL';

    let calculatedDutyLkr = 0.0;
    if (isScl && tariffLine?.scl_rate) {
      const sclDutyAmount = parseTariffRateVal(tariffLine.scl_rate, basePriceLkr, unitWeightKg);
      if (sclDutyAmount > 0) {
        calculatedDutyLkr = sclDutyAmount;
      } else {
        const cidAmt = parseTariffRateVal(tariffLine?.general_duty_rate, basePriceLkr, unitWeightKg);
        const palAmt = parseTariffRateVal(tariffLine?.pal_rate, basePriceLkr, unitWeightKg);
        const cessAmt = parseTariffRateVal(tariffLine?.cess_rate, basePriceLkr, unitWeightKg);
        const exciseAmt = parseTariffRateVal(tariffLine?.excise_rate, basePriceLkr + cidAmt + palAmt + cessAmt, unitWeightKg);
        const ssclBase = (basePriceLkr + cidAmt + palAmt + cessAmt + exciseAmt) * 1.10;
        const ssclAmt = parseTariffRateVal(tariffLine?.sscl_rate || '2.5%', ssclBase, unitWeightKg);
        const vatBase = (basePriceLkr + cidAmt + palAmt + cessAmt + exciseAmt + ssclAmt) * 1.10;
        const vatAmt = parseTariffRateVal(tariffLine?.vat_rate || '18.0%', vatBase, unitWeightKg);
        calculatedDutyLkr = cidAmt + palAmt + cessAmt + exciseAmt + ssclAmt + vatAmt;
      }
    } else {
      const cidAmt = parseTariffRateVal(tariffLine?.general_duty_rate, basePriceLkr, unitWeightKg);
      const palAmt = parseTariffRateVal(tariffLine?.pal_rate, basePriceLkr, unitWeightKg);
      const cessAmt = parseTariffRateVal(tariffLine?.cess_rate, basePriceLkr, unitWeightKg);
      const exciseAmt = parseTariffRateVal(tariffLine?.excise_rate, basePriceLkr + cidAmt + palAmt + cessAmt, unitWeightKg);
      const ssclBase = (basePriceLkr + cidAmt + palAmt + cessAmt + exciseAmt) * 1.10;
      const ssclAmt = parseTariffRateVal(tariffLine?.sscl_rate || '2.5%', ssclBase, unitWeightKg);
      const vatBase = (basePriceLkr + cidAmt + palAmt + cessAmt + exciseAmt + ssclAmt) * 1.10;
      const vatAmt = parseTariffRateVal(tariffLine?.vat_rate || '18.0%', vatBase, unitWeightKg);
      calculatedDutyLkr = cidAmt + palAmt + cessAmt + exciseAmt + ssclAmt + vatAmt;
    }

    const cnfPriceLkr = basePriceLkr + perUnitFreightLkr;
    const totalCostLkr = cnfPriceLkr + calculatedDutyLkr + perUnitPortLkr;

    const marginMode = shipment.margin_mode || 'MARGIN_ON_REVENUE';
    let marginDecimal = targetMarginPct / 100.0;
    let suggestedPriceLkr = totalCostLkr;

    if (marginMode === 'MARKUP_ON_COST') {
      suggestedPriceLkr = totalCostLkr * (1.0 + marginDecimal);
    } else {
      if (marginDecimal >= 1.0) marginDecimal = 0.99;
      suggestedPriceLkr = totalCostLkr / (1.0 - marginDecimal);
    }

    let finalPriceLkr = parseFloat(p.final_quotation_price || 0.0);
    if (finalPriceLkr <= 0.0) finalPriceLkr = suggestedPriceLkr;

    const discountLkr = parseFloat(p.discount_lkr || 0.0);
    const setPriceLkr = finalPriceLkr - discountLkr;
    const shortQty = parseFloat(p.short_qty || 0.0);
    const shortAmtLkr = shortQty * setPriceLkr;
    const grossSellAmtLkr = setPriceLkr * qty;
    const netSettlementLkr = grossSellAmtLkr - shortAmtLkr;

    const totalItemCostLkr = totalCostLkr * qty;
    const predictedProfitLkr = netSettlementLkr - totalItemCostLkr;

    const indianPriceInr = curr === 'INR' ? pPrice : basePriceLkr * lkrInrRate;
    const srilankanPriceLkr = finalPriceLkr;

    db.run(
      `UPDATE shipment_products SET
        hsn_code = ?,
        item_classification = ?,
        general_duty_rate = ?,
        vat_rate = ?,
        pal_rate = ?,
        cess_rate = ?,
        sscl_rate = ?,
        freight_allocation_lkr = ?,
        port_charges_lkr = ?,
        base_price_lkr = ?,
        cnf_price = ?,
        calculated_duty_lkr = ?,
        total_cost_lkr = ?,
        indian_price = ?,
        srilankan_price = ?,
        suggested_price = ?,
        final_quotation_price = ?,
        discount_lkr = ?,
        set_price_lkr = ?,
        short_qty = ?,
        short_amt_lkr = ?,
        net_settlement_lkr = ?,
        predicted_profit = ?
      WHERE id = ?`,
      updatedHsn,
      itemClassification,
      generalDutyRate,
      vatRate,
      palRate,
      cessRate,
      ssclRate,
      round2(itemFreightLkr),
      round2(itemPortLkr),
      round2(basePriceLkr),
      round2(cnfPriceLkr),
      round2(calculatedDutyLkr),
      round2(totalCostLkr),
      round2(indianPriceInr),
      round2(srilankanPriceLkr),
      round2(suggestedPriceLkr),
      round2(finalPriceLkr),
      round2(discountLkr),
      round2(setPriceLkr),
      round2(shortQty),
      round2(shortAmtLkr),
      round2(netSettlementLkr),
      round2(predictedProfitLkr),
      p.id
    );
  }
}

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}
