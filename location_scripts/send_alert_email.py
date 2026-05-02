import smtplib
import ssl
import os
from dotenv import load_dotenv
from email.message import EmailMessage
from email.utils import formataddr
from location_scripts.get_nearby_hospitals import get_nearby_hospitals


# Load environment variables
load_dotenv()

EMAIL_SENDER = os.getenv("ALERT_EMAIL_SENDER") or os.getenv("KINETICS_SENDER_EMAIL")
EMAIL_PASSWORD = os.getenv("ALERT_EMAIL_PASSWORD") or os.getenv("KINETICS_SENDER_PASS")
EMAIL_RECEIVER = os.getenv("ALERT_EMAIL_RECEIVER") or os.getenv("KINETICS_RECIPIENT_EMAIL")

def send_fall_alert_email(fall_detected, latitude, longitude, user_name):
    if not fall_detected:
        print("[INFO] No fall detected. No alert sent.")
        return

    if not all([EMAIL_SENDER, EMAIL_PASSWORD, EMAIL_RECEIVER]):
        print("❌ Missing email credentials. Set ALERT_EMAIL_* or KINETICS_* environment variables.")
        return

    # Get nearby hospitals
    hospitals = get_nearby_hospitals(latitude, longitude)
    hospital_list = "\n".join([f"- {h['name']} ({h['type']})" for h in hospitals]) or "No nearby hospitals found."

    # Compose the email

    subject = f"🚨 URGENT: Potential Fall Detected for {user_name}"
    body = (
        f"⚠️ This is an urgent notification from the Body Area Network regarding {user_name}.\n\n"
        f"📌 Potential Fall Detected:\n"
        f"- 📍 Location: https://www.google.com/maps?q={latitude},{longitude}\n"
        f"- 📡 Coordinates: {latitude}, {longitude}\n\n"
        f"🏥 Nearby Medical Facilities:\n"
        f"For immediate reference, here are nearby hospitals and nursing homes:\n\n"
        f"{hospital_list}\n\n"
        f"🚨 Action Required:\n"
        f"Please take immediate action to check on {user_name} and provide necessary assistance.\n\n"
        f"Sincerely,\n"
        f"The Fall Detection and Alert System\n"
        f"🛑 (Automated Notification - Do Not Reply)"
        )

    msg = EmailMessage()
    msg['From'] = formataddr(("VitalSync Alerts ⚠️", EMAIL_SENDER))
    msg['To'] = EMAIL_RECEIVER
    msg['Subject'] = subject
    msg.set_content(body)

    try:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as smtp:
            smtp.login(EMAIL_SENDER, EMAIL_PASSWORD)
            smtp.send_message(msg)
        print("✅ Fall alert email sent successfully.")
    except Exception as e:
        print(f"❌ Failed to send fall alert email: {e}")
