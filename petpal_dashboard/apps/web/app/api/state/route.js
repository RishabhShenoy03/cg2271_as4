import { devicePath, firebaseFetch } from "../firebase";

let lastLoggedCommandId = null;
let wasAroundPrev = false;
let arrivalTime = null;
let arrivalSensor = null;
let playTracker = false;
let lastShockTime = 0;

function firebaseTimeToIso(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function GET() {
  try {
    const [telemetry, command] = await Promise.all([
      firebaseFetch(devicePath("/telemetry")),
      firebaseFetch(devicePath("/command"))
    ]);

    const receivedAt = firebaseTimeToIso(telemetry?.updatedAtMs) || telemetry?.updatedAt || null;
    const ultrasonicDetected = Number(telemetry?.distanceCm) <= Number(process.env.PET_DISTANCE_THRESHOLD_CM || 30);
    const shockDetected = telemetry?.shockDetected === true;

    // Keep pet "around" for 10s after shock so it doesn't flicker
    if (shockDetected) {
      lastShockTime = Date.now();
    }
    const shockRecent = (Date.now() - lastShockTime) < 10000;

    const isAround = Boolean(ultrasonicDetected || shockDetected || shockRecent);
    const triggerSensor = ultrasonicDetected && (shockDetected || shockRecent)
      ? "ultrasonic+shock"
      : ultrasonicDetected
        ? "ultrasonic"
        : (shockDetected || shockRecent)
          ? "shock"
          : null;

    // Pet visit tracking
    if (isAround && !wasAroundPrev) {
      arrivalTime = receivedAt || new Date().toISOString();
      arrivalSensor = triggerSensor || "unknown";
    }

    if (!isAround && wasAroundPrev && arrivalTime) {
      const leftTime = receivedAt || new Date().toISOString();
      const durationMs = new Date(leftTime).getTime() - new Date(arrivalTime).getTime();
      const durationSec = Math.round(durationMs / 1000);
      try {
        await firebaseFetch(devicePath("/history/visits"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            arrivedAt: arrivalTime,
            leftAt: leftTime,
            durationSec,
            sensor: arrivalSensor
          })
        });
      } catch (e) { /* don't block state response */ }
      arrivalTime = null;
      arrivalSensor = null;
    }

    wasAroundPrev = isAround;

    // Log new commands to Firebase history with labels
    if (command?.id && command.id !== lastLoggedCommandId) {
      const wasPlaying = lastLoggedCommandId !== null && telemetry?.playServoMoving === true;
      lastLoggedCommandId = command.id;
      let label = command.type;
      if (command.type === "feed_now") {
        label = "Dispense Treat";
      } else if (command.type === "play_mode_toggle") {
        playTracker = !playTracker;
        label = playTracker ? "Play Mode On" : "Play Mode Off";
      }
      try {
        await firebaseFetch(devicePath("/history/commands"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...command, label })
        });
      } catch (e) { /* don't block state response */ }
    }

    return Response.json({
      ok: true,
      telemetry: telemetry
        ? {
            ...telemetry,
            receivedAt
          }
        : null,
      presence: {
        isAround,
        lastSeenAt: isAround ? receivedAt : null,
        lastTriggerSensor: triggerSensor,
        updatedAt: receivedAt
      },
      petEvents: [],
      commands: command ? [command] : [],
      stats: {
        totalCommands: command ? 1 : 0,
        queuedCount: command?.status === "queued" ? 1 : 0
      }
    });
  } catch (error) {
    return Response.json({ ok: false, error: error.message || "Firebase state error" }, { status: 500 });
  }
}