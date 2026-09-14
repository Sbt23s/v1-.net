/*
 * The real client, against the .NET server.
 *
 * Run from web/ so it resolves the app's own node_modules:
 *
 *     cd web && node ../backend-dotnet/tests/stomp-client-test.mjs http://localhost:5065
 *
 * Uses the very packages the React app uses -- @stomp/stompjs 7.3.0 over
 * sockjs-client 1.6.1 -- rather than a hand-rolled socket, because the point is
 * to prove the existing client works unchanged, and a simplified test client
 * would prove something else.
 */
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";

const BASE = process.argv[2] || "http://localhost:5065";
const results = [];
let done = false;

function pass(m) { results.push("PASS  " + m); }
function fail(m) { results.push("FAIL  " + m); }

function finish(code) {
  if (done) return;
  done = true;
  console.log("\n=== results ===");
  for (const r of results) console.log(r);
  const failed = results.filter(r => r.startsWith("FAIL")).length;
  console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

async function publish(destination, body, user) {
  const qs = new URLSearchParams({ destination });
  if (user) qs.set("user", user);
  await fetch(`${BASE}/__dev/publish?${qs}`, { method: "POST", body: JSON.stringify(body) });
}

const client = new Client({
  webSocketFactory: () => new SockJS(`${BASE}/ws`),
  connectHeaders: { Authorization: "Bearer not-a-real-token" },
  reconnectDelay: 0,
  debug: () => {},
  onStompError: (f) => { fail(`STOMP error: ${f.headers.message}`); finish(1); },
  onWebSocketError: (e) => { fail(`socket error: ${e?.message ?? e}`); finish(1); },

  onConnect: async () => {
    pass("CONNECT accepted, CONNECTED received");

    /*
     * An unreadable token leaves the session anonymous -- the Java behaviour,
     * which must hold here. So the public topic is allowed and the private ones
     * are not.
     */
    let publicSeen = null;
    client.subscribe("/topic/global-announcement", (m) => { publicSeen = m.body; });
    pass("subscribed to the public topic");

    client.subscribe("/topic/community/3", () => {
      fail("anonymous session received /topic/community/3");
    });
    client.subscribe("/topic/notifications/12", () => {
      fail("anonymous session received /topic/notifications/12");
    });

    // Give the subscriptions a moment to register, then push.
    await new Promise(r => setTimeout(r, 300));
    await publish("/topic/global-announcement", { title: "hello", id: 7 });
    await publish("/topic/community/3", { text: "private" });
    await publish("/topic/notifications/12", { text: "private" });
    await new Promise(r => setTimeout(r, 800));

    if (publicSeen) {
      const parsed = JSON.parse(publicSeen);
      if (parsed.title === "hello" && parsed.id === 7) {
        pass("MESSAGE delivered on the public topic with the exact payload");
      } else {
        fail(`payload altered in transit: ${publicSeen}`);
      }
    } else {
      fail("no MESSAGE arrived on the public topic");
    }

    if (client.connected) pass("connection still open after refused subscriptions");
    else fail("connection dropped after a refused subscription");

    finish(0);
  }
});

setTimeout(() => { fail("timed out before CONNECTED"); finish(1); }, 15000);

client.activate();
