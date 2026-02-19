// shared/quote/quote-core.js
(() => {
  "use strict";

  const QuoteCore = {};

  // ---- utils ----
  QuoteCore.num = (v, fb = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };

  QuoteCore.fmtKRW = (n) => {
    const x = Math.round(QuoteCore.num(n, 0));
    return x.toLocaleString("ko-KR") + "원";
  };

  function splitCSVLine(line) {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQ = !inQ;
      } else if (c === "," && !inQ) {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
    out.push(cur);
    return out;
  }

  QuoteCore.parseCSV = (text) => {
    const lines = text.trim().split(/\r?\n/);
    const headers = splitCSVLine(lines.shift()).map((h) => h.trim());
    return lines
      .filter((l) => l.trim().length)
      .map((line) => {
        const cols = splitCSVLine(line);
        const row = {};
        headers.forEach((h, i) => (row[h] = (cols[i] ?? "").trim()));
        return row;
      });
  };

  QuoteCore.fetchCSV = async (url) => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("CSV 로드 실패: " + res.status);
    const text = await res.text();
    return QuoteCore.parseCSV(text);
  };

  // ---- DB cache (공통) ----
  const DB = {
    loaded: false,
    stockByCode: new Map(),     // stock_code -> {..}
    processRule: new Map(),     // step -> { unit, min_per_unit }
    shop: null,                // { labor_cost_per_min, overhead_rate, margin_rate_default, vat_rate }
    modelRules: [],            // rows with model_code, key, value
  };

  QuoteCore.DB = DB;

  QuoteCore.loadDB = async (sheetUrls) => {
    if (DB.loaded) return;

    const [stocks, processes, shopRates, modelRules] = await Promise.all([
      QuoteCore.fetchCSV(sheetUrls.stock_items),
      QuoteCore.fetchCSV(sheetUrls.process),
      QuoteCore.fetchCSV(sheetUrls.shop_rate),
      QuoteCore.fetchCSV(sheetUrls.model_rules),
    ]);

    // stock_items
    stocks.forEach((r) => {
      const code = r.stock_code;
      if (!code) return;
      DB.stockByCode.set(code, {
        code,
        name: r.name || code,
        uom: r.uom || "m",
        kg_per_m: QuoteCore.num(r.kg_per_m, 0),
        cost_per_kg: QuoteCore.num(r.cost_per_kg, 0),
        cost_per_m: QuoteCore.num(r.cost_per_m, 0),
      });
    });

    // process
    processes.forEach((r) => {
      if (!r.step) return;
      DB.processRule.set(r.step, {
        unit: r.unit || "ea",
        min_per_unit: QuoteCore.num(r.min_per_unit, 0),
      });
    });

    // shop_rate (first row)
    const s = shopRates[0] || {};
    DB.shop = {
      labor_cost_per_min: QuoteCore.num(s.labor_cost_per_min, 0),
      overhead_rate: QuoteCore.num(s.overhead_rate, 0),
      margin_rate_default: QuoteCore.num(s.margin_rate_default, 0.25),
      vat_rate: QuoteCore.num(s.vat_rate, 0.1),
    };

    // model_rules
    DB.modelRules = modelRules.map((r) => ({
      model_code: r.model_code || "",
      key: r.key || "",
      value: QuoteCore.num(r.value, 0),
    }));

    DB.loaded = true;
  };

  QuoteCore.getModelRule = (model_code, key, fallback = 0) => {
    const row = DB.modelRules.find((x) => x.model_code === model_code && x.key === key);
    return row ? row.value : fallback;
  };

  QuoteCore.stockCostForLength = (stock_code, length_mm) => {
    const s = DB.stockByCode.get(stock_code);
    if (!s) throw new Error(`stock_code 없음: ${stock_code}`);

    const m = length_mm / 1000;
    const cost_per_m =
      s.cost_per_m > 0 ? s.cost_per_m : (s.kg_per_m > 0 && s.cost_per_kg > 0 ? s.kg_per_m * s.cost_per_kg : 0);

    if (!(cost_per_m > 0)) {
      throw new Error(`단가 비어있음: ${stock_code} (cost_per_m 또는 kg_per_m+cost_per_kg 필요)`);
    }
    return { name: s.name, cost: m * cost_per_m, cost_per_m };
  };

  // expose
  window.QuoteCore = QuoteCore;
})();
