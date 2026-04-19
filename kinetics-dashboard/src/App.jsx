import { useState, useEffect, useRef, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

// ─── API & CONSTANTS ──────────────────────────────────────────────────────────
const API_URL        = 'http://' + window.location.hostname + ':5000/run-prediction';
const MAX_HISTORY    = 40;
const POLL_INTERVAL  = 1000;
const COORDS_LAT     = 12.824589;
const COORDS_LNG     = 80.046896;
const COORDS         = `${COORDS_LAT}, ${COORDS_LNG}`;
const MAPS_EMBED_URL = `https://maps.google.com/maps?q=${COORDS_LAT},${COORDS_LNG}&z=15&output=embed`;
const MAPS_OPEN_URL  = `https://www.google.com/maps?q=${COORDS_LAT},${COORDS_LNG}`;
const SRM_MAPS_URL   = 'https://www.google.com/maps/place/SRM+Global+Hospitals/@12.82617,80.0414635,17z';
const NEARBY_HOSPITALS = [
  { name: 'SRM Global Hospitals',           dist: '1.2 km', alerted: true,  mapsUrl: SRM_MAPS_URL },
  { name: 'K.R Hospital',                   dist: '3.0 km', alerted: false, mapsUrl: MAPS_OPEN_URL },
  { name: 'Deepam Multispeciality Hospitals', dist: '3.8 km', alerted: false, mapsUrl: MAPS_OPEN_URL },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function getStability(gForce, isFall) {
  if (isFall)       return 8;
  if (gForce >= 15) return 10;
  if (gForce >= 6)  return Math.max(20, Math.round(40 - (gForce - 6) * 2));
  if (gForce >= 3)  return Math.max(50, Math.round(100 - (gForce - 3) * 17));
  return 100;
}
function getCategory(isFall, gForce, bpm, o2) {
  if (isFall)                   return 'critical';
  if (bpm > 100 || o2 < 90)     return 'clinical';
  if (gForce >= 3 && gForce < 15) return 'stumble';
  return 'normal';
}
function buildMessage(isFall, gForce, bpm, o2, name = 'Patient') {
  if (isFall)
    return `[MODE C | EMERGENCY RESCUE] AMBULANCE DISPATCHED. ETA 6 mins. Hospital Crash-Sheet generated for Level 1 Trauma Center.`;
  if (bpm > 100 || o2 < 90)
    return `[MODE B | CLINICAL INTERVENTION] Direct Tele-Health Link to Dr. Alistair Vance (Geriatric Lead). Sending diagnostic telemetry package...`;
  if (gForce >= 3 && gForce < 15)
    return `[MODE A | WELFARE CHECK] SMS Sent to Neighbor: Sarah Jenkins (Unit 4C). Message: "Arthur had a minor trip. Please check in."`;
  return `[STATUS] Normal gait signature. Vitals within baseline. Patient ${name} is safe.`;
}
const nowLabel = () => new Date().toLocaleTimeString('en-IN', { hour12: false });
const nowFull  = () => new Date().toLocaleString('en-IN', { weekday: 'short', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

// ─── REGISTRATION PAGE ────────────────────────────────────────────────────────
const DEFAULT_FORM = {
  name: 'Arthur Pendelton', age: '78', bloodType: 'O-Negative',
  allergies: 'Penicillin', meds: 'Warfarin (Blood Thinner) · 5mg daily',
  ward: 'Geriatric Care Unit · Bed 4B', emergency: 'Pendelton Family · +91 98400 12345',
};

function RegistrationPage({ onSubmit }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const submit = e => { e.preventDefault(); setBusy(true); setTimeout(onSubmit, 1200); };
  return (
    <div className="reg-shell">
      <div className="reg-brand">
        <div className="reg-brand-inner">
          <div className="reg-logo">K2</div>
          <h1 className="reg-brand-title">KINETICS</h1>
          <p className="reg-brand-sub">AEGIS Patient Safety Platform</p>
          <p className="reg-brand-desc">Intelligent fall detection &amp; real-time biometric monitoring powered by Body Area Network technology.</p>
          <div className="reg-steps">
            {['Personal Info','Medical Profile','Confirm & Activate'].map((s,i) => (
              <div key={i} className={`reg-step-item${step===i+1?' active':''}${step>i+1?' done':''}`}>
                <div className="reg-step-dot">{step > i+1 ? '✓' : i+1}</div><span>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="reg-form-panel">
        <form className="reg-form" onSubmit={submit}>
          {step === 1 && <>
            <div className="reg-form-header"><h2>Personal Information</h2><p>Enter the patient's basic identification details.</p></div>
            <div className="reg-field"><label>Full Name</label><input value={form.name} onChange={set('name')} required /></div>
            <div className="reg-row">
              <div className="reg-field"><label>Age</label><input value={form.age} onChange={set('age')} type="number" required /></div>
              <div className="reg-field"><label>Ward / Bed</label><input value={form.ward} onChange={set('ward')} /></div>
            </div>
            <div className="reg-field"><label>Emergency Contact</label><input value={form.emergency} onChange={set('emergency')} /></div>
            <button type="button" className="reg-btn" onClick={() => setStep(2)}>Continue →</button>
          </>}
          {step === 2 && <>
            <div className="reg-form-header"><h2>Medical Profile</h2><p>This data is used to alert responders during emergencies.</p></div>
            <div className="reg-field">
              <label>Blood Type</label>
              <select value={form.bloodType} onChange={set('bloodType')} required>
                {['A-Positive','A-Negative','B-Positive','B-Negative','O-Positive','O-Negative','AB-Positive','AB-Negative'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="reg-field"><label>Known Allergies</label><input value={form.allergies} onChange={set('allergies')} /></div>
            <div className="reg-field"><label>Current Medications</label><textarea value={form.meds} onChange={set('meds')} rows={3} /></div>
            <div className="reg-btn-row">
              <button type="button" className="reg-btn reg-btn--ghost" onClick={() => setStep(1)}>← Back</button>
              <button type="button" className="reg-btn" onClick={() => setStep(3)}>Continue →</button>
            </div>
          </>}
          {step === 3 && <>
            <div className="reg-form-header"><h2>Confirm &amp; Activate</h2><p>Review your details before activating AEGIS monitoring.</p></div>
            <div className="reg-confirm-card">
              <div className="reg-confirm-avatar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
              <div className="reg-confirm-rows">
                {[['Name',`${form.name}, ${form.age} yrs`],['Ward',form.ward],['Blood Type',form.bloodType],['Allergies',form.allergies],['Medications',form.meds],['Emergency',form.emergency]].map(([k,v])=>(
                  <div className="reg-confirm-row" key={k}><span>{k}</span><strong>{v}</strong></div>
                ))}
              </div>
            </div>
            <div className="reg-btn-row">
              <button type="button" className="reg-btn reg-btn--ghost" onClick={() => setStep(2)}>← Back</button>
              <button type="submit" className={`reg-btn reg-btn--activate${busy?' loading':''}`} disabled={busy}>
                {busy ? 'Activating…' : '🛡️  Begin Monitoring'}
              </button>
            </div>
          </>}
        </form>
      </div>
    </div>
  );
}

// ─── DHARMIC PRESCRIPTION DATA & PAGE ─────────────────────────────────────────
const INTERVENTIONS = {
  impact: {
    condition: 'Physical Impact / Low Stability',
    temple: 'Ekambaranathar Temple',
    location: 'Kanchipuram, Tamil Nadu 631502',
    element: 'Prithvi Stalam (The Earth Element)',
    mapsUrl: 'https://www.google.com/maps/dir/12.8245307,80.0468283/Ekambaranathar+Temple,+Ekambaranathar+koil,+Kanchipuram,+Tamil+Nadu+631502/@12.8158106,79.6939365,10.53z/data=!4m10!4m9!1m1!4e1!1m5!1m1!1s0x3a52c24dddba4d99:0x8d90cb4d6f5a505!2m2!1d79.7003182!2d12.8458536!3e0?entry=ttu&g_ep=EgoyMDI2MDQxNS4wIKXMDSoASAFQAw%3D%3D',
    embedUrl: 'https://maps.google.com/maps?q=Ekambaranathar+Temple,+Kanchipuram&output=embed',
    yoga: 'Tadasana (Mountain Pose)',
    yogaDesc: 'Tadasana focuses on grounding your body into the earth. By establishing a firm foundation through the feet, it promotes physical stability, improves posture, and strengthens the joints and skeletal structure.',
    caregiver: 'Physical instability detected. Suggesting grounding Darshan at the Prithvi Stalam in Kanchipuram to restore the Earth element within the body.'
  },
  cardiac: {
    condition: 'Cardiac Stress (High BPM)',
    temple: 'Hrudayaaleeswarar Temple',
    location: 'Thiruninravur, Tamil Nadu 602024',
    element: 'The Heart Sanctuary',
    mapsUrl: 'https://www.google.com/maps/dir/12.8245307,80.0468283/Hrudayaaleeswarar+Temple,+426H%2BQ4J,+Thiruninravur,+Tamil+Nadu+602024/@13.1119729,80.0228928,17z/data=!4m18!1m7!3m6!1s0x3a528923ce0a2b47:0xb6dfeff052618423!2sHrudayaaleeswarar+Temple!8m2!3d13.1119729!4d80.0277637!16s%2Fm%2F04gsh8n!4m9!1m1!4e1!1m5!1m1!1s0x3a528923ce0a2b47:0xb6dfeff052618423!2m2!1d80.0277686!2d13.111973!3e0?entry=ttu&g_ep=EgoyMDI2MDQxNS4wIKXMDSoASAFQAw%3D%3D',
    embedUrl: 'https://maps.google.com/maps?q=Hrudayaaleeswarar+Temple,+Thiruninravur&output=embed',
    yoga: "Balasana (Child's Pose)",
    yogaDesc: 'Balasana gently rests the heart and reduces cardiac strain. Coupled with heart-center meditation, it calms the nervous system and lowers erratic heartbeats, providing profound physiological rest.',
    caregiver: 'Heart stress detected. Organize a trip to Thiruninravur for spiritual heart-calming. Do not alarm the patient.'
  },
  respiratory: {
    condition: 'Respiratory Stress (Low SpO2)',
    temple: 'Srikalahasti Temple',
    location: 'Srikalahasti, Andhra Pradesh 517644',
    element: 'Vayu Stalam (The Air Element)',
    mapsUrl: 'https://www.google.com/maps/dir/12.8245307,80.0468283/Srikalahasti+Temple,+Srikalahasti,+Andhra+Pradesh+517644/@13.2847793,79.6239952,10z/data=!3m1!4b1!4m10!4m9!1m1!4e1!1m5!1m1!1s0x3a4d3e54318a70e9:0x706957a2638f13c1!2m2!1d79.698532!2d13.7497357!3e0?entry=ttu&g_ep=EgoyMDI2MDQxNS4wIKXMDSoASAFQAw%3D%3D',
    embedUrl: 'https://maps.google.com/maps?q=Srikalahasti+Temple&output=embed',
    yoga: 'Nadi Shodhana Pranayama (Alternate Nostril Breathing)',
    yogaDesc: 'This ancient breathwork technique clears the nadis (energy channels) and maximizes oxygen absorption into the bloodstream. It balances the two hemispheres of the brain and harmonizes the Vayu (air) element.',
    caregiver: 'Patient is experiencing Vayu imbalance. Suggest a visit to Kalahasti for Vayu-Shanti.'
  },
  fatigue: {
    condition: 'Chronic Fatigue / Illness',
    temple: 'Vaitheeswarankoil',
    location: 'Sirkazhi, Tamil Nadu 609117',
    element: 'The Shrine of the Divine Physician',
    mapsUrl: 'https://www.google.com/maps/place/Vaitheeswarankoil,+Tamil+Nadu+609117/@11.1949349,79.6899127,14z/data=!3m1!4b1!4m6!3m5!1s0x3a54dfba5310d7ad:0xc8411c41ced29f63!8m2!3d11.1949358!4d79.7105123!16zL20vMGY2bGpm?entry=ttu&g_ep=EgoyMDI2MDQxNS4wIKXMDSoASAFQAw%3D%3D',
    embedUrl: 'https://maps.google.com/maps?q=Vaitheeswaran+Koil&output=embed',
    yoga: 'Shavasana for restoration',
    yogaDesc: "Shavasana induces a state of deep yogic rest that allows the body's innate healing mechanisms (Ojas) to repair cellular damage. It resets the adrenal glands and combats chronic fatigue.",
    caregiver: 'Overall vitality (Ojas) is low. A visit to the Divine Physician at Vaitheeswaran Koil is recommended.'
  }
};

function DharmicPage({ interventionKey, onBack }) {
  const data = INTERVENTIONS[interventionKey];
  if (!data) return null;

  return (
    <div className="dharmic-page-wrap">
      <div className="dharmic-nav">
        <button className="em-btn-cancel" onClick={onBack} style={{ margin: 0, padding: '8px 16px', fontSize: '12px' }}>
          ← Return to Vitals Dashboard
        </button>
        <div className="dharmic-brand">AEGIS | SACRED INTERVENTION MODULE</div>
      </div>
      
      <div className="dharmic-hero">
        <div className="dharmic-hero-tag">PHYSIOLOGICAL SHIFT DETECTED</div>
        <h1 className="dharmic-hero-title">{data.condition}</h1>
      </div>

      <div className="dharmic-grid-layout">
        <div className="dharmic-card">
          <h2 className="dharmic-card-title">Sacred Destination</h2>
          <div className="dharmic-temple-name">{data.temple}</div>
          <div className="dharmic-temple-element">{data.element}</div>
          <div className="dharmic-temple-loc">📍 {data.location}</div>
          <div className="dharmic-map-wrap">
            <iframe 
              src={data.embedUrl} 
              width="100%" 
              height="200" 
              style={{ border: 0, borderRadius: '8px', filter: 'invert(90%) hue-rotate(180deg)' }} 
              allowFullScreen="" 
              loading="lazy"
            />
          </div>
          <a href={data.mapsUrl} target="_blank" rel="noreferrer" className="dharmic-btn">
            Open Route in Google Maps ↗
          </a>
        </div>

        <div className="dharmic-side">
          <div className="dharmic-card">
            <h2 className="dharmic-card-title">Pranayama & Asana</h2>
            <div className="dharmic-yoga-name">🧘‍♀️ {data.yoga}</div>
            <p className="dharmic-yoga-desc">{data.yogaDesc}</p>
          </div>

          <div className="dharmic-card dharmic-card--caregiver">
            <h2 className="dharmic-card-title" style={{color: '#ffd93d'}}>Caregiver 'Silent Sewa' Alert</h2>
            <p className="dharmic-caregiver-text">
              Aegis has identified a spiritual root for this physiological shift. To maintain the patient's Shanti (peace), do not trigger an alarm. Instead, invite them for a peaceful pilgrimage to the suggested destination.
              <br/><br/>
              <strong>Action:</strong> {data.caregiver}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InterventionAlert({ isFall, gForce, bpm, o2, onView }) {
  let key = null;
  if (isFall || gForce >= 3) key = 'impact';
  else if (bpm > 100) key = 'cardiac';
  else if (o2 > 0 && o2 < 90) key = 'respiratory';
  else if (bpm > 0 || o2 > 0 || gForce > 0) key = 'fatigue';

  if (!key) return null;

  return (
    <div className="sewa-alert" onClick={() => onView(key)}>
      <div className="sewa-alert-icon">🪔</div>
      <div className="sewa-alert-text">
        <div className="sewa-alert-title">Sattva AI Insights</div>
        <div className="sewa-alert-sub">Aegis has prepared a holistic intervention for the detected shift. Click to view.</div>
      </div>
      <div className="sewa-alert-arrow">→</div>
    </div>
  );
}

// ─── COMMAND CENTER ───────────────────────────────────────────────────────────
function CommandCenter({ time, isFall }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-logo">K2</div>
        <div>
          <div className="topbar-title">KINETICS | Agentic Safety Suite</div>
          <div className="topbar-sub">AEGIS Body Area Network · Real-Time Intelligence</div>
        </div>
      </div>
      <div className="topbar-right">
        {isFall && <div className="topbar-emergency-badge">🚨 FALL DETECTED</div>}
        <div className="topbar-badge">
          <span className="pulse-dot" /><span className="topbar-badge-text">SYSTEM ARMED &amp; ENCRYPTED</span>
        </div>
        <div className="topbar-time">{time}</div>
      </div>
    </header>
  );
}

// ─── AI AGENT REASONING ───────────────────────────────────────────────────────
function AgentReasoning({ isFall, gForce, bpm, o2, patient, onViewDharmic }) {
  const [typed, setTyped]   = useState('');
  const [history, setHist]  = useState([{ time: nowLabel(), text: '[BOOT] AEGIS system initialised. Awaiting sensor handshake…', cat: 'normal' }]);
  const timerRef   = useRef(null);
  const prevCatRef = useRef('boot');
  const bottomRef  = useRef(null);
  const name       = patient?.name || 'Patient';
  const cat        = getCategory(isFall, gForce, bpm, o2);
  const fullMsg    = buildMessage(isFall, gForce, bpm, o2, name);

  useEffect(() => {
    if (cat === prevCatRef.current) return;
    prevCatRef.current = cat;
    setHist(p => [...p.slice(-24), { time: nowLabel(), text: fullMsg, cat }]);
    if (timerRef.current) clearInterval(timerRef.current);
    setTyped('');
    let i = 0;
    timerRef.current = setInterval(() => {
      i++;
      setTyped(fullMsg.slice(0, i));
      if (i >= fullMsg.length) clearInterval(timerRef.current);
    }, 24);
    return () => clearInterval(timerRef.current);
  }, [cat, fullMsg]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [history]);

  const catColor = { critical: '#e88fa3', clinical: '#AFCBE3', stumble: '#ffd93d', normal: '#7FAF9C' };

  return (
    <aside className="agent-panel">
      <div className="agent-header">
        <div className="agent-header-left">
          <span className={`agent-dot agent-dot--${cat}`} />
          <span className="agent-title">AI AGENT REASONING</span>
        </div>
        <span className="agent-ver">AEGIS v2.0</span>
      </div>

      <div className={`agent-live agent-live--${cat}`}>
        <div className="agent-prompt">▶ REASONING ENGINE</div>
        <div className="agent-typed" style={{ color: catColor[cat] ?? '#7FAF9C' }}>
          {typed}<span className="blink-cursor">█</span>
        </div>
      </div>

      <div className="agent-log-header">SESSION LOG</div>
      <div className="agent-log">
        {history.map((l, i) => (
          <div key={i} className={`agent-entry agent-entry--${l.cat}`}>
            <span className="agent-ts">{l.time}</span>
            <span className="agent-msg">{l.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </aside>
  );
}

// ─── CIRCULAR GAUGE ───────────────────────────────────────────────────────────
function CircularGauge({ value, size = 110, stroke = 9 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.max(0, Math.min(100, value)) / 100);
  const color  = value > 70 ? '#7FAF9C' : value > 40 ? '#ffd93d' : '#e88fa3';
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.9s ease, stroke 0.5s ease' }} />
      </svg>
      <div className="gauge-center">
        <span className="gauge-val" style={{ color }}>{value}<span className="gauge-unit">%</span></span>
        <span className="gauge-lbl">STABILITY</span>
      </div>
    </div>
  );
}

// ─── VITALS CARDS ─────────────────────────────────────────────────────────────
function HeartRateCard({ bpm, o2, beat }) {
  return (
    <div className="vcard">
      <div className="vcard-label">BIOMETRIC HEARTBEAT</div>
      <div className="vcard-row">
        <span className={`heart-icon${beat ? ' beat' : ''}`}>❤️</span>
        <span className="vcard-val vcard-val--bpm">{bpm || '—'}</span>
        <span className="vcard-unit">BPM</span>
      </div>
      <div className="vcard-sub">SpO₂ <strong>{o2 || '—'}%</strong></div>
      <div className={`vcard-status ${bpm > 100 ? 'warn' : bpm > 0 ? 'ok' : 'idle'}`}>
        {bpm > 100 ? '⚠ Elevated' : bpm > 0 ? '✓ Normal Range' : '· Awaiting signal'}
      </div>
    </div>
  );
}

function StabilityCard({ stability }) {
  return (
    <div className="vcard vcard--stability">
      <div className="vcard-label">GAIT STABILITY INDEX</div>
      <div className="vcard-gauge-wrap">
        <CircularGauge value={stability} />
      </div>
      <div className={`vcard-status ${stability > 70 ? 'ok' : stability > 40 ? 'warn' : 'critical'}`}>
        {stability > 70 ? '✓ Stable' : stability > 40 ? '⚠ Unstable' : '🚨 Critical'}
      </div>
    </div>
  );
}

function GForceCard({ gForce, peak }) {
  const g = parseFloat(gForce) || 0;
  return (
    <div className="vcard">
      <div className="vcard-label">LIVE KINETIC LOAD</div>
      <div className="vcard-row">
        <span className="vcard-val vcard-val--gforce">{g.toFixed(2)}</span>
        <span className="vcard-unit">G</span>
      </div>
      <div className="vcard-peak">PEAK &nbsp;<strong>{peak.toFixed(2)} G</strong></div>
      <div className={`vcard-bar-wrap`}>
        <div className="vcard-bar" style={{ width: `${Math.min(100, (g / 20) * 100)}%`, background: g > 15 ? '#e88fa3' : g > 6 ? '#ffd93d' : '#7FAF9C' }} />
      </div>
    </div>
  );
}

// ─── KINETIC CHART ────────────────────────────────────────────────────────────
const ChartTip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div>{payload[0]?.payload?.t}</div>
      <div style={{ color: '#AFCBE3' }}>G-Force: {payload[0]?.payload?.g?.toFixed(2)} G</div>
      <div style={{ color: '#e88fa3' }}>Heart Rate: {payload[0]?.payload?.bpm} BPM</div>
      <div style={{ color: '#7FAF9C' }}>SpO₂: {payload[0]?.payload?.o2}%</div>
    </div>
  );
};

function KineticChart({ history }) {
  return (
    <main className="chart-panel">
      <div className="chart-panel-header">
        <span className="chart-title">TELEMETRY: GAIT &amp; VITALS</span>
        <span className="chart-tag">Live · Last {MAX_HISTORY} samples</span>
      </div>
      <div className="chart-area">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={history} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="gf" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#AFCBE3" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#AFCBE3" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="bpmf" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#e88fa3" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#e88fa3" stopOpacity={0.01} />
              </linearGradient>
              <linearGradient id="o2f" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#7FAF9C" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#7FAF9C" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="4 4" />
            <XAxis dataKey="t" tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 10 }} tickLine={false} axisLine={false} interval={4} />
            <YAxis yAxisId="left" tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 10 }} tickLine={false} axisLine={false} domain={[0, 20]} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 10 }} tickLine={false} axisLine={false} domain={[0, 150]} />
            
            <Tooltip content={<ChartTip />} />
            <ReferenceLine yAxisId="left" y={15} stroke="#e88fa3" strokeDasharray="5 3" strokeOpacity={0.5} label={{ value: 'FALL', fill: '#e88fa3', fontSize: 9, position: 'insideTopLeft' }} />
            <ReferenceLine yAxisId="left" y={3}  stroke="#ffd93d" strokeDasharray="5 3" strokeOpacity={0.4} label={{ value: 'STUMBLE', fill: '#ffd93d', fontSize: 9, position: 'insideTopLeft' }} />
            
            <Area yAxisId="left" type="monotone" dataKey="g" stroke="#AFCBE3" strokeWidth={2} fill="url(#gf)" dot={false} isAnimationActive={false} />
            <Area yAxisId="right" type="monotone" dataKey="bpm" stroke="#e88fa3" strokeWidth={1.5} fill="url(#bpmf)" dot={false} isAnimationActive={false} />
            <Area yAxisId="right" type="monotone" dataKey="o2" stroke="#7FAF9C" strokeWidth={1.5} fill="url(#o2f)" dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </main>
  );
}

// ─── PATIENT STRIP ────────────────────────────────────────────────────────────
function PatientStrip({ patient }) {
  if (!patient) return null;
  const { name, age, bloodType, allergies = [], medications = [], id, ward } = patient;
  return (
    <div className="patient-strip">
      <div className="ps-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
        </svg>
      </div>
      <div className="ps-name">{name}<span className="ps-age">, {age}</span></div>
      <div className="ps-id">{id}</div>
      <div className="ps-divider"/>
      <div className="ps-pills">
        {bloodType && <span className="ps-pill ps-pill--blood">{bloodType}</span>}
        {allergies.map((a,i) => <span key={i} className="ps-pill ps-pill--allergy">⚠ {a}</span>)}
        {medications.map((m,i) => <span key={i} className="ps-pill ps-pill--med">Rx {m.name}</span>)}
        <span className="ps-pill ps-pill--ward">{ward}</span>
      </div>
    </div>
  );
}

// ─── EMERGENCY OVERLAY ────────────────────────────────────────────────────────
function EmergencyOverlay({ onDismiss }) {
  return (
    <div className="em-overlay" role="alertdialog" aria-modal="true">
      <div className="em-panel">
        <span className="em-icon">🚨</span>
        <div className="em-event-lbl">Critical Event Detected</div>
        <div className="em-title">FALL DETECTED</div>

        <div style={{ borderRadius: 10, overflow: 'hidden', margin: '12px 0 8px', border: '2px solid rgba(255,255,255,0.4)' }}>
          <iframe title="Fall Location Map" src={MAPS_EMBED_URL} width="100%" height="190"
            style={{ border: 0, display: 'block' }} allowFullScreen loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div className="em-coords" style={{ flex: 1, margin: 0 }}>📍 {COORDS}</div>
          <a href={MAPS_OPEN_URL} target="_blank" rel="noopener noreferrer" className="em-maps-btn">🗺️ Open Maps</a>
        </div>

        <hr className="em-divider" />

        <div className="em-hosp-title">Nearby Medical Facilities</div>
        <div className="em-hosp-list">
          {NEARBY_HOSPITALS.map((h, i) => (
            <a key={i} href={h.mapsUrl} target="_blank" rel="noopener noreferrer" className="em-hosp-item"
              style={{ background: h.alerted ? 'rgba(107,31,31,0.18)' : 'rgba(255,255,255,0.22)', border: h.alerted ? '1.5px solid rgba(107,31,31,0.4)' : '1px solid rgba(255,255,255,0.28)' }}>
              <span>🏥</span>
              <div style={{ flex: 1 }}>
                <div className="em-hosp-name">{h.name}</div>
                <div className="em-hosp-dist">{h.dist} away</div>
              </div>
              {h.alerted && <span className="em-alerted-badge">✓ Alerted</span>}
            </a>
          ))}
        </div>

        <button className="em-btn-cancel" onClick={onDismiss}>✕ Cancel False Alarm</button>
      </div>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage]         = useState('register');
  const [dharmicKey, setDharmicKey] = useState(null);
  const [vitals, setVitals]     = useState({ gForce: 0, bpm: 0, o2: 0, isFall: false, event: 'BOOT', agent_reasoning: '', patient: null });
  const [history, setHistory]   = useState([]);
  const [beat, setBeat]         = useState(false);
  const [clock, setClock]       = useState(nowFull());
  const [alarmActive, setAlarmActive] = useState(false);
  const fallSeenRef             = useRef(false);
  const [peak, setPeak]         = useState(0);

  // Clock
  useEffect(() => { const id = setInterval(() => setClock(nowFull()), 1000); return () => clearInterval(id); }, []);

  // Heartbeat animation
  useEffect(() => {
    if (!vitals.bpm) return;
    const delay = 60000 / (vitals.bpm || 70);
    const id = setInterval(() => { setBeat(true); setTimeout(() => setBeat(false), 300); }, delay);
    return () => clearInterval(id);
  }, [vitals.bpm]);

  // Poll backend
  const fetchVitals = useCallback(async () => {
    try {
      const res  = await fetch(API_URL);
      const data = await res.json();
      setVitals(data);
      const g = parseFloat(data.gForce) || 0;
      setPeak(p => Math.max(p, g));
      setHistory(prev => {
        const entry = { t: nowLabel(), g, bpm: data.bpm || 0, o2: data.o2 || 0 };
        return [...prev.slice(-(MAX_HISTORY - 1)), entry];
      });
      
      if (data.isFall && !fallSeenRef.current) {
        setAlarmActive(true);
        fallSeenRef.current = true;
      } else if (!data.isFall) {
        fallSeenRef.current = false;
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchVitals();
    const id = setInterval(fetchVitals, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchVitals]);

  if (page === 'register') return <RegistrationPage onSubmit={() => setPage('dashboard')} />;
  if (page === 'dharmic') return <DharmicPage interventionKey={dharmicKey} onBack={() => setPage('dashboard')} />;

  const stability  = getStability(vitals.gForce, vitals.isFall);
  const showOverlay = alarmActive;

  return (
    <div className={`app-shell${vitals.isFall || alarmActive ? ' app-shell--emergency' : ''}`}>
      {showOverlay && <EmergencyOverlay onDismiss={() => setAlarmActive(false)} />}

      <CommandCenter time={clock} isFall={vitals.isFall} />
      <PatientStrip patient={vitals.patient} />

      <div style={{ padding: '0 20px', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
        <InterventionAlert isFall={vitals.isFall} gForce={vitals.gForce} bpm={vitals.bpm} o2={vitals.o2} onView={(k) => { setDharmicKey(k); setPage('dharmic'); }} />
      </div>

      <div className="main-grid">
        <AgentReasoning isFall={vitals.isFall} gForce={vitals.gForce} bpm={vitals.bpm} o2={vitals.o2} patient={vitals.patient} onViewDharmic={(k) => { setDharmicKey(k); setPage('dharmic'); }} />
        <KineticChart history={history} />
        <div className="vitals-col">
          <HeartRateCard bpm={vitals.bpm} o2={vitals.o2} beat={beat} />
          <StabilityCard stability={stability} />
          <GForceCard gForce={vitals.gForce} peak={peak} />
        </div>
      </div>
    </div>
  );
}
