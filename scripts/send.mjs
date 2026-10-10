// Sends a "reminder time" push to the phone. The phone itself decides what to show.
// PUSH_CONFIG is the code copied from the app's Ayarlar tab: base64 of {pub, priv, sub}.
import webpush from "web-push";

const raw = process.env.PUSH_CONFIG;
if (!raw) { console.log("PUSH_CONFIG secret is not set yet"); process.exit(0); }
const { pub, priv, sub } = JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8"));
webpush.setVapidDetails("mailto:noreply@example.com", pub, priv);

const kind = process.argv[2] || "reminder"; // reminder | resend | test
const payload = JSON.stringify({ resend: kind === "resend", test: kind === "test" });
try {
  const r = await webpush.sendNotification(sub, payload, { TTL: 1800, urgency: "high" });
  console.log("sent", kind, r.statusCode);
} catch (e) {
  console.error("failed", e.statusCode, e.body || e.message);
  process.exit(1);
}
