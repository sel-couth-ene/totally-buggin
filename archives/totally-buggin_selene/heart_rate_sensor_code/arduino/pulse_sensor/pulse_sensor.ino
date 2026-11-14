#define USE_ARDUINO_INTERRUPTS true
#include <PulseSensorPlayground.h>

const int PulseWire = A0;
const int Threshold = 550;      // use the value that worked for you
PulseSensorPlayground pulseSensor;
int bpm = 0;

void setup() {
  Serial.begin(115200);
  pulseSensor.analogInput(PulseWire);
  pulseSensor.blinkOnPulse(LED_BUILTIN);
  pulseSensor.setThreshold(Threshold);
  pulseSensor.begin();
}

void loop() {
  if (pulseSensor.sawStartOfBeat()) {
    bpm = pulseSensor.getBeatsPerMinute();
  }
  Serial.print(pulseSensor.getLatestSample());
  Serial.print(",");
  Serial.println(bpm);
  delay(20);
}
