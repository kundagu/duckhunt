/* Игра: состояние, камера, цикл, звук, захват курсора. */
(function () {
  'use strict';

  var DH = (window.DH = window.DH || {});
  var V3 = DH.V3;
  var DEG = Math.PI / 180;

  var REST_FOV = 70 * DEG;
  var MOUSE_SCALE = 0.0022; /* рад на пиксель при чувствительности 1 */
  var RELOAD_TIME = 0.95;    /* с */
  var IMPACT_LIFE = 3;       /* с — время жизни отметки «куда попала дробь» */
  /* Предел тангажа: прежние 83° увеличены на 10% (83 * 1.1 = 91.3°) */
  var PITCH_LIMIT = 83 * DEG * 1.1;

  /* ---------------- Звук ---------------- */
  var Sound = {
    ctx: null,
    enabled: true,
    noise: null,

    init: function () {
      if (this.ctx) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      var len = Math.floor(this.ctx.sampleRate * 0.4);
      var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    },

    resume: function () {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    burst: function (dur, freq, vol, type) {
      if (!this.enabled || !this.ctx) return;
      var ctx = this.ctx, t0 = ctx.currentTime;
      var src = ctx.createBufferSource();
      src.buffer = this.noise;
      var flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = freq;
      var gn = ctx.createGain();
      gn.gain.setValueAtTime(vol, t0);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(flt); flt.connect(gn); gn.connect(ctx.destination);
      src.start(t0); src.stop(t0 + dur + 0.02);

      if (type === 'thump') {
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120, t0);
        osc.frequency.exponentialRampToValueAtTime(45, t0 + dur);
        var og = ctx.createGain();
        og.gain.setValueAtTime(vol * 1.2, t0);
        og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 1.4);
        osc.connect(og); og.connect(ctx.destination);
        osc.start(t0); osc.stop(t0 + dur * 1.5);
      }
    },

    tone: function (freq, dur, vol, sweep) {
      if (!this.enabled || !this.ctx) return;
      var ctx = this.ctx, t0 = ctx.currentTime;
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (sweep) osc.frequency.exponentialRampToValueAtTime(sweep, t0 + dur);
      var gn = ctx.createGain();
      gn.gain.setValueAtTime(vol, t0);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gn); gn.connect(ctx.destination);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
    },

    shot: function () { this.burst(0.22, 1100, 0.30, 'thump'); },
    empty: function () { this.tone(1250, 0.05, 0.12); },
    click: function () { this.tone(700, 0.06, 0.14, 400); },
    hit: function () { this.tone(2600, 0.16, 0.20, 900); this.burst(0.12, 3500, 0.10); }
  };

  /* ---------------- Игра ---------------- */
  var game = {
    state: 'menu',
    canvas: null,
    ctx: null,
    W: 0, H: 0, dpr: 1,

    cam: {
      pos: { x: 0, y: 1.6, z: 0 },
      yaw: 0, pitch: 0,
      fwd: { x: 0, y: 0, z: 1 },
      right: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 }
    },

    fov: REST_FOV,
    aimHeld: false,
    aimProgress: 0,
    time: 0,
    swayX: 0,

    ammo: 2,
    reloading: false,
    reloadTimer: 0,
    reloadProgress: 0,

    shots: 0,
    hits: 0,
    hitsPulse: 0,
    hintTimer: 0,
    hint: '',
    toast: '',
    toastTimer: 0,
    impacts: [] /* отметки «куда попала дробь» */
  };
  DH.game = game;

  function updateCameraBasis() {
    var c = game.cam;
    var sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    var sp = Math.sin(c.pitch), cp = Math.cos(c.pitch);
    c.fwd = { x: sy * cp, y: sp, z: cy * cp };
    c.right = { x: cy, y: 0, z: -sy };
    c.up = { x: -sp * sy, y: cp, z: -sp * cy };
  }

  function showToast(text, dur) {
    game.toast = text;
    game.toastTimer = dur || 2;
  }

  function controlHint() {
    var b = DH.settings.bindings;
    return 'Прицеливание — ' + DH.bindingLabel(b.aim) +
      ', выстрел — ' + DH.bindingLabel(b.fire) +
      ', перезарядка — ' + DH.bindingLabel(b.reload) +
      '. Esc — пауза.';
  }

  /* ---------------- Действия ---------------- */

  function doFire() {
    if (game.state !== 'playing' || game.reloading) return;
    if (game.ammo <= 0) {
      Sound.empty();
      showToast('Нет патронов — перезарядка: ' + DH.bindingLabel(DH.settings.bindings.reload), 1.6);
      return;
    }

    var barrel = game.ammo === 2 ? 'cylinder' : 'choke'; /* сначала нижний — получок */
    game.ammo--;
    game.shots++;

    Sound.shot();

    var origin = { x: game.cam.pos.x, y: game.cam.pos.y, z: game.cam.pos.z };
    /* Выстрел идёт через точку прицеливания: центр экрана + 20% высоты вниз */
    var focal = (game.H / 2) / Math.tan(game.fov / 2);
    var dip = (game.H * 0.20) / focal;
    var dir = V3.norm(V3.sub(game.cam.fwd, V3.scale(game.cam.up, dip)));

    /* Подсказка выстрела: круг разлёта дроби (на дистанции ближайшей цели
       перед стрелком, иначе — 25 м) с учётом просадки + кольца упреждения
       для всех целей в радиусе 15% высоты экрана от точки прицеливания */
    if (DH.settings && DH.settings.hintImpact) {
      /* Дистанция круга поражения — ближайшая цель в конусе 25° от оси */
      var impD = 25;
      for (var j = 0; j < DH.Targets.list.length; j++) {
        var tg = DH.Targets.list[j];
        if (tg.dead) continue;
        var rl = V3.sub(tg.p, origin);
        var along = V3.dot(rl, dir);
        if (along < 1 || along > 80) continue;
        if (along / V3.len(rl) < Math.cos(25 * DEG)) continue; /* цель не дальше 25° от оси */
        if (along < impD) impD = along;
      }

      /* Все цели, чьё экранное положение в момент выстрела находится в радиусе
         15% высоты экрана от точки прицеливания (W/2, H*0.7) */
      var aims = [];
      var cam = game.cam;
      var aimSX = game.W / 2, aimSY = game.H * 0.7, pickR = game.H * 0.15;
      for (var m = 0; m < DH.Targets.list.length; m++) {
        var t2 = DH.Targets.list[m];
        if (t2.dead) continue;
        var dx = t2.p.x - cam.pos.x, dy = t2.p.y - cam.pos.y, dz = t2.p.z - cam.pos.z;
        var zc = dx * cam.fwd.x + dy * cam.fwd.y + dz * cam.fwd.z;
        if (zc < 0.08) continue; /* цель за камерой или вблизи ближней плоскости */
        var xc = dx * cam.right.x + dy * cam.right.y + dz * cam.right.z;
        var yc = dx * cam.up.x + dy * cam.up.y + dz * cam.up.z;
        var sdx = game.W / 2 + xc / zc * focal - aimSX;
        var sdy = game.H / 2 - yc / zc * focal - aimSY;
        if (sdx * sdx + sdy * sdy > pickR * pickR) continue;

        /* та же итерация, что у живой подсказки «куда целиться»:
           упреждение на время долёта + компенсация просадки */
        var ap = t2.p;
        for (var q = 0; q < 4; q++) {
          var atof = V3.dist(ap, origin) / DH.Ballistics.MUZZLE_SPEED;
          var atg = V3.add(t2.p, V3.scale(t2.v, atof));
          ap = { x: atg.x, y: atg.y + 0.5 * 9.81 * atof * atof, z: atg.z };
        }
        aims.push({ p: ap, radius: t2.radius });
      }

      var impTof = impD / DH.Ballistics.MUZZLE_SPEED;
      game.impacts.push({
        p: {
          x: origin.x + dir.x * impD,
          y: origin.y + dir.y * impD - 0.5 * 9.81 * impTof * impTof,
          z: origin.z + dir.z * impD
        },
        radius: DH.Ballistics.patternRadius(barrel, impD),
        aims: aims,
        life: IMPACT_LIFE,
        t: IMPACT_LIFE
      });
    }

    var hits = DH.Ballistics.resolveShot(origin, dir, barrel, DH.Targets.list);
    for (var i = 0; i < hits.length; i++) {
      DH.Targets.destroy(hits[i]);
      game.hits++;
    }
    if (hits.length > 0) {
      game.hitsPulse = 0.25;
      Sound.hit();
    }

    if (game.ammo === 0) {
      showToast('Два выстрела — перезарядка: ' + DH.bindingLabel(DH.settings.bindings.reload), 2);
    }

    /* Достигнут лимит выстрелов серии: фиксируем статистику и обнуляем счёт */
    var limit = (DH.settings && DH.settings.shotLimit) | 0;
    if (limit > 0 && game.shots >= limit) {
      var rec = DH.recordSeries(game.shots, game.hits);
      game.shots = 0;
      game.hits = 0;
      showToast('Серия окончена: ' + (rec ? rec.hits + '/' + rec.shots + ' (' + Math.round(rec.acc) + '%)' : '') +
        ' — записана в статистику, счёт обнулён', 3);
    }
  }

  function doReload() {
    if (game.state !== 'playing' || game.reloading) return;
    /* Перезарядка всегда заряжает оба ствола полностью; ружьё при этом
       опускается и не поднимается само — только по нажатию прицеливания */
    game.aimHeld = false;
    game.reloading = true;
    game.reloadTimer = RELOAD_TIME;
    Sound.click();
  }

  function setAim(down) {
    /* Прицеливание — переключатель: нажатие поднимает/опускает ружьё */
    if (down) game.aimHeld = !game.aimHeld;
  }

  function pause() {
    if (game.state !== 'playing') return;
    game.state = 'paused';
    DH.Input.detach();
    if (document.pointerLockElement === game.canvas && document.exitPointerLock) {
      document.exitPointerLock();
    }
    document.getElementById('pause').classList.remove('hidden');
    document.getElementById('pause-msg').textContent = '';
  }

  function resume() {
    if (game.state !== 'paused') return;
    document.getElementById('pause').classList.add('hidden');
    requestLock();
  }

  function toMenu() {
    /* Незавершённая серия фиксируется в статистике при выходе в меню */
    if (game.shots > 0) DH.recordSeries(game.shots, game.hits);
    game.state = 'menu';
    DH.Input.detach();
    if (document.pointerLockElement === game.canvas && document.exitPointerLock) {
      document.exitPointerLock();
    }
    document.getElementById('pause').classList.add('hidden');
    document.getElementById('menu').classList.remove('hidden');
    DH.Targets.reset();
  }

  function startGame() {
    Sound.enabled = DH.settings.sound;
    Sound.resume();

    game.shots = 0;
    game.hits = 0;
    game.ammo = 2;
    game.reloading = false;
    game.reloadProgress = 0;
    game.aimProgress = 0;
    game.aimHeld = false;
    game.hitsPulse = 0;
    game.toastTimer = 0;
    game.impacts.length = 0;
    game.hint = controlHint();
    game.hintTimer = 6;
    game.cam.yaw = 0;
    game.cam.pitch = 0;
    DH.Targets.reset();

    document.getElementById('menu').classList.add('hidden');
    document.getElementById('pause').classList.add('hidden');
    game.state = 'playing';
    requestLock();
  }

  function requestLock() {
    var el = game.canvas;
    if (el.requestPointerLock) {
      var res;
      try { res = el.requestPointerLock(); } catch (e) { res = null; }
      if (res && typeof res.catch === 'function') {
        res.catch(function () {
          var msg = document.getElementById('pause-msg');
          document.getElementById('pause').classList.remove('hidden');
          game.state = 'paused';
          DH.Input.detach();
          if (msg) msg.textContent = 'Не удалось захватить курсор. Нажмите «Продолжить» ещё раз.';
        });
      }
    }
    /* Ввод включаем сразу: movementX работает и без захвата курсора */
    DH.Input.bind(DH.settings, {
      fire: doFire,
      reload: doReload,
      aim: setAim,
      escape: pause
    });
    DH.Input.attach();
    game.state = 'playing';
  }

  /* ---------------- Обновление ---------------- */

  function update(dt) {
    game.time += dt;

    /* Прицеливание: только поднимаем оружие, без зума */
    var target = game.aimHeld ? 1 : 0;
    game.aimProgress += (target - game.aimProgress) * Math.min(1, dt * 9);

    game.hitsPulse = Math.max(0, game.hitsPulse - dt);
    game.hintTimer = Math.max(0, game.hintTimer - dt);
    game.toastTimer = Math.max(0, game.toastTimer - dt);

    /* Отметки «куда попала дробь» */
    for (var k = game.impacts.length - 1; k >= 0; k--) {
      game.impacts[k].t -= dt;
      if (game.impacts[k].t <= 0) game.impacts.splice(k, 1);
    }

    /* Перезарядка */
    if (game.reloading) {
      game.reloadTimer -= dt;
      game.reloadProgress = 1 - Math.max(0, game.reloadTimer) / RELOAD_TIME;
      if (game.reloadTimer <= 0) {
        game.reloading = false;
        game.reloadProgress = 0;
        game.ammo = 2;
        Sound.click();
      }
    }

    /* Ограничение наклона */
    if (game.cam.pitch > PITCH_LIMIT) game.cam.pitch = PITCH_LIMIT;
    if (game.cam.pitch < -PITCH_LIMIT) game.cam.pitch = -PITCH_LIMIT;

    updateCameraBasis();
    var focal = (game.H / 2) / Math.tan(game.fov / 2);
    DH.Targets.update(
      dt, game.cam,
      !!(DH.settings && DH.settings.evasion && game.aimHeld),
      { W: game.W, H: game.H, focal: focal }
    );
  }

  function updateMenuCamera(dt) {
    game.time += dt;
    game.cam.yaw += 0.035 * dt; /* медленный обзор на фоне меню */
    game.cam.pitch += (0.02 - game.cam.pitch) * Math.min(1, dt);
    game.aimProgress = 0;
    updateCameraBasis();
    DH.Targets.update(dt, game.cam);
  }

  /* ---------------- Цикл ---------------- */

  var last = 0;
  function loop(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (game.state === 'playing') update(dt);
    else updateMenuCamera(dt);

    DH.Render.draw(game.ctx, game.W, game.H, game);
    requestAnimationFrame(loop);
  }

  function resize() {
    game.dpr = Math.min(2, window.devicePixelRatio || 1);
    game.W = window.innerWidth;
    game.H = window.innerHeight;
    game.canvas.width = Math.round(game.W * game.dpr);
    game.canvas.height = Math.round(game.H * game.dpr);
  }

  /* ---------------- Инициализация ---------------- */

  function onMouseMove(e) {
    if (game.state !== 'playing') return;
    var s = DH.settings.sensitivity * MOUSE_SCALE;
    game.cam.yaw += e.movementX * s;
    game.cam.pitch -= e.movementY * s;
  }

  function onPointerLockChange() {
    var locked = document.pointerLockElement === game.canvas;
    if (!locked && game.state === 'playing') pause();
  }

  window.addEventListener('DOMContentLoaded', function () {
    game.canvas = document.getElementById('game');
    game.ctx = game.canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('pointerlockerror', function () {
      if (game.state === 'playing') pause();
    });

    DH.initMenu(startGame);

    document.getElementById('btn-resume').addEventListener('click', resume);
    document.getElementById('btn-menu').addEventListener('click', toMenu);

    var btnResetResults = document.getElementById('btn-reset-results');
    if (btnResetResults) {
      btnResetResults.addEventListener('click', function () {
        var rec = game.shots > 0 ? DH.recordSeries(game.shots, game.hits) : null;
        game.shots = 0;
        game.hits = 0;
        game.impacts.length = 0;
        var msg = document.getElementById('pause-msg');
        if (msg) {
          msg.textContent = rec
            ? 'Серия записана (' + rec.hits + '/' + rec.shots + ', ' + Math.round(rec.acc) + '%), счёт обнулён.'
            : 'Счёт обнулён.';
        }
      });
    }

    updateCameraBasis();
    requestAnimationFrame(function (t) { last = t; requestAnimationFrame(loop); });
  });
})();
