/* shared.jsx — helpers used across all 4 quiz variants.
   Keeps original data + scoring untouched. Provides:
   • svgWithColor(svgKey, rgbTriple) — recolors the original anatomy SVGs
     so each variant can render them in its own palette.
   • getModelsForBrand(brand, flexFilter) — list of model names
   • findBootsByModel(brand, model) — boots matching a brand+model (≥1 if multiple years)
   • FIT_STYLE_MAP — vol → fit style label (from original showResult)
   • getFitProblem(v) — FIT_PROBLEMS entry by value
*/
(function () {
  // Recolor anatomy SVGs by replacing the three palette rgbs in the original strings.
  window.svgWithColor = function (svgKey, rgb) {
    const fn = window.SVGS && window.SVGS[svgKey];
    if (!fn) return '';
    return fn()
      .replace(/rgba\(168,207,224,([\d.]+)\)/g, (_, a) => `rgba(${rgb},${a})`)
      .replace(/rgba\(232,201,106,([\d.]+)\)/g, (_, a) => `rgba(${rgb},${a})`)
      .replace(/rgba\(240,160,100,([\d.]+)\)/g, (_, a) => `rgba(${rgb},${a})`);
  };

  window.getModelsForBrand = function (brand, flexFilter) {
    if (!brand || !window.BFM[brand]) return [];
    if (flexFilter && window.BFM[brand][flexFilter]) return window.BFM[brand][flexFilter].slice();
    // aggregate across all flex values
    const seen = {}, out = [];
    Object.keys(window.BFM[brand]).forEach((fx) => {
      window.BFM[brand][fx].forEach((m) => { if (!seen[m]) { seen[m] = 1; out.push(m); } });
    });
    return out.sort();
  };

  window.findBootsByModel = function (brand, model) {
    return window.BOOTS.filter((b) => b.b === brand && b.m === model);
  };

  // Liner volume → fit style label (matches original `fs` map in showResult)
  window.FIT_STYLE_MAP = {
    'Low': 'Precision Race',
    'Low-Medium': 'Performance',
    'Medium': 'All-Day',
    'Medium-High': 'Comfort-Forward',
    'High': 'Maximum Warmth',
  };

  window.getFitProblem = function (v) {
    if (!v || v === 'none') return null;
    return (window.FIT_PROBLEMS || []).find((p) => p.v === v) || null;
  };

  // Pretty labels for foot profile rows on result (matches original FL + ff labels)
  window.LABELS = {
    ff:  { narrow: 'Narrow', medium: 'Medium', wide: 'Wide', vwide: 'Very Wide' },
    ins: { low: 'Low / Flat', medium: 'Medium', high: 'High' },
    ank: { low: 'Bony / Lean', medium: 'Average', high: 'Full / Fleshy' },
    cal: { low: 'Lean / Narrow', medium: 'Medium', high: 'Full / Muscular' },
    ability: { 1: 'Beginner', 2: 'Intermediate', 3: 'Advanced', 4: 'Expert / Racer' },
  };

  // Pull a question definition by id from window.QS
  window.getQ = function (id) {
    return (window.QS || []).find((q) => q.id === id);
  };
})();
