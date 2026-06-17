/* ================================================================
   script.js — 深蓝·冲日凌日 · Cinematic Space Edition · 性能优化版
   优化：离屏缓存 · 自适应帧率 · 减少 GPU 绘制调用
   架构：核心模拟 → 离屏渲染 → 合成 → 动画控制 → UI + Tweaks
   ================================================================ */

(function() {
    'use strict';

    // ================================================================
    // LAYER 1: 核心模拟逻辑（纯函数，保持不变）
    // ================================================================

    var W = 800, H = 800;
    var AU = 180;
    var SUN_RADIUS = 28, EARTH_RADIUS = 12, MARS_RADIUS = 10, VENUS_RADIUS = 11;
    var EARTH_ORBIT = 1.0, MARS_ORBIT = 1.524, VENUS_ORBIT = 0.723;
    var EARTH_PERIOD = 365.25, MARS_PERIOD = 687.0, VENUS_PERIOD = 224.7;
    var BASE_DATE = new Date(2026, 5, 16);

    var TWO_PI = 2 * Math.PI;
    var W_EARTH = TWO_PI / EARTH_PERIOD;
    var W_MARS  = TWO_PI / MARS_PERIOD;
    var W_VENUS = TWO_PI / VENUS_PERIOD;
    var INIT_EARTH = 0, INIT_MARS = 0.8, INIT_VENUS = 2.1;

    // Precomputed dash pattern (cached, not recreated per frame)
    var ORBIT_DASH = [3, 8];

    function computeAngles(day) {
        return {
            earthAngle: INIT_EARTH + W_EARTH * day,
            marsAngle:  INIT_MARS  + W_MARS  * day,
            venusAngle: INIT_VENUS + W_VENUS * day
        };
    }

    function getPlanetPos(orbitAU, angle) {
        var r = orbitAU * AU;
        return { x: W / 2 + r * Math.cos(angle), y: H / 2 + r * Math.sin(angle) };
    }

    function angularDiff(a, b) {
        var d = Math.abs(a - b) % TWO_PI;
        return Math.min(d, TWO_PI - d);
    }

    function getPositionType(diff) {
        if (diff < 0.20) return 'opposition';
        if (diff > 2.8)  return 'conjunction';
        return 'other';
    }

    function detectEvent(earthAngle, targetAngle) {
        var diff = angularDiff(earthAngle, targetAngle);
        return { isEvent: diff < 0.04, diff: diff };
    }

    function calcDistanceAU(pos1, pos2) {
        var dx = pos1.x - pos2.x;
        var dy = pos1.y - pos2.y;
        return Math.sqrt(dx * dx + dy * dy) / AU;
    }

    function dayToDate(day) {
        return new Date(BASE_DATE.getTime() + day * 86400000);
    }

    function dateToDay(date) {
        return (date.getTime() - BASE_DATE.getTime()) / 86400000;
    }

    function formatDate(date) {
        return date.toISOString().slice(0, 10);
    }

    // ================================================================
    // LAYER 2: 渲染参数（Tweaks 可控）
    // ================================================================

    var tweaks = {
        starCount: 350,          // 默认 350（视觉等效 600）
        glowMultiplier: 1.0,
        vignetteStrength: 0.55,
        orbitOpacity: 1.0
    };

    // ================================================================
    // LAYER 2a: 离屏 Canvas 缓存系统
    // ================================================================

    // --- Starfield cache ---
    var starCache = document.createElement('canvas');
    starCache.width = W; starCache.height = H;
    var starCtx = starCache.getContext('2d');
    var stars = [];
    var starTime = 0;
    var starCacheDirty = true;
    var starLastRebuild = 0;      // timestamp of last star cache rebuild

    function rebuildStarfield() {
        stars = [];
        var count = tweaks.starCount;
        for (var i = 0; i < count; i++) {
            stars.push({
                x: Math.random() * W,
                y: Math.random() * H,
                r: 0.2 + Math.random() * 1.6,
                baseAlpha: 0.15 + Math.random() * 0.7,
                phase: Math.random() * TWO_PI,
                speed: 0.3 + Math.random() * 2.5,
                hue: Math.random() < 0.08 ? (Math.random() < 0.5 ? 30 : 210) : 0
            });
        }
        stars.sort(function(a, b) { return a.r - b.r; });
        starCacheDirty = true;
    }

    /** Rebuild the star cache canvas (called every ~200ms for twinkle) */
    function rebuildStarCache() {
        starCtx.clearRect(0, 0, W, H);
        var i, s, alpha, aInt;
        for (i = 0; i < stars.length; i++) {
            s = stars[i];
            alpha = s.baseAlpha * (0.55 + 0.45 * Math.sin(starTime * s.speed + s.phase));
            aInt = Math.round(alpha * 255);
            starCtx.beginPath();
            starCtx.arc(s.x, s.y, s.r, 0, TWO_PI);
            if (s.hue === 30) {
                starCtx.fillStyle = 'rgba(255,215,170,' + (aInt / 255).toFixed(2) + ')';
            } else if (s.hue === 210) {
                starCtx.fillStyle = 'rgba(175,210,255,' + (aInt / 255).toFixed(2) + ')';
            } else {
                starCtx.fillStyle = 'rgba(255,255,255,' + (aInt / 255).toFixed(2) + ')';
            }
            starCtx.fill();
            if (s.r > 0.9 && alpha > 0.5) {
                starCtx.beginPath();
                starCtx.arc(s.x, s.y, s.r * 3.5, 0, TWO_PI);
                starCtx.fillStyle = 'rgba(255,255,255,' + ((alpha * 0.06) * 255 / 255).toFixed(3) + ')';
                starCtx.fill();
            }
        }
        starCacheDirty = false;
        starLastRebuild = performance.now();
    }

    function drawStarfieldCached(ctx, dt) {
        starTime += dt;
        // Rebuild star cache every ~200ms to animate twinkle, or if dirty
        var now = performance.now();
        if (starCacheDirty || now - starLastRebuild > 200) {
            rebuildStarCache();
        }
        ctx.drawImage(starCache, 0, 0);
    }

    // --- Sun cache ---
    var sunCache = document.createElement('canvas');
    // Size large enough for max glow radius
    var SUN_CACHE_SIZE = Math.ceil((SUN_RADIUS + 44 * 2) * 2); // max glow multiplier 2.0
    sunCache.width = SUN_CACHE_SIZE;
    sunCache.height = SUN_CACHE_SIZE;
    var sunCtx = sunCache.getContext('2d');
    var sunCacheDirty = true;
    var sunCacheGM = 0; // last glow multiplier used to build cache

    function rebuildSunCache() {
        var gm = tweaks.glowMultiplier;
        var cx = SUN_CACHE_SIZE / 2, cy = SUN_CACHE_SIZE / 2;
        sunCtx.clearRect(0, 0, SUN_CACHE_SIZE, SUN_CACHE_SIZE);

        // Corona layers
        var layers = [
            { r: SUN_RADIUS + 44 * gm, a: 0.025 * gm, blur: 55 * gm },
            { r: SUN_RADIUS + 26 * gm, a: 0.05 * gm, blur: 36 * gm },
            { r: SUN_RADIUS + 14 * gm, a: 0.10 * gm, blur: 20 * gm }
        ];

        layers.forEach(function(l) {
            if (l.a < 0.002) return;
            sunCtx.beginPath();
            sunCtx.arc(cx, cy, l.r, 0, TWO_PI);
            sunCtx.fillStyle = 'rgba(245,179,66,' + l.a.toFixed(3) + ')';
            sunCtx.shadowColor = 'rgba(245,179,66,' + Math.min(0.5, l.a * 6).toFixed(2) + ')';
            sunCtx.shadowBlur = l.blur;
            sunCtx.fill();
        });
        sunCtx.shadowBlur = 0;

        // Main body
        var grad = sunCtx.createRadialGradient(cx - 8, cy - 8, 4, cx, cy, SUN_RADIUS);
        grad.addColorStop(0, '#FFF8E1');
        grad.addColorStop(0.3, '#FFE082');
        grad.addColorStop(0.55, '#F5B342');
        grad.addColorStop(0.8, '#E68A20');
        grad.addColorStop(1, '#C5600A');

        sunCtx.shadowColor = 'rgba(245,179,66,' + (0.6 * gm).toFixed(2) + ')';
        sunCtx.shadowBlur = 28 * gm;
        sunCtx.beginPath();
        sunCtx.arc(cx, cy, SUN_RADIUS, 0, TWO_PI);
        sunCtx.fillStyle = grad;
        sunCtx.fill();
        sunCtx.shadowBlur = 0;

        // Hot core
        var coreGrad = sunCtx.createRadialGradient(cx - 3, cy - 4, 2, cx, cy, SUN_RADIUS * 0.45);
        coreGrad.addColorStop(0, 'rgba(255,255,255,0.65)');
        coreGrad.addColorStop(1, 'rgba(255,255,255,0)');
        sunCtx.beginPath();
        sunCtx.arc(cx, cy, SUN_RADIUS * 0.45, 0, TWO_PI);
        sunCtx.fillStyle = coreGrad;
        sunCtx.fill();

        sunCacheDirty = false;
        sunCacheGM = gm;
    }

    function drawSunCached(ctx) {
        if (sunCacheDirty || sunCacheGM !== tweaks.glowMultiplier) {
            rebuildSunCache();
        }
        var offset = SUN_CACHE_SIZE / 2;
        ctx.drawImage(sunCache, W/2 - offset, H/2 - offset);
    }

    // --- Vignette cache ---
    var vignetteCache = document.createElement('canvas');
    vignetteCache.width = W; vignetteCache.height = H;
    var vignetteCtx = vignetteCache.getContext('2d');
    var vignetteCacheDirty = true;
    var vignetteCacheStrength = 0;

    function rebuildVignetteCache() {
        var vs = tweaks.vignetteStrength;
        vignetteCtx.clearRect(0, 0, W, H);
        if (vs > 0.01) {
            var grad = vignetteCtx.createRadialGradient(W/2, H/2, W * 0.35, W/2, H/2, W * 0.72);
            grad.addColorStop(0, 'rgba(0,0,0,0)');
            grad.addColorStop(1, 'rgba(0,0,0,' + vs.toFixed(2) + ')');
            vignetteCtx.fillStyle = grad;
            vignetteCtx.fillRect(0, 0, W, H);
        }
        vignetteCacheDirty = false;
        vignetteCacheStrength = vs;
    }

    function drawVignetteCached(ctx) {
        if (tweaks.vignetteStrength <= 0.01) return;
        if (vignetteCacheDirty || vignetteCacheStrength !== tweaks.vignetteStrength) {
            rebuildVignetteCache();
        }
        ctx.drawImage(vignetteCache, 0, 0);
    }

    // ================================================================
    // LAYER 2b: 轨道/行星渲染
    // ================================================================

    var dashSet = false;

    function drawOrbits(ctx) {
        var alpha = (tweaks.orbitOpacity * 0.06).toFixed(3);
        if (!dashSet) { ctx.setLineDash(ORBIT_DASH); dashSet = true; }
        ctx.lineWidth = 0.8;
        var cx = W/2, cy = H/2;
        [EARTH_ORBIT, MARS_ORBIT, VENUS_ORBIT].forEach(function(r) {
            ctx.beginPath();
            ctx.arc(cx, cy, r * AU, 0, TWO_PI);
            ctx.strokeStyle = 'rgba(255,255,255,' + alpha + ')';
            ctx.stroke();
        });
        ctx.setLineDash([]);
        dashSet = false;
    }

    function drawPlanet(ctx, pos, radius, color, glowColor, label) {
        var gm = tweaks.glowMultiplier;

        // Atmospheric outer glow (no shadowBlur — use fill with low alpha)
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius * 2.4 * gm, 0, TWO_PI);
        ctx.fillStyle = glowColor.replace('1)', (0.06 * gm).toFixed(3) + ')');
        ctx.fill();

        // Planet body with glow (shadowBlur only once per planet)
        ctx.shadowColor = glowColor.replace('1)', (0.7 * gm).toFixed(2) + ')');
        ctx.shadowBlur = 20 * gm;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, TWO_PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Curvature shading
        var specGrad = ctx.createRadialGradient(
            pos.x - radius * 0.3, pos.y - radius * 0.35, radius * 0.1,
            pos.x, pos.y, radius
        );
        specGrad.addColorStop(0, 'rgba(255,255,255,0.32)');
        specGrad.addColorStop(0.4, 'rgba(255,255,255,0.06)');
        specGrad.addColorStop(1, 'rgba(0,0,0,0.28)');
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, TWO_PI);
        ctx.fillStyle = specGrad;
        ctx.fill();

        // Label
        ctx.font = '12px "LXGW WenKai", "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = 'rgba(216,226,244,0.6)';
        ctx.fillText(label, pos.x + radius + 10, pos.y - 3);
    }

    function drawConnection(ctx, from, to, color, width) {
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.stroke();
    }

    /**
     * Optimized renderScene — uses cached drawImage for starfield/sun/vignette.
     * Reduces per-frame draw calls from ~620+ to ~15.
     */
    function renderScene(ctx, day, mode, dt) {
        var angles = computeAngles(day);
        var earthAngle = angles.earthAngle;
        var marsAngle  = angles.marsAngle;
        var venusAngle = angles.venusAngle;

        var sunPos   = { x: W / 2, y: H / 2 };
        var earthPos = getPlanetPos(EARTH_ORBIT, earthAngle);
        var marsPos  = getPlanetPos(MARS_ORBIT, marsAngle);
        var venusPos = getPlanetPos(VENUS_ORBIT, venusAngle);

        var targetAngle, targetPos;
        if (mode === 'opposition') {
            targetAngle = marsAngle;
            targetPos   = marsPos;
        } else {
            targetAngle = venusAngle;
            targetPos   = venusPos;
        }

        ctx.clearRect(0, 0, W, H);

        // Cached layers: 3 drawImage calls replace ~620 individual draws
        drawStarfieldCached(ctx, dt || 0.016);
        drawOrbits(ctx);
        drawSunCached(ctx);

        // Dynamic elements: 2 planets + 2 connections
        drawPlanet(ctx, earthPos, EARTH_RADIUS, '#4A9EFF', 'rgba(74,158,255,1)', '地球');
        if (mode === 'opposition') {
            drawPlanet(ctx, marsPos, MARS_RADIUS, '#E67A4A', 'rgba(230,122,74,1)', '火星');
        } else {
            drawPlanet(ctx, venusPos, VENUS_RADIUS, '#D4C06A', 'rgba(212,192,106,1)', '金星');
        }

        drawConnection(ctx, sunPos, earthPos, 'rgba(109,140,255,0.10)', 1.5);
        drawConnection(ctx, earthPos, targetPos, 'rgba(138,172,255,0.12)', 1.2);

        drawVignetteCached(ctx);

        var eventResult = detectEvent(earthAngle, targetAngle);
        var distAU = calcDistanceAU(earthPos, targetPos);
        var posType = getPositionType(eventResult.diff);

        return {
            earthAngle: earthAngle, marsAngle: marsAngle, venusAngle: venusAngle,
            earthPos: earthPos, targetPos: targetPos, targetAngle: targetAngle,
            isEvent: eventResult.isEvent, diff: eventResult.diff,
            distAU: distAU, posType: posType
        };
    }

    // ================================================================
    // LAYER 3: 动画控制器（自适应帧率）
    // ================================================================

    var AnimController = {
        isPlaying: false,
        speed: 30,
        direction: 1,
        currentDay: 0,
        rafId: null,
        lastTimestamp: 0,
        onFrame: null,

        // Adaptive frame rate state
        frameCount: 0,
        frameSkip: 0,        // 0=60fps, 1=30fps, 2=20fps
        slowFrames: 0,       // consecutive slow frames counter
        fastFrames: 0,       // consecutive fast frames counter

        /**
         * Adaptive step: skip rendering on some frames if performance is poor.
         * Frame skip levels: 0 (every frame), 1 (every 2nd frame), 2 (every 3rd).
         * Simulation always runs — only rendering is skipped.
         */
        shouldRender: function() {
            if (this.frameSkip === 0) return true;
            return (this.frameCount % (this.frameSkip + 1)) === 0;
        },

        adjustFrameSkip: function(frameDelta) {
            // frameDelta in ms. Target: < 20ms for 60fps.
            if (frameDelta > 25) {
                this.slowFrames++;
                this.fastFrames = 0;
                if (this.slowFrames > 5 && this.frameSkip < 2) {
                    this.frameSkip++;
                    this.slowFrames = 0;
                }
            } else if (frameDelta < 14) {
                this.fastFrames++;
                this.slowFrames = 0;
                if (this.fastFrames > 30 && this.frameSkip > 0) {
                    this.frameSkip--;
                    this.fastFrames = 0;
                }
            } else {
                this.slowFrames = 0;
                this.fastFrames = 0;
            }
        },

        play: function() {
            if (this.isPlaying) return;
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.isPlaying = true;
            this.lastTimestamp = performance.now();
            this.frameCount = 0;
            var self = this;
            function step(timestamp) {
                if (!self.isPlaying) { self.rafId = null; return; }
                var delta = (timestamp - self.lastTimestamp) / 1000;
                self.lastTimestamp = timestamp;
                self.frameCount++;

                // Adaptive: detect frame time and adjust skip
                self.adjustFrameSkip(delta * 1000);

                var stepDays = Math.min(self.speed * delta, 0.8);
                self.currentDay += stepDays * self.direction;

                if (self.onFrame) {
                    // Pass frameSkip info: rendering only when shouldRender
                    self.onFrame(self.currentDay, delta, self.shouldRender());
                }
                self.rafId = requestAnimationFrame(step);
            }
            this.rafId = requestAnimationFrame(step);
        },

        pause: function() {
            this.isPlaying = false;
            if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
        },

        setSpeed: function(s) { this.speed = s; },

        jumpTo: function(day) {
            var wasPlaying = this.isPlaying;
            if (wasPlaying) this.pause();
            this.currentDay = day;
            if (this.onFrame) this.onFrame(this.currentDay, 0.016, true); // always render on jump
            if (wasPlaying) this.play();
        },

        reset: function() {
            this.pause();
            this.currentDay = 0;
            this.direction = 1;
            this.frameSkip = 0;
            this.slowFrames = 0;
            this.fastFrames = 0;
            if (this.onFrame) this.onFrame(this.currentDay, 0.016, true);
        }
    };

    // ================================================================
    // LAYER 4: UI 控制器（基本不变）
    // ================================================================

    var canvas         = document.getElementById('simCanvas');
    var ctx            = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;

    var modeBtns        = document.querySelectorAll('.mode-btn');
    var statusDisplay   = document.getElementById('statusDisplay');
    var distanceDisplay = document.getElementById('distanceDisplay');
    var dateDisplay     = document.getElementById('dateDisplay');
    var timeSlider      = document.getElementById('timeSlider');
    var dayCounter      = document.getElementById('dayCounter');
    var playPauseBtn    = document.getElementById('playPauseBtn');
    var resetBtn        = document.getElementById('resetBtn');
    var predictBtn      = document.getElementById('predictBtn');
    var speedSlider     = document.getElementById('speedSlider');
    var speedDisplay    = document.getElementById('speedDisplay');
    var startDateInput  = document.getElementById('startDate');
    var endDateInput    = document.getElementById('endDate');
    var applyRangeBtn   = document.getElementById('applyRangeBtn');
    var calcBox         = document.getElementById('calcBox');
    var calcContent     = document.getElementById('calcContent');
    var calcClose       = document.getElementById('calcClose');

    var posTags = {
        pos1: document.getElementById('pos1'),
        pos2: document.getElementById('pos2'),
        pos3: document.getElementById('pos3'),
        pos4: document.getElementById('pos4')
    };

    var tweaksToggle   = document.getElementById('tweaksToggle');
    var tweaksPanel    = document.getElementById('tweaksPanel');
    var tweaksClose    = document.getElementById('tweaksClose');
    var tweakStars     = document.getElementById('tweakStars');
    var tweakGlow      = document.getElementById('tweakGlow');
    var tweakVignette  = document.getElementById('tweakVignette');
    var tweakOrbits    = document.getElementById('tweakOrbits');
    var tweakStarsVal  = document.getElementById('tweakStarsVal');
    var tweakGlowVal   = document.getElementById('tweakGlowVal');
    var tweakVignetteVal = document.getElementById('tweakVignetteVal');
    var tweakOrbitsVal = document.getElementById('tweakOrbitsVal');

    var currentMode = 'opposition';
    var lastEventState = false;
    var sliderWindowHalf = 365;
    var sliderDragging = false;

    function dayToSlider(day, center) {
        var val = ((day - (center - sliderWindowHalf)) / (2 * sliderWindowHalf)) * 1000;
        return Math.round(Math.min(1000, Math.max(0, val)) * 10) / 10;
    }

    function sliderToDay(sliderVal, center) {
        return (sliderVal / 1000) * (2 * sliderWindowHalf) + (center - sliderWindowHalf);
    }

    function posTypeLabel(pt) {
        if (pt === 'opposition') return '地球在中间';
        if (pt === 'conjunction') return '太阳在中间';
        return '—';
    }

    function buildCalcText(day, isEvent, mode, distAU, posType) {
        var dateStr = formatDate(dayToDate(day));
        var targetName = (mode === 'opposition') ? '火星' : '金星';
        var period = (mode === 'opposition') ? MARS_PERIOD : VENUS_PERIOD;
        var text = '';
        if (isEvent) {
            var eventName = (mode === 'opposition') ? '火星冲日' : '金星凌日';
            text  = eventName + ' 事件\n';
            text += '日  期：' + dateStr + '\n';
            text += '距  离：' + distAU.toFixed(3) + ' AU（地球—' + targetName + '）\n';
            if (mode === 'opposition') {
                text += '冲日类型：' + (distAU < 0.6 ? '大冲（距离极近，视直径最大）' : '小冲（距离较远，视直径较小）') + '\n';
            }
            text += '天  数：Day ' + Math.round(day) + '\n';
            text += '共线构型：太阳—地球—' + targetName + '（' + posTypeLabel(posType) + '）\n';
            text += '角度偏差：≈0 rad（三点精确共线）';
        } else {
            text = '当前未检测到冲日/凌日事件。\n角度偏差超过 0.04 rad 阈值。\n请继续模拟或使用「查找事件」定位最近事件。';
        }
        return text;
    }

    function showCalcBox(day, isEvent, mode, distAU, posType) {
        calcContent.innerText = buildCalcText(day, isEvent, mode, distAU, posType);
        calcBox.classList.add('show');
    }

    function hideCalcBox() {
        calcBox.classList.remove('show');
    }

    function updateInfoPanel(day, simResult) {
        distanceDisplay.innerText = simResult.distAU.toFixed(3) + ' AU';
        var dateStr = formatDate(dayToDate(day));
        dateDisplay.innerText = dateStr;
        dayCounter.innerText = 'Day ' + Math.round(day);

        var statusText = '常规';
        statusDisplay.classList.remove('special');
        if (simResult.isEvent) {
            statusText = (currentMode === 'opposition') ? '火星冲日' : '金星凌日';
            statusDisplay.classList.add('special');
        } else if (simResult.posType === 'opposition' && simResult.diff < 0.30) {
            statusText = '接近事件';
        } else if (simResult.posType === 'conjunction') {
            statusText = '日合';
        }
        statusDisplay.innerText = statusText;

        Object.values(posTags).forEach(function(tag) { tag.classList.remove('active-tag'); });
        if (simResult.posType === 'opposition') {
            posTags.pos1.classList.add('active-tag');
            posTags.pos4.classList.add('active-tag');
        } else if (simResult.posType === 'conjunction') {
            posTags.pos2.classList.add('active-tag');
            posTags.pos3.classList.add('active-tag');
        }
    }

    function processFrame(day, dt, shouldRender) {
        // Always update simulation state; skip rendering on low-fps frames
        var simResult;
        if (shouldRender !== false) {
            simResult = renderScene(ctx, day, currentMode, dt);
        } else {
            // Fast path: compute angles only, don't render
            var angles = computeAngles(day);
            var targetAngle = (currentMode === 'opposition') ? angles.marsAngle : angles.venusAngle;
            var eventResult = detectEvent(angles.earthAngle, targetAngle);
            simResult = {
                earthAngle: angles.earthAngle, marsAngle: angles.marsAngle, venusAngle: angles.venusAngle,
                earthPos: getPlanetPos(EARTH_ORBIT, angles.earthAngle),
                targetPos: getPlanetPos(
                    (currentMode === 'opposition') ? MARS_ORBIT : VENUS_ORBIT,
                    targetAngle
                ),
                targetAngle: targetAngle,
                isEvent: eventResult.isEvent, diff: eventResult.diff,
                distAU: 0, posType: getPositionType(eventResult.diff)
            };
            // Compute distance on fast path too (needed for display)
            var tp = simResult.targetPos;
            var ep = simResult.earthPos;
            simResult.distAU = calcDistanceAU(ep, tp);
        }

        updateInfoPanel(day, simResult);

        if (!sliderDragging) {
            timeSlider.value = dayToSlider(day, day);
        }

        if (simResult.isEvent && !lastEventState) {
            showCalcBox(day, true, currentMode, simResult.distAU, simResult.posType);
        }
        lastEventState = simResult.isEvent;

        return simResult;
    }

    function jumpToDay(day) {
        lastEventState = false;
        hideCalcBox();
        return processFrame(day, 0.016, true);
    }

    // Animation callback — now receives shouldRender flag
    AnimController.onFrame = function(day, dt, shouldRender) {
        processFrame(day, dt, shouldRender);
    };

    // ================================================================
    // 事件绑定（保持不变）
    // ================================================================

    modeBtns.forEach(function(btn) {
        btn.addEventListener('click', function() {
            modeBtns.forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
            currentMode = this.dataset.mode;
            AnimController.reset();
            hideCalcBox();
        });
    });

    playPauseBtn.addEventListener('click', function() {
        if (AnimController.isPlaying) {
            AnimController.pause();
            playPauseBtn.innerText = '播放';
        } else {
            lastEventState = false;
            hideCalcBox();
            AnimController.play();
            playPauseBtn.innerText = '暂停';
        }
    });

    resetBtn.addEventListener('click', function() {
        AnimController.reset();
        playPauseBtn.innerText = '播放';
        hideCalcBox();
        lastEventState = false;
    });

    speedSlider.addEventListener('input', function() {
        var s = parseFloat(this.value);
        AnimController.setSpeed(s);
        speedDisplay.innerText = Math.round(s);
    });

    timeSlider.addEventListener('input', function() {
        sliderDragging = true;
        if (AnimController.isPlaying) {
            AnimController.pause();
            playPauseBtn.innerText = '播放';
        }
        var sliderVal = parseFloat(this.value);
        var day = sliderToDay(sliderVal, AnimController.currentDay);
        lastEventState = false;
        hideCalcBox();
        processFrame(day, 0.016, true);
        AnimController.currentDay = day;
    });
    timeSlider.addEventListener('change', function() {
        sliderDragging = false;
        timeSlider.value = dayToSlider(AnimController.currentDay, AnimController.currentDay);
    });

    applyRangeBtn.addEventListener('click', function() {
        var startVal = startDateInput.value;
        var endVal = endDateInput.value;
        if (!startVal || !endVal) return;
        var start = new Date(startVal);
        var end = new Date(endVal);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            alert('日期无效，请检查格式。');
            return;
        }
        var startDay = dateToDay(start);
        var endDay = dateToDay(end);
        if (startDay >= endDay) {
            alert('起始日期需早于结束日期。');
            return;
        }
        var centerDay = (startDay + endDay) / 2;
        sliderWindowHalf = Math.max(1, Math.ceil((endDay - startDay) / 2));
        AnimController.pause();
        playPauseBtn.innerText = '播放';
        AnimController.currentDay = startDay;
        lastEventState = false;
        hideCalcBox();
        processFrame(startDay, 0.016, true);
        timeSlider.value = dayToSlider(startDay, centerDay);
    });

    predictBtn.addEventListener('click', function() {
        AnimController.pause();
        playPauseBtn.innerText = '播放';
        var currentDay = AnimController.currentDay;
        var bestDay = currentDay;
        var bestDiff = Infinity;
        var searchStart = currentDay - 800;
        var searchEnd   = currentDay + 800;
        for (var d = searchStart; d <= searchEnd; d += 0.8) {
            var angles = computeAngles(d);
            var target = (currentMode === 'opposition') ? angles.marsAngle : angles.venusAngle;
            var diff = angularDiff(angles.earthAngle, target);
            if (diff < bestDiff) { bestDiff = diff; bestDay = d; }
        }
        if (bestDiff < 0.20) {
            lastEventState = false;
            hideCalcBox();
            var simResult = jumpToDay(bestDay);
            if (simResult.isEvent) {
                showCalcBox(bestDay, true, currentMode, simResult.distAU, simResult.posType);
            } else {
                alert('该位置未检测到事件，角度偏差略大于阈值。');
            }
        } else {
            alert('附近未找到显著事件，请手动调整时间。');
        }
    });

    calcClose.addEventListener('click', function() { hideCalcBox(); });

    // ================================================================
    // Tweaks 面板
    // ================================================================

    var tweaksOpen = false;

    function openTweaks() {
        tweaksOpen = true;
        tweaksPanel.classList.add('open');
        tweaksToggle.style.opacity = '0';
        tweaksToggle.style.pointerEvents = 'none';
    }

    function closeTweaks() {
        tweaksOpen = false;
        tweaksPanel.classList.remove('open');
        tweaksToggle.style.opacity = '';
        tweaksToggle.style.pointerEvents = '';
    }

    tweaksToggle.addEventListener('click', function() {
        if (tweaksOpen) closeTweaks();
        else openTweaks();
    });

    tweaksClose.addEventListener('click', closeTweaks);

    document.addEventListener('click', function(e) {
        if (tweaksOpen &&
            !tweaksPanel.contains(e.target) &&
            e.target !== tweaksToggle &&
            !tweaksToggle.contains(e.target)) {
            closeTweaks();
        }
    });

    function applyTweakStars() {
        tweaks.starCount = parseInt(tweakStars.value);
        tweakStarsVal.innerText = tweaks.starCount;
        rebuildStarfield();
        starCacheDirty = true;
    }

    function applyTweakGlow() {
        tweaks.glowMultiplier = parseInt(tweakGlow.value) / 100;
        tweakGlowVal.innerText = Math.round(tweaks.glowMultiplier * 100) + '%';
        sunCacheDirty = true;
        // Force render
        processFrame(AnimController.currentDay, 0.016, true);
    }

    function applyTweakVignette() {
        tweaks.vignetteStrength = parseInt(tweakVignette.value) / 100;
        tweakVignetteVal.innerText = Math.round(tweaks.vignetteStrength * 100) + '%';
        vignetteCacheDirty = true;
        processFrame(AnimController.currentDay, 0.016, true);
    }

    function applyTweakOrbits() {
        tweaks.orbitOpacity = parseInt(tweakOrbits.value) / 100;
        tweakOrbitsVal.innerText = Math.round(tweaks.orbitOpacity * 100) + '%';
        processFrame(AnimController.currentDay, 0.016, true);
    }

    tweakStars.addEventListener('input', applyTweakStars);
    tweakGlow.addEventListener('input', applyTweakGlow);
    tweakVignette.addEventListener('input', applyTweakVignette);
    tweakOrbits.addEventListener('input', applyTweakOrbits);

    tweaksPanel.addEventListener('click', function(e) { e.stopPropagation(); });
    tweaksToggle.addEventListener('click', function(e) { e.stopPropagation(); });

    // ================================================================
    // 初始化
    // ================================================================

    function init() {
        rebuildStarfield();
        rebuildStarCache();
        rebuildSunCache();
        rebuildVignetteCache();

        startDateInput.value = formatDate(new Date(2026, 6, 1));
        endDateInput.value   = formatDate(new Date(2035, 9, 15));

        var startDay = dateToDay(new Date(2026, 6, 1));
        var endDay   = dateToDay(new Date(2035, 9, 15));
        sliderWindowHalf = Math.ceil((endDay - startDay) / 2);
        var centerDay = (startDay + endDay) / 2;

        AnimController.currentDay = startDay;
        processFrame(startDay, 0.016, true);
        timeSlider.value = dayToSlider(startDay, centerDay);
        speedDisplay.innerText = Math.round(AnimController.speed);
        playPauseBtn.innerText = '播放';

        tweakStarsVal.innerText = tweaks.starCount;
        tweakGlowVal.innerText = Math.round(tweaks.glowMultiplier * 100) + '%';
        tweakVignetteVal.innerText = Math.round(tweaks.vignetteStrength * 100) + '%';
        tweakOrbitsVal.innerText = Math.round(tweaks.orbitOpacity * 100) + '%';
    }

    init();

})();
