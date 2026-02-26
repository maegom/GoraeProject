// rail-insert-rectframe/js/quote-model.js
// (렌더링 HDRI/스테인리스 재질 설정은 견적 계산에 영향 없음)
(() => {
  "use strict";

  const MODEL = "rail-insert-rectframe";

  // ✅ 네 시트 URL로 교체
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
  const num = (v, fb = 0) => (window.QuoteCore ? QuoteCore.num(v, fb) : (+v || fb));

  function readInputs() {
    return {
      length_mm: num($("totalL")?.value, 0),
      height_mm: num($("height")?.value, 0),
      post_pitch_mm: num($("postInt")?.value, 1000),

      postW: num($("postW")?.value, 50),
      postD: num($("postD")?.value, 50),
      basePlateT: num($("basePlateT")?.value, 10),

      railW: num($("railW")?.value, 50),
      railH: num($("railH")?.value, 30),
      topClear: num($("topRailTopClear")?.value, 300),
      botClear: num($("botRailBotClear")?.value, 100),

      moduleLen: num($("moduleLen")?.value, 1130),
      barW: num($("barW")?.value, 50),
      barT: num($("barT")?.value, 6),
      barPitch: num($("barPitch")?.value, 100),
      insertDepth: num($("insertDepth")?.value, 0),
    };
  }

  function postPositions(L, pitch) {
    const xs = [];
    for (let x = 0; x < L - 0.001; x += Math.max(1, pitch)) xs.push(x);
    if (xs.length === 0) xs.push(0);
    if (Math.abs(xs[xs.length - 1] - L) > 0.001) xs.push(L);
    return xs;
  }

  function moduleCountForSection(innerLen, pitch) {
    // N modules => span = (2N-1)*pitch
    if (pitch <= 0) return 0;
    const N = Math.floor((innerLen / pitch + 1) / 2);
    return Math.max(0, N);
  }

  function derive(inp) {
    const xs = postPositions(inp.length_mm, inp.post_pitch_mm);
    const post_count = xs.length;
    const section_count = Math.max(0, post_count - 1);

    // rail vertical positions -> post height auto
    const yTopRailTop = inp.height_mm - inp.topClear;
    const postTopY = yTopRailTop - inp.railH; // 상부레일 아랫면 = 포스트 상단
    const postHeight = Math.max(50, postTopY); // 바닥(0) 기준 높이

    let topRailLen = 0;
    let botRailLen = 0;

    let module_count_total = 0;

    for (let i = 0; i < section_count; i++) {
      const secLen = xs[i + 1] - xs[i];
      topRailLen += secLen; // center-to-center
      botRailLen += Math.max(0, secLen - inp.postW); // inner faces

      const innerLen = Math.max(0, secLen - inp.postW);
      const n = moduleCountForSection(innerLen, inp.barPitch);
      module_count_total += n;
    }

    const vertBars = module_count_total * 2;
    const crossBars = module_count_total * 2;

    // length totals
    const vertLen = vertBars * inp.moduleLen;
    const crossLen = crossBars * inp.barPitch;

    return {
      post_count,
      section_count,
      postHeight,
      topRailLen,
      botRailLen,
      module_count_total,
      vertBars,
      crossBars,
      vertLen,
      crossLen,
    };
  }

  function calcQuote(inp) {
    const d = derive(inp);

    if (!window.QuoteCore) {
      return {
        derived: d,
        bom: [],
        pricing: {
          material_cost: 0,
          labor_cost: 0,
          overhead_cost: 0,
          cost_total: 0,
          sell_before_vat: 0,
          vat: 0,
          sell_total: 0,
        },
        process: {},
      };
    }

    const rail_allow = QuoteCore.getModelRule(MODEL, "rail_allow_mm", 50);

    // stock code mapping (시트 stock_code에 맞춰야 함)
    const STOCK = {
      POST: `SQ${inp.postW}x${inp.postD}x2_SS400`,
      RAIL: `SQ${inp.railW}x${inp.railH}x2_SS400`,
      VBAR: `FB${inp.barW}x${inp.barT}_SS400`,
      // 가로평철은 "세워짐": 구매 규격은 폭=railH, 두께=barT로 보는게 자연스러움
      CBAR: `FB${inp.railH}x${inp.barT}_SS400`,
    };

    const bom = [];

    // posts
    {
      const len = d.post_count * d.postHeight;
      const { name, cost } = QuoteCore.stockCostForLength(STOCK.POST, len);
      bom.push({ label: "포스트 각관", code: STOCK.POST, name, length_mm: len, cost });
    }

    // rails
    {
      const topLen = d.topRailLen + rail_allow * d.section_count;
      const botLen = d.botRailLen + rail_allow * d.section_count;
      const len = topLen + botLen;
      const { name, cost } = QuoteCore.stockCostForLength(STOCK.RAIL, len);
      bom.push({ label: "레일(상+하) 각관", code: STOCK.RAIL, name, length_mm: len, cost });
    }

    // vertical flat bars
    {
      const len = d.vertLen;
      const { name, cost } = QuoteCore.stockCostForLength(STOCK.VBAR, len);
      bom.push({ label: "세로 평철(모듈)", code: STOCK.VBAR, name, length_mm: len, cost });
    }

    // cross flat bars (standing)
    {
      const len = d.crossLen;
      const { name, cost } = QuoteCore.stockCostForLength(STOCK.CBAR, len);
      bom.push({ label: "가로 평철(세워짐)", code: STOCK.CBAR, name, length_mm: len, cost });
    }

    const material_cost = bom.reduce((a, x) => a + x.cost, 0);

    // process rough metrics
    const cuts = d.post_count + d.section_count * 2 + d.module_count_total * 4;
    const holes = d.module_count_total * 6; // 임의
    const weld_m = (d.vertLen + d.crossLen) / 1000 * 0.15; // 매우 러프
    const grind_m = weld_m;
    const assembly_ea = holes;

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

  function bind() {
    if (!window.QuoteUI || !window.QuoteCore) return false;

    QuoteUI.bind({
      sheetUrls: SHEET_URLS,
      model_code: MODEL,
      readInputs,
      calcQuote,
    });

    return true;
  }

  if (!bind()) {
    window.addEventListener("DOMContentLoaded", bind, { once: true });
  }
})();
