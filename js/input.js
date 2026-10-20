/* Ввод: клавиши и кнопки мыши в соответствии с привязками из настроек. */
(function () {
  'use strict';

  var DH = (window.DH = window.DH || {});

  var bindings = null;
  var handlers = null;
  var attached = false;

  function onKeyDown(e) {
    if (!attached) return;
    var b = bindings.aim;
    if (b.type === 'key' && e.code === b.code) {
      e.preventDefault();
      if (!e.repeat) handlers.aim(true);
    }
    if (e.code === 'Escape') handlers.escape();
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  }

  function onKeyUp(e) {
    if (!attached) return;
    var b = bindings.aim;
    if (b.type === 'key' && e.code === b.code) handlers.aim(false);
  }

  function onMouseDown(e) {
    if (!attached) return;
    var btn = e.button | 0;
    if (bindings.fire.type === 'mouse' && btn === bindings.fire.button) {
      e.preventDefault();
      handlers.fire();
    }
    if (bindings.reload.type === 'mouse' && btn === bindings.reload.button) {
      e.preventDefault();
      handlers.reload();
    }
    if (bindings.aim.type === 'mouse' && btn === bindings.aim.button) {
      e.preventDefault();
      handlers.aim(true);
    }
  }

  function onMouseUp(e) {
    if (!attached) return;
    var b = bindings.aim;
    if (b.type === 'mouse' && (e.button | 0) === b.button) handlers.aim(false);
  }

  function onContextMenu(e) { e.preventDefault(); }

  function onBlur() {
    if (handlers) handlers.aim(false);
  }

  DH.Input = {
    /* settings — объект настроек; h — { fire, reload, aim(down:boolean), escape } */
    bind: function (settings, h) {
      bindings = settings.bindings;
      handlers = h;
    },

    attach: function () {
      if (attached) return;
      attached = true;
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('mousedown', onMouseDown);
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('contextmenu', onContextMenu);
      window.addEventListener('blur', onBlur);
      document.addEventListener('visibilitychange', onBlur);
    },

    detach: function () {
      if (!attached) return;
      attached = false;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onBlur);
      if (handlers) handlers.aim(false);
    }
  };
})();
