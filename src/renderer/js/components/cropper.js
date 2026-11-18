// Picture upload with a crop step. A picture that already has the exact
// target size is used as it is; anything else opens the cropper, where the
// user drags and zooms to choose the part to keep. Profile pictures are
// stricter: one smaller than the target is refused rather than enlarged.

import { h, button } from '../dom.js';
import { openModal, toast } from './overlays.js';

export const PICTURE_SIZES = {
  image: { width: 640, height: 640, label: 'playlist picture' },
  banner: { width: 2560, height: 423, label: 'banner' },
  // strict: never enlarged. round: shown in a circle, so the crop frame is one.
  avatar: { width: 320, height: 320, label: 'profile picture', strict: true, round: true },
};

const ACCEPT = 'image/png,image/jpeg,image/webp,image/bmp,image/gif';
const STAGE_W = 720;
const STAGE_H = 380;
const MARGIN = 30;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => (image.naturalWidth && image.naturalHeight ? resolve({ image, url }) : reject(new Error('empty')));
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable'));
    };
    image.src = url;
  });
}

function renderCrop(image, source, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, source.x, source.y, source.w, source.h, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}

// Opens a file chooser and resolves with a Blob of exactly the target size,
// or null when the user cancels or the file cannot be used. A message about a
// file that cannot be used goes to onError when given, otherwise to a toast.
export function pickPicture(kind, { onError = toast } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: ACCEPT, hidden: true });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      resolve(file ? await pictureFromFile(file, kind, { onError }) : null);
    });
    document.body.append(input);
    input.click();
  });
}

export async function pictureFromFile(file, kind, { onError = toast } = {}) {
  const target = PICTURE_SIZES[kind];
  let loaded;
  try {
    loaded = await loadImage(file);
  } catch {
    onError('That file could not be opened as a picture. Try a PNG or JPEG.');
    return null;
  }
  const { image, url } = loaded;
  try {
    if (target.strict && (image.naturalWidth < target.width || image.naturalHeight < target.height)) {
      onError(
        `That picture is too small: ${image.naturalWidth} × ${image.naturalHeight} pixels. A ${target.label} needs at least ${target.width} × ${target.height}.`,
      );
      return null;
    }
    if (image.naturalWidth === target.width && image.naturalHeight === target.height) {
      return await renderCrop(image, { x: 0, y: 0, w: target.width, h: target.height }, target.width, target.height);
    }
    return await openCropper(image, target);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function openCropper(image, target) {
  return new Promise((resolve) => {
    const iw = image.naturalWidth;
    const ih = image.naturalHeight;
    const ratio = target.width / target.height;

    // The crop frame sits in the middle of the stage; the rest of the picture
    // stays visible but dimmed so it is easy to see what is being left out.
    const cropW = Math.min(STAGE_W - MARGIN * 2, (STAGE_H - MARGIN * 2) * ratio);
    const cropH = cropW / ratio;
    const cropX = (STAGE_W - cropW) / 2;
    const cropY = (STAGE_H - cropH) / 2;

    const minScale = Math.max(cropW / iw, cropH / ih);
    // A strict target stops zooming at the point where the kept part would
    // have fewer pixels than the finished picture.
    const maxScale = target.strict ? Math.max(minScale, cropW / target.width) : minScale * 6;
    const canZoom = maxScale > minScale * 1.001;
    let scale = minScale;
    let x = cropX + (cropW - iw * scale) / 2; // top-left of the picture, in stage units
    let y = cropY + (cropH - ih * scale) / 2;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = h('canvas', { class: 'crop-stage', width: STAGE_W * dpr, height: STAGE_H * dpr });
    const ctx = canvas.getContext('2d');
    const zoom = h('input', {
      type: 'range',
      class: 'slider',
      min: '0',
      max: '1000',
      value: '0',
      'aria-label': 'Zoom',
      disabled: !canZoom,
      style: { '--fill': '0%' },
    });

    const clamp = () => {
      x = Math.min(cropX, Math.max(cropX + cropW - iw * scale, x));
      y = Math.min(cropY, Math.max(cropY + cropH - ih * scale, y));
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, STAGE_W, STAGE_H);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, x, y, iw * scale, ih * scale);
      ctx.fillStyle = 'rgba(12, 12, 12, 0.68)';
      // One path with a hole, so the dimmed area has no seams at the frame's edges.
      const frame = () => {
        if (target.round) ctx.arc(cropX + cropW / 2, cropY + cropH / 2, cropW / 2, 0, Math.PI * 2);
        else ctx.rect(cropX, cropY, cropW, cropH);
      };
      ctx.beginPath();
      ctx.rect(0, 0, STAGE_W, STAGE_H);
      frame();
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      frame();
      ctx.stroke();
    };

    const setScale = (next, originX = cropX + cropW / 2, originY = cropY + cropH / 2) => {
      const clamped = Math.min(maxScale, Math.max(minScale, next));
      x = originX - ((originX - x) / scale) * clamped;
      y = originY - ((originY - y) / scale) * clamped;
      scale = clamped;
      clamp();
      const t = canZoom ? Math.log(scale / minScale) / Math.log(maxScale / minScale) : 0;
      zoom.value = String(Math.round(t * 1000));
      zoom.style.setProperty('--fill', `${t * 100}%`);
      draw();
    };

    zoom.addEventListener('input', () => {
      setScale(minScale * (maxScale / minScale) ** (Number(zoom.value) / 1000));
    });

    const stageUnits = () => STAGE_W / canvas.getBoundingClientRect().width;
    let drag = null;
    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      drag = { px: event.clientX, py: event.clientY, x, y };
      canvas.classList.add('is-dragging');
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drag) return;
      const k = stageUnits();
      x = drag.x + (event.clientX - drag.px) * k;
      y = drag.y + (event.clientY - drag.py) * k;
      clamp();
      draw();
    });
    const endDrag = () => {
      drag = null;
      canvas.classList.remove('is-dragging');
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const k = stageUnits();
        setScale(scale * Math.exp(-event.deltaY * 0.0015), (event.clientX - rect.left) * k, (event.clientY - rect.top) * k);
      },
      { passive: false },
    );
    // Arrow keys nudge the picture for people who are not using a mouse.
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 24 : 6;
      const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      x += move[0];
      y += move[1];
      clamp();
      draw();
    });

    const tooSmall = iw < target.width || ih < target.height;
    const note = tooSmall
      ? `This picture is ${iw} × ${ih}, smaller than the ${target.width} × ${target.height} ${target.label}, so it will be enlarged and may look soft.`
      : `This picture is ${iw} × ${ih}. A ${target.label} is ${target.width} × ${target.height}, so choose the part to keep.`;

    let result = null;
    const modal = openModal({
      title: `Crop ${target.label}`,
      size: 'lg',
      onClose: () => resolve(result),
      content: [
        h('p', { class: 'modal-text' }, note),
        canvas,
        h('div', { class: 'crop-controls' }, h('span', { class: 'crop-hint' }, canZoom ? 'Drag to move · scroll to zoom' : 'Drag to move'), zoom),
        h(
          'div',
          { class: 'modal-actions' },
          button('Cancel', { onclick: () => modal.close() }),
          button('Use this crop', {
            class: 'btn-accent',
            autofocus: true,
            dataset: { test: 'crop-apply' },
            onclick: async () => {
              result = await renderCrop(
                image,
                { x: (cropX - x) / scale, y: (cropY - y) / scale, w: cropW / scale, h: cropH / scale },
                target.width,
                target.height,
              );
              modal.close();
            },
          }),
        ),
      ],
    });
    draw();
  });
}
