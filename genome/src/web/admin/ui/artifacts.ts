/**
 * Artifact panel: print options (width, theme, label, decorative hairlines,
 * PNG resolution) and SVG / PNG / PDF downloads for one code. With preview
 * data (right after issuance), the on-screen code follows the chosen theme.
 */
import { h, mount } from '../../shared/dom.js';
import type { AdminApi } from '../api.js';
import { ARTIFACT_DEFAULTS, ARTIFACT_LIMITS, buildArtifactOptions, cellPitchNote, type ArtifactForm } from '../model/generator.js';
import type { ArtifactFormat, ArtifactTheme } from '../types.js';
import { busy, button, checkbox, field, input, select } from './components.js';
import { saveDownload } from './download.js';
import { codeFigure } from './figures.js';
import { notifyError } from './toast.js';

export interface ArtifactPanelOptions {
  codeId: string;
  /** Present right after issuance: render the code on screen. */
  preview?: { data: string; glyphs: readonly number[] };
  /** Called after each successful download (e.g. to refresh the audit trail). */
  onDownloaded?: (format: ArtifactFormat) => void;
}

export function artifactPanel(api: AdminApi, o: ArtifactPanelOptions): HTMLElement {
  const width = input('widthMm', { type: 'number', value: String(ARTIFACT_DEFAULTS.widthMm), min: ARTIFACT_LIMITS.minWidthMm, max: ARTIFACT_LIMITS.maxWidthMm, step: '0.5', inputmode: 'decimal' });
  const theme = select(
    'theme',
    [
      { value: 'black', label: 'Black on white' },
      { value: 'inverted', label: 'White on black' },
      { value: 'ivory', label: 'Ink on ivory' },
    ],
    ARTIFACT_DEFAULTS.theme,
  );
  const dpi = input('dpi', { type: 'number', value: String(ARTIFACT_DEFAULTS.dpi), min: ARTIFACT_LIMITS.minDpi, max: ARTIFACT_LIMITS.maxDpi, step: '1', inputmode: 'numeric' });
  const label = checkbox('label', 'Print label (product id + ORBES)', ARTIFACT_DEFAULTS.label);
  const decor = checkbox('decor', 'Decorative hairlines', ARTIFACT_DEFAULTS.decor);
  const pitch = h('span', { class: 'artifact__pitch' }, cellPitchNote(ARTIFACT_DEFAULTS.widthMm));
  const error = h('p', { class: 'artifact__error', attrs: { role: 'alert' } });
  const preview = h('div', { class: 'artifact__preview' });

  const form = (): ArtifactForm => ({
    widthMm: width.value,
    theme: theme.value,
    dpi: dpi.value,
    label: (label.querySelector('input') as HTMLInputElement).checked,
    decor: (decor.querySelector('input') as HTMLInputElement).checked,
  });

  const renderPreview = () => {
    if (!o.preview) return;
    try {
      mount(preview, codeFigure(o.preview.data, o.preview.glyphs, theme.value as ArtifactTheme, form().decor));
    } catch {
      mount(preview, h('p', { class: 'micro soft' }, 'Preview unavailable'));
    }
  };

  width.addEventListener('input', () => (pitch.textContent = cellPitchNote(Number(width.value))));
  theme.addEventListener('change', renderPreview);
  decor.addEventListener('change', renderPreview);

  const download = (format: ArtifactFormat) => {
    const b = button(format.toUpperCase(), { kind: format === 'svg' ? 'primary' : 'secondary', testId: `download-${format}` });
    b.addEventListener('click', () => {
      error.textContent = '';
      const opts = buildArtifactOptions(form(), format);
      if (!opts.ok) {
        error.textContent = Object.values(opts.errors).join(' ');
        return;
      }
      void busy(b, async () => {
        try {
          saveDownload(await api.artifact(o.codeId, format, opts.value));
          o.onDownloaded?.(format);
        } catch (e) {
          notifyError(e, 'The artifact could not be produced.');
        }
      }, 'Rendering…');
    });
    return b;
  };

  renderPreview();
  return h(
    'div',
    { class: ['artifact', o.preview ? 'artifact--with-preview' : null] },
    o.preview ? preview : null,
    h(
      'div',
      { class: 'artifact__controls' },
      h(
        'div',
        { class: 'grid grid--2' },
        field('Width (mm)', width, { hint: `${ARTIFACT_LIMITS.minWidthMm}–${ARTIFACT_LIMITS.maxWidthMm} mm, quiet zone included` }),
        field('Theme', theme),
        field('PNG resolution (dpi)', dpi, { hint: `${ARTIFACT_LIMITS.minDpi}–${ARTIFACT_LIMITS.maxDpi}` }),
        h('div', { class: 'cfield cfield--checks' }, label, decor),
      ),
      h('div', { class: 'artifact__downloads' }, h('span', { class: 'artifact__downloads-label' }, 'Download'), download('svg'), download('png'), download('pdf'), pitch),
      error,
      h('p', { class: 'artifact__note' }, 'Every download is recorded in the audit log. Files are vector (SVG, PDF) or rasterised at the chosen resolution (PNG).'),
    ),
  );
}
