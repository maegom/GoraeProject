// shared/quote/quote-ui.js
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const QuoteUI = {};

  QuoteUI.render = (result) => {
    $("quoteTotal").textContent = QuoteCore.fmtKRW(result.pricing.sell_total);

    const b = result.pricing;
    $("quoteBreakdown").innerHTML =
      `자재비: <b>${QuoteCore.fmtKRW(b.material_cost)}</b><br>` +
      `인건비: <b>${QuoteCore.fmtKRW(b.labor_cost)}</b> (총 ${result.process.labor_minutes.toFixed(1)}분)<br>` +
      `간접비: <b>${QuoteCore.fmtKRW(b.overhead_cost)}</b><br>` +
      `VAT: <b>${QuoteCore.fmtKRW(b.vat)}</b><br>`;

    const bomHtml = result.bom
      .map((x) => {
        const lenTxt = x.length_mm ? ` / ${(x.length_mm / 1000).toFixed(2)}m` : "";
        const qtyTxt = x.qty ? ` / ${x.qty}ea` : "";
        return `- ${x.label} (${x.code})${lenTxt}${qtyTxt}: <b>${QuoteCore.fmtKRW(x.cost)}</b>`;
      })
      .join("<br>");

    $("quoteBOM").innerHTML = `<div style="margin-top:6px; font-weight:900;">BOM</div>${bomHtml}`;
  };

  // 이 함수는 페이지별 quote-model.js가 "QuoteUI.bind(...)"를 호출해서 연결한다.
  QuoteUI.bind = ({ sheetUrls, model_code, readInputs, calcQuote }) => {
    async function run() {
      await QuoteCore.loadDB(sheetUrls);
      const inputs = readInputs();
      const result = calcQuote(inputs);
      QuoteUI.render(result);
    }

    const btn = $("btnQuote");
    if (btn) btn.addEventListener("click", () => run().catch((e) => alert(e.message)));

    return { run };
  };

  window.QuoteUI = QuoteUI;
})();
