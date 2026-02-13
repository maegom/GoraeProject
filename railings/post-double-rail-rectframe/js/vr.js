// js/vr.js
// WebXR VR 진입/종료 + VR 전용 HUD(최소 토글/단계) + 사이드바 숨김
// 의존: js/app.js (window.APP에 scene/camera/renderer/controls/renderRailing 등 노출)

(() => {
  "use strict";

  // ====== helpers ======
  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "style" && v && typeof v === "object") Object.assign(node.style, v);
      else if (k === "class") node.className = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    children.forEach((c) => node.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return node;
  }

  function syncBtn(btn, onText, offText, isOn) {
    if (!btn) return;
    btn.classList.toggle("on", isOn);
    btn.textContent = isOn ? onText : offText;
  }

  function ensureXRDeps() {
    if (!window.THREE) throw new Error("THREE가 로드되지 않았습니다.");
    if (!THREE.VRButton) throw new Error("VRButton이 로드되지 않았습니다. (three examples 필요)");
  }

  // ====== state ======
  let hud = null;
  let prevSidebarDisplay = "";
  let prevTopbarLeft = "";
  let prevBodyFlex = "";
  let prevCanvasPaddingTop = "";

  // ====== VR HUD ======
  function buildVRHud() {
    // CSS
    const style = el("style", {}, [
      `
      /* VR HUD (DOM Overlay) */
      .vrHud {
        position: fixed;
        left: 12px;
        top: 12px;
        right: 12px;
        z-index: 9999;
        pointer-events: auto;
        font-family: Pretendard, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .vrHud .panel {
        display: inline-flex;
        gap: 10px;
        align-items: center;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(255,255,255,0.88);
        border: 1px solid rgba(0,0,0,0.06);
        box-shadow: 0 10px 30px rgba(0,0,0,0.12);
        backdrop-filter: blur(10px);
      }
      .vrHud .title {
        font-weight: 900;
        font-size: 12px;
        color: #111;
        margin-right: 2px;
        opacity: .9;
      }
      .vrHud .pill {
        padding: 6px 10px;
        border-radius: 999px;
        background: #fff;
        border: 1px solid #e9ecef;
        font-weight: 900;
        font-size: 12px;
        color: #0b57d0;
        min-width: 64px;
        text-align: center;
      }
      .vrHud .btnRow {
        display: inline-flex;
        gap: 8px;
        align-items: center;
      }
      .vrHud .btn {
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid #e0e0e0;
        background: #f3f5f7;
        color: #222;
        font-weight: 900;
        cursor: pointer;
        user-select: none;
        min-width: 76px;
      }
      .vrHud .btn.on {
        background: #e7f1ff;
        border-color: #a8ccff;
        color: #0b57d0;
      }
      .vrHud .btn.warn {
        background: #111;
        color: #fff;
        border-color: rgba(255,255,255,0.2);
      }
      `,
    ]);

    // DOM
    const stepLabel = el("span", { class: "pill", id: "vrStepLabel" }, ["0 / 5"]);

    const btnPrev = el("button", { class: "btn", type: "button", id: "vrPrev" }, ["Prev"]);
    const btnNext = el("button", { class: "btn", type: "button", id: "vrNext" }, ["Next"]);
    const btnReset = el("button", { class: "btn", type: "button", id: "vrReset" }, ["Reset"]);

    const btnPosts = el("button", { class: "btn on", type: "button", id: "vrPosts" }, ["포스트 ON"]);
    const btnBot = el("button", { class: "btn on", type: "button", id: "vrBot" }, ["하부 ON"]);
    const btnMid = el("button", { class: "btn on", type: "button", id: "vrMid" }, ["중간 ON"]);
    const btnTop = el("button", { class: "btn on", type: "button", id: "vrTop" }, ["상부 ON"]);
    const btnSlats = el("button", { class: "btn on", type: "button", id: "vrSlats" }, ["모듈 ON"]);

    const btnExit = el("button", { class: "btn warn", type: "button", id: "vrExit" }, ["VR 종료"]);

    const panel = el(
      "div",
      { class: "panel" },
      [
        el("span", { class: "title" }, ["VR"]),
        stepLabel,
        el("div", { class: "btnRow" }, [btnPrev, btnNext, btnReset]),
        el("div", { class: "btnRow" }, [btnPosts, btnBot, btnSlats, btnMid, btnTop]),
        btnExit,
      ]
    );

    const root = el("div", { class: "vrHud", id: "vrHudRoot" }, [panel]);

    document.head.appendChild(style);
    document.body.appendChild(root);

    return root;
  }

  function syncVRHud() {
    const APP = window.APP;
    if (!APP) return;

    const { VIEW, BUILD } = APP;

    const stepEl = $("vrStepLabel");
    if (stepEl) stepEl.textContent = `${BUILD.step} / 5`;

    syncBtn($("vrPosts"), "포스트 ON", "포스트 OFF", VIEW.showPosts);
    syncBtn($("vrBot"), "하부 ON", "하부 OFF", VIEW.showRailBot);
    syncBtn($("vrSlats"), "모듈 ON", "모듈 OFF", VIEW.showSlats);
    syncBtn($("vrMid"), "중간 ON", "중간 OFF", VIEW.showRailMid);
    syncBtn($("vrTop"), "상부 ON", "상부 OFF", VIEW.showRailTop);
  }

  function applyStepToView() {
    const APP = window.APP;
    const s = APP.BUILD.step;
    APP.VIEW.showPosts = s >= 1;
    APP.VIEW.showRailBot = s >= 2;
    APP.VIEW.showSlats = s >= 3;
    APP.VIEW.showRailMid = s >= 4;
    APP.VIEW.showRailTop = s >= 5;
  }

  function wireVRHud() {
    const APP = window.APP;

    $("vrPrev")?.addEventListener("click", () => {
      APP.BUILD.step = APP.BUILD.step <= 0 ? 5 : APP.BUILD.step - 1;
      applyStepToView();
      syncVRHud();
      APP.requestRender();
    });

    $("vrNext")?.addEventListener("click", () => {
      APP.BUILD.step = APP.BUILD.step >= 5 ? 0 : APP.BUILD.step + 1;
      applyStepToView();
      syncVRHud();
      APP.requestRender();
    });

    $("vrReset")?.addEventListener("click", () => {
      APP.BUILD.step = 0;
      applyStepToView();
      syncVRHud();
      APP.requestRender();
    });

    // 수동 토글 → step=0
    const bindToggle = (id, key) => {
      $(id)?.addEventListener("click", () => {
        APP.VIEW[key] = !APP.VIEW[key];
        APP.BUILD.step = 0;
        syncVRHud();
        APP.requestRender();
      });
    };

    bindToggle("vrPosts", "showPosts");
    bindToggle("vrBot", "showRailBot");
    bindToggle("vrSlats", "showSlats");
    bindToggle("vrMid", "showRailMid");
    bindToggle("vrTop", "showRailTop");

    $("vrExit")?.addEventListener("click", async () => {
      // VRButton과 상관없이 안전 종료
      const xr = APP.renderer?.xr;
      if (xr?.isPresenting) {
        try {
          await xr.getSession()?.end();
        } catch (e) {
          console.warn("VR 종료 실패:", e);
        }
      }
    });
  }

  // ====== UI hide/show during VR ======
  function enterVRUI() {
    const sidebar = $("sidebar");
    const topbar = document.querySelector(".topbar");
    const canvas = $("canvas-container");

    if (sidebar) {
      prevSidebarDisplay = sidebar.style.display;
      sidebar.style.display = "none";
    }

    if (document.body) {
      prevBodyFlex = document.body.style.display;
      // 기존 layout이 flex라 sidebar 없애면 canvas가 자연히 늘어나지만,
      // topbar left(320px) 같은 값은 따로 바꿔야 함
    }

    if (topbar) {
      prevTopbarLeft = topbar.style.left;
      topbar.style.left = "0px";
    }

    if (canvas) {
      prevCanvasPaddingTop = canvas.style.paddingTop;
      canvas.style.paddingTop = "56px";
    }
  }

  function exitVRUI() {
    const sidebar = $("sidebar");
    const topbar = document.querySelector(".topbar");
    const canvas = $("canvas-container");

    if (sidebar) sidebar.style.display = prevSidebarDisplay || "";
    if (topbar) topbar.style.left = prevTopbarLeft || "320px";
    if (canvas) canvas.style.paddingTop = prevCanvasPaddingTop || "56px";
  }

  // ====== VR Button + XR setup ======
  function ensureVRButton() {
    // 이미 있으면 재사용
    if (document.getElementById("vrEnterBtn")) return;

    const btn = el(
      "button",
      {
        id: "vrEnterBtn",
        type: "button",
        style: {
          position: "fixed",
          right: "14px",
          bottom: "14px",
          zIndex: "9998",
          padding: "12px 14px",
          borderRadius: "14px",
          border: "1px solid rgba(0,0,0,0.12)",
          background: "rgba(255,255,255,0.9)",
          fontWeight: "900",
          cursor: "pointer",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          backdropFilter: "blur(10px)",
        },
      },
      ["VR로 보기"]
    );

    btn.addEventListener("click", async () => {
      const APP = window.APP;
      if (!APP?.renderer?.xr) return;

      // XR 지원 체크
      if (!navigator.xr) {
        alert("이 브라우저는 WebXR을 지원하지 않습니다. (Meta Quest 브라우저에서 열어주세요)");
        return;
      }

      const isSupported = await navigator.xr.isSessionSupported("immersive-vr").catch(() => false);
      if (!isSupported) {
        alert("이 기기/브라우저에서는 VR 세션이 지원되지 않습니다.");
        return;
      }

      try {
        // DOM Overlay 활성화: VR에서도 HUD(HTML)를 보이게
        const session = await navigator.xr.requestSession("immersive-vr", {
          optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "layers"],
          requiredFeatures: ["local-floor"],
          // DOM Overlay는 optionalFeatures로 넣고, domOverlay.root 지정
          optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "layers", "dom-overlay"],
          domOverlay: { root: document.body },
        });

        APP.renderer.xr.setSession(session);
      } catch (e) {
        console.warn("VR 진입 실패:", e);
      }
    });

    document.body.appendChild(btn);
  }

  function setupXR() {
    const APP = window.APP;
    if (!APP?.renderer || !APP?.scene || !APP?.camera) return;

    // WebXR 활성화
    APP.renderer.xr.enabled = true;

    // VR 렌더 루프: VR이면 setAnimationLoop가 우선
    APP.renderer.setAnimationLoop((t, frame) => {
      APP.controls?.update?.();
      APP.renderer.render(APP.scene, APP.camera);
    });

    // 세션 이벤트
    APP.renderer.xr.addEventListener("sessionstart", () => {
      enterVRUI();

      if (!hud) {
        hud = buildVRHud();
        wireVRHud();
      }
      syncVRHud();

      // VR 진입하면 화면 리사이즈(사이드바 없는 폭)
      window.dispatchEvent(new Event("resize"));
    });

    APP.renderer.xr.addEventListener("sessionend", () => {
      exitVRUI();
      if (hud) hud.remove();
      hud = null;

      // VR 종료 후 원래 레이아웃으로 리사이즈
      window.dispatchEvent(new Event("resize"));
    });
  }

  // ====== boot ======
  function boot() {
    // app.js가 먼저 로드돼서 APP.renderer가 있어야 함
    const APP = window.APP;
    if (!APP?.renderer) {
      // 조금 기다렸다가 재시도
      setTimeout(boot, 50);
      return;
    }

    // VRButton 대신 자체 버튼으로 통일(디자인/DOM Overlay 컨트롤)
    setupXR();
    ensureVRButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
