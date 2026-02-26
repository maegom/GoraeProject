// rail-insert-rectframe/js/app.js
// 레일 삽입형 ㅒ 모듈 난간
// - 상부 레일: 포스트 맨위(상단) 부착, 길이=포스트 중심-중심
// - 하부 레일: 포스트 사이(내측) 길이
// - ㅒ 모듈: 세로평철 2 + 가로평철(세워진 플레이트) 2
//   * 가로평철은 레일 전면에 고정(삽입깊이 영향 없음)
//   * 세로평철은 삽입깊이에 따라 레일 쪽으로 이동(앞으로 튀어나옴 조절)

(() => {
  "use strict";

  window.APP = window.APP || {};
  const APP = window.APP;

  let scene, camera, renderer, controls, group, humanModel;
  let gridHelper = null;
  let groundPlane = null;

  const VIEW = {
    showPosts: true,
    showRails: true,
    showModules: true,
    showHuman: true,
  };

  const BUILD = { step: 3 }; // 0~3

  const THEME = { all: 0x666666 };

  // ====== HDRI environment (stainless look) ======
  const ENV = {
    enabled: true,
    showBg: false,
    url: "../../shared/env/studio_small_08_1k.hdr",
    intensity: 0.75,
  };
  const _envCache = new Map();
  let _envTex = null;
  const _bgColorInt = 0xf1f3f5;

  // ====== Ground tuning (배경 ON일 때 떠 보이는 느낌 완화) ======
  // NOTE: HDRI(IBL)가 켜지면 바닥이 생각보다 밝게(하얗게) 보일 수 있어요.
  // 아래 두 값만 바꾸면 바닥 톤을 쉽게 조절할 수 있습니다.
  // - color: 바닥 색(추천: 0xCED4DA ~ 0xADB5BD)
  // - envMapIntensity: HDRI가 바닥을 밝히는 정도(추천: 0.15 ~ 0.45)
  const GROUND = {
    color: 0x8F8A83,
    envMapIntensity: 0.1,
  };

// ====== Material presets ======
// HDRI ON  : 스테인리스(브러시 느낌) - 환경 반사 + 거칠기 맵(노이즈)로 질감
// HDRI OFF : 기존(도장/기본) 느낌으로 복귀 - metalness/roughness 원복, envMapIntensity=0
// ====== 재질 튜닝 포인트(여기 수치만 바꾸면 스텐 느낌 조절 가능) ======
// 1) 스텐 거칠기: MAT_PRESET.stainless.roughness (0.45~0.70 추천, 높을수록 거칠고 반사↓)
// 2) 반사 강도: ENV.intensity (0.50~1.10 추천, 낮을수록 반사↓)
// 3) 브러시 결 촘촘함: getRoughnessMap() 안의 tex.repeat.set(X, Y)
// ============================================================

const MAT_PRESET = {
  standard: { metalness: 0.25, roughness: 0.45, envMapIntensity: 0.0, useRoughMap: false },
  stainless: { metalness: 0.37, roughness: 0.7, envMapIntensity: 0.75, useRoughMap: true },
};

let _roughMap = null;
function getRoughnessMap() {
  if (_roughMap) return _roughMap;
  const size = 128;
  const data = new Uint8Array(size * size);
  // 브러시드 느낌: 기본 노이즈 + 약한 방향성(수평 스트릭)
  for (let y = 0; y < size; y++) {
    // 한 줄의 기준 밝기(스트릭)
    const streak = 110 + Math.floor(45 * Math.sin((y / size) * Math.PI * 6));
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const r = Math.floor(Math.random() * 60); // 미세 노이즈
      const v = Math.max(0, Math.min(255, streak + r));
      data[idx] = v;
    }
  }
  const fmt = THREE.LuminanceFormat || THREE.RedFormat;
  const tex = new THREE.DataTexture(data, size, size, fmt);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // 반복을 많이 주면 결이 촘촘해짐
  tex.repeat.set(24, 2);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  _roughMap = tex;
  return tex;
}

function currentMatPreset() {
    // HDRI가 실제로 로드된 상태에서만 스테인리스 프리셋 사용
    return (ENV.enabled && _envTex) ? MAT_PRESET.stainless : MAT_PRESET.standard;
  }

function applyMaterialPresetToGroup(root, preset) {
  if (!root) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (!m) return;
      if ("metalness" in m) m.metalness = preset.metalness;
      if ("roughness" in m) m.roughness = preset.roughness;
      if ("envMapIntensity" in m) m.envMapIntensity = preset.envMapIntensity;
      if (preset.useRoughMap) {
        m.roughnessMap = getRoughnessMap();
      } else {
        m.roughnessMap = null;
      }
      m.needsUpdate = true;
    });
  });
}

function updateGroundVisibility() {
  if (!groundPlane) return;
  // HDRI 배경을 켰을 때(하늘/배경이 보일 때) 바닥이 없으면 공중에 떠 보이므로 바닥을 노출
  groundPlane.visible = (ENV.enabled && ENV.showBg);
}


  function $(id) {
    return document.getElementById(id);
  }

  function num(v, fallback = 0) {
    const n = +v;
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(v, min, fallback) {
    const n = num(v, fallback);
    return Math.max(min, n);
  }

  function hexToInt(hex) {
    return parseInt((hex || "#666666").replace("#", ""), 16);
  }

  function createMesh(geom, color) {
  const p = currentMatPreset();
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: p.metalness,
    roughness: p.roughness,
    envMapIntensity: p.envMapIntensity,
  });

  if (p.useRoughMap) {
    mat.roughnessMap = getRoughnessMap();
    // 거칠기 맵의 영향이 과하면 반사가 탁해질 수 있어 스케일은 기본 유지
  } else {
    mat.roughnessMap = null;
  }

  return new THREE.Mesh(geom, mat);
}


  function applyColorToGroup(g, colorInt) {
    g.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (m?.color) m.color.setHex(colorInt);
        if (m) m.needsUpdate = true;
      });
    });
  }

function _fileBase(p) {
  try {
    const s = String(p || "");
    return s.split("/").pop() || s;
  } catch {
    return String(p || "");
  }
}

function _setStatus(msg) {
  const el = $("hdriStatus");
  if (el) el.textContent = msg;
}

function updateEnvIntensity(root, intensity) {
  if (!root) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (!m) return;
      if ("envMapIntensity" in m) m.envMapIntensity = intensity;
      m.needsUpdate = true;
    });
  });
}

function loadHDR(url) {
  if (_envCache.has(url)) return Promise.resolve(_envCache.get(url));
  return new Promise((resolve, reject) => {
    if (!THREE.RGBELoader) {
      reject(new Error("RGBELoader not found. index.html에 RGBELoader.js를 추가하세요."));
      return;
    }
    const loader = new THREE.RGBELoader();
    loader.load(
      url,
      (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        _envCache.set(url, tex);
        resolve(tex);
      },
      undefined,
      (err) => reject(err)
    );
  });
}


function updateGridVisibility() {
  if (gridHelper) {
    // 배경(HDRI) ON일 때는 그리드가 너무 튀므로 숨김
    gridHelper.visible = !(ENV.enabled && ENV.showBg);
  }
  updateGroundVisibility();
}

function applyEnvironment() {
  if (!scene) return;

  if (!ENV.enabled) {
    _envTex = null;
    scene.environment = null;
    // HDRI OFF일 때는 예전(환경맵 적용 전) 상태로 복귀
    scene.background = new THREE.Color(_bgColorInt);

    // ✅ 기존 재질 프리셋(standard)로 강제 복귀 (metalness=1인 스텐이 env 없이 검게 죽는 현상 방지)
    applyMaterialPresetToGroup(group, MAT_PRESET.standard);
    updateEnvIntensity(group, 0.0); // 안전: envMapIntensity 0으로

    updateGridVisibility();
    _setStatus("HDRI: OFF (기본 재질)");
    requestRender();
    return;
  }

  const url = ENV.url;
  _setStatus(`HDRI 로딩: ${_fileBase(url)} ...`);
  loadHDR(url)
    .then((tex) => {
      _envTex = tex;
      scene.environment = tex;
      scene.background = ENV.showBg ? tex : new THREE.Color(_bgColorInt);
      // ✅ HDRI ON이면 스텐 프리셋 적용(거칠기/금속감)
      applyMaterialPresetToGroup(group, MAT_PRESET.stainless);
      updateEnvIntensity(group, ENV.intensity);
      updateGridVisibility();
      _setStatus(`HDRI: ON (${_fileBase(url)})`);
      requestRender();
    })
    .catch((err) => {
      console.error("HDRI 로드 실패:", err);
      ENV.enabled = false;
      _envTex = null;
      scene.environment = null;
      scene.background = new THREE.Color(_bgColorInt);
      applyMaterialPresetToGroup(group, MAT_PRESET.standard);
      updateGridVisibility();
      _setStatus("HDRI 로드 실패 (OFF)");
      requestRender();
    });
}

function syncHdriUI() {
  syncBtn($("btnHdri"), "HDRI ON", "HDRI OFF", ENV.enabled);
  syncBtn($("btnHdriBg"), "배경 ON", "배경 OFF", ENV.showBg);

  const sel = $("hdriSelect");
  if (sel && sel.value !== ENV.url) {
    // 존재하는 옵션 중에 맞는게 있으면 맞춰줌
    const opt = Array.from(sel.options).find((o) => o.value === ENV.url);
    if (opt) sel.value = ENV.url;
  }
}

  function getCanvasSize() {
    const el = $("canvas-container");
    const w = el ? el.clientWidth : window.innerWidth;
    const h = el ? el.clientHeight : window.innerHeight;
    return { w: Math.max(10, w), h: Math.max(10, h) };
  }

  let _renderT = null;
  function requestRender() {
    clearTimeout(_renderT);
    _renderT = setTimeout(() => render(), 30);
  }

  function syncBtn(btn, onText, offText, isOn) {
    if (!btn) return;
    btn.classList.toggle("on", isOn);
    btn.textContent = isOn ? onText : offText;
  }

  function applyStepToView() {
    const s = BUILD.step;
    if (s === 0) {
      VIEW.showPosts = false;
      VIEW.showRails = false;
      VIEW.showModules = false;
      return;
    }
    if (s === 1) {
      VIEW.showPosts = true;
      VIEW.showRails = false;
      VIEW.showModules = false;
      return;
    }
    if (s === 2) {
      VIEW.showPosts = true;
      VIEW.showRails = true;
      VIEW.showModules = false;
      return;
    }
    // 3 = 전체 ON
    VIEW.showPosts = true;
    VIEW.showRails = true;
    VIEW.showModules = true;
  }

  function syncUI() {
    const stepLabel = $("buildStepLabel");
    if (stepLabel) stepLabel.textContent = `${BUILD.step} / 3`;

    syncBtn($("btnPosts"), "포스트 ON", "포스트 OFF", VIEW.showPosts);
    syncBtn($("btnRails"), "레일 ON", "레일 OFF", VIEW.showRails);
    syncBtn($("btnModules"), "ㅒ모듈 ON", "ㅒ모듈 OFF", VIEW.showModules);
  }

  function applyHumanVisibility() {
    if (!scene || !humanModel) return;
    const inScene = humanModel.parent === scene;
    if (VIEW.showHuman && !inScene) scene.add(humanModel);
    if (!VIEW.showHuman && inScene) scene.remove(humanModel);
  }

  function syncHumanBtn() {
    syncBtn($("btnHuman"), "사람 ON", "사람 OFF", VIEW.showHuman);
  }

  function loadHuman() {
    const loader = new THREE.GLTFLoader();
    const loading = $("loading");
    if (loading) loading.style.visibility = "visible";

    const url = "../../shared/model/SampleHuman.glb";
    loader.load(
      url,
      (gltf) => {
        humanModel = gltf.scene;
        humanModel.scale.set(25, 25, 25);
        humanModel.position.set(300, 0, -500);
        humanModel.rotation.y = Math.PI / 4;

        // 기본은 ON
        scene.add(humanModel);
        applyHumanVisibility();
        syncHumanBtn();

        if (loading) loading.style.visibility = "hidden";
        APP.humanModel = humanModel;
      },
      (xhr) => {
        if (!xhr.total || !loading) return;
        const pct = Math.round((xhr.loaded / xhr.total) * 100);
        loading.textContent = `사람 모델 로딩 중... (${pct}%)`;
      },
      (err) => {
        console.error("사람 모델 로드 실패:", err);
        if (loading) {
          loading.textContent = "사람 모델 로드 실패";
          setTimeout(() => (loading.style.visibility = "hidden"), 1200);
        }
      }
    );
  }

  function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(_bgColorInt);

    const { w, h } = getCanvasSize();
    camera = new THREE.PerspectiveCamera(45, w / h, 10, 50000);
    camera.position.set(2500, 1500, 3000);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    $("canvas-container")?.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(2000, 4000, 2000);
    scene.add(dir);

    gridHelper = new THREE.GridHelper(10000, 50, 0xd1d1d1, 0xe1e1e1);
    scene.add(gridHelper);

    // ====== Ground plane (HDRI 배경 ON 시 공중에 떠 보이는 문제 완화) ======
    // 배경이 HDRI로 바뀌면 그리드만으로는 기준면이 약해 보일 수 있어서,
    // 배경 ON일 때만 '바닥'을 표시한다.
    const gGeo = new THREE.PlaneGeometry(20000, 20000);
    const gMat = new THREE.MeshStandardMaterial({
      // ✅ 바닥 색은 위의 GROUND.color로 조절
      color: GROUND.color,
      metalness: 0.0,
      roughness: 1.0,
      // ✅ HDRI(환경광)가 바닥을 과하게 밝히는 걸 방지 (값 낮출수록 바닥이 덜 하얘짐)
      envMapIntensity: GROUND.envMapIntensity,
    });
    groundPlane = new THREE.Mesh(gGeo, gMat);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.y = 0; // 바닥 기준
    groundPlane.receiveShadow = false;
    groundPlane.visible = false; // HDRI 배경 ON일 때만 켬
    scene.add(groundPlane);

    group = new THREE.Group();
    scene.add(group);

    wireUI();
    syncHumanBtn();
    syncHdriUI();
    applyEnvironment();
    loadHuman();
    render();

    // expose
    APP.scene = scene;
    APP.camera = camera;
    APP.renderer = renderer;
    APP.controls = controls;
    APP.railingGroup = group;
    APP.VIEW = VIEW;
    APP.BUILD = BUILD;
    APP.THEME = THEME;
    APP.renderRailing = render;
    APP.applyHumanVisibility = applyHumanVisibility;
    APP.requestRender = requestRender;

    startNonVRLoop();
  }

  function wireUI() {
    document.querySelectorAll('input[type="number"]').forEach((el) => {
      el.addEventListener("input", requestRender);
    });

    const allColorEl = $("allColor");
    if (allColorEl) {
      THEME.all = hexToInt(allColorEl.value);
      allColorEl.addEventListener("change", (e) => {
        THEME.all = hexToInt(e.target.value);
        applyColorToGroup(group, THEME.all);
      });
    }

    // ===== HDRI UI =====
const btnHdri = $("btnHdri");
if (btnHdri) {
  btnHdri.addEventListener("click", () => {
    ENV.enabled = !ENV.enabled;
    syncHdriUI();
    applyEnvironment();
  });
}

const btnHdriBg = $("btnHdriBg");
if (btnHdriBg) {
  btnHdriBg.addEventListener("click", () => {
    ENV.showBg = !ENV.showBg;
    syncHdriUI();
    applyEnvironment();
  });
}

const hdriSelect = $("hdriSelect");
if (hdriSelect) {
  // 초기값 동기화
  ENV.url = hdriSelect.value || ENV.url;
  hdriSelect.addEventListener("change", (e) => {
    ENV.url = e.target.value || ENV.url;
    if (ENV.enabled) applyEnvironment();
  });
}

// toggles
    const bindToggle = (id, key, onText, offText) => {
      const btn = $(id);
      if (!btn) return;
      btn.addEventListener("click", () => {
        VIEW[key] = !VIEW[key];
        BUILD.step = 0;
        syncUI();
        requestRender();
      });
      syncBtn(btn, onText, offText, VIEW[key]);
    };

    bindToggle("btnPosts", "showPosts", "포스트 ON", "포스트 OFF");
    bindToggle("btnRails", "showRails", "레일 ON", "레일 OFF");
    bindToggle("btnModules", "showModules", "ㅒ모듈 ON", "ㅒ모듈 OFF");

    const prev = $("btnStepPrev");
    const next = $("btnStepNext");
    const reset = $("btnStepReset");

    if (prev)
      prev.addEventListener("click", () => {
        BUILD.step = BUILD.step <= 0 ? 3 : BUILD.step - 1;
        applyStepToView();
        syncUI();
        requestRender();
      });

    if (next)
      next.addEventListener("click", () => {
        BUILD.step = BUILD.step >= 3 ? 0 : BUILD.step + 1;
        applyStepToView();
        syncUI();
        requestRender();
      });

    if (reset)
      reset.addEventListener("click", () => {
        BUILD.step = 0;
        applyStepToView();
        syncUI();
        requestRender();
      });

    applyStepToView();
    syncUI();

    const btnHuman = $("btnHuman");
    if (btnHuman) {
      btnHuman.addEventListener("click", () => {
        VIEW.showHuman = !VIEW.showHuman;
        syncHumanBtn();
        applyHumanVisibility();
      });
    }

  }

  function clearGroup() {
    while (group.children.length) group.remove(group.children[0]);
  }

  // create helpers
  function box(lenX, lenY, lenZ, color) {
    return createMesh(new THREE.BoxGeometry(lenX, lenY, lenZ), color);
  }

  // ====== module layout math ======
  function calcModuleCount(innerLen, pitch) {
    // N modules => 2N bars => span = (2N-1)*pitch (bar centers)
    if (pitch <= 0) return 0;
    const N = Math.floor((innerLen / pitch + 1) / 2);
    return Math.max(0, N);
  }

  function render() {
    clearGroup();

    const L = clamp($("totalL")?.value, 200, 3000);
    const H = clamp($("height")?.value, 300, 1200);
    const postInt = clamp($("postInt")?.value, 200, 1000);

    const postW = clamp($("postW")?.value, 10, 50);
    const postD = clamp($("postD")?.value, 10, 50);
    const baseT = clamp($("basePlateT")?.value, 4, 10);
    const basePlateW = clamp($("basePlateW")?.value, 40, 200);
    const basePlateD = clamp($("basePlateD")?.value, 40, 120);

    const railW = clamp($("railW")?.value, 10, 50);
    const railH = clamp($("railH")?.value, 10, 30);

    const topClear = clamp($("topRailTopClear")?.value, 0, 300);
    const botClear = clamp($("botRailBotClear")?.value, 0, 100);

    const moduleLen = clamp($("moduleLen")?.value, 50, 1130);

    const barW = clamp($("barW")?.value, 5, 50);
    const barT = clamp($("barT")?.value, 2, 6);

    const barPitch = clamp($("barPitch")?.value, 10, 100);
    const insertDepth = clamp($("insertDepth")?.value, 0, 0);

    const zRail = 0;

    // rail vertical positions from rules
    const yTopRailTop = H - topClear;
    const yTopRailCenter = yTopRailTop - railH / 2;

    const yModuleTop = H;
    const yModuleBot = H - moduleLen;
    const yModuleMid = (yModuleTop + yModuleBot) / 2;

    const yBotRailBot = yModuleBot + botClear;
    const yBotRailCenter = yBotRailBot + railH / 2;

    // post height auto: post top == top rail bottom face
    const postTopY = yTopRailTop - railH;
    const postBodyH = Math.max(50, postTopY - baseT);

    const postHAuto = $("postHAuto");
    if (postHAuto) postHAuto.textContent = `${Math.round(postTopY)} mm`;

    // posts positions
    const postXs = [];
    for (let x = 0; x < L - 0.001; x += postInt) postXs.push(x);
    if (postXs.length === 0) postXs.push(0);
    if (Math.abs(postXs[postXs.length - 1] - L) > 0.001) postXs.push(L);

    // constants for z placement
    // rail front face (toward +Z)
    const zRailFront = zRail + railW / 2;

    // 가로평철(세워짐) : 레일 전면에 고정 (삽입깊이 영향 없음)
    const zCrossPlate = zRailFront + barT / 2 + 0.1;

    // 세로평철 : 삽입깊이에 따라 이동 (기본은 레일 전면 기준으로 barW가 앞으로 나오도록)
    const zVertBase = zRailFront + barW / 2 + 0.1;
    const zVert = zVertBase - insertDepth;

    // ---- draw posts + base plates
    if (VIEW.showPosts) {
      for (let i = 0; i < postXs.length; i++) {
        const x = postXs[i];

        const plate = box(basePlateW, baseT, basePlateD, 0x333333);
        plate.position.set(x, baseT / 2, 0);
        group.add(plate);

        const post = box(postW, postBodyH, postD, 0x444444);
        post.position.set(x, baseT + postBodyH / 2, 0);
        group.add(post);
      }
    }

    const secN = postXs.length - 1;

    for (let si = 0; si < secN; si++) {
      const xL = postXs[si];
      const xR = postXs[si + 1];
      const secLen = xR - xL;
      const cx = (xL + xR) / 2;

      const innerLeft = xL + postW / 2;
      const innerRight = xR - postW / 2;
      const innerLen = Math.max(0, innerRight - innerLeft);

      // rails
      if (VIEW.showRails) {
        // top rail: center-to-center length
        const topRail = box(secLen, railH, railW, THEME.all);
        topRail.position.set(cx, yTopRailCenter, zRail);
        group.add(topRail);

        // bottom rail: inner faces length
        const botLen = Math.max(0, secLen - postW);
        const botRail = box(botLen, railH, railW, THEME.all);
        botRail.position.set(cx, yBotRailCenter, zRail);
        group.add(botRail);
      }

      // modules
      if (VIEW.showModules) {
        // compute max module count based on barPitch (bar center spacing)
        const N = calcModuleCount(innerLen, barPitch);
        if (N <= 0) continue;

        const barCount = 2 * N;
        const span = (barCount - 1) * barPitch;

        const startX = cx - span / 2;

        for (let m = 0; m < N; m++) {
          const i0 = 2 * m;
          const i1 = 2 * m + 1;

          const x0 = startX + i0 * barPitch;
          const x1 = startX + i1 * barPitch;

          // 세로 평철 2개 (길이=moduleLen, 폭=barW, 두께=barT)
          const vGeom = new THREE.BoxGeometry(barT, moduleLen, barW);

          const vL = createMesh(vGeom, 0x999999);
          vL.position.set(x0, yModuleMid, zVert);
          group.add(vL);

          const vR = createMesh(vGeom, 0x999999);
          vR.position.set(x1, yModuleMid, zVert);
          group.add(vR);

          // 가로 평철 2개 (세워진 플레이트)
          // - 두께(Z)=barT, 높이(Y)=railH, 길이(X)=barPitch(=x1-x0)
          // - 레일 전면(zCrossPlate)에 고정 -> insertDepth 영향 없음
          const crossLen = Math.max(5, Math.abs(x1 - x0));
          const cGeom = new THREE.BoxGeometry(crossLen, railH, barT);

          const topC = createMesh(cGeom, 0x888888);
          topC.position.set((x0 + x1) / 2, yTopRailCenter, zCrossPlate);
          group.add(topC);

          const botC = createMesh(cGeom, 0x888888);
          botC.position.set((x0 + x1) / 2, yBotRailCenter, zCrossPlate);
          group.add(botC);
        }
      }
    }

    applyColorToGroup(group, THEME.all);
  }

  function onResize() {
    if (!camera || !renderer) return;

    const isVR = renderer.xr && renderer.xr.isPresenting;
    const w = isVR ? window.innerWidth : getCanvasSize().w;
    const h = isVR ? window.innerHeight : getCanvasSize().h;

    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);

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

  let _raf = 0;
  function startNonVRLoop() {
    cancelAnimationFrame(_raf);
    const tick = () => {
      _raf = requestAnimationFrame(tick);
      if (renderer?.xr?.isPresenting) return;
      controls?.update?.();
      renderer?.render?.(scene, camera);
    };
    tick();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
