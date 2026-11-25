import { expect, test } from '@playwright/test';

const PALETTES = ['navy', 'teal', 'amethyst', 'slate', 'maroon'] as const;
const MODES = ['light', 'dark'] as const;
const SURFACES = [
  'background',
  'surface',
  'surface-variant',
  'surface-container-lowest',
  'surface-container-low',
  'surface-container',
  'surface-container-high',
  'surface-container-highest',
] as const;
const TOKENS = [
  ...SURFACES,
  'on-background',
  'on-surface',
  'on-surface-variant',
  'primary',
  'on-primary',
  'primary-container',
  'on-primary-container',
  'secondary',
  'on-secondary',
  'secondary-container',
  'on-secondary-container',
  'accent',
  'error',
  'on-error',
  'error-container',
  'on-error-container',
  'success',
  'success-container',
  'on-success-container',
  'warning',
  'warning-container',
  'on-warning-container',
  'info',
  'info-container',
  'on-info-container',
  'outline',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
] as const;

type Token = (typeof TOKENS)[number];
type Tokens = Record<Token, string>;

function luminance(hex: string): number {
  const normalized = hex.trim().replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(normalized))
    throw new Error(`Expected a six-digit hex token, received ${hex}`);
  const channels = [0, 2, 4].map(offset => {
    const value = Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function textPairs(): Array<[Token, Token, number]> {
  const pairs: Array<[Token, Token, number]> = [];
  for (const surface of SURFACES) {
    pairs.push(['on-background', surface, 4.5]);
    pairs.push(['on-surface', surface, 4.5]);
    pairs.push(['on-surface-variant', surface, 4.5]);
  }
  for (const token of [
    'primary',
    'secondary',
    'accent',
    'error',
    'success',
    'warning',
    'info',
  ] as const) {
    pairs.push([token, 'surface', 4.5], [token, 'background', 4.5]);
  }
  pairs.push(
    ['on-primary', 'primary', 4.5],
    ['on-primary-container', 'primary-container', 4.5],
    ['on-secondary', 'secondary', 4.5],
    ['on-secondary-container', 'secondary-container', 4.5],
    ['on-error', 'error', 4.5],
    ['on-error-container', 'error-container', 4.5],
    ['on-success-container', 'success-container', 4.5],
    ['on-warning-container', 'warning-container', 4.5],
    ['on-info-container', 'info-container', 4.5],
  );
  return pairs;
}

test('semantic text and graphical contrast matrix passes in every palette and mode', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const matrix = (await page.evaluate(
    ({ names, palettes, modes }) => {
      const style = getComputedStyle(document.documentElement);
      return modes.flatMap(mode =>
        palettes.map(palette => {
          document.documentElement.dataset.theme = mode;
          document.documentElement.dataset.palette = palette;
          return {
            mode,
            palette,
            tokens: Object.fromEntries(
              names.map(name => [name, style.getPropertyValue(`--${name}`).trim()]),
            ),
          };
        }),
      );
    },
    { names: TOKENS, palettes: PALETTES, modes: MODES },
  )) as Array<{ mode: string; palette: string; tokens: Tokens }>;
  const failures: string[] = [];

  for (const { mode, palette, tokens } of matrix) {
    for (const [foreground, background, minimum] of textPairs()) {
      const ratio = contrast(tokens[foreground], tokens[background]);
      if (ratio < minimum) {
        failures.push(
          `${mode}/${palette}: --${foreground} on --${background} = ${ratio.toFixed(2)}:1 (needs ${minimum}:1)`,
        );
      }
    }
    for (const chart of [
      'chart-1',
      'chart-2',
      'chart-3',
      'chart-4',
      'chart-5',
      'chart-6',
    ] as const) {
      const ratio = contrast(tokens[chart], tokens.surface);
      if (ratio < 3)
        failures.push(
          `${mode}/${palette}: --${chart} on --surface = ${ratio.toFixed(2)}:1 (needs 3:1)`,
        );
    }
    for (const surface of ['surface', 'background'] as const) {
      const ratio = contrast(tokens.outline, tokens[surface]);
      if (ratio < 3)
        failures.push(
          `${mode}/${palette}: --outline on --${surface} = ${ratio.toFixed(2)}:1 (needs 3:1)`,
        );
    }
  }

  expect(failures).toEqual([]);
});
