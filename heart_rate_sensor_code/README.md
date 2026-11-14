# Pulse sensor (Arduino)

The Arduino side of the live pulse in the main app. The main app (`python app.py` in the project root) reads it over USB; nothing else is needed here.

1. Wire the Pulse Sensor: purple to A0, red to 5V, black to GND.
2. Install the "PulseSensor Playground" library in the Arduino IDE, then upload `arduino/pulse_sensor/pulse_sensor.ino`. Adjust `Threshold` in the sketch if your sensor needs it.
3. Close the Arduino Serial Monitor/Plotter (only one program can use the port).
4. Run the main app. It finds the Arduino by itself; set `PULSE_PORT` if it does not (the port shown in the IDE under Tools, Port).

The sketch prints one line every 20 ms: `<raw sample 0-1023>,<bpm>`. See the main README for what the app works out from it.
