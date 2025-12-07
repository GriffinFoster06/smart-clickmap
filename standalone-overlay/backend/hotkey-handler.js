/**
 * Hotkey Handler
 *
 * Manages hotkey configuration and callbacks
 * Note: Actual key detection happens client-side in admin.js
 * Future: Electron global hotkeys via IPC
 */

export class HotkeyHandler {
  constructor(config = {}, callbacks = {}) {
    this.hotkeys = config.hotkeys || {
      toggle: 'Ctrl+1',
      reset: 'Ctrl+2'
    };

    this.callbacks = {
      toggle: callbacks.toggle || (() => console.log('Toggle hotkey (no callback set)')),
      reset: callbacks.reset || (() => console.log('Reset hotkey (no callback set)'))
    };
  }

  /**
   * Handle hotkey action (called from client via HTTP endpoint)
   * @param {string} action - Action name ('toggle' or 'reset')
   */
  handleHotkey(action) {
    if (this.callbacks[action]) {
      console.log(`[Hotkey] Triggered: ${action}`);
      this.callbacks[action]();
    } else {
      console.warn(`[Hotkey] Unknown action: ${action}`);
    }
  }

  /**
   * Get hotkey configuration
   * @returns {Object} Hotkey config
   */
  getConfig() {
    return this.hotkeys;
  }
}
