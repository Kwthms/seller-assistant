// Sends a "reminder time" push to every subscribed phone. The phone itself decides what to show.
import webpush from "web-push";
import { readFileSync } from "node:fs";

const PUBLIC = "BAemue9PYx6qct4T8i8tYu3uOV2AGg0kFsdNqpRYkwSEZbUEeCpZxy9bzx_2PoQwGFDlxn9cvzFTR05amWdF2F0";
const PRIVATE = process.env.VAPID_PRIVATE;
if (!PRIVATE) { console.error("VAPID_PRIVATE secret is missing"); process.exit(1); }
webpush.setVapidDetails("mailto:noreply@example.com", PUBLIC, PRIVATE);

const kind = process.argv[2] || "reminder"; // reminder | resend | test
const subs = JSON.parse(readFileSync(new URL("../subscriptions.json", import.meta.url)));
if (!subs.length) { console.log("No phones subscribed yet"); process.exit(0); }

const payload = JSON.stringify({ resend: kind === "resend", test: kind === "test" });
let failed = 0;
for (const s of subs) {
  try {
    const r = await webpush.sendNotification(s, payload, { TTL: 1800, urgency: "high" });
    console.log("sent", r.statusCode, s.endpoint.slice(0, 40));
  } catch (e) {
    failed++;
    console.error("failed", e.statusCode, e.body || e.message, s.endpoint.slice(0, 40));
  }
}
if (failed === subs.length) process.exit(1);
