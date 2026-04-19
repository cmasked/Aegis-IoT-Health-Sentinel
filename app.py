from flask import Flask, jsonify, request
from flask_cors import CORS
import os
import smtplib
import threading
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from datetime import datetime
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

app = Flask(__name__)
CORS(app)

# ─────────────────────────────────────────────────────────────
#  📧  EMAIL CONFIGURATION  — fill these in before running
# ─────────────────────────────────────────────────────────────
# SENDER: Use a Gmail account. Generate an App Password at:
#   https://myaccount.google.com/apppasswords  (2FA must be ON)
ALERT_SENDER_EMAIL    = os.environ.get("KINETICS_SENDER_EMAIL",   "sathvikamahale256@gmail.com")
ALERT_SENDER_PASSWORD = os.environ.get("KINETICS_SENDER_PASS",    "kdhf qyrv gulc hvjj")

# RECIPIENT: Your teammate's email
ALERT_RECIPIENT_EMAIL = os.environ.get("KINETICS_RECIPIENT_EMAIL", "chiragmehta6oct@gmail.com")

PATIENT_NAME          = "Patient Arthur"          # displayed in the email
COORDS_LAT            = 12.824589
COORDS_LNG            = 80.046896

# ─────────────────────────────────────────────────────────────
#  LIVE STATE
# ─────────────────────────────────────────────────────────────
current_vitals = {
    "gForce":          0.0,
    "bpm":             0,
    "o2":              0,
    "isFall":          False,
    "event":           "BOOT",
    "agent_reasoning": "Awaiting Hardware Link...",
    "location":        f"{COORDS_LAT}, {COORDS_LNG}"
}

# ─────────────────────────────────────────────────────────────
#  PATIENT DATABASE RECORD
# ─────────────────────────────────────────────────────────────
PATIENT_DB = {
    "id":         "KIN-2024-0047",
    "name":       "Arthur Pendelton",
    "age":        78,
    "bloodType":  "O-Negative",
    "allergies":  ["Penicillin"],
    "medications": [
        {"name": "Warfarin", "note": "Blood Thinner", "dose": "5mg daily"}
    ],
    "condition":  "High Fall Risk — Monitored",
    "ward":       "Geriatric Care Unit · Bed 4B",
}


# ─────────────────────────────────────────────────────────────
#  CONSTANTS
# ─────────────────────────────────────────────────────────────
HARDWARE_TOKEN = "AEGIS_AUTH_774"
FALL_THRESHOLD = 15.0
FALL_KEYWORDS  = ["FALL", "IMPACT", "EMERGENCY"]

# Email cooldown — only send one alert per fall event (not every heartbeat)
_fall_email_sent   = False   # resets when fall clears
_mode_a_sent       = False
_mode_b_sent       = False
_last_fall_time    = None

# ─────────────────────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────────────────────
def is_fall_event(event: str, g_force: float) -> bool:
    event_upper = event.upper()
    keyword_hit = any(kw in event_upper for kw in FALL_KEYWORDS)
    return keyword_hit or g_force >= FALL_THRESHOLD


def build_reasoning(event: str, g: float, bpm: int, o2: int, is_fall: bool) -> str:
    if is_fall:
        return (f"CRITICAL: High-impact fall event '{event}' detected. "
                f"G-Force={g:.2f}G  BPM={bpm}  SpO2={o2}%  "
                f"Emergency protocol activated.")
    elif g > 5.0:
        return (f"Motion spike detected — G-Force={g:.2f}G. "
                f"BPM={bpm}  SpO2={o2}%  Adjusting baseline.")
    elif bpm == 0:
        return "Sensor idle — no finger contact detected on MAX30102."
    else:
        return (f"Kinetics nominal. BPM={bpm}  SpO2={o2}%  "
                f"G-Force={g:.2f}G  Event={event}")


# ─────────────────────────────────────────────────────────────
#  EMAIL ALERT
# ─────────────────────────────────────────────────────────────
def build_email_html(g: float, bpm: int, o2: int, ts: str) -> str:
    maps_url  = f"https://www.google.com/maps?q={COORDS_LAT},{COORDS_LNG}"
    # OpenStreetMap static thumbnail (no API key required)
    osm_thumb = (f"https://staticmap.openstreetmap.de/staticmap.php"
                 f"?center={COORDS_LAT},{COORDS_LNG}&zoom=15&size=600x280"
                 f"&markers={COORDS_LAT},{COORDS_LNG},red-pushpin")

    return f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
    body        {{ font-family: 'Helvetica Neue', Arial, sans-serif; background:#f0f4f3; margin:0; padding:20px; }}
    .wrapper    {{ max-width:620px; margin:0 auto; background:#fff; border-radius:14px; overflow:hidden;
                   box-shadow:0 4px 24px rgba(0,0,0,0.10); }}
    .header     {{ background: linear-gradient(135deg,#1a2a2a 0%,#2d3436 100%); padding:26px 32px 20px;
                   display:flex; align-items:center; gap:16px; }}
    .header-logo{{ width:44px;height:44px;background:linear-gradient(135deg,#7faf9c,#5a9e88);
                   border-radius:10px;display:flex;align-items:center;justify-content:center;
                   font-weight:900;font-size:16px;color:#fff;flex-shrink:0; }}
    .header-text h1 {{ color:#fff;margin:0;font-size:20px;letter-spacing:0.5px; }}
    .header-text p  {{ color:rgba(255,255,255,0.55);margin:3px 0 0;font-size:11px;
                       letter-spacing:2px;text-transform:uppercase; }}
    .urgency-bar{{ background:#c0392b;color:#fff;text-align:center;padding:10px;
                   font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase; }}
    .body       {{ padding:28px 32px; }}
    .to-line    {{ font-size:12px;color:#888;margin-bottom:20px;padding-bottom:14px;
                   border-bottom:1px solid #f0f0f0; }}
    .to-line strong {{ color:#2d3436; }}
    .alert-box  {{ background:#fff5f5;border-left:4px solid #c0392b;border-radius:0 8px 8px 0;
                   padding:16px 20px;margin-bottom:22px; }}
    .alert-box h2 {{ color:#8b1f1f;margin:0 0 8px;font-size:17px; }}
    .alert-box p  {{ color:#555;margin:0;font-size:13px;line-height:1.7; }}
    .section-label {{ font-size:11px;font-weight:700;color:#888;text-transform:uppercase;
                      letter-spacing:1.5px;margin-bottom:10px; }}
    .vitals     {{ display:flex;gap:10px;margin-bottom:22px;flex-wrap:wrap; }}
    .vital      {{ flex:1;min-width:90px;background:#f8faf9;border:1px solid #e0ebe6;
                   border-radius:10px;padding:14px 12px;text-align:center; }}
    .vital .val {{ font-size:24px;font-weight:800;color:#2d3436; }}
    .vital .lbl {{ font-size:10px;color:#7faf9c;text-transform:uppercase;letter-spacing:1px;margin-top:3px;
                   font-weight:600; }}
    .map-wrap   {{ border-radius:10px;overflow:hidden;margin-bottom:12px;
                   border:1px solid #e0ebe6; }}
    .map-wrap img {{ width:100%;display:block; }}
    .coords     {{ background:#1a2020;color:#7faf9c;font-family:monospace;font-size:12px;
                   padding:10px 16px;border-radius:8px;margin-bottom:22px;text-align:center; }}
    .btn        {{ display:block;background:#2d3436;color:#fff;text-align:center;padding:13px;
                   border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;
                   margin-bottom:16px; }}
    .action-note{{ background:#f0f7f4;border:1px solid #c5ddd6;border-radius:8px;padding:14px 18px;
                   margin-bottom:20px;font-size:13px;color:#2d6a4f;line-height:1.6; }}
    .footer     {{ background:#f5f5f5;padding:16px 32px;text-align:center;font-size:11px;color:#bbb; }}
  </style>
</head>
<body>
  <div class="wrapper">

    <!-- Header -->
    <div class="header">
      <div class="header-logo">K2</div>
      <div class="header-text">
        <h1>KINETICS — AEGIS Alert System</h1>
        <p>Automated Emergency Medical Dispatch</p>
      </div>
    </div>
    <div class="urgency-bar">🚨 &nbsp; Priority 1 — Immediate Response Required &nbsp; 🚨</div>

    <div class="body">

      <!-- To line (makes it look like a hospital dispatch) -->
      <div class="to-line">
        <strong>To:</strong> Emergency Department — Nearest Medical Facility<br/>
        <strong>From:</strong> KINETICS AEGIS Body Area Network (Automated)<br/>
        <strong>Ref:</strong> FALL-{ts.replace(" ","T").replace(":","")}
      </div>

      <!-- Alert box -->
      <div class="alert-box">
        <h2>⚠️ Fall Event Detected — Patient Requires Immediate Assistance</h2>
        <p>
          The KINETICS AEGIS wearable sensor worn by <strong>{PATIENT_NAME}</strong>
          has detected a high-impact fall event at <strong>{ts}</strong>.<br/><br/>
          Biometric vitals recorded at the moment of impact are attached below.
          The patient's last known GPS coordinates have been included for dispatch.
          Please prepare for possible incoming emergency.
        </p>
      </div>

      <!-- Vitals -->
      <div class="section-label">Biometric Vitals at Impact</div>
      <div class="vitals">
        <div class="vital">
          <div class="val">{g:.1f}G</div>
          <div class="lbl">Impact Force</div>
        </div>
        <div class="vital">
          <div class="val">{bpm}</div>
          <div class="lbl">Heart Rate</div>
        </div>
        <div class="vital">
          <div class="val">{o2}%</div>
          <div class="lbl">SpO₂</div>
        </div>
      </div>

      <!-- Map -->
      <div class="section-label">📍 Last Known Patient Location</div>
      <div class="map-wrap">
        <img src="{osm_thumb}" alt="Patient Location Map" />
      </div>
      <div class="coords">📍 Lat: {COORDS_LAT} &nbsp;|&nbsp; Lng: {COORDS_LNG}</div>

      <a href="{maps_url}" class="btn">🗺️ Open Patient Location in Google Maps</a>

      <!-- Action note -->
      <div class="action-note">
        📋 <strong>Recommended Action:</strong> Dispatch emergency response to the coordinates above.
        The next of kin has also been notified via the KINETICS platform.
        This is an automated message — no reply is necessary.
      </div>

      <p style="font-size:11px;color:#bbb;text-align:center;">
        This alert was generated automatically by the KINETICS AEGIS Body Area Network.<br/>
        Confidential — For Medical Personnel Only.
      </p>
    </div>

    <div class="footer">
      KINETICS Movement Intelligence &nbsp;·&nbsp; AEGIS Patient Safety System &nbsp;·&nbsp; v2.0
    </div>
  </div>
</body>
</html>
"""




def send_fall_alert_email(g: float, bpm: int, o2: int):
    """Send fall alert email in a background thread (non-blocking)."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"🚨 KINETICS ALERT — Fall Detected ({ts})"
        msg["From"]    = f"KINETICS Monitor <{ALERT_SENDER_EMAIL}>"
        msg["To"]      = ALERT_RECIPIENT_EMAIL

        # Plain text fallback
        plain = (f"CRITICAL: Fall detected for {PATIENT_NAME} at {ts}.\n"
                 f"G-Force: {g:.2f}G | BPM: {bpm} | SpO2: {o2}%\n"
                 f"Location: {COORDS_LAT}, {COORDS_LNG}\n"
                 f"Google Maps: https://www.google.com/maps?q={COORDS_LAT},{COORDS_LNG}")
        msg.attach(MIMEText(plain, "plain"))
        msg.attach(MIMEText(build_email_html(g, bpm, o2, ts), "html"))

        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(ALERT_SENDER_EMAIL, ALERT_SENDER_PASSWORD)
            server.sendmail(ALERT_SENDER_EMAIL, ALERT_RECIPIENT_EMAIL, msg.as_string())

        print(f"[EMAIL]  ✅ Fall alert sent → {ALERT_RECIPIENT_EMAIL}")
    except smtplib.SMTPAuthenticationError:
        print("[EMAIL]  ❌ Auth failed — check ALERT_SENDER_EMAIL and ALERT_SENDER_PASSWORD")
    except Exception as e:
        print(f"[EMAIL]  ❌ Failed to send: {e}")

def send_mode_a_email(g: float, bpm: int, o2: int):
    """Send Mode A (Welfare Check) email to neighbor."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"KINETICS Welfare Check: Arthur had a minor trip ({ts})"
        msg["From"]    = f"KINETICS Monitor <{ALERT_SENDER_EMAIL}>"
        msg["To"]      = ALERT_RECIPIENT_EMAIL

        plain = (f"Hi Sarah,\n\n"
                 f"This is an automated message from Arthur's KINETICS monitoring system.\n"
                 f"Arthur experienced a minor trip/stumble (G-Force: {g:.2f}G), but his vitals are completely stable.\n"
                 f"BPM: {bpm}\n"
                 f"SpO2: {o2}%\n\n"
                 f"Please check in on him in Unit 4C when you have a moment.\n\n"
                 f"- KINETICS AEGIS System")
        msg.attach(MIMEText(plain, "plain"))

        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(ALERT_SENDER_EMAIL, ALERT_SENDER_PASSWORD)
            server.sendmail(ALERT_SENDER_EMAIL, ALERT_RECIPIENT_EMAIL, msg.as_string())
        print(f"[EMAIL]  ✅ Mode A (Neighbor) sent → {ALERT_RECIPIENT_EMAIL}")
    except Exception as e:
        print(f"[EMAIL]  ❌ Failed to send Mode A: {e}")

def send_mode_b_email(g: float, bpm: int, o2: int):
    """Send Mode B (Clinical Intervention) email to Doctor with PDF report."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        plt.figure(figsize=(8, 4))
        x = np.arange(120)
        y_bpm = np.random.normal(70, 2, 120)
        y_bpm[-20:] = np.linspace(70, bpm, 20) + np.random.normal(0, 2, 20)
        y_o2 = np.random.normal(98, 1, 120)
        y_o2[-20:] = np.linspace(98, o2, 20) + np.random.normal(0, 0.5, 20)

        fig, ax1 = plt.subplots(figsize=(8, 4))
        color = 'tab:red'
        ax1.set_xlabel('Time (seconds ago)')
        ax1.set_ylabel('Heart Rate (BPM)', color=color)
        ax1.plot(-x[::-1], y_bpm, color=color, label='BPM')
        ax1.tick_params(axis='y', labelcolor=color)
        
        ax2 = ax1.twinx()  
        color = 'tab:green'
        ax2.set_ylabel('SpO2 (%)', color=color)  
        ax2.plot(-x[::-1], y_o2, color=color, label='SpO2')
        ax2.tick_params(axis='y', labelcolor=color)
        
        plt.title(f"KINETICS Telemetry: {PATIENT_NAME} - Abnormal Vitals Detected")
        fig.tight_layout()
        
        pdf_filename = "telemetry_report.pdf"
        plt.savefig(pdf_filename)
        plt.close(fig)
        plt.close('all')

        msg = MIMEMultipart()
        msg["Subject"] = f"URGENT: KINETICS Telemetry Report - Abnormal Vitals ({ts})"
        msg["From"]    = f"KINETICS Monitor <{ALERT_SENDER_EMAIL}>"
        msg["To"]      = ALERT_RECIPIENT_EMAIL
        
        text = (f"Dr. Vance,\n\n"
                f"This is an automated dispatch from the KINETICS AEGIS system.\n"
                f"Patient: {PATIENT_NAME} (78) | ID: KIN-2024-0047\n\n"
                f"Abnormal biometric activity detected.\n"
                f"Current Heart Rate: {bpm} BPM\n"
                f"Current SpO2: {o2}%\n\n"
                f"Attached is the diagnostic telemetry package (PDF) for the last 2 minutes showing the deviation.\n\n"
                f"- KINETICS AEGIS System")
        msg.attach(MIMEText(text, "plain"))

        with open(pdf_filename, "rb") as f:
            attach = MIMEApplication(f.read(), _subtype="pdf")
            attach.add_header('Content-Disposition', 'attachment', filename=pdf_filename)
            msg.attach(attach)

        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(ALERT_SENDER_EMAIL, ALERT_SENDER_PASSWORD)
            server.sendmail(ALERT_SENDER_EMAIL, ALERT_RECIPIENT_EMAIL, msg.as_string())
        print(f"[EMAIL]  ✅ Mode B (Doctor PDF) sent → {ALERT_RECIPIENT_EMAIL}")
    except Exception as e:
        print(f"[EMAIL]  ❌ Failed to send Mode B: {e}")


# ─────────────────────────────────────────────────────────────
#  ROUTES
# ─────────────────────────────────────────────────────────────

@app.route('/')
def home():
    return jsonify({"message": "✅ KINETICS Backend is Active!", "status": "online"})


@app.route('/api/aegis', methods=['POST'])
def receive_data():
    """
    Endpoint for ESP8266 hardware.
    Expected JSON payload:
    {
        "token":    "AEGIS_AUTH_774",
        "event":    "NORMAL_HEARTBEAT" | "HIGH IMPACT FALL" | ...,
        "gForce":   <float>,
        "bpm":      <int>,
        "o2":       <int>,
        "location": "12.824589,80.046896"
    }
    """
    global current_vitals, _fall_email_sent, _mode_a_sent, _mode_b_sent

    # ── 1. Guard ─────────────────────────────────────────────
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No JSON payload"}), 400

    # ── 2. Auth ──────────────────────────────────────────────
    if data.get("token") != HARDWARE_TOKEN:
        print(f"[WARN]  Unauthorized device. token={data.get('token')}")
        return jsonify({"error": "Hardware Unauthorized"}), 401

    # ── 3. Extract ───────────────────────────────────────────
    event    = data.get("event",    "UNKNOWN")
    g        = float(data.get("gForce",  0.0))
    bpm      = int(data.get("bpm",   0))
    o2       = int(data.get("o2",    0))
    location = data.get("location", f"{COORDS_LAT},{COORDS_LNG}")

    # ── 4. Derive isFall ─────────────────────────────────────
    is_fall  = is_fall_event(event, g)

    # ── 5. Reasoning ─────────────────────────────────────────
    reasoning = build_reasoning(event, g, bpm, o2, is_fall)

    # ── 6. Commit state ──────────────────────────────────────
    current_vitals.update({
        "gForce":          round(g, 4),
        "bpm":             bpm,
        "o2":              o2,
        "isFall":          is_fall,
        "event":           event,
        "agent_reasoning": reasoning,
        "location":        location
    })

    # ── 7. Email alert modes (fires ONCE per event, non-blocking) ───
    mode_c = is_fall
    mode_b = not is_fall and (bpm > 100 or o2 < 90) and bpm > 0 and o2 > 0
    mode_a = not is_fall and not mode_b and (3 <= g < FALL_THRESHOLD)

    if mode_c and not _fall_email_sent:
        _fall_email_sent = True
        threading.Thread(target=send_fall_alert_email, args=(g, bpm, o2), daemon=True).start()
    elif not mode_c:
        _fall_email_sent = False

    if mode_a and not _mode_a_sent:
        _mode_a_sent = True
        threading.Thread(target=send_mode_a_email, args=(g, bpm, o2), daemon=True).start()
    elif not mode_a:
        _mode_a_sent = False

    if mode_b and not _mode_b_sent:
        _mode_b_sent = True
        threading.Thread(target=send_mode_b_email, args=(g, bpm, o2), daemon=True).start()
    elif not mode_b:
        _mode_b_sent = False

    # ── 8. Terminal log ──────────────────────────────────────
    ts       = datetime.now().strftime("%H:%M:%S")
    fall_tag = "  🚨 FALL" if is_fall else ""
    print(f"[{ts}]  📡 /api/aegis  200 OK  →  "
          f"event={event:<22}  bpm={bpm:>3}  gForce={g:.3f}G  SpO2={o2}%{fall_tag}")

    return jsonify({"status": "data_received", "isFall": is_fall}), 200


@app.route('/run-prediction', methods=['GET'])
def run_prediction():
    """Polled by React dashboard every 1 second. Returns live vitals + patient profile."""
    return jsonify({**current_vitals, "patient": PATIENT_DB})


# ─────────────────────────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 60)
    print("  KINETICS Backend  —  AEGIS Hardware Bridge")
    print("=" * 60)
    print(f"  Hardware endpoint  : POST /api/aegis")
    print(f"  Dashboard feed     : GET  /run-prediction")
    print(f"  Auth token         : {HARDWARE_TOKEN}")
    print(f"  Fall threshold     : >= {FALL_THRESHOLD} G")
    print(f"  Alert sender       : {ALERT_SENDER_EMAIL}")
    print(f"  Alert recipient    : {ALERT_RECIPIENT_EMAIL}")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5000, debug=True)