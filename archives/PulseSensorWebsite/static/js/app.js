const bpmEl = document.getElementById("bpm");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart");

const chart = new Chart(document.getElementById("chart"), {
  type: "line",
  data: {
    labels: [],
    datasets: [{ data: [], borderColor: "crimson", borderWidth: 1.5, pointRadius: 0 }],
  },
  options: {
    animation: false,
    plugins: { legend: { display: false } },
    scales: { x: { display: false }, y: { min: 0, max: 1023 } },
  },
});

function clearChart() {
  chart.data.labels = [];
  chart.data.datasets[0].data = [];
  chart.update();
  bpmEl.textContent = "--";
}

async function update() {
  try {
    const res = await fetch("/data");
    const d = await res.json();

    restartBtn.disabled = d.resetting;

    if (d.resetting) {
      statusEl.textContent = "restarting...";
      statusEl.className = "";
      clearChart();
      return;
    }

    bpmEl.textContent = d.bpm > 0 ? d.bpm : "--";
    statusEl.textContent = d.connected ? "connected" : "Arduino not found";
    statusEl.className = d.connected ? "ok" : "bad";

    chart.data.labels = d.samples.map((_, i) => i);
    chart.data.datasets[0].data = d.samples;
    chart.update();
  } catch (e) {
    statusEl.textContent = "server not reachable";
    statusEl.className = "bad";
  }
}

restartBtn.addEventListener("click", async () => {
  restartBtn.disabled = true;
  clearChart();
  statusEl.textContent = "restarting...";
  statusEl.className = "";
  try {
    await fetch("/reset", { method: "POST" });
  } catch (e) {
    statusEl.textContent = "server not reachable";
    statusEl.className = "bad";
    restartBtn.disabled = false;
  }
});

setInterval(update, 200);
update();
