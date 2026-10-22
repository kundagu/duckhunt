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

  function wrapAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  /* Попадает ли цель в круг радиусом 30% высоты экрана вокруг мушки
     (точка прицеливания — центр экрана, на 20% высоты ниже центра).
     view = { W, H, focal }. Без view считаем, что цель в зоне. */
  function nearAim(t, cam, view) {
    if (!view || !view.focal) return true;
    var dx = t.p.x - cam.pos.x, dy = t.p.y - cam.pos.y, dz = t.p.z - cam.pos.z;
    var zc = dx * cam.fwd.x + dy * cam.fwd.y + dz * cam.fwd.z;
    if (zc < 0.08) return false; /* цель за камерой или у ближней плоскости */
    var xc = dx * cam.right.x + dy * cam.right.y + dz * cam.right.z;
    var yc = dx * cam.up.x + dy * cam.up.y + dz * cam.up.z;
    var aimSX = view.W / 2, aimSY = view.H * 0.7;
    var sdx = view.W / 2 + xc / zc * view.focal - aimSX;
    var sdy = view.H / 2 - yc / zc * view.focal - aimSY;
    var r = view.H * EVADE_AIM_RADIUS;
    return sdx * sdx + sdy * sdy <= r * r;
  }

  /* Есть ли в зоне мушки хотя бы одна живая цель группы gid. */
  function groupInAim(list, gid, cam, view) {
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t.dead || t.groupId !== gid) continue;
      if (nearAim(t, cam, view)) return true;
    }
    return false;
  }

  /* ---------------- Тарелочки ---------------- */
  var TARGET_RADIUS = 0.11;       /* цель увеличена вдвое: 22 см в диаметре */
  var TARGET_THICKNESS = 0.05;    /* 5 см */

  /* Уклонение при поднятом оружии: поворот от стрелка + набор высоты */
  var EVADE_TURN_RATE = 1.54;     /* рад/с — 1.4 + 10% интенсивности поворота */
  var EVADE_CLIMB_ACCEL = 4.5;    /* м/с² */
  var EVADE_MAX_CLIMB = 5.5;      /* м/с (до снижения) */
  var EVADE_HORIZONTAL_FACTOR = 0.47; /* 47% исходной горизонтальной скорости */
  var EVADE_VERTICAL_FACTOR = 0.6;    /* 60% исходной вертикальной скорости */
  var EVADE_HORIZONTAL_LIMIT = 60 * DEG; /* макс. отклонение по горизонтали */
  var EVADE_VERTICAL_LIMIT = 20 * DEG;   /* макс. отклонение по вертикали */
  var EVADE_UP_CHANCE = 0.4;      /* доля уклоняющихся, которые набирают высоту */
  var EVADE_AIM_RADIUS = 0.30;    /* радиус зоны у мушки: 30% высоты экрана */

  var MAX_ALTITUDE = 30;          /* м — выше цель исчезает */

  /* Групповые цели (опция `flock`): клин из 1–10 тарелочек */
  var FLOCK_MIN = 1;              /* минимальный размер группы */
  var FLOCK_MAX = 10;             /* максимальный размер группы */
  var FLOCK_SMALL_MAX = 5;        /* «малая» группа — до 5 целей */
  var FLOCK_SMALL_CHANCE = 0.7;   /* доля малых групп (1–5); остальные 6–10 */
  var FLOCK_SPACING = 2.145;      /* м — шаг в клине (1.43 × 1.5) */
  var FLOCK_ANGLE = 32 * DEG;     /* полуугол раствора клина (V) */
  var FLOCK_SKEW = 0.45;          /* макс. случайный перекос клина (доля) */
  var FLOCK_MIN_ALTITUDE = 10;    /* м — группа всегда появляется выше */

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
      evadeApplied: false,             /* скоростное снижение уже применено */
      evadeUp: false,                  /* уклоняется вверх (иначе только по горизонтали) */
      evadeH: 0,                       /* горизонтальная скорость при уклонении */
      evadeBaseYaw: 0,                 /* исходный курс до уклонения */
      evadeBasePitch: 0,               /* исходный угол набора высоты */
      groupId: 0,                      /* номер группы (0 — вне группы) */
      evadeTurnSign: 1,                /* сторона доворота (единая в группе) */
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

  /* Групповые цели: клин (V) из 1–10 тарелочек в направлении движения.
     Ведущая цель впереди, ведомые — позади и в стороны под полууглом
     FLOCK_ANGLE. Клин не всегда симметричен: общий перекос группы
     (skew) и небольшой независимый сдвиг каждой ведомой цели. */
  function spawnGroup(cam) {
    /* Размер группы: 70% — малые (1–5), 30% — большие (6–10);
       внутри диапазона равновероятно. */
    var lo, hi;
    if (Math.random() < FLOCK_SMALL_CHANCE) {
      lo = FLOCK_MIN; hi = FLOCK_SMALL_MAX;
    } else {
      lo = FLOCK_SMALL_MAX + 1; hi = FLOCK_MAX;
    }
    var n = lo + Math.floor(Math.random() * (hi - lo + 1));
    var lead = spawn(cam);
    var group = [lead];

    var hs = Math.sqrt(lead.v.x * lead.v.x + lead.v.z * lead.v.z);
    /* Направление движения в горизонтальной плоскости */
    var fwd = hs > 1e-6
      ? { x: lead.v.x / hs, y: 0, z: lead.v.z / hs }
      : { x: 0, y: 0, z: 1 };
    /* Боковая ось (перпендикуляр в плоскости XZ) */
    var side = { x: fwd.z, y: 0, z: -fwd.x };

    /* Общий перекос группы: смещает клин влево/вправо — асимметрия */
    var skewX = rand(-FLOCK_SKEW, FLOCK_SKEW);
    var skewY = rand(-FLOCK_SKEW, FLOCK_SKEW);

    for (var i = 1; i < n; i++) {
      var row = Math.ceil(i / 2);                 /* номер «волны» позади лидера */
      var sideSign = i % 2 === 1 ? 1 : -1;        /* попеременно в стороны */

      /* Базовая позиция в клине: назад по курсу + вбок под углом */
      var back = row * FLOCK_SPACING * Math.cos(FLOCK_ANGLE);
      var lat = sideSign * row * FLOCK_SPACING * Math.sin(FLOCK_ANGLE);

      /* Перекос и лёгкий индивидуальный разброс — клин не идеальный */
      var jitter = FLOCK_SPACING * 0.25;
      var p = {
        x: lead.p.x - fwd.x * back + side.x * lat + rand(-jitter, jitter) + side.x * skewX * row,
        y: lead.p.y + rand(-jitter, jitter) + skewY * row,
        z: lead.p.z - fwd.z * back + side.z * lat + rand(-jitter, jitter) + side.z * skewX * row
      };
      var mate = makeTarget(p, { x: lead.v.x, y: lead.v.y, z: lead.v.z }, lead.life, lead.mode);
      group.push(mate);
    }

    /* Синхронизируем внешний вид: одинаковый наклон и вращение диска
       у всей группы (как у ведущей). */
    for (i = 1; i < group.length; i++) {
      group[i].bank = lead.bank;
      group[i].spin = lead.spin;
    }

    /* Вписываем всю группу в 30-метровую зону: если хвост клина вышел
       за 28 м, подтягиваем каждую цель к стрелку по её направлению. */
    var maxR = 0;
    for (i = 0; i < group.length; i++) {
      var rr = Math.sqrt(group[i].p.x * group[i].p.x + group[i].p.z * group[i].p.z);
      if (rr > maxR) maxR = rr;
    }
    if (maxR > 28) {
      var k = 28 / maxR;
      for (i = 0; i < group.length; i++) {
        group[i].p.x *= k;
        group[i].p.z *= k;
      }
    }

    /* Группа всегда появляется выше 10 м над землёй: поднимаем весь клин
       так, чтобы самая низкая цель была не ниже FLOCK_MIN_ALTITUDE. */
    var minY = Infinity;
    for (i = 0; i < group.length; i++) {
      if (group[i].p.y < minY) minY = group[i].p.y;
    }
    var rise = (FLOCK_MIN_ALTITUDE + 0.5) - minY;
    if (rise > 0) {
      for (i = 0; i < group.length; i++) group[i].p.y += rise;
    }

    return group;
  }

  var nextGroupId = 1;

  /* ---------------- Уклонение ---------------- */

  /* Плавно уводит цель по горизонтали от стрелка; часть целей
     дополнительно набирает высоту (доля — EVADE_UP_CHANCE).
     shared — общие параметры группы (или null): для групповых целей
     решение «вверх», базовый курс и предел подъёма одинаковы у всех. */
  function evade(target, cam, dt, shared) {
    /* При переходе к уклонению один раз снижаем скорость и запоминаем
       исходное направление: горизонталь — до 47%, вертикаль — до 60%
       (вертикаль — только для уклоняющихся вверх) */
    if (!target.evadeApplied) {
      target.evadeApplied = true;

      var baseHs = Math.sqrt(target.v.x * target.v.x + target.v.z * target.v.z);
      target.evadeBaseYaw = Math.atan2(target.v.x, target.v.z);
      target.evadeBasePitch = baseHs > 1e-6 ? Math.atan2(target.v.y, baseHs) : 0;
      target.evadeH = baseHs * EVADE_HORIZONTAL_FACTOR;

      if (shared) {
        /* Первое срабатывание группы: фиксируем общие параметры по якорю */
        if (!shared.done) {
          shared.done = true;
          shared.up = Math.random() < EVADE_UP_CHANCE;
          shared.basePitch = target.evadeBasePitch;
          shared.baseYaw = target.evadeBaseYaw;
          /* Сторона доворота: в сторону «от стрелка», общая для группы */
          var awayA = Math.atan2(target.p.x - cam.pos.x, target.p.z - cam.pos.z);
          shared.turnSign = wrapAngle(awayA - target.evadeBaseYaw) >= 0 ? 1 : -1;
        }
        target.evadeUp = shared.up;
        target.evadeBasePitch = shared.basePitch;
        target.evadeBaseYaw = shared.baseYaw;
        target.evadeTurnSign = shared.turnSign;
      } else {
        target.evadeUp = Math.random() < EVADE_UP_CHANCE;
        target.evadeTurnSign = Math.random() < 0.5 ? -1 : 1;
      }

      if (target.evadeUp) target.v.y *= EVADE_VERTICAL_FACTOR;
    }

    var dx = target.p.x - cam.pos.x;
    var dz = target.p.z - cam.pos.z;
    var flat = Math.sqrt(dx * dx + dz * dz);

    /* Горизонтальный поворот — не более 60° от исходного курса.
       Вблизи вертикали над стрелком азимут «от стрелка» неустойчив —
       направление не меняем. Члены группы поворачивают в одну сторону. */
    var hs = target.evadeH;
    if (hs > 1e-3) {
      var cur = Math.atan2(target.v.x, target.v.z);
      if (flat > 0.5) {
        var diff = wrapAngle(Math.atan2(dx, dz) - cur);
        if (target.groupId > 0) diff = target.evadeTurnSign * Math.abs(diff);
        var maxTurn = EVADE_TURN_RATE * dt;
        cur += diff > maxTurn ? maxTurn : diff < -maxTurn ? -maxTurn : diff;
      }
      var rel = wrapAngle(cur - target.evadeBaseYaw);
      if (rel > EVADE_HORIZONTAL_LIMIT) rel = EVADE_HORIZONTAL_LIMIT;
      else if (rel < -EVADE_HORIZONTAL_LIMIT) rel = -EVADE_HORIZONTAL_LIMIT;
      cur = target.evadeBaseYaw + rel;
      target.v.x = Math.sin(cur) * hs;
      target.v.z = Math.cos(cur) * hs;
    }

    /* Вертикальный угол — не более 20° от исходного. Предел подъёма
       зависит от горизонтальной скорости и исходного угла траектории.
       Только для целей, уклоняющихся вверх; остальные сохраняют
       вертикальную скорость без изменений. */
    if (target.evadeUp) {
      var maxPitch = target.evadeBasePitch + EVADE_VERTICAL_LIMIT;
      var maxClimb = Math.min(
        EVADE_MAX_CLIMB * EVADE_VERTICAL_FACTOR,
        hs * Math.tan(maxPitch)
      );
      if (maxClimb < 0) maxClimb = 0;
      if (target.v.y > maxClimb) target.v.y = maxClimb;
      if (target.v.y < maxClimb) {
        target.v.y = Math.min(maxClimb, target.v.y + EVADE_CLIMB_ACCEL * dt);
      }
    }
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

    update: function (dt, cam, evadeTargets, view) {
      var i, t;
      var list = this.list;

      /* Спавн: групповая — только когда небо пустое; одиночные — как раньше */
      this.spawnTimer -= dt;
      var useFlock = !!(DH.settings && DH.settings.flock);
      var canSpawn = useFlock ? list.length === 0 : list.length < 3;
      if (this.spawnTimer <= 0 && canSpawn) {
        if (useFlock) {
          var gid = nextGroupId++;
          var group = spawnGroup(cam);
          for (i = 0; i < group.length; i++) {
            group[i].groupId = gid;
            list.push(group[i]);
          }
        } else {
          list.push(spawn(cam));
        }
        this.spawnTimer = rand(1.0, 2.6);
      }

      /* Синхронное уклонение групп: если хоть одна цель группы в зоне
         мушки — уклоняется вся группа. Общие параметры фиксируются
         один раз в кадре первого срабатывания. */
      var flockShared = {};
      if (evadeTargets) {
        for (i = 0; i < list.length; i++) {
          t = list[i];
          if (t.groupId > 0 && !flockShared[t.groupId] && groupInAim(list, t.groupId, cam, view)) {
            flockShared[t.groupId] = { done: false };
          }
        }
      }
      /* Движение и отсев */
      for (i = list.length - 1; i >= 0; i--) {
        t = list[i];
        if (t.dead) { list.splice(i, 1); continue; }
        t.age += dt;
        /* Уклоняются только цели в зоне у мушки (30% высоты экрана).
           Групповые — целиком, если хотя бы одна из них в зоне. */
        if (evadeTargets) {
          if (t.groupId > 0) {
            if (flockShared[t.groupId]) evade(t, cam, dt, flockShared[t.groupId]);
          } else if (nearAim(t, cam, view)) {
            evade(t, cam, dt, null);
          }
        }
        t.p.x += t.v.x * dt;
        t.p.y += t.v.y * dt;
        t.p.z += t.v.z * dt;
        t.bank += t.spin * dt * 0.15;

        var rel = V3.sub(t.p, cam.pos);
        /* Цель исчезает при вылете из 30-метровой зоны или подъёме выше 30 м */
        var flat = Math.sqrt(rel.x * rel.x + rel.z * rel.z);
        if (flat > 30.5 || t.p.y > MAX_ALTITUDE) {
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
