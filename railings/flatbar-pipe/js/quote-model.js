// flatbar.html/js/quote-model.js
(() => {
  "use strict";

  const MODEL = "flatbar-pipe";

  // ✅ 여기만 네 구글시트 CSV URL로 교체(포스트 페이지랑 같은 시트를 써도 됨)
  const SHEET_URLS = {
    stock_items: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTFLr23mr3veieSCtCWSQ5AQWVkCjpXN8BE2_yueplC3_J1GvVQHMJJPFXXaSEsiGujAjibR7Eb3X-0/pub?gid=0&single=true&output=csv",
    process: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTFLr23mr3veieSCtCWSQ5AQWVkCjpXN8BE2_yueplC3_J1GvVQHMJJPFXXaSEsiGujAjibR7Eb3X-0/pub?gid=1469309212&single=true&output=csv",
    shop_rate: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTFLr23mr3veieSCtCWSQ5AQWVkCjpXN8BE2_yueplC3_J1GvVQHMJJPFXXaSEsiGujAjibR7Eb3X-0/pub?gid=332181798&single=true&output=csv",
    model_rules: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTFLr23mr3veieSCtCWSQ5AQWVkCjpXN8BE2_yueplC3_J1GvVQHMJJPFXXaSEsiGujAjibR7Eb3X-0/pub?gid=19261564&single=true&output=csv",
  };

  const $ = (id) => document.getElementById(id);
  const num = QuoteCore.num;

  // app.js의 POST_CFG 일부만 견적에도 동일 반영(시각과 BOM 근사 맞추기)
  const POST_CFG = {
    pairGapExtra: 2,
    basePlateExtraW: 40,
    headWScale: 0.6,
    postCapMin: 40,
    postCapExtra: 0,
  };

  function readInputs() {
    const parts = window.APP?.getParts?.() ?? {
      posts: true,
      railBot: true,
      slats: true,
      railTop: true,
    };

    return {
      length_mm: num($("totalL")?.value, 3000),
      height_mm: num($("height")?.value, 1200),
      post_pitch_mm: num($("postInt")?.value, 1000),

      picket_gap_mm: num($("picketGap")?.value, 100),
      pipe_od_mm: num($("pipeOD")?.value, 20),

      barW: num($("barW")?.value, 50),
      barT: num($("barT")?.value, 6),

      parts,
    };
  }

  function derive(inp) {
    const L = inp.length_mm;
    const H = inp.height_mm;

    const ground = QuoteCore.getModelRule(MODEL, "ground_mm", 60);

    const numSections = Math.max(1, Math.round(L / Math.max(1, inp.post_pitch_mm)));
    const actualInterval = L / numSections;
    const post_positions = numSections + 1;

    const minGap = inp.pipe_od_mm + POST_CFG.pairGapExtra;
    const pGapSafe = Math.max(inp.picket_gap_mm, minGap);

    const picketH = Math.max(50, H - ground - (inp.barT * 2));

    // app.js와 동일한 “구간 내 살” 개수 근사
    const netWidth = actualInterval - pGapSafe;
    const subCountPerSection = Math.max(0, Math.floor(netWidth / pGapSafe) - 1);
    const infill_count = numSections * subCountPerSection;

    // 포스트는 “2개/지점”
    const post_pipe_count = post_positions * 2;

    // 포스트 캡 길이 근사
    const basePlateW = pGapSafe + inp.pipe_od_mm + POST_CFG.basePlateExtraW;
    const headW = basePlateW * POST_CFG.headWScale;
    const capLen = Math.max(POST_CFG.postCapMin, headW + POST_CFG.postCapExtra);

    return {
      ground,
      numSections,
      actualInterval,
      post_positions,
      pGapSafe,
      picketH,
      subCountPerSection,
      infill_count,
      post_pipe_count,
      capLen,
    };
  }

  function calcQuote(inp) {
    const d = derive(inp);

    // ✅ stock_code 매핑(시트 stock_code와 반드시 맞춰야 함)
    // 평철은 기존과 같은 규칙
    const STOCK = {
      BAR: `FB${inp.barW}x${inp.barT}_SS400`,
      // ⚠️ 파이프는 네 시트 코드에 맞게 수정 필요 (예: PIPE20x1.5_SS400 등)
      PIPE: `PIPE${inp.pipe_od_mm}_SS400`,
    };

    const bom = [];
    const parts = inp.parts || {};

    // ====== (1) 평철(상/하) ======
    const rail_allow = QuoteCore.getModelRule(MODEL, "rail_allow_mm", 0);

    if (parts.railTop) {
      const len = inp.length_mm + rail_allow;
      const { name, cost } = QuoteCore.stockCostForLength(STOCK.BAR, len);
      bom.push({ label: "상부 평철", code: STOCK.BAR, name, length_mm: len, cost });
    }

    if (parts.railBot) {
      const len = inp.length_mm + rail_allow;
      const { name, cost } = QuoteCore.stockCostForLength(STOCK.BAR, len);
      bom.push({ label: "하부 평철", code: STOCK.BAR, name, length_mm: len, cost });
    }

    // ====== (2) 포스트 캡(상/하) 근사 (포스트 ON일 때만) ======
    if (parts.posts && (parts.railTop || parts.railBot)) {
      const capCount = d.post_positions * ((parts.railTop ? 1 : 0) + (parts.railBot ? 1 : 0));
      const capTotalLen = capCount * d.capLen;
      const { name, cost } = QuoteCore.stockCostForLength(STOCK.BAR, capTotalLen);
      bom.push({ label: "포스트 캡 평철(근사)", code: STOCK.BAR, name, length_mm: capTotalLen, cost });
    }

    // ====== (3) 파이프(포스트/중간살) ======
    // 포스트 파이프(2ea/지점) : posts 켜져있을 때만
    let pipeLenPosts = 0;
    if (parts.posts) {
      pipeLenPosts = d.post_pipe_count * d.picketH;
      const { name, cost } = QuoteCore.stockCostForLength(STOCK.PIPE, pipeLenPosts);
      bom.push({ label: "포스트 파이프(2ea/지점)", code: STOCK.PIPE, name, length_mm: pipeLenPosts, cost });
    }

    // 중간살(구간 내 살)
    let pipeLenInfill = 0;
    if (parts.slats) {
      pipeLenInfill = d.infill_count * d.picketH;
      const { name, cost } = QuoteCore.stockCostForLength(STOCK.PIPE, pipeLenInfill);
      bom.push({ label: "중간살 파이프", code: STOCK.PIPE, name, length_mm: pipeLenInfill, cost });
    }

    const material_cost = bom.reduce((a, x) => a + (x.cost || 0), 0);

    // ====== (4) 공정 메트릭(MVP 근사) ======
    // 절단: 평철(상/하) + 포스트파이프 + 중간살
    const cut_flat = (parts.railTop ? d.numSections : 0) + (parts.railBot ? d.numSections : 0);
    const cut_pipe = (parts.posts ? d.post_pipe_count : 0) + (parts.slats ? d.infill_count : 0);
    const cuts = cut_flat + cut_pipe;

    // 홀: 중간살 체결(2홀/살) + 앙카(4홀/지점) 근사
    const holes = (parts.slats ? d.infill_count * 2 : 0) + (parts.posts ? d.post_positions * 4 : 0);

    const weld_m = 0;   // 볼트/팝너트 전제(근사)
    const grind_m = 0;
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

    const margin_rate = QuoteCore.DB.shop.margin_rate_default ?? 0.25;
    const vat_rate = QuoteCore.DB.shop.vat_rate ?? 0.1;

    const sell_before_vat = cost_total * (1 + margin_rate);
    const vat = sell_before_vat * vat_rate;
    const sell_total = sell_before_vat + vat;

    return {
      derived: d,
      bom,
      process: { cuts, weld_m, holes, grind_m, assembly_ea, labor_minutes: mins, labor_cost },
      pricing: {
        material_cost,
        labor_cost,
        overhead_cost,
        cost_total,
        sell_before_vat,
        vat,
        sell_total,
        margin_rate,
        vat_rate,
      },
    };
  }

  window.addEventListener("DOMContentLoaded", () => {
    // QuoteUI / QuoteCore가 로드된 뒤에 bind
    if (!window.QuoteUI || !window.QuoteCore) return;

    QuoteUI.bind({
      sheetUrls: SHEET_URLS,
      model_code: MODEL,
      readInputs,
      calcQuote,
    });
  });
})();