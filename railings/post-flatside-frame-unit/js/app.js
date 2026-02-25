// post-flatside-frame-unit/js/app.js
// post-flatside-frame-unit 전용 (Three.js + UI + 모델 생성)
// 특징:
// - 포스트 높이: 단일 입력값(전체 포스트 동일)
// - 포스트 사이 "큰 프레임": 좌/우 평철(세로재) + 상/하부 각관 레일(가로재)
// - 평철(세로재) 높이 = 난간 시작높이(하부레일 하단) ~ 난간 높이(상부레일 최상단)
// - 레일(각관)은 평철 사이를 통과(끝면이 평철 내측면과 맞음)
// - 그 사이에 ㅁ자 모듈 배치 (모듈 높이 자동 계산)
// VR은 js/vr.js가 담당 (renderer.setAnimationLoop)

(() => {
  "use strict";

  // ====== 전역 핸들(다른 파일(vr.js)에서 접근) ======
  window.APP = window.APP || {};

  let scene, camera, renderer, controls, railingGroup, humanModel;

  const HOME_URL = "https://goraeeum.cafe24.com/";

  // ✅ 보기 토글(부재별)
  const VIEW = {
    showPosts: true,
    showSideBars: true, // 좌/우 평철(세로재)
    showRailBot: true,
    showSlats: true,
    showRailTop: true,
    showHuman: true,
  };

  // ✅ 공정 단계(0~5)
  // 0: 전부 OFF, 1: 포스트, 2: 양옆 평철, 3: 하부레일, 4: ㅁ자 모듈, 5: 상부레일
  const BUILD = { step: 5 };

  // ✅ 전체 컬러
  const THEME = { all: 0x666666 };

  // ====== utils ======
  function $(id) {
    return document.getElementById(id);
  }

  function clampNum(v, min, fallback) {
    const n = +v;
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, n);
  }

  function hexToInt(hex) {
    return parseInt((hex || "#666666").replace("#", ""), 16);
  }

  function createMesh(geom, color) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.6,
      roughness: 0.3,
    });
    return new THREE.Mesh(geom, mat);
  }

  function applyColorToGroup(group, colorInt) {
    group.traverse((obj) => {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        if (m && m.color) m.color.setHex(colorInt);
        m.needsUpdate = true;
      });
    });
  }

  function getCanvasSize() {
    const el = $("canvas-container");
    const w = el ? el.clientWidth : window.innerWidth;
    const h = el ? el.clientHeight : window.innerHeight;
    return { w: Math.max(10, w), h: Math.max(10, h) };
  }

  // ====== render debounce ======
  let _renderT = null;
  function requestRender() {
    clearTimeout(_renderT);
    _renderT = setTimeout(() => renderRailing(), 30);
  }

  // ====== UI sync helpers ======
  function syncBtn(btn, onText, offText, isOn) {
    if (!btn) return;
    btn.classList.toggle("on", isOn);
    btn.textContent = isOn ? onText : offText;
  }

  function syncStepLabel() {
    const el = $("buildStepLabel");
    if (!el) return;
    el.textContent = `${BUILD.step} / 5`;
  }

  function applyStepToView() {
    const s = BUILD.step;
    VIEW.showPosts = s >= 1;
    VIEW.showSideBars = s >= 2;
    VIEW.showRailBot = s >= 3;
    VIEW.showSlats = s >= 4;
    VIEW.showRailTop = s >= 5;
  }

  function syncViewButtons() {
    syncBtn($("btnPosts"), "포스트 ON", "포스트 OFF", VIEW.showPosts);
    syncBtn($("btnSideBars"), "측면평철 ON", "측면평철 OFF", VIEW.showSideBars);
    syncBtn($("btnRailBot"), "하부레일 ON", "하부레일 OFF", VIEW.showRailBot);
    syncBtn($("btnSlats"), "ㅁ자모듈 ON", "ㅁ자모듈 OFF", VIEW.showSlats);
    syncBtn($("btnRailTop"), "상부레일 ON", "상부레일 OFF", VIEW.showRailTop);
  }

  function syncHumanButton() {
    syncBtn($("btnHuman"), "사람 ON", "사람 OFF", VIEW.showHuman);
  }

  function applyHumanVisibility() {
    if (!humanModel || !scene) return;
    const inScene = humanModel.parent === scene;
    if (VIEW.showHuman && !inScene) scene.add(humanModel);
    if (!VIEW.showHuman && inScene) scene.remove(humanModel);
  }

  // ====== init ======
  function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f3f5);

    const { w, h } = getCanvasSize();
    camera = new THREE.PerspectiveCamera(45, w / h, 10, 50000);
    camera.position.set(2500, 1500, 3000);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    $("canvas-container")?.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(2000, 4000, 2000);
    scene.add(dirLight);

    scene.add(new THREE.GridHelper(10000, 50, 0xd1d1d1, 0xe1e1e1));

    railingGroup = new THREE.Group();
    scene.add(railingGroup);

    wireUI();
    loadHuman();
    renderRailing();

    // ✅ 다른 파일(vr.js)에서 사용 가능하도록 노출
    APP.scene = scene;
    APP.camera = camera;
    APP.renderer = renderer;
    APP.controls = controls;
    APP.railingGroup = railingGroup;
    APP.VIEW = VIEW;
    APP.BUILD = BUILD;
    APP.THEME = THEME;
    APP.renderRailing = renderRailing;
    APP.requestRender = requestRender;
    APP.applyHumanVisibility = applyHumanVisibility;

    // ✅ 기본(비VR) 렌더 루프: vr.js가 setAnimationLoop로 덮어씀
    startNonVRLoop();
  }

  function wireUI() {
    // Home/Brand 링크
    const homeLink = $("homeLink");
    if (homeLink) homeLink.href = HOME_URL;
    const brandLink = $("brandLink");
    if (brandLink) brandLink.href = HOME_URL;

    // inputs -> 디바운스 렌더
    document
      .querySelectorAll('input[type="number"]')
      .forEach((el) => el.addEventListener("input", requestRender));

    // color
    const allColorEl = $("allColor");
    if (allColorEl) {
      THEME.all = hexToInt(allColorEl.value);
      allColorEl.addEventListener("change", (e) => {
        THEME.all = hexToInt(e.target.value);
        applyColorToGroup(railingGroup, THEME.all);
      });
    }

    // 초기 단계
    applyStepToView();
    syncStepLabel();
    syncViewButtons();
    syncHumanButton();
    applyHumanVisibility();

    // 토글(수동 토글 시 step=0)
    const bindToggle = (id, key) => {
      const btn = $(id);
      if (!btn) return;
      btn.addEventListener("click", () => {
        VIEW[key] = !VIEW[key];
        BUILD.step = 0;
        syncStepLabel();
        syncViewButtons();
        requestRender();
      });
    };

    bindToggle("btnPosts", "showPosts");
    bindToggle("btnSideBars", "showSideBars");
    bindToggle("btnRailBot", "showRailBot");
    bindToggle("btnSlats", "showSlats");
    bindToggle("btnRailTop", "showRailTop");

    // 사람 토글
    const btnHuman = $("btnHuman");
    if (btnHuman)
      btnHuman.addEventListener("click", () => {
        VIEW.showHuman = !VIEW.showHuman;
        syncHumanButton();
        applyHumanVisibility();
      });

    // 공정 버튼: 순환(5->0, 0->5)
    const btnPrev = $("btnStepPrev");
    const btnNext = $("btnStepNext");
    const btnReset = $("btnStepReset");

    if (btnPrev)
      btnPrev.addEventListener("click", () => {
        BUILD.step = BUILD.step <= 0 ? 5 : BUILD.step - 1;
        applyStepToView();
        syncStepLabel();
        syncViewButtons();
        requestRender();
      });

    if (btnNext)
      btnNext.addEventListener("click", () => {
        BUILD.step = BUILD.step >= 5 ? 0 : BUILD.step + 1;
        applyStepToView();
        syncStepLabel();
        syncViewButtons();
        requestRender();
      });

    if (btnReset)
      btnReset.addEventListener("click", () => {
        BUILD.step = 0;
        applyStepToView();
        syncStepLabel();
        syncViewButtons();
        requestRender();
      });
  }

  function loadHuman() {
    const loader = new THREE.GLTFLoader();
    const loadingScreen = $("loading");
    if (loadingScreen) loadingScreen.style.visibility = "visible";

    const rawUrl = "../../shared/model/SampleHuman.glb";

    loader.load(
      rawUrl,
      (gltf) => {
        humanModel = gltf.scene;
        humanModel.scale.set(25, 25, 25);
        humanModel.position.set(300, 0, -500);
        humanModel.rotation.y = Math.PI / 4;

        scene.add(humanModel);

        applyHumanVisibility();
        syncHumanButton();

        if (loadingScreen) {
          loadingScreen.style.visibility = "hidden";
          loadingScreen.innerText = "모델 데이터를 불러오는 중...";
        }

        APP.humanModel = humanModel;
      },
      (xhr) => {
        if (!xhr.total || !loadingScreen) return;
        const percent = Math.round((xhr.loaded / xhr.total) * 100);
        loadingScreen.innerText = `모델 로딩 중... (${percent}%)`;
      },
      (error) => {
        console.error("모델 로드 실패:", error);
        if (loadingScreen) loadingScreen.innerText = "사람 모델 로드 실패";
      }
    );
  }

  // ====== geometry helpers ======
  function makeRectTube(len, w, h, color) {
    const g = new THREE.BoxGeometry(len, h, w); // X len, Y height, Z width
    return createMesh(g, color);
  }

  function makePostBox(height, w, d, color) {
    const g = new THREE.BoxGeometry(w, height, d);
    return createMesh(g, color);
  }

  function makeFlatBarVertical(height, t, w, color) {
    // thickness (X) = t, height (Y) = height, width (Z) = w
    const g = new THREE.BoxGeometry(t, height, w);
    return createMesh(g, color);
  }

  // ㅁ자 1개(세로2 + 가로2), center 기준
  function addRectFrame(centerX, yMid, innerW, innerH, barW, barT, z, color) {
    const hLen = Math.max(10, innerW);
    const vLen = Math.max(10, innerH);

    const vLenFixed = vLen + barT;
    const hLenFixed = Math.max(10, hLen - barT);

    const vGeom = new THREE.BoxGeometry(barT, vLenFixed, barW);

    const left = createMesh(vGeom, color);
    left.position.set(centerX - hLen / 2, yMid, z);
    railingGroup.add(left);

    const right = createMesh(vGeom, color);
    right.position.set(centerX + hLen / 2, yMid, z);
    railingGroup.add(right);

    const hGeom = new THREE.BoxGeometry(hLenFixed, barT, barW);

    const top = createMesh(hGeom, color);
    top.position.set(centerX, yMid + vLen / 2, z);
    railingGroup.add(top);

    const bot = createMesh(hGeom, color);
    bot.position.set(centerX, yMid - vLen / 2, z);
    railingGroup.add(bot);
  }

  // 포스트 사이 모듈 N개 자동 센터링
  function addRectFrameModulesCentered({
    innerX0,
    innerLen,
    cut = 0,
    yTop,
    yBot,
    z,
    moduleW,
    moduleH,
    moduleGap,
    barW,
    barT,
    color,
  }) {
    const x0 = innerX0 + cut;
    const len = Math.max(0, innerLen - 2 * cut);
    if (len < moduleW) return;

    const pitch = moduleW + moduleGap;
    const N = Math.floor((len + moduleGap) / pitch);
    if (N <= 0) return;

    const totalUsed = N * moduleW + (N - 1) * moduleGap;

    const centerX = x0 + len / 2;
    const firstCenterX = centerX - totalUsed / 2 + moduleW / 2;

    const yMid = (yTop + yBot) / 2;

    for (let i = 0; i < N; i++) {
      const cx = firstCenterX + i * pitch;
      addRectFrame(cx, yMid, moduleW, moduleH, barW, barT, z, color);
    }
  }

  // ====== main render ======
  function renderRailing() {
    while (railingGroup.children.length > 0) {
      railingGroup.remove(railingGroup.children[0]);
    }

    const L = clampNum($("totalL")?.value, 200, 3000);
    const H_total = clampNum($("height")?.value, 300, 1200);

    const postInt = clampNum($("postInt")?.value, 200, 1000);
    const postW = clampNum($("postW")?.value, 20, 20);
    const postD = clampNum($("postH")?.value, 20, 50);

    const baseT = clampNum($("basePlateT")?.value, 4, 10);
    const basePlateW = clampNum($("basePlateW")?.value, 60, 200);
    const basePlateD = clampNum($("basePlateD")?.value, 40, 120);

    const railW = clampNum($("railW")?.value, 20, 50);
    const railH = clampNum($("railH")?.value, 10, 20);
    const railStartY = clampNum($("railStartY")?.value, 0, 80);

    const barW = clampNum($("barW")?.value, 5, 45);
    const barT = clampNum($("barT")?.value, 2, 6);

    const moduleW = clampNum($("moduleW")?.value, 40, 100);
    const moduleGap = clampNum($("moduleGap")?.value, 0, 80);

    // 포스트 높이(단일)
    const postHeight = clampNum(
      $("postHeight")?.value,
      50,
      Math.max(80, H_total - railH - baseT)
    );

const z = 0;

    // 포스트 위치
    const postXs = [];
    for (let x = 0; x < L - 0.001; x += postInt) postXs.push(x);
    if (postXs.length === 0) postXs.push(0);
    if (Math.abs(postXs[postXs.length - 1] - L) > 0.001) postXs.push(L);

    const postCount = postXs.length;
    const numSections = postCount - 1;

    // ====== 높이 계산 ======
    // 상부레일 최상단이 "난간 높이"에 맞춰짐
    const yTopRailCenter = H_total - railH / 2;
    const yTopRailBottom = H_total - railH;

    // 하부레일: 입력값은 "하부레일 하단 기준"
    const yBotRailCenter = railStartY + railH / 2;
    const yBotRailTop = railStartY + railH;

    // 측면 평철(세로재) 높이: railStartY ~ H_total
    const sideBarH = Math.max(10, H_total - railStartY);
    const ySideBarCenter = railStartY + sideBarH / 2;

    // ㅁ자 모듈: 상부레일 하단 ~ 하부레일 상단 사이
    const moduleAreaTop = yTopRailBottom - barT / 2;
    const moduleAreaBot = yBotRailTop + barT / 2;
    const moduleH = Math.max(10, moduleAreaTop - moduleAreaBot);

    const moduleHOut = $("moduleHAuto");
    if (moduleHOut) {
      const ok = moduleAreaTop > moduleAreaBot + 1;
      moduleHOut.textContent = ok ? `${Math.round(moduleH)} mm` : `- (높이 부족)`;
    }

    // ====== 1) 포스트 + 베이스 ======
    if (VIEW.showPosts) {
      for (let i = 0; i < postCount; i++) {
        const x = postXs[i];

        const plate = createMesh(
          new THREE.BoxGeometry(basePlateW, baseT, basePlateD),
          0x333333
        );
        plate.position.set(x, baseT / 2, z);
        railingGroup.add(plate);

        const ph = postHeight;
        const post = makePostBox(ph, postW, postD, 0x444444);
        post.position.set(x, baseT + ph / 2, z);
        railingGroup.add(post);
      }
    }

    // ====== 2) 섹션별: (좌/우 평철) + (하/상부 레일) + (ㅁ자 모듈) ======
    for (let i = 0; i < numSections; i++) {
      const xL = postXs[i];
      const xR = postXs[i + 1];

      // 포스트 내측면(스팬 방향)
      const leftPostInnerFace = xL + postW / 2;
      const rightPostInnerFace = xR - postW / 2;

      // 측면 평철(세로재) 위치: 포스트 내측면과 평철 끝면이 맞도록 배치
      const leftBarCx = leftPostInnerFace + barT / 2;
      const rightBarCx = rightPostInnerFace - barT / 2;

      // 레일/모듈이 들어갈 유효 스팬(평철 사이)
      const leftClearX = leftPostInnerFace + barT;   // left bar의 내측면
      const rightClearX = rightPostInnerFace - barT; // right bar의 내측면
      const innerLen = rightClearX - leftClearX;

      if (innerLen <= 5) continue;

      const innerCenterX = (leftClearX + rightClearX) / 2;

      // 2-1) 측면 평철 (큰 프레임의 세로재)
      if (VIEW.showSideBars) {
        const barL = makeFlatBarVertical(sideBarH, barT, barW, 0x999999);
        barL.position.set(leftBarCx, ySideBarCenter, z);
        railingGroup.add(barL);

        const barR = makeFlatBarVertical(sideBarH, barT, barW, 0x999999);
        barR.position.set(rightBarCx, ySideBarCenter, z);
        railingGroup.add(barR);
      }

      // 2-2) 하부레일(각관) - 평철 사이를 통과
      if (VIEW.showRailBot) {
        const rail = makeRectTube(innerLen, railW, railH, THEME.all);
        rail.position.set(innerCenterX, yBotRailCenter, z);
        railingGroup.add(rail);
      }

      // 2-3) ㅁ자 모듈 - 평철 사이, 레일 사이
      if (VIEW.showSlats) {
        if (moduleAreaTop > moduleAreaBot + 1) {
          const cut = Math.max(barT, 10); // 측면평철과 간섭 최소화
          addRectFrameModulesCentered({
            innerX0: leftClearX,
            innerLen,
            cut,
            yTop: moduleAreaTop,
            yBot: moduleAreaBot,
            z,
            moduleW,
            moduleH,
            moduleGap,
            barW,
            barT,
            color: 0xbbbbbb,
          });
        }
      }

      // 2-4) 상부레일(각관)
      if (VIEW.showRailTop) {
        const rail = makeRectTube(innerLen, railW, railH, THEME.all);
        rail.position.set(innerCenterX, yTopRailCenter, z);
        railingGroup.add(rail);
      }
    }

    applyColorToGroup(railingGroup, THEME.all);
  }

  // ====== resize ======
  function onResize() {
    if (!camera || !renderer) return;

    // VR 모드에서는 사이드바 숨김이라 width=window.innerWidth가 맞음
    const isVR = renderer.xr && renderer.xr.isPresenting;

    const w = isVR ? window.innerWidth : getCanvasSize().w;
    const h = isVR ? window.innerHeight : getCanvasSize().h;

    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);

    // topbar 폭 보정(특히 VR 진입 시)
    const topbar = document.querySelector(".topbar");
    if (topbar) {
      if (isVR) {
        topbar.style.left = "0px";
        topbar.style.right = "0px";
      } else {
        topbar.style.left = "";
        topbar.style.right = "";
      }
    }
  }

  window.addEventListener("resize", onResize);

  // ====== non-VR loop ======
  let _raf = 0;
  function startNonVRLoop() {
    cancelAnimationFrame(_raf);
    const tick = () => {
      _raf = requestAnimationFrame(tick);

      // VR로 들어가면 vr.js의 setAnimationLoop가 렌더 담당
      if (renderer?.xr?.isPresenting) return;

      controls?.update?.();
      renderer?.render?.(scene, camera);
    };
    tick();
  }

  // ====== boot ======
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
