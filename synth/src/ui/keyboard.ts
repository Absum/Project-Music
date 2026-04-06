// Computer keyboard → note mapping (2 octaves)
const KEY_MAP: Record<string, string> = {
  'a': 'C3', 'w': 'C#3', 's': 'D3', 'e': 'D#3', 'd': 'E3',
  'f': 'F3', 't': 'F#3', 'g': 'G3', 'y': 'G#3', 'h': 'A3',
  'u': 'A#3', 'j': 'B3', 'k': 'C4', 'o': 'C#4', 'l': 'D4',
  'p': 'D#4', ';': 'E4',
};

const WHITE_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK_NOTES: Record<string, number> = { 'C#': 1, 'D#': 2, 'F#': 4, 'G#': 5, 'A#': 6 };

export function setupKeyboard(
  container: HTMLElement,
  onNoteOn: (note: string) => void,
  onNoteOff: (note: string) => void,
): void {
  // Build virtual keyboard
  for (const octave of [3, 4]) {
    for (const note of WHITE_NOTES) {
      const key = document.createElement('div');
      key.className = 'key white';
      key.dataset.note = `${note}${octave}`;
      const label = document.createElement('span');
      label.textContent = `${note}${octave}`;
      key.appendChild(label);
      container.appendChild(key);
    }
  }

  // Black keys overlay
  const blackOverlay = document.createElement('div');
  blackOverlay.className = 'black-keys-overlay';
  for (const octave of [3, 4]) {
    for (const [note, pos] of Object.entries(BLACK_NOTES)) {
      const key = document.createElement('div');
      key.className = 'key black';
      key.dataset.note = `${note}${octave}`;
      key.style.left = `${(pos + (octave - 3) * 7) * (100 / 14) + (100 / 28)}%`;
      container.appendChild(key);
    }
  }
  container.appendChild(blackOverlay);

  // Mouse events on virtual keys
  const keys = container.querySelectorAll<HTMLElement>('.key');
  keys.forEach(key => {
    key.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const note = key.dataset.note!;
      key.classList.add('active');
      onNoteOn(note);
    });
    key.addEventListener('mouseup', () => {
      const note = key.dataset.note!;
      key.classList.remove('active');
      onNoteOff(note);
    });
    key.addEventListener('mouseleave', () => {
      if (key.classList.contains('active')) {
        key.classList.remove('active');
        onNoteOff(key.dataset.note!);
      }
    });
  });

  // Computer keyboard events
  const heldKeys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.target instanceof HTMLInputElement) return;
    const note = KEY_MAP[e.key.toLowerCase()];
    if (note && !heldKeys.has(e.key)) {
      heldKeys.add(e.key);
      const el = container.querySelector(`[data-note="${note}"]`);
      el?.classList.add('active');
      onNoteOn(note);
    }
  });

  window.addEventListener('keyup', (e) => {
    const note = KEY_MAP[e.key.toLowerCase()];
    if (note && heldKeys.has(e.key)) {
      heldKeys.delete(e.key);
      const el = container.querySelector(`[data-note="${note}"]`);
      el?.classList.remove('active');
      onNoteOff(note);
    }
  });
}
