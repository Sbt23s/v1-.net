import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, Users, PhoneOff, UserPlus, X, Search
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGroupCall, maxParticipants, type GroupParticipant } from "@/hooks/useGroupCall";
import { useAuth } from "@/hooks/useAuth";

function initials(name?: string) {
  if (!name) return "?";
  return name.split(" ").filter(Boolean).slice(0, 2)
    .map((p) => p[0]?.toUpperCase()).join("");
}

function clock(total: number) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * One face in the grid.
 *
 * Split out so React can keep each video element mounted across re-renders.
 * Inlining it would remount every tile whenever anyone's mute state changed,
 * and a remounted video element loses its stream and shows black for a beat.
 */
function Tile({
  name, stream, muted, cameraOff, connected, isSelf
}: {
  name: string;
  stream: MediaStream | null;
  muted: boolean;
  cameraOff: boolean;
  connected: boolean;
  isSelf?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  /*
    Whether this tile actually has a picture to show.

    Counting video tracks is not the same question. A track can be attached
    and carrying nothing yet, and the far side's own state arrives separately
    over the signalling channel -- so a tile that trusted the track count
    showed a black rectangle, and one that trusted the announced state showed
    an avatar over a perfectly good video.

    The element knows. It reports a width once it has decoded a frame, and
    every browser agrees on that.
  */
  const [hasPicture, setHasPicture] = useState(false);

  // Streams are attached through the DOM. A src attribute cannot carry one,
  // and re-attaching on every render would restart playback.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
      if (stream) el.play().catch(() => {});
    }

    const check = () => setHasPicture(el.videoWidth > 0);
    // resize covers the far side starting or stopping their camera mid-call.
    el.addEventListener("loadedmetadata", check);
    el.addEventListener("resize", check);
    el.addEventListener("playing", check);
    el.addEventListener("emptied", check);
    check();

    return () => {
      el.removeEventListener("loadedmetadata", check);
      el.removeEventListener("resize", check);
      el.removeEventListener("playing", check);
      el.removeEventListener("emptied", check);
    };
  }, [stream]);

  /*
    Own tile follows the local switch, because the local preview keeps
    producing frames for a moment after the camera is turned off and showing
    yourself when you have just hidden yourself is alarming. Everyone else's
    tile follows the picture, because that is the only thing that is true
    regardless of what was announced and when.
  */
  const showing = isSelf ? (!cameraOff && hasPicture) : hasPicture;

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-800 ring-1 ring-white/10">
      <video
        ref={ref}
        autoPlay
        playsInline
        // Hearing your own microphone back is an echo; everyone else is not.
        muted={isSelf}
        className={cn(
          "h-full w-full object-cover",
          showing ? "opacity-100" : "opacity-0"
        )}
      />

      {!showing && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="grid h-16 w-16 place-items-center rounded-full bg-slate-700 text-lg font-semibold text-white">
            {initials(name)}
          </div>
        </div>
      )}

      {!connected && !isSelf && (
        <div className="absolute inset-0 grid place-items-center bg-slate-900/60">
          <span className="text-xs text-slate-300">Connecting…</span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
        <span className="truncate text-xs font-medium text-white">
          {isSelf ? "You" : name}
        </span>
        {muted && <MicOff className="h-3.5 w-3.5 shrink-0 text-red-400" />}
      </div>
    </div>
  );
}

function ControlButton({
  icon: Icon, label, active, danger, badge, onClick
}: {
  icon: typeof Mic;
  label: string;
  active?: boolean;
  danger?: boolean;
  badge?: number;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // The label is the accessible name and the visible one, so the control
      // reads the same to a screen reader as it does on screen.
      aria-label={label}
      aria-pressed={active}
      className="group flex w-16 flex-col items-center gap-1.5 focus:outline-none"
    >
      <span
        className={cn(
          "relative grid h-11 w-11 place-items-center rounded-full transition-colors",
          "group-focus-visible:ring-2 group-focus-visible:ring-white/70",
          danger
            ? "bg-red-500 text-white group-hover:bg-red-600"
            : active
              ? "bg-white text-slate-900"
              : "bg-white/10 text-white group-hover:bg-white/20"
        )}
      >
        <Icon className="h-5 w-5" />
        {!!badge && badge > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-green-500 px-1 text-[10px] font-semibold text-white">
            {badge}
          </span>
        )}
      </span>
      <span className="text-[11px] text-slate-300">{label}</span>
    </button>
  );
}

/**
 * A group call, filling the screen.
 *
 * Rendered above the routes rather than inside the chat page, because a call
 * outlives the page somebody happened to be on when it started.
 */
export function GroupCallOverlay() {
  const { user } = useAuth();
  const g = useGroupCall();
  const [seconds, setSeconds] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [addSearch, setAddSearch] = useState("");

  /*
    Only fetched while the panel is open. It is the whole staff list, and a
    call has no other use for it -- the same reason the chat page gates it,
    and the same trap: a consumer that forgets to say it wants the list gets
    an empty array rather than an error.
  */
  const contacts = useQuery({
    enabled: panelOpen,
    queryKey: ["chat_contacts"],
    queryFn: async () =>
      (await api.get<Array<{ id: number; name: string; employeeCode?: string }>>(
        "/communities/contacts")).data
  });

  const active = g.state === "active";

  /*
    The clock measures the conversation, not the waiting.

    It used to start the moment the call opened, so the caller watched it count
    up while the phone was still ringing and nobody had picked up -- and the
    duration it ended on was wrong by however long that took. It now starts
    when somebody's media actually arrives, which is the first moment there is
    a call to time.
  */
  const answered = active && g.participants.some((p) => p.connected);

  useEffect(() => {
    if (!answered) { setSeconds(0); return; }
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [answered]);

  /*
    Columns from the count, not a fixed grid.

    Two people should not be shown as two small tiles in a four-column layout
    with half the screen empty. The steps are chosen so the tiles stay close
    to a comfortable size at every room size up to the mesh ceiling.
  */
  const columns = useMemo(() => {
    const n = g.participants.length + 1;
    if (n <= 1) return "grid-cols-1";
    if (n <= 2) return "grid-cols-1 sm:grid-cols-2";
    if (n <= 4) return "grid-cols-2";
    return "grid-cols-2 lg:grid-cols-3";
  }, [g.participants.length]);

  /* ------------------------------------------------------- being invited */

  if (g.state === "incoming" && g.invite) {
    return (
      <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/95 p-6">
        <div className="w-full max-w-sm rounded-2xl bg-slate-900 p-8 text-center ring-1 ring-white/10">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-green-500/20 text-2xl font-semibold text-green-300">
            {initials(g.invite.roomName)}
          </div>
          <h2 className="mt-5 text-xl font-semibold text-white">{g.invite.roomName}</h2>
          <p className="mt-1 text-sm text-slate-400">
            {g.invite.fromName} started a group {g.invite.isVideo ? "video" : "voice"} call
          </p>

          <div className="mt-8 flex items-center justify-center gap-5">
            <button
              type="button"
              onClick={g.decline}
              className="grid h-14 w-14 place-items-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600"
              aria-label="Decline"
            >
              <PhoneOff className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => void g.accept()}
              className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-white transition-colors hover:bg-emerald-600"
              aria-label="Join"
            >
              {g.invite.isVideo ? <Video className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (g.state === "idle") return null;

  /* --------------------------------------------------------- in the call */

  const count = g.participants.length + 1;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-white">{g.roomName}</h1>
          <p className="text-xs tabular-nums text-slate-400">
            {answered
              ? clock(seconds)
              : g.state === "joining" ? "Joining…" : "Ringing…"}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white">
          <Users className="h-3.5 w-3.5" />
          {count} {count === 1 ? "participant" : "participants"}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 sm:px-6">
        <div className={cn("grid gap-3", columns)}>
          <Tile
            isSelf
            name={user?.name || "You"}
            stream={g.localStream}
            muted={g.muted}
            cameraOff={g.cameraOff}
            connected
          />
          {g.participants.map((p: GroupParticipant) => (
            <Tile
              key={p.id}
              name={p.name}
              stream={p.stream}
              muted={p.muted}
              cameraOff={p.cameraOff}
              connected={p.connected}
            />
          ))}
        </div>

        {g.participants.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">
            Waiting for others to join…
          </p>
        )}
      </div>

      {/*
        Who is here, and how to add somebody.

        A panel beside the grid rather than a dialog over it, because adding
        a person is something you do while still watching the call -- covering
        the faces to do it is the wrong trade.
      */}
      {panelOpen && (
        <aside className="absolute bottom-0 right-0 top-0 z-10 flex w-full max-w-sm flex-col border-l border-white/10 bg-slate-900/95 backdrop-blur sm:w-80">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">
              In this call · {count}
            </h2>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-label="Close participants"
              className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <ul className="max-h-52 shrink-0 overflow-y-auto px-2 py-2">
            <li className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-green-500/25 text-[11px] font-semibold text-green-200">
                {initials(user?.name)}
              </span>
              <span className="flex-1 truncate text-sm text-white">You</span>
              {g.muted && <MicOff className="h-3.5 w-3.5 text-red-400" />}
            </li>
            {g.participants.map((p) => (
              <li key={p.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-700 text-[11px] font-semibold text-slate-200">
                  {initials(p.name)}
                </span>
                <span className="flex-1 truncate text-sm text-white">{p.name}</span>
                {!p.connected && <span className="text-[10px] text-slate-400">ringing…</span>}
                {p.muted && <MicOff className="h-3.5 w-3.5 text-red-400" />}
              </li>
            ))}
          </ul>

          <div className="flex min-h-0 flex-1 flex-col border-t border-white/10">
            <div className="flex items-center gap-2 px-4 pb-2 pt-3">
              <UserPlus className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Add someone
              </span>
              <span className="ml-auto text-[11px] text-slate-500">
                {Math.max(0, maxParticipants(g.isVideo) - g.memberIds.length)} slots left
              </span>
            </div>

            <div className="relative px-3 pb-2">
              <Search className="pointer-events-none absolute left-5 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                placeholder="Search people…"
                className="w-full rounded-lg bg-white/10 py-1.5 pl-8 pr-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-white/40"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {contacts.isLoading && (
                <p className="px-3 py-4 text-center text-xs text-slate-400">Loading people…</p>
              )}
              {!contacts.isLoading && (() => {
                // Anyone already in the call, or already ringing, is not an
                // option -- offering them is how you get a duplicate invite.
                const available = (contacts.data ?? []).filter(
                  (c) => c.id !== user?.id && !g.memberIds.includes(c.id) &&
                    c.name?.toLowerCase().includes(addSearch.toLowerCase())
                );
                if (available.length === 0) {
                  return (
                    <p className="px-3 py-4 text-center text-xs text-slate-400">
                      {addSearch ? `Nobody matches “${addSearch}”.` : "Everyone is already here."}
                    </p>
                  );
                }
                // A voice call holds far more people than a video one, so the
                // panel follows the call it is actually in.
                const full = g.memberIds.length >= maxParticipants(g.isVideo);
                return available.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={full}
                    onClick={() => { g.addPeople([c.id]); setAddSearch(""); }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                      full ? "cursor-not-allowed opacity-40" : "hover:bg-white/10"
                    )}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-700 text-[11px] font-semibold text-slate-200">
                      {initials(c.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">{c.name}</span>
                      {c.employeeCode && (
                        <span className="block truncate text-[11px] text-slate-500">{c.employeeCode}</span>
                      )}
                    </span>
                    <UserPlus className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  </button>
                ));
              })()}
            </div>
          </div>
        </aside>
      )}

      <footer className="shrink-0 border-t border-white/10 bg-slate-900/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-center gap-1 sm:gap-3">
          <ControlButton
            icon={g.muted ? MicOff : Mic}
            label={g.muted ? "Unmute" : "Mute"}
            active={g.muted}
            onClick={g.toggleMute}
          />
          {g.isVideo && (
            <ControlButton
              icon={g.cameraOff ? VideoOff : Video}
              label={g.cameraOff ? "Start Video" : "Stop Video"}
              active={g.cameraOff}
              onClick={g.toggleCamera}
            />
          )}
          <ControlButton
            icon={MonitorUp}
            label={g.sharingScreen ? "Stop Share" : "Share Screen"}
            active={g.sharingScreen}
            onClick={() => void g.toggleScreenShare()}
          />
          <ControlButton
            icon={Users}
            label="Participants"
            badge={count}
            active={panelOpen}
            onClick={() => setPanelOpen((v) => !v)}
          />

          <button
            type="button"
            onClick={g.leave}
            className="ml-2 flex items-center gap-2 rounded-full bg-red-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-600 sm:ml-4 sm:px-6"
          >
            <PhoneOff className="h-4 w-4" />
            End
          </button>
        </div>
      </footer>
    </div>
  );
}
