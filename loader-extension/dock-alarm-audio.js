(() => {
  'use strict';

  let context = null;
  let lastPlayedAt = 0;

  async function play() {
    if (Date.now() - lastPlayedAt < 3000) return { ok: true, deduplicated: true };
    lastPlayedAt = Date.now();
    try {
      context ||= new (window.AudioContext || window.webkitAudioContext)();
      if (context.state === 'suspended') await context.resume();
      const start = context.currentTime + 0.02;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'square';
      oscillator.connect(gain);
      gain.connect(context.destination);
      gain.gain.setValueAtTime(0.0001, start);

      for (let i = 0; i < 3; i++) {
        const pulse = start + i * 0.75;
        oscillator.frequency.setValueAtTime(830, pulse);
        oscillator.frequency.setValueAtTime(990, pulse + 0.28);
        gain.gain.linearRampToValueAtTime(0.22, pulse + 0.03);
        gain.gain.setValueAtTime(0.22, pulse + 0.40);
        gain.gain.exponentialRampToValueAtTime(0.0001, pulse + 0.54);
      }

      oscillator.start(start);
      oscillator.stop(start + 2.08);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'SPX_DOCK_ALARM_PLAY') return false;
    play().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  });
})();
