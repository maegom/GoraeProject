// shared/quote/quote-ui.js
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const QuoteUI = {};
  QuoteUI._lastResult = null;
  QuoteUI._run = null;

  const R = (n) => Math.round(Number(n || 0)); // 원 단위
  const KRW = (n) => R(n).toLocaleString("ko-KR") + "원";

  // ---- (공통) pricing 정합 계산: "마진"을 분리해서 out 만들기 ----
  function buildOutFromResult(result) {
    const p = result?.pricing || {};

    // vat/margin rate 우선순위: pricing -> DB(shop) -> fallback
    const vatRate =
      (typeof p.vat_rate === "number") ? p.vat_rate :
      (typeof QuoteCore?.DB?.shop?.vat_rate === "number") ? QuoteCore.DB.shop.vat_rate :
      0.1;

    const marginRate =
      (typeof p.margin_rate === "number") ? p.margin_rate :
      (typeof QuoteCore?.DB?.shop?.margin_rate_default === "number") ? QuoteCore.DB.shop.margin_rate_default :
      0.25;

    const material = R(p.material_cost);
    const labor = R(p.labor_cost);
    const overhead = R(p.overhead_cost);

    // ✅ 원가(=cost_total의 근본)
    const baseCost = material + labor + overhead;

    // 모델이 이미 계산해준 값(있으면 우선)
    const sellBeforeVatRaw = (p.sell_before_vat != null) ? R(p.sell_before_vat) : null;
    const vatRaw = (p.vat != null) ? R(p.vat) : null;
    const sellTotalRaw = (p.sell_total != null) ? R(p.sell_total) : null;

    let sellBeforeVat, vat, total;

    if (sellBeforeVatRaw != null) {
      sellBeforeVat = sellBeforeVatRaw;
      vat = (vatRaw != null) ? vatRaw : R(sellBeforeVat * vatRate);
      total = (sellTotalRaw != null) ? sellTotalRaw : (sellBeforeVat + vat);
    } else if (sellTotalRaw != null) {
      // sell_total만 있으면 역산
      sellBeforeVat = R(sellTotalRaw / (1 + vatRate));
      vat = sellTotalRaw - sellBeforeVat;
      total = sellTotalRaw;
    } else {
      // fallback: 마진/부가세를 여기서 만든다
      sellBeforeVat = R(baseCost * (1 + marginRate));
      vat = R(sellBeforeVat * vatRate);
      total = sellBeforeVat + vat;
    }

    // ✅ 마진(공급가 - 원가)
    const marginAmt = sellBeforeVat - baseCost;

    return {
      material,
      labor,
      overhead,
      baseCost,
      marginRate,
      marginAmt,
      supply: sellBeforeVat, // 공급가(부가세 전 판매가)
      vatRate,
      vat,
      total,
    };
  }

  // ---- UI Render ----
  QuoteUI.render = (result) => {
    QuoteUI._lastResult = result;

    const out = buildOutFromResult(result);
    $("quoteTotal").textContent = KRW(out.total);

    const laborMin = Number(result?.process?.labor_minutes || 0);

    $("quoteBreakdown").innerHTML =
      `자재비: <b>${KRW(out.material)}</b><br>` +
      `인건비: <b>${KRW(out.labor)}</b> (총 ${laborMin.toFixed(1)}분)<br>` +
      `간접비: <b>${KRW(out.overhead)}</b><br>` +
      `마진: <b>${KRW(out.marginAmt)}</b> <span style="color:#888;">(${Math.round(out.marginRate * 100)}%)</span><br>` +
      `VAT: <b>${KRW(out.vat)}</b> <span style="color:#888;">(${Math.round(out.vatRate * 100)}%)</span><br>` +
      `<div style="margin-top:6px; color:#666;">공급가(부가세 제외): <b>${KRW(out.supply)}</b></div>`;

    const bomHtml = (result?.bom || [])
      .map((x) => {
        const lenTxt = x.length_mm ? ` / ${(x.length_mm / 1000).toFixed(2)}m` : "";
        const qtyTxt = x.qty ? ` / ${x.qty}ea` : "";
        return `- ${x.label} (${x.code})${lenTxt}${qtyTxt}: <b>${KRW(x.cost)}</b>`;
      })
      .join("<br>");

    $("quoteBOM").innerHTML =
      `<div style="margin-top:6px; font-weight:900;">BOM</div>${bomHtml || "(BOM 없음)"}`;

    // PDF 버튼 표시
    const pdfBtn = $("btnQuotePdf");
    if (pdfBtn) pdfBtn.style.display = "inline-flex";
  };

  // ---- bind ----
  QuoteUI.bind = ({ sheetUrls, model_code, readInputs, calcQuote }) => {
    async function run() {
      await QuoteCore.loadDB(sheetUrls);
      const inputs = readInputs();
      const result = calcQuote(inputs);
      QuoteUI.render(result);
      return result;
    }

    QuoteUI._run = run;

    const btn = $("btnQuote");
    if (btn) btn.addEventListener("click", () => run().catch((e) => alert(e.message)));

    // ✅ 자동 재산출: input 변경 시 debounce
    const debounced = (() => {
      let t = null;
      return () => {
        clearTimeout(t);
        t = setTimeout(() => run().catch(() => {}), 250);
      };
    })();

    // 페이지 내 number input 전부 자동 연결
    document.querySelectorAll('input[type="number"], input[type="color"]').forEach((el) => {
      el.addEventListener("input", debounced);
      el.addEventListener("change", debounced);
    });

    return { run };
  };

  // ===== PDF Export : 견적서 양식(문구 + 공급자표 + 견적금액 + 항목별 + BOM + 정합) =====
  (function attachPdfExport() {
    const btnPdf = $("btnQuotePdf");
    if (!btnPdf) return;

    const wrap = (doc, text, maxW) => doc.splitTextToSize(String(text || ""), maxW);

    // 회사정보(원하면 추후 시트에서 가져오게 확장 가능)
    const VENDOR = {
      name: "고래이음",
      bizno: "-",
      manager: "-",
      tel: "-",
    };

    btnPdf.addEventListener("click", async () => {
      try {
        if (!window.jspdf || !window.jspdf.jsPDF) {
          alert("PDF 라이브러리를 불러오지 못했습니다. (jsPDF)");
          return;
        }

        // ✅ 항상 최신값으로 재계산 후 PDF (버튼만 누르면 바로 됨)
        let last = QuoteUI._lastResult;
        if (QuoteUI._run) last = await QuoteUI._run();
        if (!last) {
          alert("먼저 견적 계산을 해주세요.");
          return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: "mm", format: "a4" });

        // ✅ 한글 폰트 등록
        const fontB64 = window.__GE_PDF_FONT_B64__;
        if (!fontB64) {
          alert("한글 폰트 데이터가 없습니다.\nindex.html에 Pretendard-Regular.base64.js 로딩을 확인하세요.");
          return;
        }
        doc.addFileToVFS("Pretendard-Regular.ttf", fontB64);
        doc.addFont("Pretendard-Regular.ttf", "Pretendard", "normal");
        doc.setFont("Pretendard", "normal");

        const out = buildOutFromResult(last);

        const now = new Date();
        const dateStr = `${now.getFullYear()}년 ${String(now.getMonth() + 1).padStart(2, "0")}월 ${String(now.getDate()).padStart(2, "0")}일`;

        const pageW = 210;
        const margin = 12;
        const innerW = pageW - margin * 2;
        const bottomLimit = 280;

        let y = 18;

        // (1) 타이틀
        doc.setFontSize(18);
        doc.text("견  적  서", pageW / 2, y, { align: "center" });
        y += 10;

        // (2) 날짜 + 수신 문구(좌측)
        doc.setFontSize(10);
        doc.text(dateStr, margin, y);
        y += 7;

        doc.setFontSize(11);
        doc.text("귀하", margin, y);
        y += 6;

        doc.setFontSize(10);
        doc.text("아래와 같이 견적서를 발송합니다.", margin, y);
        y += 10;

        // (3) 공급자 정보 박스(우측)
        const boxX = 110;
        const boxY = 30;
        const boxW = 88;
        const boxH = 34;

        doc.rect(boxX, boxY, boxW, boxH);

        const rH = boxH / 4;
        const cW = 26;

        for (let i = 1; i < 4; i++) doc.line(boxX, boxY + rH * i, boxX + boxW, boxY + rH * i);
        doc.line(boxX + cW, boxY, boxX + cW, boxY + boxH);

        doc.setFontSize(9);
        const labels = ["상호", "사업자번호", "담당자", "전화번호"];
        for (let i = 0; i < 4; i++) doc.text(labels[i], boxX + 3, boxY + rH * i + 6);

        doc.setFontSize(9);
        doc.text(VENDOR.name, boxX + cW + 3, boxY + 6);
        doc.text(VENDOR.bizno, boxX + cW + 3, boxY + rH + 6);
        doc.text(VENDOR.manager, boxX + cW + 3, boxY + rH * 2 + 6);
        doc.text(VENDOR.tel, boxX + cW + 3, boxY + rH * 3 + 6);

        // (4) 견적금액 박스
        const amtY = boxY + boxH + 8;
        const amtX = margin;
        const amtW = innerW;
        const amtH = 10;

        doc.rect(amtX, amtY, amtW, amtH);
        doc.setFontSize(10);
        doc.text("견적금액(부가세 포함)", amtX + 3, amtY + 7);
        doc.setFontSize(11);
        doc.text(KRW(out.total), amtX + amtW - 3, amtY + 7, { align: "right" });

        // 공급가도 한 줄 추가
        doc.setFontSize(9);
        doc.text(`공급가(부가세 제외): ${KRW(out.supply)}`, amtX + 3, amtY + 16);

        y = amtY + amtH + 18;

        // =========================
        // (5) 내역(항목별 소계)
        // =========================
        doc.setFontSize(12);
        doc.text("내역", margin, y);
        y += 6;

        const rowH = 9;
        const headH = 9;
        const colL = 70;
        const colR = innerW - colL;

        // header
        doc.rect(margin, y, innerW, headH);
        doc.line(margin + colL, y, margin + colL, y + headH);
        doc.setFontSize(10);
        doc.text("구분", margin + colL / 2, y + 6, { align: "center" });
        doc.text("소계", margin + colL + colR / 2, y + 6, { align: "center" });
        y += headH;

        const laborMin = Number(last?.process?.labor_minutes || 0);

        const rows = [
          { k: "자재비", v: out.material },
          { k: `인건비 ${laborMin ? `(${laborMin.toFixed(1)}분)` : ""}`.trim(), v: out.labor },
          { k: "간접비", v: out.overhead },
          { k: `마진 (${Math.round(out.marginRate * 100)}%)`, v: out.marginAmt },
          { k: `VAT (${Math.round(out.vatRate * 100)}%)`, v: out.vat },
        ];

        doc.setFontSize(10);
        rows.forEach((r, i) => {
          const y0 = y + i * rowH;
          doc.rect(margin, y0, innerW, rowH);
          doc.line(margin + colL, y0, margin + colL, y0 + rowH);
          doc.text(r.k, margin + 2, y0 + 6);
          doc.text(KRW(r.v), margin + innerW - 2, y0 + 6, { align: "right" });
        });

        y += rowH * rows.length + 6;

        // 합계(정합)
        doc.setFontSize(10);
        doc.rect(margin, y, innerW, 10);
        doc.text("합계(부가세 포함)", margin + 3, y + 7);
        doc.text(KRW(out.total), margin + innerW - 3, y + 7, { align: "right" });
        y += 16;

        // =========================
        // (6) 자재비 상세(BOM)
        // =========================
        if (y + 12 > bottomLimit) {
          doc.addPage();
          doc.setFont("Pretendard", "normal");
          y = 18;
        }

        doc.setFontSize(11);
        doc.text(`자재비 상세(BOM)  /  소계: ${KRW(out.material)}`, margin, y);
        y += 6;

        const tX = margin;
        const tW = innerW;
        const bomCol = { name: 70, spec: 64, qty: 22, amt: tW - (70 + 64 + 22) };
        const bomHeadH = 9;
        const bomRowH = 9;

        function drawBomHeader(titleSuffix) {
          if (titleSuffix) {
            doc.setFontSize(11);
            doc.text(titleSuffix, margin, y);
            y += 6;
          }
          doc.setFontSize(10);
          doc.rect(tX, y, tW, bomHeadH);
          doc.line(tX + bomCol.name, y, tX + bomCol.name, y + bomHeadH);
          doc.line(tX + bomCol.name + bomCol.spec, y, tX + bomCol.name + bomCol.spec, y + bomHeadH);
          doc.line(tX + bomCol.name + bomCol.spec + bomCol.qty, y, tX + bomCol.name + bomCol.spec + bomCol.qty, y + bomHeadH);
          doc.text("품명", tX + bomCol.name / 2, y + 6, { align: "center" });
          doc.text("규격", tX + bomCol.name + bomCol.spec / 2, y + 6, { align: "center" });
          doc.text("수량", tX + bomCol.name + bomCol.spec + bomCol.qty / 2, y + 6, { align: "center" });
          doc.text("금액", tX + bomCol.name + bomCol.spec + bomCol.qty + bomCol.amt / 2, y + 6, { align: "center" });
          y += bomHeadH;
          doc.setFontSize(9);
        }

        drawBomHeader();

        const items = (last?.bom || []).map((x) => {
          const lenM = x.length_mm ? (x.length_mm / 1000) : 0;
          const qty = x.qty || 0;
          const qtyText = lenM ? `${lenM.toFixed(2)}m` : (qty ? `${qty}ea` : "-");
          return {
            name: x.label || "",
            spec: x.code || "",
            qty: qtyText,
            amt: KRW(x.cost || 0),
          };
        });

        if (items.length === 0) {
          doc.setFontSize(9);
          doc.text("(BOM 없음)", margin, y + 4);
          y += 10;
        } else {
          items.forEach((it) => {
            if (y + bomRowH > bottomLimit) {
              doc.addPage();
              doc.setFont("Pretendard", "normal");
              y = 18;
              drawBomHeader("자재비 상세(BOM) - 계속");
            }

            doc.rect(tX, y, tW, bomRowH);
            doc.line(tX + bomCol.name, y, tX + bomCol.name, y + bomRowH);
            doc.line(tX + bomCol.name + bomCol.spec, y, tX + bomCol.name + bomCol.spec, y + bomRowH);
            doc.line(tX + bomCol.name + bomCol.spec + bomCol.qty, y, tX + bomCol.name + bomCol.spec + bomCol.qty, y + bomRowH);

            const nameLines = wrap(doc, it.name, bomCol.name - 4);
            doc.text(nameLines.slice(0, 1), tX + 2, y + 6);
            doc.text(String(it.spec), tX + bomCol.name + 2, y + 6);
            doc.text(String(it.qty), tX + bomCol.name + bomCol.spec + bomCol.qty - 2, y + 6, { align: "right" });
            doc.text(String(it.amt), tX + tW - 2, y + 6, { align: "right" });

            y += bomRowH;
          });

          y += 8;
        }

        // =========================
        // (7) 인건비/간접비/마진/VAT 설명 (간단)
        // =========================
        const ensureSpace = (need) => {
          if (y + need > bottomLimit) {
            doc.addPage();
            doc.setFont("Pretendard", "normal");
            y = 18;
          }
        };

        ensureSpace(28);
        doc.setFontSize(11);
        doc.text(`인건비  /  소계: ${KRW(out.labor)}`, margin, y);
        y += 6;
        doc.setFontSize(9);
        doc.text(`총 작업시간: ${laborMin.toFixed(1)}분`, margin, y);
        y += 10;

        ensureSpace(18);
        doc.setFontSize(11);
        doc.text(`간접비  /  소계: ${KRW(out.overhead)}`, margin, y);
        y += 6;
        doc.setFontSize(9);
        doc.text("기계감가/소모품/관리비 등(산정 기준은 추후 고도화)", margin, y);
        y += 10;

        ensureSpace(18);
        doc.setFontSize(11);
        doc.text(`마진  /  소계: ${KRW(out.marginAmt)} (${Math.round(out.marginRate * 100)}%)`, margin, y);
        y += 6;
        doc.setFontSize(9);
        doc.text("원가 대비 판매가 조정(운영/리스크/이윤 포함)", margin, y);
        y += 10;

        ensureSpace(16);
        doc.setFontSize(11);
        doc.text(`VAT  /  소계: ${KRW(out.vat)} (${Math.round(out.vatRate * 100)}%)`, margin, y);
        y += 12;

        // 하단 조건
        ensureSpace(20);
        doc.setFontSize(9);
        doc.text("유효기간 : 발행 후 14일", margin, y);
        doc.text("납기 : 발주 후 협의", margin, y + 5);
        doc.text("결제방법 : 세금계산서", margin, y + 10);
        doc.text("기타 : 운반비 별도", margin, y + 15);

        doc.save(`견적서_${dateStr.replace(/\s/g, "")}.pdf`);
      } catch (e) {
        console.error(e);
        alert("PDF 생성 중 오류가 발생했습니다. 콘솔을 확인해주세요.");
      }
    });
  })();

  window.QuoteUI = QuoteUI;
})();
