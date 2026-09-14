import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff, MonitorUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function initials(name?: string) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/** One labelled round button in the call's control bar. */
function CallControl({
  icon: Icon, label, active, onClick
}: {
  icon: typeof Mic;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className="group flex w-16 flex-col items-center gap-1.5 focus:outline-none"
    >
      <span
        className={cn(
          "grid h-12 w-12 place-items-center rounded-full transition-colors",
          "group-focus-visible:ring-2 group-focus-visible:ring-white/70",
          active
            ? "bg-white text-neutral-900"
            : "bg-white/15 text-white group-hover:bg-white/25"
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="text-[11px] text-white/70">{label}</span>
    </button>
  );
}

export type CallState = "idle" | "calling" | "ringing" | "incoming" | "connecting" | "connected";

/**
 * A voice or video call, filling the screen. One screen covers being called,
 * calling out and talking — the buttons underneath are what change.
 *
 * It lives above the whole app rather than inside the chat page, because a call
 * can arrive while somebody is looking at their payslip.
 */
export function CallOverlay({
  state, partnerName, isVideo, localStream, remoteStream,
  muted, cameraOff, onAccept, onReject, onHangUp, onToggleMute, onToggleCamera,
  sharingScreen, onToggleScreenShare
}: {
  state: CallState;
  partnerName: string;
  isVideo: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  muted: boolean;
  cameraOff: boolean;
  onAccept: () => void;
  onReject: () => void;
  onHangUp: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  sharingScreen: boolean;
  onToggleScreenShare: () => void;
}) {
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const mainLocalVideo = useRef<HTMLVideoElement | null>(null);
  // The other side plays through a video element on a video call and a bare
  // audio element otherwise; only one of the two is ever mounted.
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  const [seconds, setSeconds] = useState(0);

  /*
    Bumped whenever the far side's tracks change.

    A MediaStream is mutable, and both of the other person's tracks belong to
    the same one. The audio track arrives first and the stream is put into
    state; the video track is then added to that very same object, so the
    reference React holds is unchanged and it correctly decides there is
    nothing to re-render. hasRemoteVideo below stays as it was computed when
    the stream held audio only -- false -- and the remote picture is never
    shown at all, on either side, for the whole call.

    Watching the stream itself is what makes the derived values below true:
    addtrack for a track appearing, mute and unmute for the other side
    turning their camera off and on, which are events on the receiving end
    rather than anything that travels in the signalling.
  */
  const [remoteRevision, setRemoteRevision] = useState(0);

  /*
    Watch the far side's tracks appear and change.

    This effect must not depend on the counter it increments. It did, and it
    also bumped unconditionally on every run, so it re-triggered itself for
    ever: render, bump, render, bump. A React loop like that does not throw --
    it simply occupies the main thread, and the video pipeline never gets the
    time it needs to decode a frame. The symptom was the far side's picture
    never arriving, which is exactly what it looks like when a connection is
    at fault, and is why it took a while to find.

    Tracks added later are handled by listening to the stream, and attaching
    the per-track listeners from inside that handler, rather than by
    re-running this whole effect.
  */
  useEffect(() => {
    if (!remoteStream) return;
    const bump = () => setRemoteRevision((n) => n + 1);

    const watchTrack = (t: MediaStreamTrack) => {
      t.addEventListener("mute", bump);
      t.addEventListener("unmute", bump);
      t.addEventListener("ended", bump);
    };
    const unwatchTrack = (t: MediaStreamTrack) => {
      t.removeEventListener("mute", bump);
      t.removeEventListener("unmute", bump);
      t.removeEventListener("ended", bump);
    };

    const onAddTrack = (e: MediaStreamTrackEvent) => { watchTrack(e.track); bump(); };
    const watched = remoteStream.getTracks();
    watched.forEach(watchTrack);

    remoteStream.addEventListener("addtrack", onAddTrack);
    remoteStream.addEventListener("removetrack", bump);

    return () => {
      remoteStream.removeEventListener("addtrack", onAddTrack);
      remoteStream.removeEventListener("removetrack", bump);
      // Whatever the stream holds now, not what it held when this ran.
      remoteStream.getTracks().forEach(unwatchTrack);
      watched.forEach(unwatchTrack);
    };
  }, [remoteStream]);

  /*
    Whether the far side's picture is actually arriving.

    This asked the track: live, and not muted. Both of those are unreliable
    for a track you are receiving rather than sending. A received track starts
    muted and is unmuted by the browser when media begins, but the unmute can
    fire before anything is listening for it, and several browsers simply
    leave muted true for the life of a perfectly good stream. The result was
    a call that showed your own camera full screen with "their camera is off"
    written across it, while their video was flowing the whole time.

    The video element is the ground truth. It reports a width once it has
    decoded a frame, and a width means there is a picture -- no browser
    disagrees about that.
  */
  const [remoteHasPicture, setRemoteHasPicture] = useState(false);

  useEffect(() => {
    const el = remoteVideo.current;
    if (!el) return;

    const check = () => {
      if (el.videoWidth > 0) {
        setRemoteHasPicture(true);
      }
    };

    // resize fires when the far side's camera starts, stops or changes size
    el.addEventListener("loadedmetadata", check);
    el.addEventListener("loadeddata", check);
    el.addEventListener("resize", check);
    el.addEventListener("playing", check);
    el.addEventListener("timeupdate", check);
    check();

    const interval = setInterval(check, 300);

    return () => {
      clearInterval(interval);
      el.removeEventListener("loadedmetadata", check);
      el.removeEventListener("loadeddata", check);
      el.removeEventListener("resize", check);
      el.removeEventListener("playing", check);
      el.removeEventListener("timeupdate", check);
    };
  }, [remoteStream, remoteRevision, state]);

  /** A live video track exists, whether or not it has produced a picture yet. */
  const remoteVideoTrackLive = !!remoteStream
    && remoteStream.getVideoTracks().some((t) => t.readyState === "live" && t.enabled !== false);

  const hasRemoteVideo = isVideo && (remoteHasPicture || remoteVideoTrackLive);
  const hasLocalVideo = isVideo && !!localStream && localStream.getVideoTracks().some(t => t.readyState === "live" && t.enabled) && !cameraOff;

  // Streams are attached through the DOM rather than a src attribute. The state
  // and kind are watched too: connecting swaps the audio element for a video
  // one, and the new element would otherwise never be given the stream.
  useEffect(() => {
    if (localVideo.current) {
      localVideo.current.srcObject = localStream ?? null;
      if (localStream) localVideo.current.play().catch(() => {});
    }
  }, [localStream, state, isVideo, cameraOff]);

  useEffect(() => {
    if (remoteVideo.current) {
      remoteVideo.current.muted = true;
      if (remoteVideo.current.srcObject !== (remoteStream ?? null)) {
        remoteVideo.current.srcObject = remoteStream ?? null;
      }
      if (remoteStream) remoteVideo.current.play().catch(() => {});
    }
    if (remoteAudio.current) {
      if (remoteAudio.current.srcObject !== (remoteStream ?? null)) {
        remoteAudio.current.srcObject = remoteStream ?? null;
      }
      if (remoteStream) remoteAudio.current.play().catch(() => {});
    }
  }, [remoteStream, state, isVideo]);

  useEffect(() => {
    if (state !== "connected") return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [state]);

  const label =
    state === "incoming" ? `Incoming ${isVideo ? "video" : "voice"} call`
      : state === "calling" ? "Calling…"
        : state === "ringing" ? "Ringing…"
          : state === "connecting" ? "Connecting…"
            : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-neutral-900/95 p-6 text-white">
      {/* Background or Main Video */}
      {isVideo ? (
        <div className="relative flex-1 w-full max-w-4xl overflow-hidden rounded-2xl bg-black shadow-2xl flex items-center justify-center">
          {/* Main Remote Video Element - Always Mounted & Muted for Unrestricted Real-Time WebRTC Video Decoding */}
          <video
            ref={remoteVideo}
            autoPlay
            playsInline
            muted
            className={cn(
              "h-full w-full object-contain bg-black transition-opacity duration-300",
              (!hasRemoteVideo || state !== "connected") ? "opacity-0 absolute inset-0 pointer-events-none" : "opacity-100 relative z-10"
            )}
          />

          {/* Center Avatar & Status Card when remote video is not active or while connecting */}
          {(!hasRemoteVideo || state !== "connected") && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-neutral-900/90 z-0">
              <div className="flex h-28 w-28 animate-pulse items-center justify-center rounded-full bg-white/20 text-4xl font-bold backdrop-blur-sm shadow-xl border border-white/10">
                {initials(partnerName)}
              </div>
              <h3 className="font-display text-2xl font-bold drop-shadow-md">{partnerName}</h3>
              <p className="text-sm font-medium tabular-nums text-white/80 bg-black/50 px-4 py-1.5 rounded-full backdrop-blur-md">
                {state === "connected"
                  ? (remoteVideoTrackLive ? `Connecting video for ${partnerName}…` : `${partnerName}'s camera is off`)
                  : label}
              </p>
            </div>
          )}

          {/* Local Camera PIP Box (Bottom Right) - Live preview of your own face */}
          {hasLocalVideo && (
            <div className="absolute bottom-4 right-4 z-30 w-36 h-28 sm:w-48 sm:h-36 rounded-xl border-2 border-white/30 overflow-hidden bg-black shadow-2xl">
              <video
                ref={localVideo}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover -scale-x-100"
              />
            </div>
          )}

          <div className="absolute left-4 top-4 z-20 rounded-full bg-black/60 px-4 py-1.5 text-sm font-semibold tabular-nums backdrop-blur-md">
            {partnerName} · {label}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <div className={cn(
            "flex h-28 w-28 items-center justify-center rounded-full bg-white/10 text-4xl font-bold shadow-lg",
            state !== "connected" && "animate-pulse"
          )}>
            {initials(partnerName)}
          </div>
          <h3 className="font-display text-2xl font-bold">{partnerName}</h3>
          <p className="text-base tabular-nums text-white/70">{label}</p>
        </div>
      )}
      {/* Audio element ensuring remote voice is played unconditionally for all calls */}
      <audio ref={remoteAudio} autoPlay className="hidden" />

      <div className="mt-6 flex items-center gap-3">
        {state === "incoming" ? (
          <>
            <Button
              type="button"
              size="icon"
              onClick={onReject}
              title="Decline"
              className="h-14 w-14 rounded-full bg-red-500 text-white hover:bg-red-600"
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
            <Button
              type="button"
              size="icon"
              onClick={onAccept}
              title="Accept"
              className="h-14 w-14 rounded-full bg-emerald-500 text-white hover:bg-emerald-600"
            >
              {isVideo ? <Video className="h-6 w-6" /> : <Phone className="h-6 w-6" />}
            </Button>
          </>
        ) : (
          <>
            {/* Labelled, because an unlabelled circle of icons makes people
                guess which one hangs up. The label is also the accessible
                name, so the control reads the same either way. */}
            <CallControl
              icon={muted ? MicOff : Mic}
              label={muted ? "Unmute" : "Mute"}
              active={muted}
              onClick={onToggleMute}
            />
            {isVideo && (
              <CallControl
                icon={cameraOff ? VideoOff : Video}
                label={cameraOff ? "Start Video" : "Stop Video"}
                active={cameraOff}
                onClick={onToggleCamera}
              />
            )}
            {isVideo && state === "connected" && (
              <CallControl
                icon={MonitorUp}
                label={sharingScreen ? "Stop Share" : "Share Screen"}
                active={sharingScreen}
                onClick={onToggleScreenShare}
              />
            )}
            <button
              type="button"
              onClick={onHangUp}
              className="ml-3 flex items-center gap-2 rounded-full bg-red-500 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-red-600"
            >
              <PhoneOff className="h-4 w-4" />
              End Call
            </button>
          </>
        )}
      </div>
      {/* Invisible Audio element dedicated for un-blocked audio playback */}
      <audio ref={remoteAudio} autoPlay playsInline className="hidden" />
    </div>
  );
}
