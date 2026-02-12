const TWO_PI = Math.PI * 2;

const nextPow2 = (value: number) => {
  let v = 1;
  while (v < value) v <<= 1;
  return v;
};

const hannWindow = (n: number, i: number) =>
  0.5 * (1 - Math.cos(TWO_PI * i / (n - 1)));

export function computeSpectrum(signal: Float32Array) {
  const n = nextPow2(signal.length);
  const re = new Float32Array(n);
  const im = new Float32Array(n);

  const length = Math.min(signal.length, n);
  for (let i = 0; i < length; i++) {
    re[i] = signal[i] * hannWindow(length, i);
  }

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const phaseStep = -TWO_PI / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const angle = phaseStep * k;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const tre = cos * re[i + k + half] - sin * im[i + k + half];
        const tim = sin * re[i + k + half] + cos * im[i + k + half];
        re[i + k + half] = re[i + k] - tre;
        im[i + k + half] = im[i + k] - tim;
        re[i + k] += tre;
        im[i + k] += tim;
      }
    }
  }

  const bins = n >> 1;
  const magnitudes = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    magnitudes[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }

  return { magnitudes, size: n };
}
