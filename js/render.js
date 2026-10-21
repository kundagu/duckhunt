/* Отрисовка: небо, поле, горизонт, цели, оружие, HUD. */
(function () {
  'use strict';

  var DH = (window.DH = window.DH || {});
  var V3 = DH.V3;

  var NEAR = 0.08;
  var COORD_MAX = 1e5;
  var G_ACC = 9.81;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* Преобразование мировой точки в координаты камеры */
  function camPoint(p, cam) {
    var dx = p.x - cam.pos.x, dy = p.y - cam.pos.y, dz = p.z - cam.pos.z;
    return {
      x: dx * cam.right.x + dy * cam.right.y + dz * cam.right.z,
      y: dx * cam.up.x + dy * cam.up.y + dz * cam.up.z,
      z: dx * cam.fwd.x + dy * cam.fwd.y + dz * cam.fwd.z
    };
  }

  function projCp(cp, focal, cx, cy) {
    return {
      x: clamp(cx + cp.x / cp.z * focal, -COORD_MAX, COORD_MAX),
      y: clamp(cy - cp.y / cp.z * focal, -COORD_MAX, COORD_MAX)
    };
  }

  function lerpCp(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }

  /* Рисует отрезок в мировых координатах с отсечением ближней плоскости */
  function line3(ctx, a, b, cam, focal, cx, cy) {
    var A = camPoint(a, cam), B = camPoint(b, cam);
    if (A.z < NEAR && B.z < NEAR) return;
    if (A.z < NEAR) A = lerpCp(A, B, (NEAR - B.z) / (A.z - B.z));
    else if (B.z < NEAR) B = lerpCp(B, A, (NEAR - A.z) / (B.z - A.z));
    var pa = projCp(A, focal, cx, cy), pb = projCp(B, focal, cx, cy);
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
  }

  /* ---------------- Небо и поле ---------------- */

  function drawBackground(ctx, W, H, cam, focal, cx, cy) {
    var horizonY = cy + Math.tan(cam.pitch) * focal;

    if (horizonY > -H) {
      var top = Math.min(horizonY, H);
      if (top > 0) {
        var sky = ctx.createLinearGradient(0, 0, 0, Math.max(top, 1));
        sky.addColorStop(0, 'rgb(52,116,208)');
        sky.addColorStop(0.55, 'rgb(120,175,230)');
        sky.addColorStop(1, 'rgb(206,228,245)');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, top);
      }
    }

    if (horizonY < H) {
      var gTop = Math.max(0, horizonY);
      var ground = ctx.createLinearGradient(0, gTop, 0, H);
      ground.addColorStop(0, 'rgb(160,186,110)');
      ground.addColorStop(0.35, 'rgb(126,158,80)');
      ground.addColorStop(1, 'rgb(74,106,48)');
      ctx.fillStyle = ground;
      ctx.fillRect(0, gTop, W, H - gTop);

      /* Сетка поля */
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(38,58,26,0.16)';
      ctx.lineWidth = 1;
      var S = 10, N = 10, i, k;
      for (i = -N; i <= N; i++) {
        k = i * S;
        line3(ctx, { x: k, y: 0, z: -N * S }, { x: k, y: 0, z: N * S }, cam, focal, cx, cy);
        line3(ctx, { x: -N * S, y: 0, z: k }, { x: N * S, y: 0, z: k }, cam, focal, cx, cy);
      }
      ctx.stroke();

      /* Дымка вдали */
      var hazeH = Math.min(H - gTop, Math.max(24, H * 0.22));
      if (hazeH > 2) {
        var haze = ctx.createLinearGradient(0, gTop, 0, gTop + hazeH);
        haze.addColorStop(0, 'rgba(214,230,215,0.85)');
        haze.addColorStop(1, 'rgba(214,230,215,0)');
        ctx.fillStyle = haze;
        ctx.fillRect(0, gTop, W, hazeH);
      }

      /* Линия горизонта */
      if (horizonY >= 0) {
        ctx.strokeStyle = 'rgba(60,84,52,0.45)';
        ctx.beginPath();
        ctx.moveTo(0, horizonY + 0.5);
        ctx.lineTo(W, horizonY + 0.5);
        ctx.stroke();
      }
    }
  }

  /* ---------------- Цели ---------------- */

  function drawTrail(ctx, t, cam, focal, cx, cy) {
    if (t.px.length < 2) return;
    ctx.strokeStyle = 'rgba(255,190,140,0.20)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < t.px.length; i++) {
      var cp = camPoint(t.px[i], cam);
      if (cp.z < NEAR) { started = false; continue; }
      var p = projCp(cp, focal, cx, cy);
      if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y);
    }
    var cpc = camPoint(t.p, cam);
    if (cpc.z >= NEAR) {
      var pc = projCp(cpc, focal, cx, cy);
      if (!started) ctx.moveTo(pc.x, pc.y); else ctx.lineTo(pc.x, pc.y);
    }
    ctx.stroke();
  }

  function drawTarget(ctx, t, cam, focal, cx, cy) {
    drawTrail(ctx, t, cam, focal, cx, cy);

    var cp = camPoint(t.p, cam);
    if (cp.z < NEAR) return;
    var p = projCp(cp, focal, cx, cy);
    var pxPerM = focal / cp.z;

    /* Тень на земле */
    if (t.p.y > 0.15) {
      var sh = camPoint({ x: t.p.x, y: 0, z: t.p.z }, cam);
      if (sh.z >= NEAR) {
        var sp = projCp(sh, focal, cx, cy);
        var srx = clamp(t.radius * pxPerM * 1.1, 1, 120);
        var alpha = clamp(0.30 - t.p.y * 0.012, 0.04, 0.30);
        ctx.fillStyle = 'rgba(30,45,22,' + alpha.toFixed(3) + ')';
        ctx.beginPath();
        ctx.ellipse(sp.x, sp.y, srx, srx * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* Сама тарелочка: эллипс с учётом срезывания плоскости диска */
    var view = V3.norm(V3.sub(t.p, cam.pos));
    var flat = Math.abs(view.y); /* насколько диск срезан по вертикали */
    var semiMajor = Math.max(1.2, t.radius * pxPerM);
    var semiMinor = Math.max(0.8, 0.5 * Math.max(t.thickness, 2 * t.radius * flat) * pxPerM);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(t.bank);

    var grad = ctx.createLinearGradient(0, -semiMinor, 0, semiMinor);
    grad.addColorStop(0, '#ffb066');
    grad.addColorStop(0.5, '#f07d20');
    grad.addColorStop(1, '#b8500e');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, semiMajor, semiMinor, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = Math.max(0.7, semiMajor * 0.09);
    ctx.strokeStyle = 'rgba(70,32,8,0.85)';
    ctx.stroke();
    ctx.restore();
  }

  function drawParticles(ctx, cam, focal, cx, cy) {
    var ps = DH.Targets.particles;
    for (var i = 0; i < ps.length; i++) {
      var q = ps[i];
      var cp = camPoint(q.p, cam);
      if (cp.z < NEAR) continue;
      var p = projCp(cp, focal, cx, cy);
      var s = clamp(q.size * focal / cp.z, 0.8, 60);
      var a = q.age > q.life - 0.4 ? (q.life - q.age) / 0.4 : 1;
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.translate(p.x, p.y);
      ctx.rotate(q.rot);
      ctx.fillStyle = q.dark ? '#4a2408' : '#f07d20';
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------- Подсказка прицеливания ---------------- */

  /* Подсветка точки, куда целиться (с учётом упреждения и просадки дроби) —
     для всех видимых (впереди стрелка) целей */
  function drawAimHint(ctx, W, H, g) {
    if (!DH.settings || !DH.settings.hintAim) return;
    var cam = g.cam;
    var focal = (H / 2) / Math.tan(g.fov / 2);
    var speed = DH.Ballistics.MUZZLE_SPEED;
    for (var i = 0; i < DH.Targets.list.length; i++) {
      var t = DH.Targets.list[i];
      if (t.dead) continue;
      var rel = V3.sub(t.p, cam.pos);
      if (V3.dot(rel, cam.fwd) < 0.5) continue; /* только цели перед стрелком */

      /* Итерационное решение: точка встречи дроби с целью + компенсация просадки */
      var aimP = t.p;
      for (var k = 0; k < 4; k++) {
        var tof = V3.dist(aimP, cam.pos) / speed;
        var tgt = V3.add(t.p, V3.scale(t.v, tof));
        aimP = { x: tgt.x, y: tgt.y + 0.5 * G_ACC * tof * tof, z: tgt.z };
      }

      var cp = camPoint(aimP, cam);
      if (cp.z < NEAR) continue;
      var p = projCp(cp, focal, W / 2, H / 2);

      var pulse = 0.7 + 0.3 * Math.sin(g.time * 6 + i * 1.3);
      var r = clamp((focal / cp.z) * t.radius * 2.2, 16, 220) * pulse;
      ctx.strokeStyle = 'rgba(125,255,154,0.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(125,255,154,0.9)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* Подсказка выстрела: круг разлёта дроби (круг поражения) на дистанции
     выстрела + крестики упреждения целей, попавших в радиус 15% высоты экрана
     от точки прицеливания в момент выстрела */
  function drawImpacts(ctx, W, H, g) {
    if (!g.impacts || !g.impacts.length) return;
    var cam = g.cam;
    var focal = (H / 2) / Math.tan(g.fov / 2);
    for (var i = 0; i < g.impacts.length; i++) {
      var im = g.impacts[i];
      var cp = camPoint(im.p, cam);
      if (cp.z < NEAR) continue;
      var p = projCp(cp, focal, W / 2, H / 2);
      /* Плавное угасание в течение всей жизни отметки (3 с) */
      var fade = clamp(im.t / (im.life || 3), 0, 1);
      var r = clamp((focal / cp.z) * im.radius, 5, 260);

      /* Площадь разлёта дроби — полупрозральная заливка */
      ctx.fillStyle = 'rgba(255,165,80,' + (0.10 * fade).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();

      /* Круг поражения — обводка */
      ctx.strokeStyle = 'rgba(255,165,80,' + (0.9 * fade).toFixed(3) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();

      /* Центр пятна */
      ctx.fillStyle = 'rgba(255,205,150,' + (0.9 * fade).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();

      /* Точки упреждения — крестики: окружность здесь вводит в заблуждение,
         будто совпадение с кругом поражения гарантирует попадание */
      var aims = im.aims || [];
      for (var k = 0; k < aims.length; k++) {
        var tcp = camPoint(aims[k].p, cam);
        if (tcp.z < NEAR) continue;
        var tp = projCp(tcp, focal, W / 2, H / 2);
        /* Размер крестика ~ радиус цели на экране, 6…24 px */
        var arm = clamp((focal / tcp.z) * aims[k].radius, 6, 24);
        ctx.strokeStyle = 'rgba(255,235,120,' + (0.9 * fade).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tp.x - arm, tp.y);
        ctx.lineTo(tp.x + arm, tp.y);
        ctx.moveTo(tp.x, tp.y - arm);
        ctx.lineTo(tp.x, tp.y + arm);
        ctx.stroke();
      }
    }
  }

  /* ---------------- Оружие ---------------- */

  /* Индикатор патронов слева внизу: нижний квадрат — первый выстрел (получок) */
  function drawAmmo(ctx, H, g) {
    var size = 16, x = 26, baseY = H - 58;
    for (var i = 0; i < 2; i++) {
      var loaded = g.ammo >= (2 - i);
      var y = baseY - i * (size + 6);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y - size, size, size, 3);
      else ctx.rect(x, y - size, size, size);
      if (loaded) { ctx.fillStyle = '#e8edf3'; ctx.fill(); }
      else { ctx.strokeStyle = 'rgba(232,237,243,0.35)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    }
  }

  function drawGun(ctx, W, H, g) {
    /* Ружьё видно только при удержании прицеливания */
    if (g.aimProgress <= 0.02) return;

    /* Полукруг диаметром 20% высоты экрана; точка прицеливания (верхушка) — на 20% высоты ниже центра */
    var s = (H * 0.20 / 2) / 64;
    var aimY = H * 1.02 + (H * 0.7 - H * 1.02) * g.aimProgress;
    var swayAmp = 2.0 * (1 - g.aimProgress);
    var ax = W / 2 + Math.sin(g.time * 1.3) * swayAmp + g.swayX;
    var ay = aimY + Math.sin(g.time * 0.9 + 1.7) * swayAmp * 0.7;

    ctx.save();
    ctx.globalAlpha = clamp((g.aimProgress - 0.02) / 0.2, 0, 1);
    ctx.translate(ax, ay);
    ctx.scale(s, s);

    /* Прямоугольное цевьё от нижней части полукруга до нижней границы экрана */
    var yBot = (H * 0.3) / s; /* при полном прицеливании низ цевья — нижняя граница экрана */
    var bodyGrad = ctx.createLinearGradient(0, 64, 0, yBot);
    bodyGrad.addColorStop(0, '#2b3038');
    bodyGrad.addColorStop(1, '#12151a');
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(-64, 64, 128, yBot - 64);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-64, 64, 128, yBot - 64);

    /* Полукруг сверху; при перезарядке ствол «размыкается» — купол опускается */
    var open = g.reloadProgress > 0 ? Math.sin(g.reloadProgress * Math.PI) : 0;
    ctx.save();
    ctx.translate(0, 64);
    ctx.scale(1, 1 - 0.35 * open);
    ctx.translate(0, -64);
    var domeGrad = ctx.createLinearGradient(0, 0, 0, 64);
    domeGrad.addColorStop(0, '#3c434d');
    domeGrad.addColorStop(1, '#22262d');
    ctx.fillStyle = domeGrad;
    ctx.beginPath();
    ctx.arc(0, 64, 64, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    /* Мушка — маленький квадрат (1,5% высоты экрана) на верхней части */
    var side = (H * 0.015) / s;
    ctx.fillStyle = '#15181d';
    ctx.fillRect(-side / 2, -side, side, side);
    ctx.restore();

    ctx.restore();

    /* Сообщение о перезарядке справа от оружия */
    if (g.reloading) {
      ctx.fillStyle = 'rgba(255,178,125,0.9)';
      ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('ПЕРЕЗАРЯДКА…', ax + W * 0.17, Math.min(ay + 40 * s, H - 120));
    }
  }

  /* ---------------- HUD ---------------- */

  function drawHUD(ctx, W, H, g) {
    drawAmmo(ctx, H, g);

    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 22px "Segoe UI", system-ui, sans-serif';

    var y = H - 24;

    /* Выстрелы — слева снизу */
    ctx.textAlign = 'left';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(10,14,10,0.7)';
    ctx.fillStyle = '#f2f6f0';
    var leftText = 'ВЫСТРЕЛЫ: ' + g.shots;
    ctx.strokeText(leftText, 26, y);
    ctx.fillText(leftText, 26, y);

    /* Попадания — справа снизу */
    ctx.textAlign = 'right';
    var hitText = 'ПОПАДАНИЯ: ' + g.hits;
    var pulse = g.hitsPulse > 0 ? Math.sin(Math.min(1, g.hitsPulse / 0.25) * Math.PI) : 0;
    ctx.font = '700 ' + (22 + 8 * pulse) + 'px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = pulse > 0.02 ? '#ffd34d' : '#f2f6f0';
    ctx.strokeText(hitText, W - 26, y);
    ctx.fillText(hitText, W - 26, y);

    /* Подсказки сверху */
    var msg = g.toastTimer > 0 ? g.toast : (g.hintTimer > 0 ? g.hint : null);
    if (msg) {
      var alpha = g.toastTimer > 0 ? clamp(g.toastTimer / 0.4, 0, 1)
        : clamp(Math.min(g.hintTimer, 1), 0, 1);
      ctx.textAlign = 'center';
      ctx.font = '600 16px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,' + (0.92 * alpha).toFixed(3) + ')';
      ctx.strokeStyle = 'rgba(10,14,10,' + (0.7 * alpha).toFixed(3) + ')';
      ctx.lineWidth = 4;
      ctx.strokeText(msg, W / 2, 42);
      ctx.fillText(msg, W / 2, 42);
    }
  }

  /* ---------------- Главная функция ---------------- */

  DH.Render = {
    draw: function (ctx, W, H, g) {
      var cam = g.cam;
      var focal = (H / 2) / Math.tan(g.fov / 2);
      var cx = W / 2, cy = H / 2;

      ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      drawBackground(ctx, W, H, cam, focal, cx, cy);

      /* Цели: дальние первыми */
      var list = DH.Targets.list.slice().sort(function (a, b) {
        return V3.dist(b.p, cam.pos) - V3.dist(a.p, cam.pos);
      });
      for (var i = 0; i < list.length; i++) drawTarget(ctx, list[i], cam, focal, cx, cy);

      drawParticles(ctx, cam, focal, cx, cy);

      drawAimHint(ctx, W, H, g);
      drawImpacts(ctx, W, H, g);
      drawGun(ctx, W, H, g);
      drawHUD(ctx, W, H, g);
    }
  };
})();
