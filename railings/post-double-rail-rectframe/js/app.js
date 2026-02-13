// js/app.js
// post-double-rail-rectframe 전용 (Three.js + UI + 모델 생성)
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
    showRailBot: true,
    showSlats: true,
    showRailMid: true,
    showRailTop: true,
    showHuman: true,
  };

  // ✅ 공정 단계(0~5)
  const BUILD = { step: 5 };

  // ✅ 전체 컬러
  const THEME = { all: 0x666666 };

  // ====== utils ======
  function $(id) {
    return document.getElementById(id);
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
    VIEW.showRailBot = s >= 2;
    VIEW.showSlats = s >= 3;
    VIEW.showRailMid = s >= 4;
    VIEW.showRailTop = s >= 5;
  }

  function syncViewButtons() {
    syncBtn($("btnPosts"), "포스트 ON", "포스트 OFF", VIEW.showPosts);
    syncBtn($("btnRailBot"), "하부레일 ON", "하부레일 OFF", VIEW.showRailBot);
    syncBtn($("btnSlats"), "ㅁ자모듈 ON", "ㅁ자모듈 OFF", VIEW.showSlats);
    syncBtn($("btnRailMid"), "중간레일 ON", "중간레일 OFF", VIEW.showRailMid);
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

    camera = new THREE.PerspectiveCamera(
      45,
      (window.innerWidth - 320) / window.innerHeight,
      10,
      50000
    );
    camera.position.set(2500, 1500, 3000);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth - 320, window.innerHeight);
    $("canvas-container").appendChild(renderer.domElement);

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
    // (vr.js가 없거나 VR 미지원이어도 정상 동작)
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
    bindToggle("btnRailBot", "showRailBot");
    bindToggle("btnSlats", "showSlats");
    bindToggle("btnRailMid", "showRailMid");
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

        // vr.js에서 접근 가능하게
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

  // ㅁ자 1개
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

    const L = Math.max(200, +$("totalL")?.value || 3000);
    const H_total = Math.max(300, +$("height")?.value || 1200);

    const postInt = Math.max(200, +$("postInt")?.value || 1000);
    const postW = Math.max(20, +$("postW")?.value || 50);
    const postH = Math.max(20, +$("postH")?.value || 50);

    const baseT = Math.max(4, +$("basePlateT")?.value || 10);

    const railW = Math.max(20, +$("railW")?.value || 50);
    const railH = Math.max(10, +$("railH")?.value || 30);
    const railStartY = Math.max(0, +$("railStartY")?.value || 80);

    const barW = Math.max(5, +$("barW")?.value || 45);
    const barT = Math.max(2, +$("barT")?.value || 6);

    const moduleW = Math.max(40, +$("moduleW")?.value || 100);
    const moduleH = Math.max(40, +$("moduleH")?.value || 120);
    const moduleGap = Math.max(0, +$("moduleGap")?.value || 80);

    const basePlateW = Math.max(60, +$("basePlateW")?.value || 220);
    const basePlateD = Math.max(40, +$("basePlateD")?.value || 120);

    const z = 0;

    // ✅ 포스트 위치를 postInt 기준으로 직접 생성
    const postXs = [];
    for (let x = 0; x < L - 0.001; x += postInt) postXs.push(x);
    if (postXs.length === 0) postXs.push(0);
    if (Math.abs(postXs[postXs.length - 1] - L) > 0.001) postXs.push(L);

    const numSections = postXs.length - 1;

    // =========================
    // 높이 계산 (접촉/정렬 보정)
    // =========================
    const yTopRailCenter = H_total - railH / 2;
    const yTopRailBottom = H_total - railH;

    const postHeight = Math.max(50, yTopRailBottom - baseT);

    const yBotRailCenter = railStartY + railH / 2;
    const yBotRailTop = railStartY + railH;

    const moduleOuterH = moduleH + barT;

    const yMidRailBottom = yBotRailTop + moduleOuterH;
    const yMidRailCenter = yMidRailBottom + railH / 2;

    const moduleAreaTop = yMidRailBottom - barT / 2;
    const moduleAreaBot = yBotRailTop + barT / 2;

    // 1) 포스트 + 베이스
    if (VIEW.showPosts) {
      for (let i = 0; i < postXs.length; i++) {
        const x = postXs[i];

        const plate = createMesh(
          new THREE.BoxGeometry(basePlateW, baseT, basePlateD),
          0x333333
        );
        plate.position.set(x, baseT / 2, z);
        railingGroup.add(plate);

        const post = makePostBox(postHeight, postW, postH, 0x444444);
        post.position.set(x, baseT + postHeight / 2, z);
        railingGroup.add(post);
      }
    }

    // 2) 섹션별 가로재 + 모듈
    for (let i = 0; i < numSections; i++) {
      const xL = postXs[i];
      const xR = postXs[i + 1];

      const sectionLen = xR - xL;
      const center = (xL + xR) / 2;

      // 상부레일: 포스트 중심-중심 길이
      const topRailLen = sectionLen;

      // ✅ 포스트가 꺼져도 "포스트가 있었을 자리"는 비워두기 위해 항상 postW/2 오프셋 적용
      const leftFace = xL + postW / 2;
      const rightFace = xR - postW / 2;

      const innerRailLen = rightFace - leftFace;
      if (innerRailLen > 0) {
        const innerRailCenter = (leftFace + rightFace) / 2;

        // 하부레일
        if (VIEW.showRailBot) {
          const rail = makeRectTube(innerRailLen, railW, railH, THEME.all);
          rail.position.set(innerRailCenter, yBotRailCenter, z);
          railingGroup.add(rail);
        }

        // 중간레일
        if (VIEW.showRailMid) {
          const rail = makeRectTube(innerRailLen, railW, railH, THEME.all);
          rail.position.set(innerRailCenter, yMidRailCenter, z);
          railingGroup.add(rail);
        }
      }

      // 모듈
      if (VIEW.showSlats) {
        const innerX0 = leftFace;
        const innerLen = rightFace - leftFace;
        const cut = barT / 2;

        addRectFrameModulesCentered({
          innerX0,
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
          color: 0x999999,
        });
      }

      // 상부레일
      if (VIEW.showRailTop) {
        const rail = makeRectTube(topRailLen, railW, railH, THEME.all);
        rail.position.set(center, yTopRailCenter, z);
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
    const w = isVR ? window.innerWidth : window.innerWidth - 320;
    const h = window.innerHeight;

    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);

    const topbar = document.querySelector(".topbar");
    if (topbar) topbar.style.left = isVR ? "0px" : "320px";
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
  // DOM이 로드된 뒤 실행되게 안전하게 처리
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
