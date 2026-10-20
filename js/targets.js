/* Векторная математика, генерация траекторий тарелочек, частицы разрушения. */
(function () {
  'use strict';

  var DH = (window.DH = window.DH || {});
  var DEG = Math.PI / 180;

  /* ---------------- Векторы ---------------- */
  var V3 = {
    add: function (a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; },
    sub: function (a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; },
    scale: function (a, k) { return { x: a.x * k, y: a.y * k, z: a.z * k }; },
    dot: function (a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; },
    len: function (a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); },
    dist: function (a, b) { return V3.len(V3.sub(a, b)); },
    norm: function (a) {
      var l = V3.len(a);
      return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 1 };
    }
  };
  DH.V3 = V3;

  function rand(a, b) { return a + Math.random() * (b - a); }

  /* ---------------- Тарелочки ---------------- */
  var TARGET_RADIUS = 0.11;       /* цель увеличена вдвое: 22 см в диаметре */
  var TARGET_THICKNESS = 0.05;    /* 5 см */

  var MODE_WEIGHTS = [
    { mode: 'to', w: 18 },        /* на стрелка, через голову */
    { mode: 'from', w: 14 },      /* от стрелка */
    { mode: 'tan90', w: 12 },     /* касательная 90°, 30 м */
    { mode: 'tan60', w: 10 },
    { mode: 'tan30', w: 10 },
    { mode: 'parallel', w: 16 },  /* параллельно земле */
    { mode: 'climb10', w: 10 },   /* взлёт под 10° */
    { mode: 'climb30', w: 10 }    /* взлёт под 30° */
  ];

  function pickMode() {
    var total = 0, i;
    for (i = 0; i < MODE_WEIGHTS.length; i++) total += MODE_WEIGHTS[i].w;
    var r = Math.random() * total;
    for (i = 0; i < MODE_WEIGHTS.length; i++) {
      r -= MODE_WEIGHTS[i].w;
      if (r <= 0) return MODE_WEIGHTS[i].mode;
    }
    return 'parallel';
  }

  function makeTarget(p, v, life, mode) {
    return {
      p: p, v: v, mode: mode,
      age: 0, life: life,
      radius: TARGET_RADIUS,
      thickness: TARGET_THICKNESS,
      bank: rand(-0.45, 0.45),        /* наклон диска для отрисовки */
      spin: rand(-1.2, 1.2),
      px: [],                          /* история позиций для шлейфа */
      dead: false
    };
  }

  /* Сектор видимости стрелка: ±45° от направления взгляда */
  function azimuthOk(p, yaw) {
    var d = Math.atan2(p.x, p.z) - yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d) <= 45 * DEG;
  }

  function spawn(cam) {
    var mode = pickMode();
    /* Скорость из настроек (км/ч) с разбросом ±2,5 км/ч (в пределах диапазона 10–80) */
    var baseSpeed = (DH.settings && typeof DH.settings.speed === 'number') ? DH.settings.speed : 72;
    /* Визуально вдвое медленнее: фактическая скорость тарелочки = половина настройки */
    var speed = Math.min(80, Math.max(10, baseSpeed + rand(-2.5, 2.5))) * 0.5 / 3.6;
    var dist = rand(10, 28);                 /* дистанция в зоне до 30 м */
    var sgn = Math.random() < 0.5 ? -1 : 1;

    var p, v, life = 9, attempt, off, wy, r, t;
    var ca, sa, d, L, c, y, b, elev, hd, mix, D, phi;

    /* Все налёты начинаются строго в секторе ±45° от направления взгляда */
    for (attempt = 0; attempt < 30; attempt++) {
      off = rand(-45, 45) * DEG;
      wy = cam.yaw + off;
      r = { x: Math.sin(wy), y: 0, z: Math.cos(wy) };   /* радиальное */
      t = { x: r.z * sgn, y: 0, z: -r.x * sgn };        /* касательное */

      switch (mode) {
        case 'to': /* на стрелка — пролёт через голову */
          p = { x: r.x * dist, y: rand(1, 5), z: r.z * dist };
          var over = rand(0.5, 2.7); /* насколько выше головы пройдёт */
          var aim = { x: cam.pos.x, y: cam.pos.y + over, z: cam.pos.z };
          v = V3.scale(V3.norm(V3.sub(aim, p)), speed);
          life = 7;
          break;

        case 'from': /* от стрелка — старт ближе, чтобы пролёт поместился в зоне 30 м */
          var d2 = rand(10, 22);
          p = { x: r.x * d2, y: rand(1, 4), z: r.z * d2 };
          v = { x: r.x * speed, y: 0, z: r.z * speed };
          life = 8;
          break;

        case 'tan90': case 'tan60': case 'tan30': /* касательная */
          var angDeg = mode === 'tan90' ? 90 : mode === 'tan60' ? 60 : 30;
          y = rand(1.5, 4.5);
          var R = rand(16, 26);                /* ближайшая точка пути — в зоне 30 м */
          c = { x: r.x * R, y: y, z: r.z * R };
          ca = Math.cos(angDeg * DEG) * (Math.random() < 0.5 ? 1 : -1);
          sa = Math.sin(angDeg * DEG);
          d = V3.norm({ x: r.x * ca + t.x * sa, y: 0, z: r.z * ca + t.z * sa });
          L = rand(14, 26);
          p = { x: c.x - d.x * L, y: y, z: c.z - d.z * L };
          /* Старт не дальше 30 м от стрелка */
          while (V3.len(p) > 30 && L > 8) {
            L -= 1;
            p = { x: c.x - d.x * L, y: y, z: c.z - d.z * L };
          }
          v = V3.scale(d, speed);
          life = 8;
          break;

        case 'parallel': /* параллельно земле */
          if (Math.random() < 0.35) {
            /* Близкий пролёт почти над головой: цель летит «насквозь» мимо стрелка */
            D = rand(16, 30);           /* дальность старта в зоне 30 м */
            b = rand(1, 4.5);           /* боковое расстояние до стрелка */
            y = rand(2.5, 5.5);
            phi = Math.asin(Math.min(0.95, b / D));
            d = V3.norm({
              x: -r.x * Math.cos(phi) + t.x * Math.sin(phi),
              y: 0,
              z: -r.z * Math.cos(phi) + t.z * Math.sin(phi)
            });
            p = { x: r.x * D, y: y, z: r.z * D };
            v = V3.scale(d, speed);
          } else {
            b = rand(5, 22);
            y = rand(1.5, 5);
            c = { x: r.x * b, y: y, z: r.z * b };
            L = rand(10, Math.max(12, Math.sqrt(Math.max(100, 900 - b * b))));
            p = { x: c.x - t.x * L, y: y, z: c.z - t.z * L };
            v = { x: t.x * speed, y: 0, z: t.z * speed };
          }
          life = 9;
          break;

        case 'climb10': case 'climb30': /* взлёт под углом */
          elev = (mode === 'climb10' ? 10 : 30) * DEG;
          p = { x: r.x * dist, y: rand(0.8, 2.4), z: r.z * dist };
          mix = rand(0.45, 0.95);
          hd = V3.norm({ x: r.x * mix + t.x * (1 - mix), y: 0, z: r.z * mix + t.z * (1 - mix) });
          v = {
            x: hd.x * Math.cos(elev) * speed,
            y: Math.sin(elev) * speed,
            z: hd.z * Math.cos(elev) * speed
          };
          life = mode === 'climb30' ? 6 : 8;
          break;
      }
      if (azimuthOk(p, cam.yaw)) break;
    }
    return makeTarget(p, v, life, mode);
  }

  /* ---------------- Разрушение ---------------- */
  function breakTarget(particles, target) {
    var n = 16;
    for (var i = 0; i < n; i++) {
      var dir = V3.norm({ x: rand(-1, 1), y: rand(-0.3, 1.2), z: rand(-1, 1) });
      var sp = rand(1.5, 7);
      particles.push({
        p: { x: target.p.x, y: target.p.y, z: target.p.z },
        v: {
          x: target.v.x * 0.5 + dir.x * sp,
          y: target.v.y * 0.5 + dir.y * sp,
          z: target.v.z * 0.5 + dir.z * sp
        },
        size: rand(0.012, 0.035),
        rot: rand(0, Math.PI * 2),
        rv: rand(-8, 8),
        age: 0,
        life: rand(0.9, 1.6),
        dark: Math.random() < 0.3
      });
    }
  }

  /* ---------------- Модуль ---------------- */
  DH.Targets = {
    radius: TARGET_RADIUS,

    list: [],
    particles: [],
    spawnTimer: 0.5,

    reset: function () {
      this.list.length = 0;
      this.particles.length = 0;
      this.spawnTimer = 0.5;
    },

    /* Удаляет сбитую цель, порождая обломки. Возвращает число сбитых. */
    destroy: function (target) {
      target.dead = true;
      breakTarget(this.particles, target);
    },

    update: function (dt, cam) {
      var i, t;
      var list = this.list;

      /* Спавн */
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && list.length < 3) {
        list.push(spawn(cam));
        this.spawnTimer = rand(1.0, 2.6);
      }

      /* Движение и отсев */
      for (i = list.length - 1; i >= 0; i--) {
        t = list[i];
        if (t.dead) { list.splice(i, 1); continue; }
        t.age += dt;
        t.p.x += t.v.x * dt;
        t.p.y += t.v.y * dt;
        t.p.z += t.v.z * dt;
        t.bank += t.spin * dt * 0.15;

        var rel = V3.sub(t.p, cam.pos);
        /* Цель не исчезает, пока не вылетит из 30-метровой зоны */
        var flat = Math.sqrt(rel.x * rel.x + rel.z * rel.z);
        if (flat > 30.5) {
          list.splice(i, 1);
          continue;
        }
        /* Шлейф */
        if (t.age % 0.05 < dt) {
          t.px.push({ x: t.p.x, y: t.p.y, z: t.p.z });
          if (t.px.length > 6) t.px.shift();
        }
      }

      /* Обломки */
      var ps = this.particles;
      for (i = ps.length - 1; i >= 0; i--) {
        var q = ps[i];
        q.age += dt;
        if (q.age > q.life) { ps.splice(i, 1); continue; }
        q.v.y -= 9.81 * dt;
        q.p.x += q.v.x * dt;
        q.p.y += q.v.y * dt;
        q.p.z += q.v.z * dt;
        if (q.p.y < 0.02) { q.p.y = 0.02; q.v.y *= -0.3; q.v.x *= 0.7; q.v.z *= 0.7; }
        q.rot += q.rv * dt;
      }
    }
  };
})();
