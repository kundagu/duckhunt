/* Баллистика: радиусы дробового пятна, расчёт попаданий. */
(function () {
  'use strict';

  var DH = (window.DH = window.DH || {});
  var G = 9.81;

  /* Диаметр дробового пятна, см, в зависимости от дистанции, м.
     Разброс увеличен вдвое относительно табличных значений. */
  var PATTERNS = {
    /* нижний ствол — получок */
    cylinder: [[10, 50], [15, 70], [20, 100], [25, 120], [35, 155]],
    /* верхний ствол — чок */
    choke: [[10, 30], [15, 40], [20, 70], [25, 90], [35, 125]]
  };

  function interpolate(pts, d) {
    if (d <= pts[0][0]) {
      var k0 = (pts[1][1] - pts[0][1]) / (pts[1][0] - pts[0][0]);
      return pts[0][1] + (d - pts[0][0]) * k0;
    }
    var last = pts.length - 1;
    if (d >= pts[last][0]) {
      var k1 = (pts[last][1] - pts[last - 1][1]) / (pts[last][0] - pts[last - 1][0]);
      return pts[last][1] + (d - pts[last][0]) * k1;
    }
    for (var i = 0; i < last; i++) {
      if (d <= pts[i + 1][0]) {
        var k = (pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]);
        return pts[i][1] + (d - pts[i][0]) * k;
      }
    }
    return pts[last][1];
  }

  DH.Ballistics = {
    MUZZLE_SPEED: 175, /* м/с — вдвое медленнее прежних 350, чтобы упреждение было больше */

    /* barrel: 'cylinder' (получок) | 'choke' (чок); dist — метры; возвращает диаметр в метрах */
    patternRadius: function (barrel, dist) {
      return interpolate(PATTERNS[barrel], Math.max(0, dist)) / 200;
    },

    /*
     * Выстрел из ствола barrel из точки origin по направлению dir (единичный).
     * Учитывает гравитацию и упреждение по времени полёта (175 м/с).
     * Возвращает массив поражённых целей.
     */
    resolveShot: function (origin, dir, barrel, targets) {
      var V3 = DH.V3;
      var speed = this.MUZZLE_SPEED;
      var hits = [];

      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (t.dead) continue;

        var rel = V3.sub(t.p, origin);
        var along = V3.dot(rel, dir);
        if (along < 0.3) continue;

        var tof = along / speed;                       /* время полёта до плоскости цели */
        var targetPos = V3.add(t.p, V3.scale(t.v, tof)); /* положение цели к моменту прихода дроби */
        var proj = V3.add(
          V3.add(origin, V3.scale(dir, along)),
          { x: 0, y: -0.5 * G * tof * tof, z: 0 }
        );

        var miss = V3.dist(targetPos, proj);
        var radius = this.patternRadius(barrel, along) + t.radius;
        if (miss <= radius) hits.push(t);
      }
      return hits;
    }
  };
})();
