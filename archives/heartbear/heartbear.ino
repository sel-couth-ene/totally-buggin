#define USE_ARDUINO_INTERRUPTS true
#include <PulseSensorPlayground.h>

const int PulseWire = A0;
const int Threshold = 550;      // adjust to the middle of your wave
PulseSensorPlayground pulseSensor;
int bpm = 0;

void setup() {
  Serial.begin(115200);
  pulseSensor.analogInput(PulseWire);
  pulseSensor.blinkOnPulse(LED_BUILTIN);   // onboard LED flashes with each beat
  pulseSensor.setThreshold(Threshold);
  pulseSensor.begin();
}

void loop() {
  if (pulseSensor.sawStartOfBeat()) {
    bpm = pulseSensor.getBeatsPerMinute();
  }
  Serial.print("Signal:");
  Serial.print(pulseSensor.getLatestSample());
  Serial.print(",BPM:");
  Serial.println(bpm);
  delay(20);
}
