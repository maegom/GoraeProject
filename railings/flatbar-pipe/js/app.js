// flatbar.html/js/app.js
(() => {
    "use strict";

    // ✅ Home URL
    const HOME_URL = "https://goraeeum.cafe24.com/";

    // ====== helpers ======
    const $ = (id) => document.getElementById(id);
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const num = (v, def = 0) => {
        const x = parseFloat(v);
        return Number.isFinite(x) ? x : def;
    };

    // ==============================
    // POST(포스트) 설계 파라미터 (기존 로직 그대로)
    // ==============================
    const POST_CFG = {
        pairGapExtra: 2,

        postPipeRadScale: 1.0,
        postPipeSegs: 20,

        stemW: 10,
        stemDScale: 1.0,
        stemInsetY: 0,
        stemWLinkedToBar: true,
        stemWScale: 1.6,

        headWScale: 0.6,
        headT: 6,
        headTLinkedToBar: true,

        headDLinkedToBarW: true,
        headDScale: 1.0,
        headDOffset: 0,

        basePlateT: 10,
        basePlateZScale: 1.5,
        basePlateExtraW: 40,
        basePlateTLinkedToBar: true,
        basePlateTScale: 1.8,

        holeCount: 2,
        holeRad: null,
        holeOffset: 35,
        holeSegs: 24,
        anchorHeight: 10,
        anchorRad: 6,

        barCutUseHeadW: true,
        barCutExtra: 0,
        barMinLen: 80,

        makePostTopCap: true,
        makePostBotCap: true,
        postCapExtra: 0,
        postCapMin: 40,

        railCapClearance: 2,
        railMinLen: 80,

        postZ: 0,
    };

    // ====== STATE ======
    const STATE = {
        color: "#666666",
        humanOn: true,
        step: 0, // 0~4
        parts: {
            posts: true,
            railBot: true,
            slats: true,
            railTop: true,
        },
    };

    // ====== three ======
    let scene, camera, renderer, controls;
    let railingGroup;
    let humanModel = null;

    let _raf = null;
    let _pendingRender = false;

    function getCanvasSize() {
        const wrap = $("canvas-container");
        const w = wrap?.clientWidth || window.innerWidth;
        const h = wrap?.clientHeight || window.innerHeight;
        return { w: Math.max(1, w), h: Math.max(1, h) };
    }

    function initThree() {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf1f3f5);

        const { w, h } = getCanvasSize();
        camera = new THREE.PerspectiveCamera(45, w / h, 10, 50000);
        camera.position.set(2500, 1500, 3000);

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(w, h);

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
    }

    function animate() {
        _raf = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }

    // ====== UI wiring ======
    function syncStepLabel() {
        const el = $("buildStepLabel");
        if (!el) return;
        el.textContent = `${STATE.step} / 4`;
    }

    function syncBtn(btn, onText, offText, isOn) {
        if (!btn) return;
        btn.classList.toggle("on", isOn);
        btn.textContent = isOn ? onText : offText;
    }

    function syncPartsUI() {
        syncBtn($("btnHuman"), "사람 ON", "사람 OFF", STATE.humanOn);
        syncBtn($("btnPosts"), "포스트 ON", "포스트 OFF", STATE.parts.posts);
        syncBtn($("btnRailBot"), "하부레일 ON", "하부레일 OFF", STATE.parts.railBot);
        syncBtn($("btnSlats"), "중간살 ON", "중간살 OFF", STATE.parts.slats);
        syncBtn($("btnRailTop"), "상부레일 ON", "상부레일 OFF", STATE.parts.railTop);
        syncStepLabel();
    }

    function applyStep(step) {
        const s = clamp(step, 0, 4);
        STATE.step = s;

        // 0~4 단계 매핑
        if (s === 0) {
            STATE.parts.posts = false;
            STATE.parts.railBot = false;
            STATE.parts.slats = false;
            STATE.parts.railTop = false;
        } else if (s === 1) {
            STATE.parts.posts = true;
            STATE.parts.railBot = false;
            STATE.parts.slats = false;
            STATE.parts.railTop = false;
        } else if (s === 2) {
            STATE.parts.posts = true;
            STATE.parts.railBot = true;
            STATE.parts.slats = false;
            STATE.parts.railTop = false;
        } else if (s === 3) {
            STATE.parts.posts = true;
            STATE.parts.railBot = true;
            STATE.parts.slats = true;
            STATE.parts.railTop = false;
        } else if (s === 4) {
            STATE.parts.posts = true;
            STATE.parts.railBot = true;
            STATE.parts.slats = true;
            STATE.parts.railTop = true;
        }

        syncPartsUI();
        requestRender();
        window.dispatchEvent(new CustomEvent("ge:partsChanged", { detail: { ...STATE.parts } }));
    }

    function setPart(partKey, next) {
        STATE.parts[partKey] = !!next;
        // 수동 토글이면 단계는 0으로
        STATE.step = 0;
        syncPartsUI();
        requestRender();
        window.dispatchEvent(new CustomEvent("ge:partsChanged", { detail: { ...STATE.parts } }));
    }

    function wireUI() {
        // topbar links
        const homeLink = $("homeLink");
        if (homeLink) homeLink.href = HOME_URL;
        const brandLink = $("brandLink");
        if (brandLink) brandLink.href = HOME_URL;

        // color
        const colorEl = $("allColor");
        if (colorEl) {
            STATE.color = colorEl.value || STATE.color;
            colorEl.addEventListener("input", () => {
                STATE.color = colorEl.value || STATE.color;
                requestRender();
            });
        }

        // human
        const btnHuman = $("btnHuman");
        if (btnHuman) {
            btnHuman.addEventListener("click", () => {
                STATE.humanOn = !STATE.humanOn;
                if (humanModel) humanModel.visible = STATE.humanOn;
                syncPartsUI();
            });
        }

        // step buttons
        $("btnStepPrev")?.addEventListener("click", () => applyStep(STATE.step - 1));
        $("btnStepNext")?.addEventListener("click", () => applyStep(STATE.step + 1));
        $("btnStepReset")?.addEventListener("click", () => applyStep(0));

        // part toggles
        $("btnPosts")?.addEventListener("click", () => setPart("posts", !STATE.parts.posts));
        $("btnRailBot")?.addEventListener("click", () => setPart("railBot", !STATE.parts.railBot));
        $("btnSlats")?.addEventListener("click", () => setPart("slats", !STATE.parts.slats));
        $("btnRailTop")?.addEventListener("click", () => setPart("railTop", !STATE.parts.railTop));

        // inputs -> render (debounce)
        const debounce = (() => {
            let t = null;
            return () => {
                clearTimeout(t);
                t = setTimeout(() => requestRender(), 60);
            };
        })();

        document.querySelectorAll('input[type="number"]').forEach((el) => {
            el.addEventListener("input", debounce);
            el.addEventListener("change", debounce);
        });

        syncPartsUI();
    }

    // ====== human loader ======
    function loadHuman() {
        const loader = new THREE.GLTFLoader();
        const loadingScreen = $("loading");
        loadingScreen.style.visibility = "visible";
        loadingScreen.innerText = "사람 모델 로딩 중...";

        const rawUrl = "../../shared/model/SampleHuman.glb";

        loader.load(
            rawUrl,
            (gltf) => {
                humanModel = gltf.scene;
                humanModel.scale.set(25, 25, 25);
                humanModel.position.set(300, 0, -500);
                humanModel.rotation.y = Math.PI / 4;
                humanModel.visible = STATE.humanOn;
                scene.add(humanModel);

                loadingScreen.style.visibility = "hidden";
                loadingScreen.innerText = "모델 데이터를 불러오는 중...";
            },
            (xhr) => {
                if (!xhr.total) return;
                const percent = Math.round((xhr.loaded / xhr.total) * 100);
                loadingScreen.innerText = `사람 모델 로딩 중... (${percent}%)`;
            },
            (error) => {
                console.error("사람 모델 로드 실패:", error);
                loadingScreen.innerText = "사람 모델 로드 실패";
            }
        );
    }

    // ====== geometry helpers ======
    function createMesh(geom, colorHex) {
        const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(colorHex),
            metalness: 0.6,
            roughness: 0.3,
        });
        return new THREE.Mesh(geom, mat);
    }

    function clearGroup(g) {
        while (g.children.length > 0) {
            const o = g.children.pop();
            if (o.geometry) o.geometry.dispose?.();
            if (o.material) {
                if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
                else o.material.dispose?.();
            }
        }
    }

    function makePostPairFactory(pipeD, picketH, colorHex) {
        const r = (pipeD / 2) * POST_CFG.postPipeRadScale;
        const segs = POST_CFG.postPipeSegs;
        const geom = new THREE.CylinderGeometry(r, r, picketH, segs);
        return () => createMesh(geom, colorHex);
    }

    // return: { headW, basePlateW, capLen }
    function addBaseAndStand(posX, bW, bT, pGapSafe, pipeD, ground, colorHex) {
        const basePlateW = pGapSafe + pipeD + POST_CFG.basePlateExtraW;

        const basePlateT = (POST_CFG.basePlateTLinkedToBar ?? false)
            ? Math.max(2, bT * (POST_CFG.basePlateTScale ?? 1.8))
            : POST_CFG.basePlateT;

        const basePlateD = bW * POST_CFG.basePlateZScale;

        const plate = createMesh(new THREE.BoxGeometry(basePlateW, basePlateT, basePlateD), colorHex);
        plate.position.set(posX, basePlateT / 2, POST_CFG.postZ);
        railingGroup.add(plate);

        const stemW = (POST_CFG.stemWLinkedToBar ?? false)
            ? Math.max(2, bT * (POST_CFG.stemWScale ?? 1.6))
            : POST_CFG.stemW;

        const stemH = ground + POST_CFG.stemInsetY;
        const stemD = bW * POST_CFG.stemDScale;

        const stem = createMesh(new THREE.BoxGeometry(stemW, stemH, stemD), colorHex);
        stem.position.set(posX, stemH / 2, POST_CFG.postZ);
        railingGroup.add(stem);

        const headW = basePlateW * POST_CFG.headWScale;
        const headT = (POST_CFG.headTLinkedToBar ?? true) ? bT : POST_CFG.headT;

        const headD = (POST_CFG.headDLinkedToBarW ?? true)
            ? Math.max(2, (bW * (POST_CFG.headDScale ?? 1.0)) + (POST_CFG.headDOffset ?? 0))
            : (basePlateD * (POST_CFG.headDScale ?? 1.0));

        const head = createMesh(new THREE.BoxGeometry(headW, headT, headD), colorHex);
        head.position.set(posX, ground + headT / 2, POST_CFG.postZ);
        railingGroup.add(head);

        // 앙카(수직)
        const off = POST_CFG.holeOffset;
        const holes = (POST_CFG.holeCount === 2)
            ? [[-off, 0], [off, 0]]
            : [[-off, -off], [off, -off], [-off, off], [off, off]];

        const anchorR = (POST_CFG.holeRad != null) ? POST_CFG.holeRad : (POST_CFG.anchorRad ?? 6);
        const anchorH = POST_CFG.anchorHeight ?? 120;
        const anchorGeo = new THREE.CylinderGeometry(anchorR, anchorR, anchorH, POST_CFG.holeSegs);

        holes.forEach(([hx, hz]) => {
            const a = createMesh(anchorGeo, "#111111");
            a.position.set(posX + hx, basePlateT + anchorH / 2, POST_CFG.postZ + hz);
            railingGroup.add(a);
        });

        // 캡 길이 산정(포스트 위/아래 평철)
        const capBase = (POST_CFG.barCutUseHeadW ?? true) ? headW : basePlateW;
        const capLen = Math.max(POST_CFG.postCapMin ?? 40, (capBase || 0) + (POST_CFG.postCapExtra ?? 0));

        return { headW, basePlateW, capLen };
    }

    // ====== render ======
    function requestRender() {
        if (_pendingRender) return;
        _pendingRender = true;
        requestAnimationFrame(() => {
            _pendingRender = false;
            renderRailing();
        });
    }

    function renderRailing() {
        clearGroup(railingGroup);

        // inputs
        const L = Math.max(100, num($("totalL")?.value, 3000));
        const pInt = Math.max(100, num($("postInt")?.value, 1000));
        const pGap = Math.max(1, num($("picketGap")?.value, 120));
        const pipeD = Math.max(6, num($("pipeOD")?.value, 20));

        const bW = Math.max(1, num($("barW")?.value, 50));
        const bT = Math.max(1, num($("barT")?.value, 6));
        const H = Math.max(200, num($("height")?.value, 1100));

        const colorHex = STATE.color || "#666666";
        const ground = 60;

        const minGap = pipeD + POST_CFG.pairGapExtra;
        const pGapSafe = Math.max(pGap, minGap);

        const numSections = Math.max(1, Math.round(L / pInt));
        const actualInterval = L / numSections;

        const picketH = Math.max(50, H - ground - (bT * 2));
        const picketY = ground + bT + (picketH / 2);

        // 1) 포스트 메타(캡길이 포함) 먼저 구함
        const postMeta = new Array(numSections + 1)
            .fill(null)
            .map(() => ({ capLen: 0, headW: 0, basePlateW: 0 }));

        if (STATE.parts.posts) {
            for (let i = 0; i <= numSections; i++) {
                const posX = i * actualInterval;

                const makePost = makePostPairFactory(pipeD, picketH, colorHex);

                // 포스트(2개)
                const p1 = makePost();
                p1.position.set(posX - pGapSafe / 2, picketY, POST_CFG.postZ);
                railingGroup.add(p1);

                const p2 = makePost();
                p2.position.set(posX + pGapSafe / 2, picketY, POST_CFG.postZ);
                railingGroup.add(p2);

                const meta = addBaseAndStand(posX, bW, bT, pGapSafe, pipeD, ground, "#444444");
                postMeta[i] = meta;

                // 포스트 상/하 캡
                // ✅ 포스트 상/하 캡
                if (POST_CFG.makePostTopCap) {  // ✅ railTop 조건 제거
                    const capTop = createMesh(new THREE.BoxGeometry(meta.capLen, bT, bW), colorHex);
                    capTop.position.set(posX, H, POST_CFG.postZ);
                    railingGroup.add(capTop);
                }

                if (POST_CFG.makePostBotCap && STATE.parts.railBot) {
                    const capBot = createMesh(new THREE.BoxGeometry(meta.capLen, bT, bW), colorHex);
                    capBot.position.set(posX, ground + bT / 2, POST_CFG.postZ);
                    railingGroup.add(capBot);
                }
            }
        }

        // 2) 구간 난간(하부/상부/중간살)
        for (let i = 0; i < numSections; i++) {
            const posX = i * actualInterval;
            const center = posX + actualInterval / 2;

            let barLen = actualInterval;

            if (STATE.parts.posts) {
                const left = postMeta[i];
                const right = postMeta[i + 1];

                const cutBaseL = (POST_CFG.barCutUseHeadW ?? true) ? left.headW : left.basePlateW;
                const cutBaseR = (POST_CFG.barCutUseHeadW ?? true) ? right.headW : right.basePlateW;
                const cutX = Math.max(cutBaseL, cutBaseR) / 2 + (POST_CFG.barCutExtra ?? 0);

                const capHalfL = (left.capLen ?? 0) / 2;
                const capHalfR = (right.capLen ?? 0) / 2;
                const capHalf = Math.max(capHalfL, capHalfR) + (POST_CFG.railCapClearance ?? 0);

                const endCut = Math.max(cutX, capHalf);
                barLen = Math.max((POST_CFG.railMinLen ?? 80), actualInterval - 2 * endCut);
            } else {
                barLen = actualInterval;
            }

            if (STATE.parts.railTop) {
                const topBar = createMesh(new THREE.BoxGeometry(barLen, bT, bW), colorHex);
                topBar.position.set(center, H, POST_CFG.postZ);
                railingGroup.add(topBar);
            }

            if (STATE.parts.railBot) {
                const botBar = createMesh(new THREE.BoxGeometry(barLen, bT, bW), colorHex);
                botBar.position.set(center, ground + bT / 2, POST_CFG.postZ);
                railingGroup.add(botBar);
            }

            if (STATE.parts.slats) {
                // 구간 내 살
                const netWidth = actualInterval - pGapSafe;
                const subCount = Math.max(0, Math.floor(netWidth / pGapSafe) - 1);
                const subSpacing = netWidth / (subCount + 1);

                for (let j = 1; j <= subCount; j++) {
                    const subX = posX + (pGapSafe / 2) + (subSpacing * j);
                    const picket = createMesh(
                        new THREE.CylinderGeometry(pipeD / 2, pipeD / 2, picketH, 16),
                        "#bbbbbb"
                    );
                    picket.position.set(subX, picketY, POST_CFG.postZ);
                    railingGroup.add(picket);
                }
            }
        }
    }

    // ====== resize ======
    function onResize() {
        const { w, h } = getCanvasSize();
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }

    // ====== expose for quote-model ======
    window.APP = {
        getParts: () => ({ ...STATE.parts }),
        getColor: () => STATE.color,
        forceRender: () => requestRender(),
    };

    // ====== boot ======
    window.addEventListener("DOMContentLoaded", () => {
        initThree();
        wireUI();
        loadHuman();
        requestRender();
        animate();
    });

    window.addEventListener("resize", onResize);
})();