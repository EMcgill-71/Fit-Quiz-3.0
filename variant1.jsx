/* global React */
/* Variant 1 — EDITORIAL LIGHT
   PRESERVES: the full 7-question flow from the original quiz (boot → forefoot →
   instep → ankle → calf → fit problem → ability) and the original tier-based
   scoring via window.computeMatch. Only the presentation changes.
   Aesthetic: white canvas, big Outfit display type, illustrated SVG cards.
*/
(function () {
  const { useState, useMemo, useEffect } = React;
  const RED = '#EF4623';
  const BLACK = '#272727';
  const WARM = '#F1EDE7';
  const RAINBOW = 'linear-gradient(90deg,#EF4623 0%,#FBCF21 20%,#68BD46 40%,#5DC7D1 60%,#2F438F 80%,#952A7D 100%)';

  // ─── styles ─────────────────────────────────────────────────────────
  const rainbowText = {
    background: RAINBOW,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
    WebkitTextFillColor: 'transparent',
  };
  const css = {
    eyebrow: { fontSize: 12, fontWeight: 700, letterSpacing: '.22em', textTransform: 'uppercase', color: '#7A7670', fontFamily: 'Inter, sans-serif' },
    h2: { fontFamily: 'Outfit, sans-serif', fontWeight: 800, textTransform: 'uppercase', fontSize: 52, letterSpacing: '-.022em', lineHeight: 1.0, color: BLACK, margin: 0, textWrap: 'balance' },
    hint: { fontFamily: 'Inter, sans-serif', fontSize: 17, lineHeight: 1.5, color: '#4A4A4A', margin: '12px 0 0', maxWidth: 620, textWrap: 'pretty' },
    sub: { fontFamily: 'Inter, sans-serif', fontSize: 13, lineHeight: 1.4, color: '#7A7670', margin: '12px 0 0', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: WARM, borderRadius: 6 },
  };
  const btnPrimary = (disabled) => ({
    background: disabled ? 'rgba(39,39,39,.12)' : RED, color: '#fff',
    border: 0, borderRadius: 4, padding: '14px 26px',
    fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 13, letterSpacing: '.08em',
    textTransform: 'uppercase', cursor: disabled ? 'not-allowed' : 'pointer',
  });
  const btnGhost = {
    background: 'transparent', color: BLACK, border: 0, padding: '14px 6px',
    fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 13, letterSpacing: '.08em',
    textTransform: 'uppercase', cursor: 'pointer',
  };

  // ─── Shell finder (search + brand + flex-chip filters → model cards) ─
  // Volume → accent color used for rails + swatches. All contrast against
  // both #fff (list rows) and #272727 (confirmation card).
  const VOL_COLOR = {
    'LV': '#5DC7D1', 'Race/LV': '#5DC7D1', 'Race': '#EF4623',
    'MV': '#FBCF21', 'MV-Wide': '#FBCF21', 'HV': '#68BD46', 'EHV': '#68BD46',
  };

  function ShellTag({ children, color, dark }) {
    return (
      <span style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
        padding: '4px 9px', borderRadius: 3,
        background: dark ? 'rgba(255,255,255,.12)' : '#fff',
        color: color || (dark ? '#fff' : BLACK),
        border: `1px solid ${dark ? 'rgba(255,255,255,.18)' : 'rgba(39,39,39,.14)'}`,
        whiteSpace: 'nowrap',
      }}>{children}</span>
    );
  }

  // Each boot in BOOTS carries a pre-classified `fam` field (curated families
  // from the Ski Boot Database). Keep this lightweight fallback for any future
  // boots that lack the field.
  function familyOf(boot) {
    if (typeof boot === 'string') return boot.replace(/\s+\d{2,3}\b.*$/, '').trim() || boot;
    return boot.fam || (boot.m || '').replace(/\s+\d{2,3}\b.*$/, '').trim() || boot.m;
  }

  function BootPicker({ value, onChange }) {
    const [pBrand, setPBrand] = useState(value?.b || '');
    const [pFamily, setPFamily] = useState('');
    const [pFlex, setPFlex] = useState('');
    const [query, setQuery] = useState('');

    const ql = query.trim().toLowerCase();

    // Group BOOTS into model families. Each family entry carries its available
    // flex numbers, volumes, lasts, and walk-mode flag so we can render a
    // single row per family in the list.
    const families = useMemo(() => {
      let list = window.BOOTS.slice();
      if (pBrand) list = list.filter((b) => b.b === pBrand);
      if (ql) list = list.filter((b) => {
        const fam = familyOf(b);
        return `${b.b} ${b.m} ${fam}`.toLowerCase().includes(ql);
      });
      const map = {};
      list.forEach((b) => {
        const fam = familyOf(b);
        const key = b.b + '::' + fam;
        if (!map[key]) map[key] = { b: b.b, fam, flexes: {}, volumes: {}, lasts: {}, walk: false };
        if (b.f) map[key].flexes[b.f] = 1;
        if (b.v && b.v !== 'nan') map[key].volumes[b.v] = 1;
        if (b.l) map[key].lasts[b.l] = 1;
        if (b.w) map[key].walk = true;
      });
      return Object.values(map)
        .map((m) => ({
          b: m.b,
          fam: m.fam,
          flexes: Object.keys(m.flexes).map(Number).sort((a, c) => a - c),
          volumes: Object.keys(m.volumes),
          lasts: Object.keys(m.lasts).map(Number).sort((a, c) => a - c),
          walk: m.walk,
        }))
        .sort((a, b) => a.b.localeCompare(b.b) || a.fam.localeCompare(b.fam));
    }, [pBrand, ql]);

    // Selected boot confirmation card (computed below all hooks; render decision lives near return)

    // Family options for the Model dropdown — derived directly from BOOTS so
    // models without a flex number in their name (touring boots, race series,
    // etc.) still appear. BFM is keyed by flex and would silently drop those.
    const familyOptions = useMemo(() => {
      if (!pBrand) return [];
      const set = {};
      window.BOOTS.forEach((b) => { if (b.b === pBrand) set[familyOf(b)] = 1; });
      let list = Object.keys(set);
      if (ql) list = list.filter((fam) => `${pBrand} ${fam}`.toLowerCase().includes(ql));
      return list.sort();
    }, [pBrand, ql]);

    // Only show the family list once a brand is picked or there's a query —
    // rendering hundreds of rows blind is overwhelming.
    const narrowed = !!(pBrand || ql);
    const visible = narrowed ? families : [];

    // After family + flex are chosen, surface year chips if there are multiple.
    // Compute family info from BOOTS directly (not from the search-filtered
    // `families` list) so the flex chips still show even if the user's query
    // would have hidden this family from the row list.
    const familyVariants = (pFamily && pBrand)
      ? window.BOOTS.filter((b) => b.b === pBrand && familyOf(b) === pFamily)
      : [];
    const flexesForFamily = (() => {
      const seen = {};
      familyVariants.forEach((b) => { if (b.f) seen[b.f] = 1; });
      return Object.keys(seen).map(Number).sort((a, c) => a - c);
    })();
    const familyHasFlex = flexesForFamily.length > 0;
    const yearMatches = pFamily
      ? (familyHasFlex
          ? (pFlex ? familyVariants.filter((b) => String(b.f) === String(pFlex)) : [])
          : familyVariants)
      : [];

    // If a family has only one flex, accept it immediately.
    useEffect(() => {
      if (value) return;
      if (pFamily && flexesForFamily.length === 1 && !pFlex) {
        setPFlex(String(flexesForFamily[0]));
      }
    }, [value, pFamily, flexesForFamily, pFlex]);

    // If flex selection narrows to a single boot, confirm it — but only after
    // the user has explicitly picked a flex chip (not on family auto-set).
    // Removed for new variant-list UX: the user always clicks a row to confirm,
    // so we don't surprise them by skipping ahead.

    // Selected boot confirmation card — must render AFTER all hooks above so hook
    // order stays stable across renders (toggling between picker and confirmation).
    if (value) {
      const last = value.l || 0;
      const lastNote = last === 0 ? '' : last <= 98 ? 'Low volume' : last <= 100 ? 'Medium volume' : last <= 102 ? 'Mid-high volume' : 'High volume';
      const volColor = VOL_COLOR[value.v] || BLACK;
      return (
        <div style={{
          background: '#fff', color: BLACK, borderRadius: 14,
          padding: '0 0 18px', position: 'relative', overflow: 'hidden',
          border: '1px solid rgba(39,39,39,.1)',
          boxShadow: '0 1px 0 rgba(39,39,39,.04)',
        }}>
          <div style={{ height: 4, background: RAINBOW }} />
          <div style={{ padding: '18px 22px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ ...css.eyebrow, fontSize: 11, color: '#7A7670', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ ...rainbowText }}>✓</span> Shell confirmed
              </div>
              <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: 26, lineHeight: 1.12, letterSpacing: '-.014em', marginTop: 8, textWrap: 'balance', color: BLACK }}>{value.m}</div>
              <div style={{ fontSize: 14, color: '#7A7670', marginTop: 8 }}>{value.b} · {value.y}{value.w ? ' · Walk mode' : ''}</div>
            </div>
            <button onClick={() => { setPBrand(''); setPFamily(''); setPFlex(''); setQuery(''); onChange(null); }}
              style={{ background: 'transparent', border: '1px solid rgba(39,39,39,.18)', color: '#7A7670', padding: '6px 12px', borderRadius: 4, fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'Inter, sans-serif', flexShrink: 0 }}>
              Change
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0, marginTop: 18, marginLeft: 22, marginRight: 22, borderTop: '1px solid rgba(39,39,39,.08)' }}>
            <DnaCell label="Last" value={value.l ? value.l + 'mm' : '—'} note={lastNote} />
            <DnaCell label="Volume" value={value.v && value.v !== 'nan' ? value.v : '—'} accent={volColor} />
            <DnaCell label="Flex" value={value.f || '—'} />
          </div>
        </div>
      );
    }

    const pickFamily = (b, fam) => {
      setPBrand(b);
      setPFamily(fam);
      setPFlex('');
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Search bar */}
        <div style={{ position: 'relative' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', opacity: .4 }}>
            <circle cx="7" cy="7" r="5" stroke={BLACK} strokeWidth="1.5" fill="none" />
            <path d="M11 11l3.5 3.5" stroke={BLACK} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={pBrand ? `Search ${pBrand} models…` : 'Search by brand or model…'}
            style={{
              width: '100%', padding: '14px 14px 14px 40px',
              background: '#fff',
              border: `1.5px solid ${query ? BLACK : 'rgba(39,39,39,.16)'}`,
              borderRadius: 8,
              fontFamily: 'Inter, sans-serif', fontSize: 16, color: BLACK,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Brand + model filter row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10 }}>
          <Select label="Brand" value={pBrand} onChange={(v) => { setPBrand(v); setPFamily(''); setPFlex(''); }} options={window.BRANDS} placeholder="Any brand" />
          <Select label="Model" value={pFamily}
            onChange={(v) => { setPFamily(v); setPFlex(''); }}
            options={familyOptions.map((m) => ({ key: m, label: m }))}
            disabled={!pBrand} placeholder={pBrand ? 'Any model' : '—'} />
        </div>

        {/* Flex chips (only when a family with multiple flex options is picked) */}
        {pFamily && flexesForFamily.length > 1 && (
          <div style={{ background: WARM, border: `1.5px solid ${BLACK}`, borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ ...css.eyebrow, fontSize: 11, marginBottom: 8 }}>Pick a flex for {pFamily}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {flexesForFamily.map((f) => {
                const active = String(pFlex) === String(f);
                return (
                  <button key={f} onClick={() => setPFlex(active ? '' : String(f))}
                    style={{
                      padding: '8px 16px', borderRadius: 999,
                      background: active ? BLACK : '#fff',
                      color: active ? '#fff' : BLACK,
                      border: `1.5px solid ${active ? BLACK : 'rgba(39,39,39,.18)'}`,
                      fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    }}>
                    {f}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Family list — collapses to family rows when nothing is selected,
            drills into individual variants once a family is picked. */}
        <div style={{ background: '#fff', border: '1px solid rgba(39,39,39,.1)', borderRadius: 10 }}>
          {!narrowed ? (
            <div style={{ padding: '36px 24px', textAlign: 'center', fontSize: 15, color: '#7A7670', lineHeight: 1.55 }}>
              <div style={{ ...css.eyebrow, fontSize: 11, color: BLACK, marginBottom: 8 }}>{families.length} model families in our database</div>
              Pick a brand above or search to see matching shells.
            </div>
          ) : pFamily ? (
            // Variant-level list: every individual boot in the selected family,
            // sorted by flex then year (newest first). Clicking a row confirms.
            (() => {
              const variants = familyVariants
                .filter((b) => !pFlex || String(b.f) === String(pFlex))
                .sort((a, b) => (a.f || 0) - (b.f || 0) || b.y.localeCompare(a.y));
              if (variants.length === 0) {
                return <div style={{ padding: '24px 20px', textAlign: 'center', fontSize: 14, color: '#7A7670' }}>No variants for {pFamily}{pFlex ? ' at flex ' + pFlex : ''}.</div>;
              }
              return (
                <>
                  <div style={{ ...css.eyebrow, fontSize: 11, padding: '12px 18px 8px', background: 'rgba(39,39,39,.02)', borderBottom: '1px solid rgba(39,39,39,.06)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{pBrand} · {pFamily}{pFlex ? ' · Flex ' + pFlex : ''} · {variants.length} variant{variants.length === 1 ? '' : 's'}</span>
                    <span style={{ color: 'rgba(39,39,39,.3)' }}>flex · last · year</span>
                  </div>
                  {variants.map((b) => {
                    const volColor = VOL_COLOR[b.v] || BLACK;
                    return (
                      <button key={b.i} onClick={() => onChange(b)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 14,
                          width: '100%', padding: '12px 18px',
                          background: 'transparent', border: 0,
                          borderBottom: '1px solid rgba(39,39,39,.06)',
                          textAlign: 'left', cursor: 'pointer',
                          fontFamily: 'Inter, sans-serif',
                          transition: 'background .12s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = WARM; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <div style={{ width: 5, height: 34, background: volColor, borderRadius: 2, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14.5, fontWeight: 600, color: BLACK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.m}</div>
                          <div style={{ fontSize: 12, color: '#7A7670', marginTop: 2 }}>{b.y}{b.g === 'W' ? ' · Women' : ''}{b.w ? ' · Walk' : ''}{b.c ? ' · ' + b.c : ''}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 5, flexShrink: 0, alignItems: 'center' }}>
                          {b.f ? <ShellTag>{b.f}</ShellTag> : null}
                          {b.l ? <ShellTag>{b.l}mm</ShellTag> : null}
                          {b.v && b.v !== 'nan' ? <ShellTag color={volColor}>{b.v}</ShellTag> : null}
                        </div>
                      </button>
                    );
                  })}
                </>
              );
            })()
          ) : visible.length === 0 ? (
            <div style={{ padding: '24px 20px', textAlign: 'center', fontSize: 14, color: '#7A7670' }}>
              No shells match. Try a different brand or clear the search.
            </div>
          ) : (
            <>
              <div style={{ ...css.eyebrow, fontSize: 11, padding: '12px 18px 8px', background: 'rgba(39,39,39,.02)', borderBottom: '1px solid rgba(39,39,39,.06)', display: 'flex', justifyContent: 'space-between', position: 'sticky', top: 0 }}>
                <span>{visible.length} model{visible.length === 1 ? '' : 's'}</span>
                <span style={{ color: 'rgba(39,39,39,.3)' }}>last · volume · flex options</span>
              </div>
              {visible.map((f) => {
                const volColor = VOL_COLOR[f.volumes[0]] || BLACK;
                const isActive = pBrand === f.b && pFamily === f.fam;
                return (
                  <button key={f.b + '::' + f.fam} onClick={() => pickFamily(f.b, f.fam)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      width: '100%', padding: '14px 18px',
                      background: isActive ? WARM : 'transparent', border: 0,
                      borderBottom: '1px solid rgba(39,39,39,.06)',
                      textAlign: 'left', cursor: 'pointer',
                      fontFamily: 'Inter, sans-serif',
                      transition: 'background .12s',
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = WARM; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ width: 5, height: 34, background: volColor, borderRadius: 2, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, color: BLACK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.fam}</div>
                      <div style={{ fontSize: 12.5, color: '#7A7670', marginTop: 2 }}>{f.b}{f.walk ? ' · Walk' : ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexShrink: 0, alignItems: 'center' }}>
                      {f.lasts.length > 0 && <ShellTag>{f.lasts.length === 1 ? f.lasts[0] : `${f.lasts[0]}–${f.lasts[f.lasts.length - 1]}`}</ShellTag>}
                      {f.volumes.length > 0 && <ShellTag color={volColor}>{f.volumes.join('/')}</ShellTag>}
                      {f.flexes.length > 0 && <ShellTag>{f.flexes.length === 1 ? `Flex ${f.flexes[0]}` : `${f.flexes[0]}–${f.flexes[f.flexes.length - 1]} · ${f.flexes.length}`}</ShellTag>}
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
    );
  }

  function DnaCell({ label, value, note, accent }) {
    return (
      <div style={{ padding: '14px 0', borderRight: '1px solid rgba(39,39,39,.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {accent && <span style={{ width: 10, height: 10, borderRadius: 2, background: accent, flexShrink: 0 }} />}
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: '#7A7670' }}>{label}</div>
        </div>
        <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 700, fontSize: 24, marginTop: 6, color: BLACK }}>{value}</div>
        {note && <div style={{ fontSize: 11.5, color: '#a8a39d', marginTop: 3 }}>{note}</div>}
      </div>
    );
  }

  function Select({ label, sublabel, value, onChange, options, disabled, placeholder }) {
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ ...css.eyebrow, fontSize: 11 }}>
          {label}{sublabel && <em style={{ fontStyle: 'normal', fontWeight: 400, marginLeft: 4, textTransform: 'none', letterSpacing: 0, color: 'rgba(39,39,39,.3)', fontSize: 11 }}> {sublabel}</em>}
        </span>
        <div style={{ position: 'relative' }}>
          <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
            style={{
              width: '100%', appearance: 'none', WebkitAppearance: 'none',
              padding: '13px 32px 13px 14px',
              background: disabled ? 'rgba(39,39,39,.04)' : '#fff',
              color: disabled ? '#bbb' : BLACK,
              border: '1.5px solid rgba(39,39,39,.12)', borderRadius: 8,
              fontFamily: 'Inter, sans-serif', fontSize: 15, fontWeight: 500,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}>
            <option value="">{placeholder}</option>
            {options.map((o) => {
              const v = typeof o === 'string' ? o : o.key;
              const l = typeof o === 'string' ? o : o.label;
              return <option key={v} value={v}>{l}</option>;
            })}
          </select>
          <svg width="11" height="7" viewBox="0 0 11 7" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <path d="M1 1l4.5 4.5L10 1" stroke={BLACK} strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </svg>
        </div>
      </label>
    );
  }

  // ─── option cards (anatomy + choice) ────────────────────────────────
  // Clean technical-illustration style side views of foot / ankle / calf.
  // All three share a 120x80 viewBox, a 1.8px stroke, and a light fill so they
  // read as a coherent illustrated set. Active state inverts via the color prop.

  // Foot side view — heel, ankle stub, top of foot, toes, arch underneath.
  // Arch lift + instep rise both scale with level so options read at a glance.
  function FootSideSvg({ level, color }) {
    const arch = level === 'low' ? 1 : level === 'high' ? 12 : 6;
    const inst = level === 'low' ? 0 : level === 'high' ? 8 : 4;
    return (
      <svg viewBox="0 0 120 80" width="118" height="78" fill="none" style={{ display: 'block' }} aria-hidden="true">
        <g stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill={color} fillOpacity=".05">
          <path d={`
            M 32 70
            Q 16 70 12 60
            Q 8 50 16 42
            L 18 28
            L 18 14
            Q 18 8 26 8
            L 40 8
            Q 46 8 46 14
            L 46 22
            Q 50 ${28 - inst} 60 ${26 - inst}
            Q 78 ${30 - inst * .4} 96 38
            Q 108 42 114 52
            Q 116 62 106 64
            Q 92 66 78 66
            Q 66 ${68 - arch * .3} 56 ${68 - arch}
            Q 44 ${68 - arch * .4} 34 68
            Q 30 70 32 70 Z
          `} />
          {/* Toe knuckle hint */}
          <path d="M 100 50 Q 104 48 108 52" fill="none" strokeOpacity=".35" strokeWidth="1.2" />
        </g>
      </svg>
    );
  }

  // Ankle side view — lower leg, achilles, heel, top of foot.
  // Volume = how much soft tissue surrounds the ankle. Lean (low) shows a
  // prominent malleolus; high padding buries it.
  function AnkleSideSvg({ level, color }) {
    const back = level === 'low' ? 0 : level === 'high' ? 10 : 5;
    const front = level === 'low' ? 0 : level === 'high' ? 6 : 3;
    const boneR = level === 'low' ? 5 : level === 'high' ? 2 : 3.2;
    const boneFill = level === 'low' ? .35 : level === 'high' ? .08 : .2;
    return (
      <svg viewBox="0 0 120 80" width="118" height="78" fill="none" style={{ display: 'block' }} aria-hidden="true">
        <g stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill={color} fillOpacity=".05">
          <path d={`
            M 38 0
            L ${66 + front} 0
            L ${66 + front} 28
            Q ${66 + front} 40 ${62 + front} 50
            Q ${60 + front} 58 68 62
            Q 86 66 120 66
            L 120 76
            L 26 76
            Q 12 76 12 62
            Q 12 52 ${22 - back} 48
            Q ${32 - back * .6} 44 ${34 - back * .3} 36
            Q ${36 - back * .15} 22 38 0 Z
          `} />
          {/* Achilles tendon */}
          <path d={`M ${38 - back * .15} 6 Q ${36 - back * .4} 30 ${28 - back * .5} 48`}
            fill="none" strokeOpacity=".3" strokeWidth="1.2" />
          {/* Lateral malleolus (ankle bone) */}
          <circle cx={28 - back * .3} cy={56} r={boneR}
            fill={color} fillOpacity={boneFill} strokeWidth="1.4" />
        </g>
      </svg>
    );
  }

  // Calf — just the muscle belly viewed from the side. No foot, no knee.
  // Back-of-calf bulge grows with level for a clear teardrop progression.
  function CalfSvg({ level, color }) {
    const w = level === 'lean' ? 0 : level === 'large' ? 14 : 7;
    return (
      <svg viewBox="0 0 120 80" width="92" height="76" fill="none" style={{ display: 'block' }} aria-hidden="true">
        <g stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill={color} fillOpacity=".05">
          <path d={`
            M 54 2
            Q 62 18 62 38
            Q 60 56 54 70
            Q 50 78 44 78
            Q 38 78 38 70
            Q 38 58 ${42 - w * .15} 48
            Q ${28 - w} 36 ${32 - w * .5} 22
            Q ${40 - w * .15} 8 46 4
            Q 50 2 54 2 Z
          `} />
          {/* Gastrocnemius/soleus separation */}
          <path d={`M ${40 - w * .4} 26 Q ${36 - w * .3} 44 44 60`}
            fill="none" strokeOpacity=".3" strokeWidth="1.2" />
        </g>
      </svg>
    );
  }

  // Map each anatomy SVG key to a renderer + relative size. For forefoot we
  // still use the foot emoji (top-down width is what matters). The rest are
  // bespoke side-view illustrations.
  const ANAT_GLYPH = {
    // forefoot (4 sizes) — footprints emoji, scaled by width
    ff1: { emoji: '👣', size: 28 }, ff2: { emoji: '👣', size: 36 },
    ff3: { emoji: '👣', size: 44 }, ff4: { emoji: '👣', size: 52 },
    // instep / navicular — sole/heel half of foot, scaled by arch height
    a1:  { emoji: '🦶', size: 40, crop: 0.30 },
    a2:  { emoji: '🦶', size: 50, crop: 0.30 },
    a3:  { emoji: '🦶', size: 64, crop: 0.30 },
    // ankle volume — same crop, scaled by soft tissue
    ank1: { emoji: '🦶', size: 40, crop: 0.30 },
    ank2: { emoji: '🦶', size: 52, crop: 0.30 },
    ank3: { emoji: '🦶', size: 64, crop: 0.30 },
    // calf — leg emoji with the thigh cropped off (top ~40%)
    c1: { emoji: '🦵', size: 48, crop: 0.40 },
    c2: { emoji: '🦵', size: 58, crop: 0.40 },
    c3: { emoji: '🦵', size: 68, crop: 0.40 },
  };

  // Emoji renderer. Loads a polished Noto SVG from jsdelivr (reliable CDN);
  // falls back to the system emoji glyph if the network blocks the image.
  function EmojiCard({ emoji, size, crop, active }) {
    const cp = [...emoji].map((c) => c.codePointAt(0).toString(16)).join('-');
    const url = `https://www.emoji.family/api/emojis/${cp}/noto/svg`;
    const [failed, setFailed] = useState(false);
    const W = size * 1.5;
    if (failed) {
      // Fallback: render the OS-native emoji glyph at the same scale, with
      // the same overflow-crop wrapper so layout doesn't shift.
      return (
        <div style={{ width: W, height: W * (1 - crop), overflow: 'hidden', transition: 'all .2s ease' }}>
          <div style={{
            width: W, height: W, lineHeight: 1,
            fontSize: W * 0.9, marginTop: -W * crop,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            filter: active ? 'grayscale(1) brightness(2) contrast(1.4)' : 'none',
          }}>{emoji}</div>
        </div>
      );
    }
    return (
      <div style={{ width: W, height: W * (1 - crop), overflow: 'hidden', transition: 'all .2s ease' }}>
        <img src={url} alt="" onError={() => setFailed(true)} style={{
          width: W, height: W,
          marginTop: -W * crop,
          display: 'block',
          filter: active ? 'grayscale(1) brightness(2) contrast(1.4)' : 'none',
        }} />
      </div>
    );
  }

  function AnatCard({ svgKey, label, desc, active, onClick, cols }) {
    const g = ANAT_GLYPH[svgKey] || { emoji: '🦶', size: 40 };
    return (
      <button onClick={onClick} style={{
        background: active ? BLACK : '#fff',
        color: active ? '#fff' : BLACK,
        border: `1.5px solid ${active ? BLACK : 'rgba(39,39,39,.12)'}`,
        borderRadius: 12, padding: '16px 10px 16px',
        cursor: 'pointer', display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 8,
        fontFamily: 'Inter, sans-serif', transition: 'all .14s',
        textAlign: 'center', minHeight: cols === 4 ? 168 : 184,
      }}>
        <div style={{
          width: '100%', height: 80,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          lineHeight: 1,
          transition: 'all .2s ease',
        }}>
          {g.side
            ? <FootSideSvg level={g.side} color={active ? '#fff' : BLACK} />
            : g.ankle
              ? <AnkleSideSvg level={g.ankle} color={active ? '#fff' : BLACK} />
              : g.calf
                ? <CalfSvg level={g.calf} color={active ? '#fff' : BLACK} />
                : g.emoji ? <EmojiCard emoji={g.emoji} size={g.size} crop={g.crop || 0} active={active} /> : null}
        </div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 13, opacity: .7, lineHeight: 1.35 }}>{desc}</div>
      </button>
    );
  }

  // Rainbow palette positions — used to tint emoji badges so they read as
  // designed iconography rather than literal emoji.
  const RAINBOW_STOPS = ['#EF4623', '#FBCF21', '#68BD46', '#5DC7D1', '#2F438F', '#952A7D'];
  function accentForIndex(i, total) {
    if (i >= RAINBOW_STOPS.length) return BLACK; // overflow goes neutral
    return RAINBOW_STOPS[i];
  }
  // Hex → tinted background (alpha overlay)
  function tintBg(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function ChoiceCard({ icon, label, desc, active, accent, onClick }) {
    const tint = accent || BLACK;
    return (
      <button onClick={onClick} style={{
        background: active ? BLACK : '#fff',
        color: active ? '#fff' : BLACK,
        border: `1.5px solid ${active ? BLACK : 'rgba(39,39,39,.12)'}`,
        borderRadius: 12, padding: '16px 18px',
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 18,
        fontFamily: 'Inter, sans-serif', textAlign: 'left', width: '100%',
        transition: 'all .14s',
      }}>
        <div style={{
          width: 48, height: 48, flexShrink: 0,
          borderRadius: 999,
          background: active ? '#fff' : tintBg(tint, 0.14),
          border: `1px solid ${active ? 'rgba(255,255,255,.2)' : tintBg(tint, 0.28)}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22,
          overflow: 'hidden',
        }}>{icon === '🦵' ? <EmojiCard emoji="🦵" size={28} crop={0.4} active={active} /> : icon}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.2 }}>{label}</div>
          <div style={{ fontSize: 14, opacity: .7, marginTop: 3 }}>{desc}</div>
        </div>
      </button>
    );
  }

  // ─── progress ────────────────────────────────────────────────────────
  // Three-section breadcrumb above a thin rainbow-fill bar. Sections are derived
  // from the questions' `sec` field so re-ordering questions stays in sync.
  function ProgressBar({ stepNum, totalSteps, currentSection }) {
    const pct = Math.round((stepNum / totalSteps) * 100);
    const sections = ['Your Shell', 'Your Foot', 'Your Skiing'];
    return (
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {sections.map((s, i) => {
            const isActive = s === currentSection;
            const passed = sections.indexOf(currentSection) > i;
            return (
              <div key={s} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 11, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase',
                  color: isActive ? BLACK : passed ? '#7A7670' : 'rgba(39,39,39,.28)',
                }}>{s}</span>
                <div style={{ height: 4, borderRadius: 4, background: isActive || passed ? 'transparent' : 'rgba(39,39,39,.08)', backgroundImage: isActive || passed ? RAINBOW : 'none' }} />
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ ...css.eyebrow, fontSize: 11, color: BLACK }}>Step {stepNum} <span style={{ color: '#a8a39d' }}>/ {totalSteps}</span></span>
          <span style={{ ...css.eyebrow, fontSize: 11 }}>{Math.round(pct)}% complete</span>
        </div>
      </div>
    );
  }

  // ─── main quiz ──────────────────────────────────────────────────────
  const STAGES = ['intro', 'lead', 'boot', 'ff', 'ins', 'ank', 'cal', 'fit_problem', 'ability', 'result'];

  // Decode a ?r= result token so follow-up email links land directly on the
  // result screen. Returns a partial answers object or null if absent/invalid.
  function decodeResultParam() {
    try {
      const p = new URLSearchParams(window.location.search).get('r');
      if (!p) return null;
      // base64url → base64 → JSON
      return JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
    } catch (_) { return null; }
  }

  function QuizEditorial() {
    const prefill = useMemo(decodeResultParam, []);
    const [step, setStep] = useState(() => prefill ? STAGES.indexOf('result') : 0);
    const [answers, setAnswers] = useState(() => prefill || {});

    const stage = STAGES[step];
    // Real quiz questions (excludes intro, lead, result)
    const totalQs = STAGES.length - 3;
    // 1-indexed step within the real questions (boot = 1, ff = 2, ...)
    const stepNum = Math.max(0, step - 1);
    const q = window.getQ(stage);

    const canAdvance = (() => {
      if (stage === 'intro') return true;
      if (stage === 'lead') {
        const l = answers.lead;
        if (!l) return false;
        return !!l.name && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((l.email || '').trim());
      }
      if (stage === 'boot') return !!answers.boot;
      if (stage === 'result') return false;
      if (stage === 'fit_problem') {
        const a = answers.fit_problem;
        return Array.isArray(a) ? a.length > 0 : a !== undefined;
      }
      return answers[stage] !== undefined;
    })();

    const setAns = (k, v) => setAnswers((a) => ({ ...a, [k]: v }));

    const next = () => setStep((s) => Math.min(s + 1, STAGES.length - 1));
    const back = () => setStep((s) => Math.max(0, s - 1));

    // Every question now waits for the Continue button — no auto-advance.
    const pickAndMaybeAdvance = (k, v) => {
      setAns(k, v);
    };

    const restart = () => { setAnswers({}); setStep(0); };

    return (
      <div style={{ width: '100%', height: '100%', background: '#fff', color: BLACK, fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* header */}
        <div style={{ padding: '20px 30px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(39,39,39,.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src="assets/logo-black.png" alt="ZipFit" style={{ height: 20 }} />
            <span style={{ ...css.eyebrow, fontSize: 11 }}>· Find my fit</span>
          </div>
          {step > 0 && step < STAGES.length - 1 && (
            <button onClick={restart} style={{ ...btnGhost, fontSize: 12, padding: '4px 0' }}>Restart</button>
          )}
        </div>

        {/* scrolling content */}
        <div style={{ flex: 1, padding: '30px 36px 18px', overflow: 'auto' }}>
          {stage === 'intro' && <Intro onStart={() => setStep(1)} />}

          {stage === 'lead' && <LeadCapture value={answers.lead} onChange={(v) => setAns('lead', v)} />}

          {stage !== 'intro' && stage !== 'lead' && stage !== 'result' && q && (
            <>
              <ProgressBar currentSection={q.sec} stepNum={stepNum} totalSteps={totalQs} />
              <div style={css.eyebrow}>Question {stepNum}</div>
              <h2 style={{ ...css.h2, marginTop: 10 }}>{q.txt}</h2>
              <p style={css.hint}>{q.hint}</p>
              {q.sub && <div style={css.sub}>📐 {q.sub}</div>}

              <div style={{ marginTop: 26 }}>
                {q.type === 'boot' && (
                  <BootPicker value={answers.boot} onChange={(b) => {
                    setAns('boot', b);
                  }} />
                )}

                {q.type === 'anat' && (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${q.cols === 'f4' ? 4 : 3}, 1fr)`, gap: 12 }}>
                    {q.opts.map((o) => (
                      <AnatCard key={o.v} svgKey={o.s} label={o.l} desc={o.d}
                        active={answers[q.id] === o.v} cols={q.cols === 'f4' ? 4 : 3}
                        onClick={() => pickAndMaybeAdvance(q.id, o.v)} />
                    ))}
                  </div>
                )}

                {q.type === 'anat-pair' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
                    {q.subs.map((sub, si) => (
                      <div key={sub.id}>
                        <div style={{
                          fontFamily: 'Inter, sans-serif', fontSize: 15, fontWeight: 600,
                          color: BLACK, marginBottom: 10, display: 'flex', alignItems: 'baseline', gap: 8,
                        }}>
                          <span style={{ ...css.eyebrow, fontSize: 11, color: '#7A7670' }}>{String.fromCharCode(65 + si)}</span>
                          {sub.lbl}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sub.cols === 'f4' ? 4 : 3}, 1fr)`, gap: 12 }}>
                          {sub.opts.map((o) => (
                            <AnatCard key={o.v} svgKey={o.s} label={o.l} desc={o.d}
                              active={answers[sub.id] === o.v} cols={sub.cols === 'f4' ? 4 : 3}
                              onClick={() => pickAndMaybeAdvance(sub.id, o.v)} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                                {q.type === 'choice' && q.id === 'fit_problem' && (
                  // Fit problems are multi-select: pick all that apply. "No
                  // major issues" is mutually exclusive with the rest.
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ ...css.eyebrow, fontSize: 11, color: '#7A7670', marginBottom: 2 }}>
                      Select all that apply
                    </div>
                    {q.opts.map((o, i) => {
                      const current = Array.isArray(answers.fit_problem) ? answers.fit_problem : (answers.fit_problem ? [answers.fit_problem] : []);
                      const isActive = current.indexOf(o.v) > -1;
                      const toggle = () => {
                        let next;
                        if (o.v === 'none') {
                          next = isActive ? [] : ['none'];
                        } else {
                          next = current.filter((v) => v !== 'none');
                          next = isActive ? next.filter((v) => v !== o.v) : [...next, o.v];
                        }
                        setAns('fit_problem', next);
                      };
                      return (
                        <ChoiceCard key={String(o.v)} icon={o.ic} label={o.l} desc={o.d}
                          accent={accentForIndex(i, q.opts.length)}
                          active={isActive}
                          onClick={toggle} />
                      );
                    })}
                  </div>
                )}

                {q.type === 'choice' && q.id !== 'fit_problem' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {q.opts.map((o, i) => (
                      <ChoiceCard key={String(o.v)} icon={o.ic} label={o.l} desc={o.d}
                        accent={accentForIndex(i, q.opts.length)}
                        active={answers[q.id] === o.v}
                        onClick={() => pickAndMaybeAdvance(q.id, o.v)} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {stage === 'result' && <Result answers={answers} onRestart={restart} onBack={back} />}
        </div>

        {/* footer nav */}
        {step > 0 && step < STAGES.length - 1 && (
          <div style={{ padding: '14px 30px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(39,39,39,.06)', background: '#fff' }}>
            <button onClick={back} style={btnGhost}>← Back</button>
            <button onClick={next} disabled={!canAdvance} style={btnPrimary(!canAdvance)}>
              {step === STAGES.length - 2 ? 'See my liner →' : 'Continue →'}
            </button>
          </div>
        )}
      </div>
    );
  }

  function Intro({ onStart }) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 520, justifyContent: 'space-between' }}>
        <div>
          <div style={css.eyebrow}>Custom liners · Made in Italy · Since 1989</div>
          <h1 style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 900, textTransform: 'uppercase', lineHeight: .88, letterSpacing: '-.032em', margin: '20px 0 24px' }}>
            <span style={{ display: 'block', fontSize: 46, fontWeight: 700, letterSpacing: '-.014em', color: '#4A4A4A', marginBottom: 4 }}>Find your</span>
            <span style={{ ...rainbowText, display: 'block', fontSize: 168, lineHeight: .82 }}>ZipFit.</span>
          </h1>
          <p style={{ fontSize: 19, lineHeight: 1.45, color: '#4A4A4A', maxWidth: 600, margin: 0, textWrap: 'pretty' }}>
            Six questions about your shell, foot shape, and how you ski. We match you to one of seven ZipFits — handmade in Italy.
          </p>
          <div style={{ marginTop: 28, background: WARM, borderRadius: 10, padding: 18, display: 'flex', gap: 16, alignItems: 'center', maxWidth: 580 }}>
            <img src="assets/lifestyle-liner.jpg" alt="" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
            <p style={{ fontSize: 15, lineHeight: 1.5, color: '#4A4A4A', margin: 0 }}>
              Have a soft tape measure handy — we'll ask about your ankle and calf circumference.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', paddingTop: 28 }}>
          <button onClick={onStart} style={btnPrimary(false)}>Begin →</button>
          <span style={{ fontSize: 13, color: '#7A7670' }}>~ 2 minutes · 7 steps</span>
        </div>
      </div>
    );
  }

  // ─── Result ─────────────────────────────────────────────────────────
  function Result({ answers, onRestart, onBack }) {
    const match = window.computeMatch(answers);
    const top = match.primary;
    if (!top) return <div>Hmm, no match found. Try adjusting your answers.</div>;
    const alts = match.alternates;
    const linerColor = window.LINER_COLOR[top.id] || RED;
    const boot = answers.boot || {};
    // Multi-select fit problems → array of FIT_PROBLEMS entries (excluding 'none').
    const fitProblemVals = Array.isArray(answers.fit_problem)
      ? answers.fit_problem
      : (answers.fit_problem ? [answers.fit_problem] : []);
    const fitProblems = fitProblemVals
      .map((v) => window.getFitProblem(v))
      .filter(Boolean);
    const fitStyle = window.FIT_STYLE_MAP[top.vol] || top.vol;

    // Tinted surfaces derived from the liner's signature color. These replace
    // the old neutral WARM washes so the entire result page reads as belonging
    // to the chosen liner.
    const wash = tintBg(linerColor, 0.06);  // page-level surfaces (stat tiles)
    const washStrong = tintBg(linerColor, 0.12); // hero photo backdrop
    const washHair = tintBg(linerColor, 0.22); // borders

    // Brief reveal motion — keeps the result feeling like an arrival, not
    // just another page load.
    const [revealed, setRevealed] = useState(false);
    useEffect(() => {
      const id = requestAnimationFrame(() => setRevealed(true));
      return () => cancelAnimationFrame(id);
    }, []);

    // Fire-and-forget submit to the backend (Klaviyo + Shopify + Odoo).
    // sessionStorage flag prevents double-posting if the user navigates back.
    useEffect(() => {
      if (!answers.lead?.email || !top) return;
      const sigKey = `__zf_${answers.lead.email}:${top.id}`;
      try { if (sessionStorage.getItem(sigKey)) return; } catch (_) {}
      fetch('/api/fit-quiz/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead: answers.lead,
          boot: answers.boot || null,
          match: { id: top.id, name: top.name },
          answers: {
            ff: answers.ff, ins: answers.ins, ank: answers.ank, cal: answers.cal,
            fit_problem: answers.fit_problem, ability: answers.ability,
          },
          submittedAt: new Date().toISOString(),
        }),
      })
        .then((r) => { if (r.ok) try { sessionStorage.setItem(sigKey, '1'); } catch (_) {} })
        .catch((e) => console.warn('fit-quiz submit failed', e));
    }, []);
    const revealStyle = (delay) => ({
      opacity: revealed ? 1 : 0,
      transform: revealed ? 'translateY(0)' : 'translateY(8px)',
      transition: `opacity .42s ${delay}ms ease, transform .5s ${delay}ms cubic-bezier(.2,.7,.2,1)`,
    });

    const footProfile = [
      { l: 'Forefoot', v: window.LABELS.ff[answers.ff] },
      { l: 'Instep',   v: window.LABELS.ins[answers.ins] },
      { l: 'Ankle',    v: window.LABELS.ank[answers.ank] },
      { l: 'Calf',     v: window.LABELS.cal[answers.cal] },
    ].filter((r) => r.v);

    return (
      <div>
        {/* ── Hero: tinted card with liner photo on a color-washed backdrop ── */}
        <div style={{
          ...revealStyle(0),
          background: wash,
          border: `1px solid ${washHair}`,
          borderRadius: 14,
          padding: '18px 20px 16px',
          marginBottom: 14,
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{ ...css.eyebrow, fontSize: 12, color: linerColor, fontWeight: 800 }}>
            ✓ Our best match
          </div>
          <h1 style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 900, textTransform: 'uppercase', fontSize: 64, lineHeight: .92, letterSpacing: '-.03em', margin: '10px 0 8px', color: BLACK }}>
            The <span style={{ color: linerColor }}>{top.name}</span>.
          </h1>
          <p style={{ fontSize: 16, color: '#4A4A4A', margin: '0 0 16px', fontStyle: 'italic', lineHeight: 1.4, textWrap: 'balance', maxWidth: 600 }}>{top.tag}</p>

          {/* Photo on a fuller wash — gives the product real stage presence */}
          <div style={{
            background: washStrong,
            borderRadius: 10,
            position: 'relative',
            overflow: 'hidden',
            textAlign: 'center',
            padding: '20px 14px 12px',
          }}>
            {/* Big ghost wordmark behind the photo */}
            <div aria-hidden style={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'Outfit, sans-serif', fontWeight: 900,
              fontSize: 180, lineHeight: 1, letterSpacing: '-.04em',
              color: linerColor, opacity: 0.10,
              textTransform: 'uppercase', pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}>{top.name}</div>
            <img src={window.LINER_IMG[top.id]} alt={top.name}
              style={{ position: 'relative', width: '100%', maxHeight: 200, objectFit: 'contain' }} />
          </div>
        </div>

        {/* Shell stats */}
        {boot.m && (
          <div style={revealStyle(60)}>
            <Section title="Shell" accent={linerColor}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>{boot.b} · {boot.m}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                <Stat l="Last" v={boot.l ? boot.l + 'mm' : '—'} bg={wash} />
                <Stat l="Volume" v={boot.v && boot.v !== 'nan' ? boot.v : '—'} bg={wash} />
                <Stat l="Flex" v={boot.f || '—'} bg={wash} />
              </div>
            </Section>
          </div>
        )}

        {/* Foot profile */}
        {footProfile.length > 0 && (
          <div style={revealStyle(110)}>
            <Section title="Your foot profile" accent={linerColor}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
                {footProfile.map((r) => <Stat key={r.l} l={r.l} v={r.v} bg={wash} />)}
              </div>
            </Section>
          </div>
        )}

        {/* Fit problems — render each picked issue as its own section. */}
        {fitProblems.length > 0 && (
          <div style={revealStyle(160)}>
            {fitProblems.map((fp, i) => (
              <Section key={fp.v} title={`${fp.icon} About your ${fp.l.toLowerCase()}`} accent={linerColor}>
                <p style={{ fontSize: 15, lineHeight: 1.55, color: '#4A4A4A', margin: 0, textWrap: 'pretty' }}>{fp.msg}</p>
              </Section>
            ))}
          </div>
        )}

        {/* Shim / footbed recommendations */}
        {(() => {
          const shims = window.computeShimRecommendation(answers);
          if (!shims.length) return null;
          return (
            <div style={revealStyle(185)}>
              <Section title="Bootfitter accessories" accent={linerColor}>
                <p style={{ fontSize: 13, color: '#7A7670', margin: '0 0 12px', lineHeight: 1.45 }}>
                  Based on your foot profile, your bootfitter should also assess the following:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {shims.map((s) => (
                    <div key={s.type} style={{ background: wash, borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: BLACK, marginBottom: 4 }}>
                        {s.icon} {s.title}
                      </div>
                      <p style={{ fontSize: 13, color: '#4A4A4A', margin: '0 0 6px', lineHeight: 1.5, fontWeight: 500 }}>{s.summary}</p>
                      <p style={{ fontSize: 13, color: '#7A7670', margin: 0, lineHeight: 1.5 }}>{s.detail}</p>
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          );
        })()}

        {/* Liner stats */}
        <div style={revealStyle(210)}>
          <Section title="Liner stats" accent={linerColor}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <Bar l="Performance" pct={top.p * 20} color={linerColor} bg={wash} />
              <Bar l="Warmth" pct={top.w * 20} color={linerColor} bg={wash} />
              <Stat l="Volume" v={top.vol} bg={wash} />
              <Stat l="Fit style" v={fitStyle} bg={wash} />
            </div>
          </Section>
        </div>

        {/* Why */}
        <div style={revealStyle(260)}>
          <Section title="Why this liner for you" accent={linerColor}>
            <p style={{ fontSize: 16, lineHeight: 1.55, color: BLACK, margin: 0, textWrap: 'pretty' }}>{top.why}</p>
          </Section>
        </div>

        {/* Features */}
        <div style={revealStyle(310)}>
          <Section title="Key features" accent={linerColor}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {top.feat.map((f, i) => (
                <span key={i} style={{
                  fontSize: 13, padding: '6px 12px', borderRadius: 999,
                  background: wash, border: `1px solid ${washHair}`, color: BLACK,
                }}>{f}</span>
              ))}
            </div>
          </Section>
        </div>

        {/* Confirmation that we'll send the result to the email captured upfront */}
        {answers.lead && answers.lead.email && (
          <div style={revealStyle(400)}>
            <div style={{
              background: linerColor, color: '#fff',
              borderRadius: 12, padding: '18px 22px',
              position: 'relative', overflow: 'hidden',
            }}>
              <div aria-hidden style={{
                position: 'absolute', right: -40, bottom: -40,
                width: 220, height: 220, borderRadius: '50%',
                background: 'rgba(255,255,255,.08)', pointerEvents: 'none',
              }} />
              <div style={{ ...css.eyebrow, fontSize: 11, color: 'rgba(255,255,255,.7)', fontWeight: 800 }}>
                ✓ Best match on its way
              </div>
              <div style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, textTransform: 'uppercase', fontSize: 26, letterSpacing: '-.014em', lineHeight: 1.05, margin: '8px 0 6px', textWrap: 'balance' }}>
                Thanks{answers.lead.name ? ', ' + answers.lead.name : ''}.
              </div>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,.9)', margin: 0, lineHeight: 1.5, maxWidth: 520 }}>
                We’ll email the <strong style={{ color: '#fff' }}>{top.name}</strong> pairing to <strong style={{ color: '#fff' }}>{answers.lead.email}</strong> so you can refer back to it anytime.
              </p>
            </div>
          </div>
        )}

        <div style={{ marginTop: 18, ...revealStyle(460) }}>
          <a
            href={window.LINER_SHOP_URL[top.id] || '#'}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              width: '100%', boxSizing: 'border-box',
              background: linerColor, borderColor: linerColor,
              color: '#fff', textDecoration: 'none', textAlign: 'center',
              fontFamily: 'Inter, sans-serif', fontWeight: 700,
              fontSize: 15, letterSpacing: '.06em', textTransform: 'uppercase',
              borderRadius: 4, padding: '16px 24px',
              boxShadow: `0 4px 18px ${linerColor}55`,
              transition: 'opacity .15s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '.88'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
            Buy the {top.name}
          </a>
          <a
            href="https://zipfit.com/collections/liners"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              width: '100%', boxSizing: 'border-box', marginTop: 10,
              background: 'transparent', color: BLACK,
              border: `1.5px solid rgba(39,39,39,.22)`,
              textDecoration: 'none', textAlign: 'center',
              fontFamily: 'Inter, sans-serif', fontWeight: 600,
              fontSize: 13, letterSpacing: '.08em', textTransform: 'uppercase',
              borderRadius: 4, padding: '13px 24px',
              transition: 'border-color .15s, background .15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(39,39,39,.05)'; e.currentTarget.style.borderColor = 'rgba(39,39,39,.4)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(39,39,39,.22)'; }}
          >
            Browse All Liners
          </a>
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            {onBack && (
              <button onClick={onBack} style={{ flex: 1, background: 'transparent', color: BLACK, border: `1.5px solid rgba(39,39,39,.18)`, borderRadius: 4, padding: '11px 18px', fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 13, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' }}>← Edit answers</button>
            )}
            <button onClick={onRestart} style={{ flex: 1, background: 'transparent', color: BLACK, border: `1.5px solid rgba(39,39,39,.18)`, borderRadius: 4, padding: '11px 18px', fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 13, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' }}>↻ Retake</button>
          </div>
        </div>
        <p style={{ fontSize: 12, color: '#a8a39d', marginTop: 14, textAlign: 'center', lineHeight: 1.5, ...revealStyle(510) }}>
          A certified ZipFit bootfitter provides the definitive fit.
        </p>
      </div>
    );
  }

  function Section({ title, children, accent }) {
    return (
      <div style={{
        background: '#fff',
        border: '1px solid rgba(39,39,39,.08)',
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 10,
      }}>
        <div style={{ ...css.eyebrow, fontSize: 11, marginBottom: 10, color: accent || css.eyebrow.color, display: 'flex', alignItems: 'center', gap: 8 }}>
          {accent && <span style={{ width: 8, height: 8, borderRadius: 999, background: accent, display: 'inline-block' }} />}
          {title}
        </div>
        {children}
      </div>
    );
  }

  function Stat({ l, v, bg }) {
    return (
      <div style={{ background: bg || WARM, borderRadius: 6, padding: '9px 12px' }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: '#7A7670' }}>{l}</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 3 }}>{v}</div>
      </div>
    );
  }

  function Bar({ l, pct, color, bg }) {
    return (
      <div style={{ background: bg || WARM, borderRadius: 6, padding: '9px 12px' }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: '#7A7670', marginBottom: 7 }}>{l}</div>
        <div style={{ height: 4, background: 'rgba(39,39,39,.08)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: pct + '%', background: color || RAINBOW, borderRadius: 4 }} />
        </div>
      </div>
    );
  }

  // ── LeadCapture ────────────────────────────────────────────────────────────
  // Upfront name + email capture (the first question after intro). In
  // production: pushed to Odoo when the user finishes the quiz so we can
  // associate the lead with their match. Values bubble up via onChange.
  function LeadCapture({ value, onChange }) {
    const lead = value || { name: '', email: '', optIn: true };
    const setField = (patch) => onChange({ ...lead, ...patch });
    const emailValid = !lead.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email.trim());

    return (
      <div>
        <div style={css.eyebrow}>Let’s get started</div>
        <h2 style={{ ...css.h2, marginTop: 10 }}>First, who are we fitting?</h2>
        <p style={css.hint}>
          We’ll email your match so you can refer back to it anytime — and so a ZipFit bootfitter can follow up if you want help dialing in the fit.
        </p>

        <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ ...css.eyebrow, fontSize: 11 }}>First name <em style={{ fontStyle: 'normal', fontWeight: 400, marginLeft: 4, textTransform: 'none', letterSpacing: 0, color: 'rgba(39,39,39,.4)' }}>required</em></span>
            <input
              type="text"
              value={lead.name}
              onChange={(e) => setField({ name: e.target.value })}
              placeholder="Your first name"
              required
              autoFocus
              style={inputStyle(false)}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ ...css.eyebrow, fontSize: 11 }}>Email <em style={{ fontStyle: 'normal', fontWeight: 400, marginLeft: 4, textTransform: 'none', letterSpacing: 0, color: 'rgba(39,39,39,.4)' }}>required</em></span>
            <input
              type="email"
              value={lead.email}
              onChange={(e) => setField({ email: e.target.value })}
              placeholder="your@email.com"
              required
              style={inputStyle(!emailValid)}
            />
            {!emailValid && <span style={{ fontSize: 12, color: '#C73327' }}>That doesn’t look like a valid email.</span>}
          </label>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#4A4A4A', cursor: 'pointer', marginTop: 4, lineHeight: 1.4 }}>
            <input type="checkbox" checked={!!lead.optIn} onChange={(e) => setField({ optIn: e.target.checked })}
              style={{ accentColor: RED, width: 16, height: 16, marginTop: 1, flexShrink: 0, cursor: 'pointer' }} />
            <span>Send me fit tips and the occasional update. Unsubscribe anytime.</span>
          </label>

          <p style={{ fontSize: 11, color: '#a8a39d', margin: '4px 0 0', lineHeight: 1.4 }}>
            By continuing, you agree to our privacy policy. We’ll only use your email to send your fit results and (if you opt in) the occasional update.
          </p>
        </div>
      </div>
    );
  }

  function inputStyle(hasError) {
    return {
      width: '100%', boxSizing: 'border-box',
      padding: '13px 14px',
      background: '#fff',
      border: `1.5px solid ${hasError ? '#C73327' : 'rgba(39,39,39,.16)'}`,
      borderRadius: 8,
      fontFamily: 'Inter, sans-serif', fontSize: 15, color: BLACK,
      outline: 'none',
    };
  }

  window.QuizEditorial = QuizEditorial;
})();
