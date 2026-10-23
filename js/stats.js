/* Статистика серий: хранение в localStorage и отображение в меню. */
(function () {
  'use strict';

  var DH = (window.DH = window.DH || {});

  var STORAGE_KEY = 'dh.stats.v1';
  var MAX_SERIES = 8; /* сколько лучших серий хранить/показывать */
  /* Серии короче этого числа выстрелов не претендуют на «лучший результат»:
     единичные выстрелы (например, выйти в меню после одного выстрела)
     давали бессмысленный «лучший результат 0 из 1 (0%)». */
  var MIN_BEST_SHOTS = 5;

  function emptyStats() { return { series: [], best: null }; }

  /* Нормализует запись серии; null — если запись некорректна. */
  function validRec(r) {
    if (!r || typeof r !== 'object') return null;
    if (typeof r.shots !== 'number' || !isFinite(r.shots)) return null;
    if (typeof r.hits !== 'number' || !isFinite(r.hits)) return null;
    var shots = Math.round(r.shots);
    var hits = Math.round(r.hits);
    if (shots <= 0 || hits < 0) return null;
    if (hits > shots) hits = shots;
    return { shots: shots, hits: hits, acc: hits / shots * 100, t: typeof r.t === 'number' ? r.t : 0 };
  }

  /* «a» лучше «b»: больше точность, при равенстве — больше попаданий,
     затем больше выстрелов. */
  function isBetter(a, b) {
    if (!a) return false;
    if (!b) return true;
    if (a.acc !== b.acc) return a.acc > b.acc;
    if (a.hits !== b.hits) return a.hits > b.hits;
    return a.shots > b.shots;
  }

  /* Сравнение для сортировки списка: от лучшей серии к худшей. */
  function compareSeries(a, b) {
    if (a.acc !== b.acc) return b.acc - a.acc;
    if (a.hits !== b.hits) return b.hits - a.hits;
    return b.shots - a.shots;
  }

  /* Оставляет в списке только MAX_SERIES лучших серий. */
  function trimSeries(series) {
    series.sort(compareSeries);
    if (series.length > MAX_SERIES) series.length = MAX_SERIES;
    return series;
  }

  /* Кандидат в лучшие: только серии от MIN_BEST_SHOTS выстрелов */
  function betterCandidate(rec, best) {
    if (!rec || rec.shots < MIN_BEST_SHOTS) return best;
    return isBetter(rec, best) ? rec : best;
  }

  DH.loadStats = function () {
    var raw = null;
    try { raw = window.localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) return emptyStats();

    var s;
    try { s = JSON.parse(raw); } catch (e) { return emptyStats(); }
    if (!s || typeof s !== 'object') return emptyStats();

    var out = emptyStats();
    if (Array.isArray(s.series)) {
      for (var i = 0; i < s.series.length; i++) {
        var rec = validRec(s.series[i]);
        if (rec) out.series.push(rec);
      }
      trimSeries(out.series);
    }

    /* Лучший: сохранённый (если валиден и достаточно длинный — защита от
       старых данных) и пересчёт по имеющимся сериям */
    var best = validRec(s.best);
    if (best && best.shots < MIN_BEST_SHOTS) best = null;
    for (var j = 0; j < out.series.length; j++) {
      best = betterCandidate(out.series[j], best);
    }
    out.best = best;
    return out;
  };

  DH.saveStats = function (s) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* нет доступа */ }
  };

  DH.resetStats = function () {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* нет доступа */ }
    DH.updateStats();
  };

  /* Фиксирует серию. Возвращает запись или null, если записывать нечего. */
  DH.recordSeries = function (shots, hits) {
    var rec = validRec({ shots: shots, hits: hits, t: Date.now() });
    if (!rec) return null;

    var s = DH.loadStats();
    s.series.push(rec);
    s.best = betterCandidate(rec, s.best);
    trimSeries(s.series);
    DH.saveStats(s);
    DH.updateStats();
    return rec;
  };

  /* Отрисовка блока статистики в меню: лучший результат сверху, ниже — список. */
  DH.updateStats = function () {
    var bestLine = document.getElementById('best-line');
    var list = document.getElementById('stats-list');
    if (!bestLine || !list) return;

    var s = DH.loadStats();

    if (s.best) {
      bestLine.textContent = 'Лучший результат: ' + Math.round(s.best.acc) + '% (' +
        s.best.hits + ' из ' + s.best.shots + ')';
      bestLine.classList.remove('hidden');
    } else {
      bestLine.textContent = 'Лучший результат: —';
      bestLine.classList.add('hidden');
    }

    if (!s.series.length) {
      list.innerHTML = '<p class="hint">Серий пока нет — сыграйте, результаты появятся здесь.</p>';
      return;
    }

    /* loadStats уже оставил MAX_SERIES лучших серий и отсортировал их. */
    var sorted = s.series;

    var html = '';
    for (var i = 0; i < sorted.length; i++) {
      var r = sorted[i];
      html += '<div class="stats-row">' +
        '<span class="muted">' + r.hits + ' из ' + r.shots + '</span>' +
        '<span class="acc">' + Math.round(r.acc) + '%</span>' +
        '</div>';
    }
    list.innerHTML = html;
  };
})();
