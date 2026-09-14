# Real time: can the existing STOMP/SockJS client keep working?

Investigated before writing any of it, because the answer decides whether the
frontend is touched at all.

**Answer: yes.** The client can stay exactly as it is. The evidence and the
scope are below, along with the one thing that has to be accepted for it to
hold.

---

## 1. What the client actually does

Eight files, not four. Every one of them creates its own `@stomp/stompjs`
`Client` over `sockjs-client` against `/ws`.

| File | Subscribes to |
|---|---|
| `hooks/useNotifications.ts` | `/topic/notifications/{userId}`, `/user/queue/notifications` |
| `hooks/useAttendanceLive.ts` | `/topic/attendance` |
| `hooks/useCalls.tsx` | `/topic/calls/{userId}` |
| `hooks/useChat.ts` | `/topic/presence`, `/topic/community/{communityId}` |
| `hooks/usePayrollProgress.ts` | `/topic/payroll` |
| `hooks/useTaskChat.ts` | `/topic/tasks/{taskId}` |
| `components/GlobalLoginAnnouncementModal.tsx` | `/topic/global-announcement` |
| `components/RequestThread.tsx` | imports STOMP; no subscription of its own |

Nine destinations. Versions: `@stomp/stompjs` 7.3.0, `sockjs-client` 1.6.1.

### The client never publishes

Searched for `.publish({ destination: ... })` across `web/src`: **no matches.**
Every message flows server → client. Nothing calls into `/app/**`, and Spring's
`setApplicationDestinationPrefixes("/app")` has no client using it.

This is the single most important finding. A STOMP *broker* — transactions,
receipts, acks, message ordering guarantees, client-side sends being routed to
`@MessageMapping` handlers — is not what this application uses. It uses a
one-way push channel that happens to be framed in STOMP.

### Frames in play

- Client sends: `CONNECT`, `SUBSCRIBE`, `UNSUBSCRIBE`, `DISCONNECT`, and
  heart-beat newlines.
- Server sends: `CONNECTED`, `MESSAGE`, and heart-beat newlines.

`SEND`, `BEGIN`, `COMMIT`, `ABORT`, `ACK`, `NACK` exist in the client library
and are never reached by this application.

### Connection lifecycle

`reconnectDelay: 5000` on every client; the library reconnects on its own and
re-issues its `SUBSCRIBE` frames. Auth is a `connectHeaders` `Authorization:
Bearer` on `CONNECT` — a STOMP native header, not an HTTP one, so it survives
SockJS's transport negotiation.

### Server-side rules that must come across

From `WebSocketConfig`:

- **CONNECT never fails.** A missing or unreadable token leaves the session
  anonymous rather than refusing it. The announcement modal can be mid
  token-refresh when it connects, and refusing would change how every client
  reconnects.
- **SUBSCRIBE is where authorisation happens.** `/topic/global-announcement` is
  public; everything else needs a named session; `/topic/notifications/{id}`
  must match the session's own user id. A refused subscription drops the frame
  and leaves the connection up.
- The principal's name is the user id as a string. `/user/queue/**` routing
  depends on it.

---

## 2. Is SockJS a problem?

`sockjs-client` ships nine transports: `websocket`, `xhr-streaming`,
`xdr-streaming`, `eventsource`, `iframe-*`, `htmlfile`, `xhr-polling`,
`xdr-polling`, `jsonp-polling`.

A server does not have to implement all nine. The client asks `/ws/info` first
and picks from what it is told plus what the browser supports.

Checked against the live server:

```
GET /ws/info
{"entropy":-1378862784,"origins":["*:*"],"cookie_needed":true,"websocket":true}

GET /ws/websocket  (with Upgrade headers)
HTTP/1.1 101 Switching Protocols
```

So in production today the client negotiates and then uses **the raw WebSocket
transport at `/ws/websocket`**. The eight fallback transports exist in the
bundle and are not used on any browser that reaches this application, all of
which have had WebSocket support for a decade.

### What has to be accepted

Implementing `/ws/info` and `/ws/websocket` covers every browser that can open a
WebSocket. It does **not** cover a network that blocks WebSocket upgrades and
forces SockJS to fall back to XHR streaming or polling.

That is a real difference from today, and it is the one thing to accept
deliberately rather than discover later. Two mitigations, both cheap:

- The fallbacks are already unusable in practice: `cookie_needed: true` means
  the streaming transports need a session cookie this API does not set, and the
  JWT travels in a STOMP header rather than a cookie.
- If a customer network ever does block WebSocket, `xhr-streaming` is one
  additional endpoint on the same frame codec — it can be added then, against a
  real case, rather than speculatively now.

---

## 3. The decision

**Implement a STOMP-over-WebSocket endpoint in ASP.NET Core. Do not touch the
React client.**

Scope, measured rather than guessed:

| Piece | Size |
|---|---|
| `/ws/info` — a five-field JSON document | trivial |
| `/ws/websocket` — WebSocket accept | trivial |
| SockJS frame envelope (`o`, `a[...]`, `h`, `c[...]`) | small |
| STOMP frame parse/serialise — 5 client verbs, 2 server verbs | ~150 lines |
| Subscription registry, per connection | ~100 lines |
| Heart-beats both ways | ~40 lines |
| CONNECT auth + SUBSCRIBE authorisation, ported from `WebSocketConfig` | ~80 lines |
| A publisher service replacing `SimpMessagingTemplate` | ~60 lines |

Roughly 450 lines of well-understood protocol work, against a wire format that
is a specification, is public, and is exercised by nine destinations that
already work — so every one of them is a test.

### Why not the alternatives

**SignalR + rewriting the client.** Eight files, nine subscriptions, four
distinct reconnect behaviours, presence, and call signalling. Larger than the
450 lines, and it changes the part of the system the brief protects most.
Rejected.

**Keeping Java for real time.** Contradicts the goal, and leaves two backends
holding one JWT secret and one user table indefinitely. Rejected.

### What this does not do

It does not make ASP.NET a STOMP broker. There is no `/app/**` routing, no
transactions, no acks, no receipts — because the application does not use them.
If a future feature needs the client to publish, that is the moment to add
`SEND` handling, and it is additive.

---

## 4. Verification plan

The nine destinations are the test suite. For each:

1. Run both backends side by side, Java on 7060 and .NET on another port.
2. Point a browser at the .NET one with `VITE_API_URL` overridden.
3. Trigger the event that pushes on that destination — punch in for
   `/topic/attendance`, approve a leave for `/topic/notifications/{id}`, post to
   a community for `/topic/community/{id}`, and so on.
4. Compare the frame the browser receives: same destination, same JSON body.

Plus the two authorisation cases, which are the ones a rewrite loses:

- an anonymous session subscribing to `/topic/community/3` is refused and the
  connection stays up;
- user 12 subscribing to `/topic/notifications/13` is refused and user 12's own
  stream keeps working.
