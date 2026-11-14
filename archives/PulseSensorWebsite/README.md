# Pulse Monitor

Live pulse wave and BPM from an Arduino + Pulse Sensor, shown in a Flask web page.

## Setup
1. Wire the sensor: purple -> A0, red -> 5V, black -> GND.
2. Upload `arduino/pulse_sensor/pulse_sensor.ino` (needs the "PulseSensor Playground" library).
3. Close the Arduino Serial Monitor/Plotter (only one program can use the port).
4. `pip install -r requirements.txt`
5. `python app.py`
6. Open http://localhost:5000

If it says "Arduino not found", set `PORT` at the top of `app.py`
(the port shown in the Arduino IDE under Tools -> Port).

## Layout
- app.py                 Flask server + serial reader (+ /reset route)
- templates/index.html   page
- static/css/style.css   styles
- static/js/app.js       chart + polling
- arduino/               Arduino sketch

## Restart button
The Restart button clears the chart and BPM and reboots the Arduino (via the serial
DTR line, no re-upload needed) so BPM tracking starts fresh. Place your finger again
and wait a few seconds for a new reading.
