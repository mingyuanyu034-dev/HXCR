/* ================================================================
   script.js — 深蓝·冲日凌日 · Cinematic Space Edition
   架构：核心模拟 → 星空渲染 → 行星渲染 → 动画控制 → UI + Tweaks
   ================================================================ */

(function() {
    'use strict';

    // ================================================================
    // LAYER 1: 核心模拟逻辑（纯函数）
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

    function getPositionType(earthAngle, targetAngle) {
        var d = angularDiff(earthAngle, targetAngle);
        if (d < 0.20) return 'opposition';
        if (d > 2.8)  return 'conjunction';
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
        starCount: 600,
        glowMultiplier: 1.0,    // 0.5x – 2.0x
        vignetteStrength: 0.55, // 0.0 – 1.0
        orbitOpacity: 1.0       // 0.2 – 1.0
    };

    // ================================================================
    // LAYER 2a: 星空系统
    // ================================================================

    var stars = [];
    var starTime = 0;

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
    }

    function drawStarfield(ctx, dt) {
        starTime += dt;
        var i, s, alpha;
        for (i = 0; i < stars.length; i++) {
            s = stars[i];
            alpha = s.baseAlpha * (0.55 + 0.45 * Math.sin(starTime * s.speed + s.phase));
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, TWO_PI);
            if (s.hue === 30) {
                ctx.fillStyle = 'rgba(255,215,170,' + alpha.toFixed(2) + ')';
            } else if (s.hue === 210) {
                ctx.fillStyle = 'rgba(175,210,255,' + alpha.toFixed(2) + ')';
            } else {
                ctx.fillStyle = 'rgba(255,255,255,' + alpha.toFixed(2) + ')';
            }
            ctx.fill();
            // Bright star glow
            if (s.r > 0.9 && alpha > 0.5) {
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r * 3.5, 0, TWO_PI);
                ctx.fillStyle = 'rgba(255,255,255,' + (alpha * 0.06).toFixed(3) + ')';
                ctx.fill();
            }
        }
    }

    function drawVignette(ctx) {
        if (tweaks.vignetteStrength <= 0.01) return;
        var grad = ctx.createRadialGradient(W/2, H/2, W * 0.35, W/2, H/2, W * 0.72);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,' + tweaks.vignetteStrength.toFixed(2) + ')');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
    }

    // ================================================================
    // LAYER 2b: 行星/轨道渲染
    // ================================================================

    function drawOrbits(ctx) {
        var alpha = (tweaks.orbitOpacity * 0.06).toFixed(3);
        ctx.setLineDash([3, 8]);
        ctx.lineWidth = 0.8;
        [EARTH_ORBIT, MARS_ORBIT, VENUS_ORBIT].forEach(function(r) {
            ctx.beginPath();
            ctx.arc(W / 2, H / 2, r * AU, 0, TWO_PI);
            ctx.strokeStyle = 'rgba(255,255,255,' + alpha + ')';
            ctx.stroke();
        });
        ctx.setLineDash([]);
    }

    function drawSun(ctx) {
        var sunX = W / 2, sunY = H / 2;
        var gm = tweaks.glowMultiplier;

        // Multi-layer corona
        var layers = [
            { r: SUN_RADIUS + 44 * gm, a: 0.025 * gm, blur: 55 * gm },
            { r: SUN_RADIUS + 26 * gm, a: 0.05 * gm, blur: 36 * gm },
            { r: SUN_RADIUS + 14 * gm, a: 0.10 * gm, blur: 20 * gm }
        ];

        layers.forEach(function(l) {
            if (l.a < 0.002) return;
            ctx.beginPath();
            ctx.arc(sunX, sunY, l.r, 0, TWO_PI);
            ctx.fillStyle = 'rgba(245,179,66,' + l.a.toFixed(3) + ')';
            ctx.shadowColor = 'rgba(245,179,66,' + Math.min(0.5, l.a * 6).toFixed(2) + ')';
            ctx.shadowBlur = l.blur;
            ctx.fill();
        });
        ctx.shadowBlur = 0;

        // Main body
        var grad = ctx.createRadialGradient(sunX - 8, sunY - 8, 4, sunX, sunY, SUN_RADIUS);
        grad.addColorStop(0, '#FFF8E1');
        grad.addColorStop(0.3, '#FFE082');
        grad.addColorStop(0.55, '#F5B342');
        grad.addColorStop(0.8, '#E68A20');
        grad.addColorStop(1, '#C5600A');

        ctx.shadowColor = 'rgba(245,179,66,' + (0.6 * gm).toFixed(2) + ')';
        ctx.shadowBlur = 28 * gm;
        ctx.beginPath();
        ctx.arc(sunX, sunY, SUN_RADIUS, 0, TWO_PI);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Hot core
        var coreGrad = ctx.createRadialGradient(sunX - 3, sunY - 4, 2, sunX, sunY, SUN_RADIUS * 0.45);
        coreGrad.addColorStop(0, 'rgba(255,255,255,0.65)');
        coreGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.beginPath();
        ctx.arc(sunX, sunY, SUN_RADIUS * 0.45, 0, TWO_PI);
        ctx.fillStyle = coreGrad;
        ctx.fill();
    }

    function drawPlanet(ctx, pos, radius, color, glowColor, label) {
        var gm = tweaks.glowMultiplier;

        // Atmospheric outer glow
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius * 2.4 * gm, 0, TWO_PI);
        ctx.fillStyle = glowColor.replace('1)', (0.06 * gm).toFixed(3) + ')');
        ctx.fill();

        // Planet body with shadow
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

        drawStarfield(ctx, dt || 0.016);
        drawOrbits(ctx);
        drawSun(ctx);

        drawPlanet(ctx, earthPos, EARTH_RADIUS, '#4A9EFF', 'rgba(74,158,255,1)', '地球');
        if (mode === 'opposition') {
            drawPlanet(ctx, marsPos, MARS_RADIUS, '#E67A4A', 'rgba(230,122,74,1)', '火星');
        } else {
            drawPlanet(ctx, venusPos, VENUS_RADIUS, '#D4C06A', 'rgba(212,192,106,1)', '金星');
        }

        drawConnection(ctx, sunPos, earthPos, 'rgba(109,140,255,0.10)', 1.5);
        drawConnection(ctx, earthPos, targetPos, 'rgba(138,172,255,0.12)', 1.2);

        drawVignette(ctx);

        var eventResult = detectEvent(earthAngle, targetAngle);
        var distAU = calcDistanceAU(earthPos, targetPos);
        var posType = getPositionType(earthAngle, targetAngle);

        return {
            earthAngle: earthAngle, marsAngle: marsAngle, venusAngle: venusAngle,
            earthPos: earthPos, targetPos: targetPos, targetAngle: targetAngle,
            isEvent: eventResult.isEvent, diff: eventResult.diff,
            distAU: distAU, posType: posType
        };
    }

    // ================================================================
    // LAYER 3: 动画控制器
    // ================================================================

    var AnimController = {
        isPlaying: false,
        speed: 30,
        direction: 1,
        currentDay: 0,
        rafId: null,
        lastTimestamp: 0,
        onFrame: null,

        play: function() {
            if (this.isPlaying) return;
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.isPlaying = true;
            this.lastTimestamp = performance.now();
            var self = this;
            function step(timestamp) {
                if (!self.isPlaying) { self.rafId = null; return; }
                var delta = (timestamp - self.lastTimestamp) / 1000;
                self.lastTimestamp = timestamp;
                var stepDays = Math.min(self.speed * delta, 0.8);
                self.currentDay += stepDays * self.direction;
                if (self.onFrame) self.onFrame(self.currentDay, delta);
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
            if (this.onFrame) this.onFrame(this.currentDay, 0.016);
            if (wasPlaying) this.play();
        },

        reset: function() {
            this.pause();
            this.currentDay = 0;
            this.direction = 1;
            if (this.onFrame) this.onFrame(this.currentDay, 0.016);
        }
    };

    // ================================================================
    // LAYER 4: UI 控制器
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

    // Tweaks DOM
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
            text += '日  期：' + dateStr + '\n';
            text += '距  离：' + distAU.toFixed(3) + ' AU（地球—' + targetName + '）\n';
            if (mode === 'opposition') {
                text += '冲日类型：' + (distAU < 0.6 ? '大冲（距离极近，视直径最大）' : '小冲（距离较远，视直径较小）') + '\n';
            }
            text += '天  数：Day ' + Math.round(day) + '\n';
            text += '共线构型：太阳—地球—' + targetName + '（' + posTypeLabel(posType) + '）\n';
            text += '角度偏差：' + '≈0 rad（三点精确共线）';
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

    function processFrame(day, dt) {
        var simResult = renderScene(ctx, day, currentMode, dt);
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
        return processFrame(day, 0.016);
    }

    // -- 动画回调 --
    AnimController.onFrame = function(day, dt) {
        processFrame(day, dt);
    };

    // ================================================================
    // 事件绑定
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
        processFrame(day, 0.016);
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
        processFrame(startDay, 0.016);
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

    // Click outside to close
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
    }

    function applyTweakGlow() {
        tweaks.glowMultiplier = parseInt(tweakGlow.value) / 100;
        tweakGlowVal.innerText = Math.round(tweaks.glowMultiplier * 100) + '%';
        // Force re-render
        processFrame(AnimController.currentDay, 0.016);
    }

    function applyTweakVignette() {
        tweaks.vignetteStrength = parseInt(tweakVignette.value) / 100;
        tweakVignetteVal.innerText = Math.round(tweaks.vignetteStrength * 100) + '%';
        processFrame(AnimController.currentDay, 0.016);
    }

    function applyTweakOrbits() {
        tweaks.orbitOpacity = parseInt(tweakOrbits.value) / 100;
        tweakOrbitsVal.innerText = Math.round(tweaks.orbitOpacity * 100) + '%';
        processFrame(AnimController.currentDay, 0.016);
    }

    tweakStars.addEventListener('input', applyTweakStars);
    tweakGlow.addEventListener('input', applyTweakGlow);
    tweakVignette.addEventListener('input', applyTweakVignette);
    tweakOrbits.addEventListener('input', applyTweakOrbits);

    // Prevent tweaks panel from triggering document click close
    tweaksPanel.addEventListener('click', function(e) { e.stopPropagation(); });
    tweaksToggle.addEventListener('click', function(e) { e.stopPropagation(); });

    // ================================================================
    // 初始化
    // ================================================================

    function init() {
        rebuildStarfield();

        startDateInput.value = formatDate(new Date(2026, 6, 1));
        endDateInput.value   = formatDate(new Date(2035, 9, 15));

        var startDay = dateToDay(new Date(2026, 6, 1));
        var endDay   = dateToDay(new Date(2035, 9, 15));
        sliderWindowHalf = Math.ceil((endDay - startDay) / 2);
        var centerDay = (startDay + endDay) / 2;

        AnimController.currentDay = startDay;
        processFrame(startDay, 0.016);
        timeSlider.value = dayToSlider(startDay, centerDay);
        speedDisplay.innerText = Math.round(AnimController.speed);
        playPauseBtn.innerText = '播放';

        // Init tweak displays
        tweakStarsVal.innerText = tweaks.starCount;
        tweakGlowVal.innerText = Math.round(tweaks.glowMultiplier * 100) + '%';
        tweakVignetteVal.innerText = Math.round(tweaks.vignetteStrength * 100) + '%';
        tweakOrbitsVal.innerText = Math.round(tweaks.orbitOpacity * 100) + '%';
    }

    init();

})();
