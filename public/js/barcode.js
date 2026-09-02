// Global Hardware Barcode Input Listener (Module C: Keyboard Emulation Mode).
// Intercepts rapid character bursts from USB / Bluetooth handheld barcode scanners
// without requiring explicit focus on an input element.

export function initBarcodeListener(onScan) {
  let buffer = '';
  let lastKeyTime = 0;
  const SCANNER_MAX_CHAR_INTERVAL_MS = 60; // Scanners type chars in <25ms bursts
  const MIN_BARCODE_LENGTH = 2;

  window.addEventListener(
    'keydown',
    (e) => {
      const now = performance.now();
      const timeSinceLastKey = now - lastKeyTime;
      lastKeyTime = now;

      // Don't intercept when user is typing in standard textareas/inputs, unless it's the barcode bar
      const activeEl = document.activeElement;
      const isCustomInput =
        activeEl &&
        (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable) &&
        !activeEl.classList.contains('barcode-input');

      if (e.key === 'Enter') {
        if (buffer.length >= MIN_BARCODE_LENGTH) {
          const barcode = buffer.trim();
          buffer = '';
          if (onScan) onScan(barcode, 'hardware_gun');
          if (!isCustomInput) {
            e.preventDefault();
            e.stopPropagation();
          }
        } else {
          buffer = '';
        }
        return;
      }

      // Scanner burst timing: if interval too long and not printable, reset buffer
      if (timeSinceLastKey > SCANNER_MAX_CHAR_INTERVAL_MS && buffer.length > 0) {
        // Reset if too slow for a scanner burst unless it's short
        if (buffer.length > 2) buffer = '';
      }

      // Collect single printable characters
      if (e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (!isCustomInput) {
          buffer += e.key;
        }
      }
    },
    true,
  );

  return {
    simulateScan(barcode) {
      if (onScan && barcode) onScan(barcode.trim(), 'simulator');
    },
  };
}
