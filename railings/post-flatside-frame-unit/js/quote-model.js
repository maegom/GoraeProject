// post-flatside-frame-unit/js/quote-model.js
// 견적 로직 (QuoteCore / QuoteUI 기반)
// 구조:
// - 포스트(각관): 포스트 높이(단일) 적용
// - 측면 평철(세로재): 섹션(포스트-포스트)마다 2개, 길이 = (난간높이 - 시작높이)
// - 레일(각관): 섹션마다 상/하 1개씩, 길이 = (포스트 내측면 - 측면평철 - 측면평철 - 포스트 내측면)
// - ㅁ자 모듈(평철): 섹션 내에 자동 배치, 모듈 높이 자동

(() => {
  "use strict";

  const MODEL = "post-flatside-frame-unit";

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
      post_pitch_mm: num($("postInt")?.value, 1000),

      // post 각관
      postW: num($("postW")?.value, 20),
      postH: num($("postH")?.value, 50),      postHeight: num($("postHeight")?.value, 0),
// rail 각관(2단: 하/상)
      railW: num($("railW")?.value, 50),
      railH: num($("railH")?.value, 20),
      railStartY: num($("railStartY")?.value, 80),

      // flatbar(측면세로재 + ㅁ자모듈)
      barW: num($("barW")?.value, 45),
      barT: num($("barT")?.value, 6),

      // ㅁ자 모듈(가로폭/간격)
      moduleW: num($("moduleW")?.value, 100),
      moduleGap: num($("moduleGap")?.value, 100),
    };
  }

  function derive(inp) {
    const L = inp.length_mm;

    // 포스트 개수 (앱과 동일하게: 0..L를 pitch로 채우고 마지막 L 포함)
    const xs = [];
    for (let x = 0; x < L - 0.001; x += Math.max(1, inp.post_pitch_mm)) xs.push(x);
    if (xs.length === 0) xs.push(0);
    if (Math.abs(xs[xs.length - 1] - L) > 0.001) xs.push(L);

    const post_count = xs.length;
    const section_count = Math.max(0, post_count - 1);

        // 포스트 높이 합(단일)
    const postH = Math.max(50, inp.postHeight || inp.height_mm);
    const post_total_len = post_count * postH;

    // 측면 평철(세로재)
    const sideH = Math.max(0, inp.height_mm - inp.railStartY);
    const side_total_len = section_count * 2 * sideH;

    // 레일 길이: 섹션별로 (post 내측면 기준) - (측면평철 두께 2개)
    // innerLen = sectionLen - postW - 2*barT
    let rail_len_sum = 0;
    for (let i = 0; i < section_count; i++) {
      const secLen = xs[i + 1] - xs[i];
      const innerLen = Math.max(0, secLen - inp.postW - 2 * inp.barT);
      rail_len_sum += innerLen;
    }

    const rail_allow = QuoteCore.getModelRule(MODEL, "rail_allow_mm", 30);
    const rail_total_len = (rail_len_sum + section_count * rail_allow) * 2; // 상/하

    // 모듈 높이 자동(센터-센터 근사)
    const freeSpace = inp.height_mm - inp.railStartY - 2 * inp.railH;
    const moduleH = Math.max(0, freeSpace - inp.barT);

    // 모듈 개수(섹션별)
    let module_count = 0;
    for (let i = 0; i < section_count; i++) {
      const secLen = xs[i + 1] - xs[i];
      const innerLen = Math.max(0, secLen - inp.postW - 2 * inp.barT);

      const usable = Math.max(0, innerLen - 2 * inp.barT);
      const unit = inp.moduleW + inp.moduleGap;
      const n = unit > 0 ? Math.floor((usable + inp.moduleGap) / unit) : 0;
      module_count += Math.max(0, n);
    }

    const bar_total_len_mm = module_count * (2 * moduleH + 2 * inp.moduleW);

    return {
      post_count,
      section_count,
      module_count,
      moduleH,
      post_total_len,
      side_total_len,
      rail_total_len,
      bar_total_len_mm,
    };
  }

  function calcQuote(inp) {
    const d = derive(inp);

    // ✅ stock_code 매핑 규칙(시트의 stock_code와 맞춰야 함)
    const STOCK = {
      POST: `SQ${inp.postW}x${inp.postH}x2_SS400`,
      RAIL: `SQ${inp.railW}x${inp.railH}x2_SS400`,
      FB: `FB${inp.barW}x${inp.barT}_SS400`,
    };

    const bom = [];

    // 포스트(각관)
    {
      const len = d.post_total_len;
      const { name, cost } = QuoteCore.stockCostForLength(STOCK.POST, len);
      bom.push({ label: "포스트 각관", code: STOCK.POST, name, length_mm: len, cost });
    }

    // 레일(각관) 상/하
    {
      const len = d.rail_total_len;
      const { name, cost } = QuoteCore.stockCostForLength(STOCK.RAIL, len);
      bom.push({ label: "가로재(상/하) 각관", code: STOCK.RAIL, name, length_mm: len, cost });
    }

    // 측면 평철(세로재)
    {
      const len = d.side_total_len;
      const { name, cost } = QuoteCore.stockCostForLength(STOCK.FB, len);
      bom.push({ label: "측면 평철(세로재)", code: STOCK.FB, name, length_mm: len, cost });
    }

    // ㅁ자 모듈 평철
    {
      const len = d.bar_total_len_mm;
      const { name, cost } = QuoteCore.stockCostForLength(STOCK.FB, len);
      bom.push({ label: "ㅁ자 모듈 평철", code: STOCK.FB, name, length_mm: len, cost });
    }

    const material_cost = bom.reduce((a, x) => a + x.cost, 0);

    // 공정 메트릭(MVP 근사)
    const cuts =
      d.post_count +                       // 포스트 컷
      d.section_count * 2 +                // 레일(상/하)
      d.section_count * 2 +                // 측면평철(좌/우)
      d.module_count * 4;                  // 모듈(4피스)

    // 용접/그라인딩 근사
    const weld_m =
      (d.section_count * 4 * 0.05) +       // 레일-측면평철 결합(섹션당 4코너, 50mm씩)
      (d.module_count * (2 * (d.moduleH + inp.moduleW)) / 1000); // 모듈 둘레 근사

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

  if (!bindQuoteNow()) {
    window.addEventListener("DOMContentLoaded", bindQuoteNow, { once: true });
  }
})();
