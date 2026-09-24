#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include "MAX30105.h"
#include "heartRate.h" // Built-in with SparkFun library for BPM math

const char* SECRET_DEVICE_TOKEN = "AEGIS_AUTH_774";

// --- WIFI & CLOUD CREDENTIALS ---
const char* ssid = "OnePlus Nord CE 3 Lite 5G";       
const char* password = "Charizard"; 
const char* serverURL = "http://10.3.143.52:5000/api/aegis"; // Laptop B IP

// Sensor setup
Adafruit_MPU6050 mpu;
MAX30105 particleSensor;

// Pins
const int BUZZER_PIN = 14; // D5
const int BUTTON_PIN = 12; // D6
const int LED_PIN    = 13; // D7

// --- BPM & O2 VARIABLES ---
const byte RATE_SIZE = 4; 
byte rates[RATE_SIZE]; 
byte rateSpot = 0;
long lastBeat = 0;
float beatsPerMinute;
int beatAvg;
float spo2 = 98.0; // Simulated O2 baseline (Requires complex math for raw, so we stabilize for SaaS)

// --- THRESHOLDS & CALIBRATION ---
float gravityOffset = 9.81;
const float FALL_THRESHOLD = 15.0; 

// --- TIMING ---
unsigned long lastPrintTime = 0;
unsigned long lastCloudSync = 0;
unsigned long lastEmergencyTime = 0;
bool lastButtonState = HIGH;
unsigned long lastButtonTime = 0;

// --- ML WINDOW BUFFER ---
const int WINDOW_SIZE = 6;
float ax_buf[WINDOW_SIZE], ay_buf[WINDOW_SIZE], az_buf[WINDOW_SIZE];
float gx_buf[WINDOW_SIZE], gy_buf[WINDOW_SIZE], gz_buf[WINDOW_SIZE];
int buf_idx = 0;
unsigned long lastSampleTime = 0;

// --- HARDCODED LOCATION SPOOFING ---
const float SPOOF_LAT = 12.824589;
const float SPOOF_LNG = 80.046896;

// --- HOLLYWOOD SPOOF STATE ---
bool isFakingFall = false;
unsigned long fakeFallStartTime = 0;

void triggerEmergency(const char* reason, float g, int bpm);
void sendToCloud(String event, float g, int bpm, int o2);

// ============================================================
void setup() {
  Serial.begin(115200);
  
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN,    OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Wire.begin(D2, D1);
  
  Serial.println(F("\n--- AEGIS SAAS BOOT ---"));

  // 1. Connect to WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(".");
  }
  Serial.println(F("\n[OK] WiFi Connected"));

  // 2. MPU6050 Init & Calibration
  if (mpu.begin()) {
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    Serial.println(F("[..] Calibrating MPU... Keep Still"));
    float sum = 0;
    for(int i=0; i<20; i++) {
        sensors_event_t a, g, t;
        mpu.getEvent(&a, &g, &t);
        sum += sqrt(pow(a.acceleration.x,2)+pow(a.acceleration.y,2)+pow(a.acceleration.z,2));
        delay(50);
    }
    gravityOffset = sum / 20.0;
  }

  // 3. MAX30102 Sensitivity Setup
  if (particleSensor.begin(Wire, I2C_SPEED_FAST)) {
    particleSensor.setup(0x3F, 4, 2, 100, 411, 16384); 
    particleSensor.setPulseAmplitudeRed(0x3F);
    particleSensor.setPulseAmplitudeIR(0x3F);
    Serial.println(F("[OK] Heart Sensor Ready"));
  }
}

// ============================================================
void loop() {
  // A. BPM Software Logic (Checks for pulses constantly)
  long irValue = particleSensor.getIR();
  if (checkForBeat(irValue) == true) {
    long delta = millis() - lastBeat;
    lastBeat = millis();
    beatsPerMinute = 60 / (delta / 1000.0);
    if (beatsPerMinute < 255 && beatsPerMinute > 20) {
      rates[rateSpot++] = (byte)beatsPerMinute;
      rateSpot %= RATE_SIZE;
      beatAvg = 0;
      for (byte x = 0 ; x < RATE_SIZE ; x++) beatAvg += rates[x];
      beatAvg /= RATE_SIZE;
    }
  }

  // B. Button Debounce & Spoof Trigger
  bool currentBtn = digitalRead(BUTTON_PIN);
  if (currentBtn == LOW && lastButtonState == HIGH) {
    if (millis() - lastButtonTime > 500) {
      lastButtonTime = millis();
      isFakingFall = true;
      fakeFallStartTime = millis();
    }
  }
  lastButtonState = currentBtn;

  // C. Accelerometer Math & Spoofing
  sensors_event_t a, g, t;
  mpu.getEvent(&a, &g, &t);
  
  unsigned long now = millis();
  if (now - lastSampleTime >= 500) { // Sample every 500ms
    lastSampleTime = now;
    ax_buf[buf_idx] = a.acceleration.x;
    ay_buf[buf_idx] = a.acceleration.y;
    az_buf[buf_idx] = a.acceleration.z;
    gx_buf[buf_idx] = g.gyro.x;
    gy_buf[buf_idx] = g.gyro.y;
    gz_buf[buf_idx] = g.gyro.z;
    buf_idx = (buf_idx + 1) % WINDOW_SIZE;
  }

  float rawMag = sqrt(pow(a.acceleration.x,2)+pow(a.acceleration.y,2)+pow(a.acceleration.z,2));
  float netG = rawMag - gravityOffset;

  if (isFakingFall) {
    if (millis() - fakeFallStartTime < 1000) {
      netG = 28.5 + (random(-10, 10) / 10.0); // Fake a massive impact
    } else { isFakingFall = false; }
  }

  // D. SaaS Heartbeat (Every 5 seconds send to Laptop B)
  if (now - lastCloudSync >= 5000) {
    lastCloudSync = now;
    int finalBPM = (irValue < 50000) ? 0 : beatAvg;
    sendToCloud("NORMAL_HEARTBEAT", netG, finalBPM, (finalBPM > 0 ? 98 : 0));
  }

  // E. Fall Detection Trigger
  if (netG > FALL_THRESHOLD && (now - lastEmergencyTime > 5000)) {
    lastEmergencyTime = now;
    int finalBPM = (irValue < 50000) ? 0 : beatAvg;
    triggerEmergency("HIGH IMPACT FALL", netG, finalBPM);
  }
}

// ============================================================
void sendToCloud(String event, float g, int bpm, int o2) {
  if (WiFi.status() == WL_CONNECTED) {
    WiFiClient client;
    HTTPClient http;
    http.begin(client, serverURL);
    http.addHeader("Content-Type", "application/json");

    String jsonPayload = "{";
    jsonPayload += "\"token\":\"" + String(SECRET_DEVICE_TOKEN) + "\",";
    jsonPayload += "\"event\":\"" + event + "\",";
    jsonPayload += "\"gForce\":" + String(g) + ",";
    jsonPayload += "\"bpm\":" + String(bpm) + ",";
    jsonPayload += "\"o2\":" + String(o2) + ",";
    jsonPayload += "\"location\":\"12.824589,80.046896\",";
    
    jsonPayload += "\"window\":[";
    for(int i=0; i<WINDOW_SIZE; i++) {
      int idx = (buf_idx + i) % WINDOW_SIZE;
      jsonPayload += "[" + String(ax_buf[idx], 3) + "," + String(ay_buf[idx], 3) + "," + String(az_buf[idx], 3) + "," 
                         + String(gx_buf[idx], 3) + "," + String(gy_buf[idx], 3) + "," + String(gz_buf[idx], 3) + "]";
      if (i < WINDOW_SIZE - 1) jsonPayload += ",";
    }
    jsonPayload += "]";
    
    jsonPayload += "}";

    int httpCode = http.POST(jsonPayload);
    http.end();
  }
}

void triggerEmergency(const char* reason, float g, int bpm) {
  Serial.print(F("!!! EMERGENCY: ")); Serial.println(reason);
  sendToCloud(reason, g, bpm, 97); // Instant SaaS Alert
  
  for(int i=0; i<10; i++) {
    digitalWrite(LED_PIN, HIGH); digitalWrite(BUZZER_PIN, HIGH);
    delay(100);
    digitalWrite(LED_PIN, LOW); digitalWrite(BUZZER_PIN, LOW);
    delay(100);
  }
}