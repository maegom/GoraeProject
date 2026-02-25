// post-bound-frame-unit/js/quote-model.js
(() => {
  "use strict";

  const MODEL = "post-bound-frame-unit";

  // ✅ 여기만 네 구글시트 CSV URL로 교체
  const SHEET_URLS = {
    stock_items:
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vTFLr23mr3veieSCtCWSQ5AQWVkCjpXN8BE2_yueplC3_J1GvVQHMJJPFXXaSEsiGujAjibR7Eb3X-0/pub?gid=0&single=true&output=csv",
    process:
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vTFLr23mr3veieSCtCWSQ5AQWVkCjpXN8BE2_yueplC3_J1GvVQHMJJPFXXaSEsiGujAjibR7Eb3X-0/pub?gid=1469309212&single=true&output=csv",
    shop_rate:
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vTFLr23mr3veieSCtCWSQ5AQWVkCjpXN8BE2_yueplC3_J1GvVQHMJJPFXXaSEsiGujAjibR7Eb3X-0/pub?gid=332181798&single=true&output=csv",
    model_rules:
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vTFLr23mr3veieSCtCWSQ5AQWVkCjpXN8BE2_yueplC3_J1GvVQHMJJPFXXaSEsiGujAjibR7Eb3X-0/pub?gid=19261564&single=true&output=csv",
  };

  const $ = (id) => document.getElementById(id);
  const num = QuoteCore.num;

  function readInputs() {
    return {
      length_mm: num($("totalL")?.value, 0),
      height_mm: num($("height")?.value, 0),
      post_pitch_mm: num($("postInt")?.value, 1100),

      // post 각관
      postW: num($("postW")?.value, 20),
      postH: num($("postH")?.value, 50),

      // rail 각관(2단: 하/상)
      railW: num($("railW")?.value, 50),
      railH: num($("railH")?.value, 20),
      railStartY: num($("railStartY")?.value, 80),

      // ㅁ자 모듈(평철) - 높이는 자동 계산
      barW: num($("barW")?.value, 45),
      barT: num($("barT")?.value, 6),
      moduleW: num($("moduleW")?.value, 100),
      moduleGap: num($("moduleGap")?.value, 100),
    };
  }

  function derive(inp) {
    const L = inp.length_mm;
    const post_count = Math.ceil(L / Math.max(1, inp.post_pitch_mm)) + 1;

    const rail_allow = QuoteCore.getModelRule(MODEL, "rail_allow_mm", 50);
    const module_edge_clear = QuoteCore.getModelRule(MODEL, "module_edge_clear_mm", 40);

    const usable_L = Math.max(0, L - 2 * module_edge_clear);
    const unit = inp.moduleW + inp.moduleGap;
    const module_count = unit > 0 ? Math.max(0, Math.floor((usable_L + inp.moduleGap) / unit)) : 0;

    const rail_len_mm_each = L + rail_allow; // 하/상부 각각 길이(근사)

    // ✅ 모듈 높이 자동 계산 (center-center 기준)
    // 상부레일 하단: height_mm - railH
    // 하부레일 상단: railStartY + railH
    // freeSpace = (height_mm - railH) - (railStartY + railH)
    // moduleH = freeSpace - barT
    const freeSpace = inp.height_mm - inp.railStartY - 2 * inp.railH;
    const moduleH = Math.max(0, freeSpace - inp.barT);

    // 모듈 1개당 평철 길이(세로2 + 가로2)
    const bar_total_len_mm = module_count * (2 * moduleH + 2 * inp.moduleW);

    return { post_count, module_count, rail_len_mm_each, moduleH, bar_total_len_mm };
  }

  function calcQuote(inp) {
    const d = derive(inp);

    // ✅ stock_code 매핑 규칙(시트의 stock_code와 맞춰야 함)
    const STOCK = {
      POST: `SQ${inp.postW}x${inp.postH}x2_SS400`,
      RAIL: `SQ${inp.railW}x${inp.railH}x2_SS400`,
      BAR: `FB${inp.barW}x${inp.barT}_SS400`,
    };

    const bom = [];

    // 포스트
    {
      const len = d.post_count * inp.height_mm;
      const { name, cost } = QuoteCore.stockCostForLength(STOCK.POST, len);
      bom.push({ label: "포스트 각관", code: STOCK.POST, name, length_mm: len, cost });
    }

    // 가로재 2단 (상/하)
    {
      const len = 2 * d.rail_len_mm_each;
      const { name, cost } = QuoteCore.stockCostForLength(STOCK.RAIL, len);
      bom.push({ label: "가로재(2단) 각관", code: STOCK.RAIL, name, length_mm: len, cost });
    }

    // ㅁ자 모듈 평철
    {
      const len = d.bar_total_len_mm;
      const { name, cost } = QuoteCore.stockCostForLength(STOCK.BAR, len);
      bom.push({ label: "ㅁ자 모듈 평철", code: STOCK.BAR, name, length_mm: len, cost });
    }

    const material_cost = bom.reduce((a, x) => a + x.cost, 0);

    // 공정 메트릭(MVP 근사)
    const cuts = d.post_count + 2 + d.module_count * 4; // 포스트 + 상/하 레일 + 모듈(4피스)
    const weld_m = d.module_count * (2 * (inp.moduleW + d.moduleH)) / 1000;
    const holes = d.module_count * 6;
    const assembly_ea = holes;
    const grind_m = weld_m;

    const pr = QuoteCore.DB.processRule;
    const labor_per_min = QuoteCore.DB.shop.labor_cost_per_min;

    const mins =
      (pr.get("cut")?.min_per_unit || 0) * cuts +
      (pr.get("weld")?.min_per_unit || 0) * weld_m +
      (pr.get("drill")?.min_per_unit || 0) * holes +
      (pr.get("assembly")?.min_per_unit || 0) * assembly_ea +
      (pr.get("grind")?.min_per_unit || 0) * grind_m;

    const labor_cost = mins * labor_per_min;
    const overhead_cost = (material_cost + labor_cost) * (QuoteCore.DB.shop.overhead_rate || 0);

    const cost_total = material_cost + labor_cost + overhead_cost;

    const margin = QuoteCore.DB.shop.margin_rate_default ?? 0.25;
    const vat_rate = QuoteCore.DB.shop.vat_rate ?? 0.1;

    const sell_before_vat = cost_total * (1 + margin);
    const vat = sell_before_vat * vat_rate;
    const sell_total = sell_before_vat + vat;

    return {
      derived: d,
      bom,
      process: { cuts, weld_m, holes, grind_m, assembly_ea, labor_minutes: mins, labor_cost },
      pricing: { material_cost, labor_cost, overhead_cost, cost_total, sell_before_vat, vat, sell_total },
    };
  }

  function bindQuoteNow() {
    if (!window.QuoteUI || !window.QuoteCore) return false;

    QuoteUI.bind({
      sheetUrls: SHEET_URLS,
      model_code: MODEL,
      readInputs,
      calcQuote,
    });
    console.log("[quote] bind OK");
    return true;
  }

  // DOM이 이미 준비됐으면 즉시, 아니면 준비되면 실행
  if (!bindQuoteNow()) {
    window.addEventListener("DOMContentLoaded", bindQuoteNow, { once: true });
  }
})();