import { devicePath, firebaseFetch } from "../firebase";

export async function GET() {
  try {
    const [visits, commands] = await Promise.all([
      firebaseFetch(devicePath("/history/visits")),
      firebaseFetch(devicePath("/history/commands"))
    ]);

    const visitList = visits
      ? Object.entries(visits).map(([id, v]) => ({ id, ...v })).reverse()
      : [];

    const cmdList = commands
      ? Object.entries(commands).map(([id, cmd]) => ({ id, ...cmd })).reverse()
      : [];

    return Response.json({ ok: true, visits: visitList, commands: cmdList });
  } catch (error) {
    return Response.json({ ok: false, error: error.message || "Firebase history error" }, { status: 500 });
  }
}