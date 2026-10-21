/* Настройки: загрузка/сохранение в localStorage, привязка клавиш, меню. */
(function () {
  'use strict';

  var DH = (window.DH = window.DH || {});

  var STORAGE_KEY = 'dh.settings.v1';

  DH.defaultSettings = function () {
    return {
      sensitivity: 1,
      speed: 72, /* км/ч, базовая скорость тарелочек */
      shotLimit: 0, /* лимит выстрелов в серии; 0 — безлимит */
      sound: true,
      hintAim: false,
      hintImpact: false,
      bindings: {
        aim: { type: 'key', code: 'Space' },
        fire: { type: 'mouse', button: 0 },
        reload: { type: 'mouse', button: 2 }
      }
    };
  };

  var KEY_NAMES = {
    Space: 'Пробел', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace',
    ShiftLeft: 'Левый Shift', ShiftRight: 'Правый Shift',
    ControlLeft: 'Левый Ctrl', ControlRight: 'Правый Ctrl',
    AltLeft: 'Левый Alt', AltRight: 'Правый Alt',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    CapsLock: 'Caps Lock', Backquote: '`', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
    Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End',
    PageUp: 'Page Up', PageDown: 'Page Down'
  };

  var MOUSE_NAMES = { 0: 'ЛКМ', 1: 'СКМ', 2: 'ПКМ', 3: 'Бок 1', 4: 'Бок 2' };

  function keyLabel(code) {
    if (KEY_NAMES[code]) return KEY_NAMES[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
    if (/^F[0-9]+$/.test(code)) return code;
    return code;
  }

  DH.bindingLabel = function (b) {
    if (!b) return '—';
    if (b.type === 'key') return keyLabel(b.code);
    if (b.type === 'mouse') return MOUSE_NAMES[b.button] || ('Кнопка ' + (b.button + 1));
    return '—';
  };

  DH.sameBinding = function (a, b) {
    if (!a || !b || a.type !== b.type) return false;
    return a.type === 'key' ? a.code === b.code : a.button === b.button;
  };

  function validBinding(b) {
    if (!b || typeof b !== 'object') return null;
    if (b.type === 'key' && typeof b.code === 'string') return { type: 'key', code: b.code };
    if (b.type === 'mouse' && typeof b.button === 'number') return { type: 'mouse', button: b.button | 0 };
    return null;
  }

  DH.loadSettings = function () {
    var def = DH.defaultSettings();
    var raw = null;
    try { raw = window.localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) return def;
    var s;
    try { s = JSON.parse(raw); } catch (e) { return def; }
    if (!s || typeof s !== 'object') return def;

    var out = def;
    if (typeof s.sensitivity === 'number' && isFinite(s.sensitivity)) {
      out.sensitivity = Math.min(4, Math.max(0.2, s.sensitivity));
    }
    if (typeof s.speed === 'number' && isFinite(s.speed)) {
      out.speed = Math.min(80, Math.max(10, s.speed));
    }
    if (typeof s.shotLimit === 'number' && isFinite(s.shotLimit)) {
      out.shotLimit = Math.min(50, Math.max(0, Math.round(s.shotLimit)));
    }
    if (typeof s.sound === 'boolean') out.sound = s.sound;
    if (typeof s.hintAim === 'boolean') out.hintAim = s.hintAim;
    if (typeof s.hintImpact === 'boolean') out.hintImpact = s.hintImpact;
    if (s.bindings && typeof s.bindings === 'object') {
      ['aim', 'fire', 'reload'].forEach(function (act) {
        var b = validBinding(s.bindings[act]);
        if (b) out.bindings[act] = b;
      });
    }
    return out;
  };

  DH.saveSettings = function (settings) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* нет доступа */ }
  };

  DH.resetSettings = function () {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* нет доступа */ }
  };

  /* ---------------- Меню настроек ---------------- */

  DH.initMenu = function (onStart) {
    var settings = (DH.settings = DH.loadSettings());

    var elStart = document.getElementById('btn-start');
    var elSens = document.getElementById('sens');
    var elSensVal = document.getElementById('sens-val');
    var elSpeed = document.getElementById('speed');
    var elSpeedVal = document.getElementById('speed-val');
    var elLimit = document.getElementById('limit');
    var elLimitVal = document.getElementById('limit-val');
    var elSound = document.getElementById('sound');
    var elHintAim = document.getElementById('hint-aim');
    var elHintImpact = document.getElementById('hint-impact');
    var elReset = document.getElementById('btn-reset');
    var elStatsReset = document.getElementById('btn-stats-reset');
    var bindButtons = Array.prototype.slice.call(document.querySelectorAll('.btn.bind'));

    function refresh() {
      elSens.value = String(settings.sensitivity);
      elSensVal.textContent = settings.sensitivity.toFixed(2);
      elSpeed.value = String(settings.speed);
      elSpeedVal.textContent = String(Math.round(settings.speed));
      elLimit.value = String(settings.shotLimit);
      elLimitVal.textContent = settings.shotLimit > 0 ? String(settings.shotLimit) : '∞';
      elSound.checked = settings.sound;
      elHintAim.checked = !!settings.hintAim;
      elHintImpact.checked = !!settings.hintImpact;
      bindButtons.forEach(function (btn) {
        btn.textContent = DH.bindingLabel(settings.bindings[btn.dataset.action]);
      });
    }

    elSens.addEventListener('input', function () {
      settings.sensitivity = parseFloat(elSens.value) || 1;
      elSensVal.textContent = settings.sensitivity.toFixed(2);
      DH.saveSettings(settings);
    });

    elSpeed.addEventListener('input', function () {
      settings.speed = parseFloat(elSpeed.value) || 72;
      elSpeedVal.textContent = String(Math.round(settings.speed));
      DH.saveSettings(settings);
    });

    elLimit.addEventListener('input', function () {
      var v = Math.round(parseFloat(elLimit.value));
      settings.shotLimit = Math.min(50, Math.max(0, isFinite(v) ? v : 0));
      elLimitVal.textContent = settings.shotLimit > 0 ? String(settings.shotLimit) : '∞';
      DH.saveSettings(settings);
    });

    elSound.addEventListener('change', function () {
      settings.sound = elSound.checked;
      DH.saveSettings(settings);
    });

    elHintAim.addEventListener('change', function () {
      settings.hintAim = elHintAim.checked;
      DH.saveSettings(settings);
    });

    elHintImpact.addEventListener('change', function () {
      settings.hintImpact = elHintImpact.checked;
      DH.saveSettings(settings);
    });

    elReset.addEventListener('click', function () {
      DH.resetSettings();
      settings = DH.settings = DH.defaultSettings();
      refresh();
    });

    elStatsReset.addEventListener('click', function () {
      DH.resetStats();
    });

    /* Переназначение кнопок */
    var capturing = null;

    function stopCapture() {
      if (!capturing) return;
      capturing.btn.classList.remove('capturing');
      window.removeEventListener('keydown', onCaptureKey, true);
      window.removeEventListener('mousedown', onCaptureMouse, true);
      capturing = null;
      refresh();
    }

    function applyBinding(action, binding) {
      var bs = settings.bindings;
      var other = Object.keys(bs).some(function (k) {
        return k !== action && DH.sameBinding(bs[k], binding);
      });
      if (other) {
        var tmp = { type: bs[action].type, code: bs[action].code, button: bs[action].button };
        bs[action] = binding;
        bs[other] = tmp;
      } else {
        bs[action] = binding;
      }
      DH.saveSettings(settings);
    }

    function onCaptureKey(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') { stopCapture(); return; }
      applyBinding(capturing.action, { type: 'key', code: e.code });
      stopCapture();
    }

    function onCaptureMouse(e) {
      e.preventDefault();
      e.stopPropagation();
      applyBinding(capturing.action, { type: 'mouse', button: e.button | 0 });
      stopCapture();
    }

    bindButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        stopCapture();
        capturing = { action: btn.dataset.action, btn: btn };
        btn.classList.add('capturing');
        btn.textContent = 'Нажмите…';
        window.addEventListener('keydown', onCaptureKey, true);
        window.addEventListener('mousedown', onCaptureMouse, true);
      });
    });

    elStart.addEventListener('click', function () {
      stopCapture();
      elStart.blur();
      onStart();
    });

    refresh();
    if (DH.updateStats) DH.updateStats();
  };
})();
