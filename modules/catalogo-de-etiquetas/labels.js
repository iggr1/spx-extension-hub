const LABELS = [
  { id: 'avaria-tratada', name: 'Avaria tratada', row: 1, column: 0 },
  { id: 'aviso-endereco-comercial', name: 'Aviso sobre endereço comercial', row: 1, column: 1 },
  { id: 'cuidado-fragil', name: 'Cuidado frágil', row: 1, column: 2 },
  { id: 'cuidado-liquido', name: 'Cuidado líquido', row: 1, column: 3 },
  { id: 'cuidado-vidro', name: 'Cuidado vidro', row: 2, column: 0 },
  { id: 'este-lado-para-cima', name: 'Este lado para cima', row: 2, column: 1 },
  { id: 'fora-de-rota', name: 'Fora de rota', row: 2, column: 2 },
  { id: 'fora-de-rota-rural', name: 'Fora de rota rural', row: 2, column: 3 },
  { id: 'liquidate', name: 'Liquidate', row: 3, column: 0 },
  { id: 'nao-contem-vidro', name: 'Não contém vidro', row: 3, column: 1 },
  { id: 'pacote-pesado', name: 'Pacote pesado', row: 3, column: 2 },
  { id: 'possivel-duplicado', name: 'Possível duplicado', row: 3, column: 3 },
  { id: 'prioridade', name: 'Prioridade', row: 4, column: 0 },
  { id: 'prioridade-maxima', name: 'Prioridade máxima', row: 4, column: 1 },
  { id: 'remark-avarias', name: 'Remark Avarias', row: 4, column: 2 },
  { id: 'solicitacao-rts', name: 'Solicitação de RTS', row: 4, column: 3 }
];

const LABEL_TYPES = {
  small: { key: 'small', labelType: 'Pequena', width: 70, height: 40 },
  large: { key: 'large', labelType: 'Grande', width: 100, height: 150 }
};

const ROW_CACHE = new Map();
const ARTWORK_CACHE = new Map();
const $ = id => document.getElementById(id);
let activeLabel = null;
let activeLabelType = 'small';
let printing = false;
let toastTimer = null;

function toast(message) {
  const element = $('toast');
  if (!element) return;
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3200);
}

function setProgress(percent, message) {
  $('labelBarFill').style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
  $('labelProgress').textContent = message || 'Selecione uma etiqueta para imprimir.';
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Não foi possível carregar a arte da etiqueta.'));
    image.src = src;
  });
}

async function loadRow(row) {
  if (ROW_CACHE.has(row)) return ROW_CACHE.get(row);
  const promise = fetch(`assets/labels-row-${row}.b64?v=1.1.0`, { cache: 'force-cache' })
    .then(response => {
      if (!response.ok) throw new Error(`Falha ao carregar a folha ${row}.`);
      return response.text();
    })
    .then(base64 => loadImage(`data:image/jpeg;base64,${base64.replace(/\s+/g, '')}`));
  ROW_CACHE.set(row, promise);
  return promise;
}

function trimCanvas(source) {
  const context = source.getContext('2d', { willReadFrequently: true });
  const { width, height } = source;
  const pixels = context.getImageData(0, 0, width, height).data;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const alpha = pixels[offset + 3];
      const isWhite = alpha < 8 || (red > 247 && green > 247 && blue > 247);
      if (isWhite) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < left || bottom < top) return source;
  const padding = Math.max(4, Math.round(Math.min(width, height) * 0.012));
  left = Math.max(0, left - padding);
  top = Math.max(0, top - padding);
  right = Math.min(width - 1, right + padding);
  bottom = Math.min(height - 1, bottom + padding);

  const result = document.createElement('canvas');
  result.width = right - left + 1;
  result.height = bottom - top + 1;
  result.getContext('2d').drawImage(source, left, top, result.width, result.height, 0, 0, result.width, result.height);
  return result;
}

async function getArtworkCanvas(label) {
  if (ARTWORK_CACHE.has(label.id)) return ARTWORK_CACHE.get(label.id);
  const promise = (async () => {
    const row = await loadRow(label.row);
    const cellWidth = Math.floor(row.naturalWidth / 4);
    const cellHeight = row.naturalHeight;
    const source = document.createElement('canvas');
    source.width = cellWidth;
    source.height = cellHeight;
    source.getContext('2d').drawImage(
      row,
      label.column * cellWidth,
      0,
      cellWidth,
      cellHeight,
      0,
      0,
      cellWidth,
      cellHeight
    );
    return trimCanvas(source);
  })();
  ARTWORK_CACHE.set(label.id, promise);
  return promise;
}

async function artworkUrl(label) {
  const canvas = await getArtworkCanvas(label);
  return canvas.toDataURL('image/jpeg', 0.96);
}

async function renderLabels() {
  const list = $('labelList');
  list.replaceChildren();
  $('labelStatus').textContent = 'Carregando 16 etiquetas originais...';
  setProgress(8, 'Carregando as artes do catálogo...');

  for (const label of LABELS) {
    const card = document.createElement('article');
    card.className = 'label-card';
    card.innerHTML = `
      <div class="label-preview"><div class="label-loading">Carregando...</div><img alt="${label.name}" hidden></div>
      <div class="label-body">
        <h2>${label.name}</h2>
        <div class="label-meta">Arte original</div>
        <div class="label-actions"><button class="primary" type="button">Imprimir</button></div>
      </div>`;
    card.querySelector('button').addEventListener('click', () => openModal(label));
    list.appendChild(card);

    artworkUrl(label).then(url => {
      const image = card.querySelector('img');
      const loading = card.querySelector('.label-loading');
      image.src = url;
      image.hidden = false;
      if (loading) loading.remove();
    }).catch(error => {
      const loading = card.querySelector('.label-loading');
      if (loading) loading.textContent = 'Falha ao carregar';
      console.error(error);
    });
  }

  await Promise.allSettled(LABELS.map(getArtworkCanvas));
  $('labelStatus').textContent = `${LABELS.length} etiquetas originais carregadas`;
  setProgress(0, 'Selecione uma etiqueta para imprimir.');
}

async function openModal(label) {
  activeLabel = label;
  setType('small');
  setQty(1);
  $('labelModalTitle').textContent = label.name;
  $('labelModalImage').removeAttribute('src');
  $('labelPrintModal').classList.add('show');
  $('labelPrintModal').setAttribute('aria-hidden', 'false');
  try {
    $('labelModalImage').src = await artworkUrl(label);
  } catch (error) {
    toast(error.message || 'Não foi possível carregar a etiqueta.');
  }
}

function closeModal() {
  if (printing) return;
  $('labelPrintModal').classList.remove('show');
  $('labelPrintModal').setAttribute('aria-hidden', 'true');
  activeLabel = null;
}

function setType(type) {
  activeLabelType = LABEL_TYPES[type] ? type : 'small';
  $('labelTypeSmall').classList.toggle('selected', activeLabelType === 'small');
  $('labelTypeLarge').classList.toggle('selected', activeLabelType === 'large');
}

function getQty() {
  const value = Math.max(1, Math.min(999, Math.floor(Number($('labelQtyInput').value) || 1)));
  $('labelQtyInput').value = String(value);
  return value;
}

function setQty(value) {
  $('labelQtyInput').value = String(Math.max(1, Math.min(999, Math.floor(Number(value) || 1))));
}

function setLoading(loading) {
  printing = loading;
  ['labelModalPrint','labelModalCancel','labelModalClose','labelTypeSmall','labelTypeLarge','labelQtyInput','labelQtyMinus','labelQtyPlus']
    .forEach(id => { $(id).disabled = loading; });
  $('labelModalPrint').textContent = loading ? 'Preparando...' : 'Imprimir etiqueta';
}

function getAutoRotation(imageWidth, imageHeight, labelWidth, labelHeight) {
  return (imageWidth >= imageHeight) === (labelWidth >= labelHeight) ? 0 : 90;
}

function getDrawRect(imageWidth, imageHeight, pageWidth, pageHeight) {
  const imageRatio = imageWidth / imageHeight;
  const pageRatio = pageWidth / pageHeight;
  let width;
  let height;
  if (imageRatio > pageRatio) {
    width = pageWidth;
    height = width / imageRatio;
  } else {
    height = pageHeight;
    width = height * imageRatio;
  }
  return { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height };
}

async function renderForPrint(label, settings) {
  const source = await getArtworkCanvas(label);
  const pxPerMm = 203 / 25.4;
  const canvasWidth = Math.max(1, Math.round(settings.width * pxPerMm));
  const canvasHeight = Math.max(1, Math.round(settings.height * pxPerMm));
  const rotation = getAutoRotation(source.width, source.height, settings.width, settings.height);
  const rotated = rotation === 90;
  const sourceWidth = rotated ? source.height : source.width;
  const sourceHeight = rotated ? source.width : source.height;
  const rect = getDrawRect(sourceWidth, sourceHeight, canvasWidth, canvasHeight);

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  if (rotation) {
    context.save();
    context.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
    context.rotate(Math.PI / 2);
    context.drawImage(source, -rect.height / 2, -rect.width / 2, rect.height, rect.width);
    context.restore();
  } else {
    context.drawImage(source, rect.x, rect.y, rect.width, rect.height);
  }

  return canvas.toDataURL('image/jpeg', 0.98);
}

function printWithWindowsDialog(printWindow, imageUrl, label, settings, quantity) {
  const safeTitle = label.name.replace(/[<>]/g, '');
  const pages = Array.from({ length: quantity }, (_, index) =>
    `<div class="page${index === quantity - 1 ? ' last' : ''}"><img src="${imageUrl}" alt="${safeTitle}"></div>`
  ).join('');

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  @page { size: ${settings.width}mm ${settings.height}mm; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .page { width: ${settings.width}mm; height: ${settings.height}mm; display: flex; align-items: center; justify-content: center; page-break-after: always; break-after: page; overflow: hidden; }
  .page.last { page-break-after: auto; break-after: auto; }
  .page img { display: block; width: 100%; height: 100%; object-fit: contain; }
  @media screen { body { background: #d9d9d9; } .page { margin: 16px auto; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.18); } }
</style>
</head>
<body>${pages}
<script>
  window.addEventListener('load', function () {
    setTimeout(function () { window.focus(); window.print(); }, 180);
  });
<\/script>
</body>
</html>`);
  printWindow.document.close();
}

async function printActiveLabel() {
  if (!activeLabel || printing) return;
  const settings = LABEL_TYPES[activeLabelType] || LABEL_TYPES.small;
  const quantity = getQty();
  const printWindow = window.open('', '_blank', 'width=960,height=720');

  if (!printWindow) {
    toast('Permita pop-ups para abrir a impressão do Windows.');
    return;
  }

  printWindow.document.write('<!doctype html><title>Preparando impressão...</title><body style="font-family:Segoe UI,Arial,sans-serif;padding:28px">Preparando etiqueta...</body>');

  try {
    setLoading(true);
    setProgress(20, `Preparando ${settings.labelType.toLowerCase()} ${settings.width}×${settings.height} mm...`);
    const imageUrl = await renderForPrint(activeLabel, settings);
    setProgress(75, 'Abrindo a impressão padrão do Windows...');
    printWithWindowsDialog(printWindow, imageUrl, activeLabel, settings, quantity);
    setProgress(100, `${quantity} cópia(s) preparada(s) em ${settings.width}×${settings.height} mm.`);
    setLoading(false);
    closeModal();
    toast('Janela de impressão aberta.');
    setTimeout(() => setProgress(0, 'Selecione uma etiqueta para imprimir.'), 3500);
  } catch (error) {
    try { printWindow.close(); } catch {}
    setProgress(0, error?.message || 'Erro ao preparar a impressão.');
    toast(error?.message || 'Erro ao preparar a impressão.');
    setLoading(false);
  }
}

$('reloadLabels').addEventListener('click', () => {
  ARTWORK_CACHE.clear();
  ROW_CACHE.clear();
  renderLabels();
});
$('labelModalClose').addEventListener('click', closeModal);
$('labelModalCancel').addEventListener('click', closeModal);
$('labelTypeSmall').addEventListener('click', () => setType('small'));
$('labelTypeLarge').addEventListener('click', () => setType('large'));
$('labelQtyMinus').addEventListener('click', () => setQty(getQty() - 1));
$('labelQtyPlus').addEventListener('click', () => setQty(getQty() + 1));
$('labelQtyInput').addEventListener('change', getQty);
$('labelModalPrint').addEventListener('click', printActiveLabel);
$('labelPrintModal').addEventListener('click', event => {
  if (event.target === $('labelPrintModal')) closeModal();
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeModal();
});

renderLabels();
