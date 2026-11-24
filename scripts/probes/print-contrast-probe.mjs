// Throwaway probe: resolve the print-contrast tokens against real math.
const L = rgb => {
  const f = c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};
const cr = (a, b = [255, 255, 255]) => {
  const la = L(a);
  const lb = L(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const density = rgb => {
  const avg = (rgb[0] + rgb[1] + rgb[2]) / 3;
  return ((255 - avg) / 255) * (0.6 + L(rgb) * 0.4);
};
const mix = (base, w) => base.map(c => Math.round(c + (255 - c) * w));
const navy = [10, 94, 166];
const grays = {
  '#f0f2f5': [240, 242, 245],
  '#eaeef3': [234, 238, 243],
  '#e6e9ee': [230, 233, 238],
  '#e2e6eb': [226, 230, 235],
  '#8a8f98': [138, 143, 152],
  '#7c828b': [124, 130, 139],
  '#6b7280': [107, 114, 128],
  '#5b6168': [91, 97, 104],
};
console.log('gray        contrast  inkDensity');
for (const [name, rgb] of Object.entries(grays)) {
  console.log(name.padEnd(12), cr(rgb).toFixed(2), density(rgb).toFixed(3));
}
console.log('\nbrand ramp (navy)     contrast  inkDensity  darkTextOnIt');
for (const w of [0.9, 0.88, 0.84, 0.8, 0.72, 0.6, 0.45]) {
  const rgb = mix(navy, w);
  console.log(
    `mix ${String(w).padEnd(6)} [${rgb}]`.padEnd(24),
    cr(rgb).toFixed(2),
    density(rgb).toFixed(3),
    cr(rgb, [6, 58, 103]).toFixed(2),
  );
}
