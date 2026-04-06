export interface KnobOptions {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  size?: number;
  onChange: (value: number) => void;
}

export function createKnob(parent: HTMLElement, opts: KnobOptions): HTMLElement {
  const size = opts.size ?? 52;
  const wrap = document.createElement('div');
  wrap.className = 'knob-wrap';

  const canvas = document.createElement('canvas');
  canvas.width = size * 2;
  canvas.height = size * 2;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.className = 'knob-canvas';

  const valDisplay = document.createElement('div');
  valDisplay.className = 'knob-value';

  const labelEl = document.createElement('div');
  labelEl.className = 'knob-label';
  labelEl.textContent = opts.label;

  wrap.appendChild(canvas);
  wrap.appendChild(valDisplay);
  wrap.appendChild(labelEl);
  parent.appendChild(wrap);

  let currentValue = opts.value;

  function normalize(): number {
    return (currentValue - opts.min) / (opts.max - opts.min);
  }

  function formatValue(): string {
    const decimals = opts.step < 0.01 ? 3 : opts.step < 0.1 ? 2 : opts.step < 1 ? 1 : 0;
    return currentValue.toFixed(decimals) + (opts.unit ? ` ${opts.unit}` : '');
  }

  function draw(): void {
    const ctx = canvas.getContext('2d')!;
    const cx = size;
    const cy = size;
    const r = size - 8;
    const startAngle = Math.PI * 0.75;
    const endAngle = Math.PI * 2.25;
    const n = normalize();
    const valueAngle = startAngle + n * (endAngle - startAngle);

    ctx.clearRect(0, 0, size * 2, size * 2);

    // Track background
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(65,158,199,0.12)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Value arc
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, valueAngle);
    ctx.strokeStyle = '#419EC7';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Knob body
    ctx.beginPath();
    ctx.arc(cx, cy, r - 10, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(cx - 4, cy - 4, 0, cx, cy, r - 10);
    grad.addColorStop(0, '#242838');
    grad.addColorStop(1, '#141822');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(65,158,199,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Indicator line
    const indicatorR = r - 14;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(valueAngle) * (indicatorR * 0.4), cy + Math.sin(valueAngle) * (indicatorR * 0.4));
    ctx.lineTo(cx + Math.cos(valueAngle) * indicatorR, cy + Math.sin(valueAngle) * indicatorR);
    ctx.strokeStyle = '#419EC7';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();

    valDisplay.textContent = formatValue();
  }

  // Drag interaction
  let dragging = false;
  let dragStartY = 0;
  let dragStartValue = 0;

  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    dragStartY = e.clientY;
    dragStartValue = currentValue;
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = (dragStartY - e.clientY) / 150;
    const range = opts.max - opts.min;
    let newVal = dragStartValue + delta * range;
    newVal = Math.round(newVal / opts.step) * opts.step;
    newVal = Math.max(opts.min, Math.min(opts.max, newVal));
    if (newVal !== currentValue) {
      currentValue = newVal;
      draw();
      opts.onChange(currentValue);
    }
  });

  window.addEventListener('mouseup', () => { dragging = false; });

  // Touch support
  canvas.addEventListener('touchstart', (e) => {
    dragging = true;
    dragStartY = e.touches[0].clientY;
    dragStartValue = currentValue;
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const delta = (dragStartY - e.touches[0].clientY) / 150;
    const range = opts.max - opts.min;
    let newVal = dragStartValue + delta * range;
    newVal = Math.round(newVal / opts.step) * opts.step;
    newVal = Math.max(opts.min, Math.min(opts.max, newVal));
    if (newVal !== currentValue) {
      currentValue = newVal;
      draw();
      opts.onChange(currentValue);
    }
  }, { passive: false });

  window.addEventListener('touchend', () => { dragging = false; });

  draw();
  return wrap;
}
