import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState
} from "react";
import { useNavigate } from "react-router-dom";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";
import toast from "react-hot-toast";
import { api, tokenStore } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { CallOverlay, type CallState } from "@/components/CallOverlay";
import { setLiveCaller } from "@/lib/liveCall";

const BASE = import.meta.env.VITE_API_URL || "";

/** A call rings for this long before it is given up on as unanswered. */
const NO_ANSWER_MS = 45_000;

const iceServers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" }
  ]
};

export interface CallSignal {
  senderId: number;
  senderName: string;
  type: string;
  data: any;
}

interface CallApi {
  callState: "idle" | CallState;
  activeCallPartner: { id: number; name: string } | null;
  callIsVideo: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  startCall: (partnerId: number, partnerName: string, isVideo: boolean) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  hangUp: () => void;
  toggleTrack: (kind: "audio" | "video") => boolean;
  /** True while the screen is being sent instead of the camera. */
  sharingScreen: boolean;
  toggleScreenShare: () => Promise<void>;

  /*
    The three below exist so a group call can be built on this connection
    rather than beside it. A second STOMP client would mean a second socket,
    a second reconnect cycle and two places where a signal can be missed --
    and the server already fans every signal for this user out to the one
    topic this provider is listening on.
  */
  /** Relay a signal to one person. Same channel a one-to-one call uses. */
  sendSignal: (recipientId: number, type: string, data: any) => Promise<void>;
  /** Watch every incoming signal. Returns the function that stops watching. */
  addSignalListener: (fn: (signal: CallSignal) => void) => () => void;
  /** TURN and STUN as configured on the server, with public STUN as backup. */
  getIceServers: () => Promise<RTCConfiguration>;
}

const CallContext = createContext<CallApi | null>(null);

/**
 * The ringing tone, as a pair of oscillators rather than an audio file.
 *
 * Exported so a group call rings with the same sound as a one-to-one one. A
 * second implementation would drift from this one, and two different ring
 * tones in the same product is the kind of detail that reads as two different
 * products.
 */
export function playRingtone() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return () => {};
    const ctx = new AudioCtx();

    let isRinging = true;
    const ringCycle = () => {
      if (!isRinging || ctx.state === "closed") return;
      try {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.frequency.setValueAtTime(440, ctx.currentTime);
        osc2.frequency.setValueAtTime(480, ctx.currentTime);

        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.8);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(ctx.currentTime);
        osc2.start(ctx.currentTime);
        osc1.stop(ctx.currentTime + 1.8);
        osc2.stop(ctx.currentTime + 1.8);

        if (isRinging) {
          setTimeout(ringCycle, 2800);
        }
      } catch (e) {}
    };

    ringCycle();

    return () => {
      isRinging = false;
      ctx.close().catch(() => {});
    };
  } catch (e) {
    return () => {};
  }
}

/**
 * Calling, for the whole portal rather than the chat page.
 *
 * <p>The engine used to live inside the chat hook, which meant the person being
 * called only ever heard about it if they happened to be sitting on Chat — from
 * anywhere else the phone simply never rang. It is mounted once, above the
 * routes, so a call arrives wherever somebody is working.
 *
 * <p>The handshake is ordered so that a late listener still connects. The caller
 * opens their own microphone, says "calling", and then <em>waits</em>. Only when
 * the other side answers with "ringing" — which it cannot do until it is
 * listening — does the offer go out. Answering opens the callee's devices and
 * replies; the caller learns the room is live from the answer.
 */
export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [callState, setCallState] = useState<"idle" | CallState>("idle");
  const [activeCallPartner, setActiveCallPartner] = useState<{ id: number; name: string } | null>(null);
  const [callIsVideo, setCallIsVideo] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const clientRef = useRef<Client | null>(null);
  const [connected, setConnected] = useState(false);

  // The signal handler is rebuilt on every render, so it reads live state from
  // refs rather than from a closure that was captured at subscribe time.
  const callStateRef = useRef(callState);
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  const partnerRef = useRef(activeCallPartner);
  useEffect(() => { partnerRef.current = activeCallPartner; }, [activeCallPartner]);

  /** An offer that arrived before Accept was pressed. */
  const pendingOfferRef = useRef<{ senderId: number; sdp: any; isVideo: boolean } | null>(null);
  /** Candidates that arrived before there was a connection to feed them to. */
  const pendingCandidatesRef = useRef<any[]>([]);
  /** True on the side that placed the call, which is the side that offers. */
  const isCallerRef = useRef(false);
  /// Guards against two restarts overlapping, and caps how many are attempted.
  const restartingRef = useRef(false);
  const restartCountRef = useRef(0);
  /** Guards against sending a second offer if "ringing" arrives twice. */
  const offerSentRef = useRef(false);
  /**
   * The pending "give up on this call" timer.
   *
   * Held in a ref rather than left to fire because it has to be cancellable.
   * It was previously started and forgotten, so a connection that failed
   * twice had two timers racing, and -- the case that actually ended calls --
   * a repair that was working could not stop the timer that was about to
   * throw the call away.
   */
  const giveUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Stop the countdown. Called whenever there is evidence of recovery. */
  const cancelGiveUp = useCallback(() => {
    if (giveUpTimerRef.current) {
      clearTimeout(giveUpTimerRef.current);
      giveUpTimerRef.current = null;
    }
  }, []);

  const sendSignal = useCallback(async (recipientId: number, type: string, data: any) => {
    try {
      await api.post("/calls/signal", { recipientId, type, data });
    } catch (e) {
      console.error("Failed to send calling signal", e);
    }
  }, []);

  /** Records the call in the conversation, so the chat shows it happened. */
  const logCall = useCallback(async (
    partnerId: number,
    outcome: "MISSED" | "DECLINED" | "ENDED",
    isVideo: boolean,
    seconds: number
  ) => {
    try {
      await api.post("/calls/log", { recipientId: partnerId, outcome, video: isVideo, seconds });
    } catch (e) {
      console.error("Could not record the call in the chat", e);
    }
  }, []);

  const cleanupCall = useCallback(() => {
    if (giveUpTimerRef.current) {
      clearTimeout(giveUpTimerRef.current);
      giveUpTimerRef.current = null;
    }
    pendingOfferRef.current = null;
    pendingCandidatesRef.current = [];
    isCallerRef.current = false;
    offerSentRef.current = false;
    /*
      The restart budget belongs to a call, not to the tab. It was only ever
      cleared on reaching "connected", so a call that failed for good left the
      counter spent -- and the next call, and every call after it in that tab,
      got no repair attempt at all and ended the moment the network hiccuped.
    */
    restartCountRef.current = 0;
    restartingRef.current = false;
    cameraTrackRef.current?.stop();
    cameraTrackRef.current = null;
    setSharingScreen(false);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);
    setActiveCallPartner(null);
    setCallState("idle");
    setMuted(false);
    setCameraOff(false);
  }, []);

  const [sharingScreen, setSharingScreen] = useState(false);
  /*
    The camera track is kept alive while the screen is being shared rather
    than stopped. Stopping it turns the light off, but it also means the
    camera has to be reopened to come back -- which is slow, and on some
    machines asks for permission again in the middle of a call.
  */
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);

  /**
   * Send the screen instead of the camera, and back again.
   *
   * replaceTrack rather than a renegotiation: it swaps what the existing
   * sender is sending without a new offer, so the other side's picture
   * changes over without the call visibly reconnecting.
   */
  const toggleScreenShare = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    const sender = pc.getSenders().find((sn) => sn.track?.kind === "video");
    if (!sender) {
      toast.error("Screen sharing needs a video call.");
      return;
    }

    if (sharingScreen) {
      const camera = cameraTrackRef.current;
      if (camera) {
        await sender.replaceTrack(camera);
        const shown = localStreamRef.current?.getVideoTracks()[0];
        if (shown && shown !== camera) {
          shown.stop();
          localStreamRef.current?.removeTrack(shown);
          localStreamRef.current?.addTrack(camera);
        }
      }
      setSharingScreen(false);
      return;
    }

    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = display.getVideoTracks()[0];
      if (!track) return;

      if (!cameraTrackRef.current) {
        cameraTrackRef.current = localStreamRef.current?.getVideoTracks()[0] ?? null;
      }
      await sender.replaceTrack(track);

      const old = localStreamRef.current?.getVideoTracks()[0];
      if (old) localStreamRef.current?.removeTrack(old);
      localStreamRef.current?.addTrack(track);
      setSharingScreen(true);

      // The browser's own "Stop sharing" bar never touches our button, so the
      // camera has to be restored from the track ending as well.
      track.onended = () => { void toggleScreenShare(); };
    } catch {
      // The picker was dismissed; not worth a message.
    }
  }, [sharingScreen]);

  /*
    Publish who is on the call so a notification toast can be worded for the
    moment it is shown rather than the moment it was written. The server
    writes "X is calling you" once, when the call starts, and never revisits
    it -- so without this the toast for a call that rang out still says
    somebody is calling.
  */
  useEffect(() => {
    setLiveCaller(callState !== "idle" ? (activeCallPartner?.name ?? null) : null);
  }, [callState, activeCallPartner?.name]);


  /** When the conversation started, so a call log can say how long it ran. */
  const connectedAtRef = useRef<number | null>(null);
  useEffect(() => {
    connectedAtRef.current = callState === "connected" ? Date.now() : null;
  }, [callState]);

  const elapsedSeconds = () =>
    connectedAtRef.current ? Math.round((Date.now() - connectedAtRef.current) / 1000) : 0;

  const drainCandidates = useCallback(async () => {
    const queued = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of queued) {
      try {
        await pcRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error("Error adding queued ICE candidate", e);
      }
    }
  }, []);

  /*
    The TURN and STUN list, fetched once and kept.

    This was fetched fresh every time a call was answered or dialled, and the
    fetch sits in front of everything else: no peer connection can be built
    without it. The server is in Paris and the people using this are in
    Coimbatore, so that was around 650ms of doing nothing, every time, before
    the camera was even asked for. On answering a call that is the difference
    between "instant" and "why is this taking so long".

    The list changes when somebody edits the TURN configuration, which is
    approximately never, so ten minutes is a generous freshness window and
    still bounded -- a credential rotation is picked up without a reload.
  */
  const iceCacheRef = useRef<{ config: RTCConfiguration; at: number } | null>(null);
  const ICE_CACHE_MS = 10 * 60 * 1000;

  const getIceServersConfig = useCallback(async (): Promise<RTCConfiguration> => {
    const cached = iceCacheRef.current;
    if (cached && Date.now() - cached.at < ICE_CACHE_MS) return cached.config;
    try {
      const res = await api.get<{ iceServers: RTCIceServer[] }>("/calls/ice-servers");
      if (res.data?.iceServers && res.data.iceServers.length > 0) {
        const config: RTCConfiguration = {
          iceServers: res.data.iceServers,
          iceCandidatePoolSize: 10
        };
        iceCacheRef.current = { config, at: Date.now() };
        return config;
      }
    } catch (e) {
      console.warn("Could not fetch server ICE config, using default STUN", e);
    }
    return {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        { urls: "stun:global.stun.twilio.com:3478" }
      ],
      iceCandidatePoolSize: 10
    };
  }, []);
  /*
    Fetch the TURN list before anybody needs it.

    Once when the provider mounts, and again the moment a call starts ringing.
    A ringing phone gives us several seconds while somebody reaches for the
    mouse, and spending them on a round trip that would otherwise happen after
    they click is free speed: by the time Accept is pressed the answer is
    already in hand and the only remaining wait is the camera opening.
  */
  useEffect(() => {
    if (!user?.id) return;
    void getIceServersConfig();
  }, [user?.id, getIceServersConfig]);

  useEffect(() => {
    if (callState === "incoming" || callState === "calling") {
      void getIceServersConfig();
    }
  }, [callState, getIceServersConfig]);

  const setupPeerConnection = useCallback(async (partnerId: number, isVideo: boolean) => {
    // The camera and microphone are only offered to a secure page. On plain HTTP
    // navigator.mediaDevices does not exist at all, so say why rather than
    // failing with a browser message about permissions.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Calls need a secure (https) connection. Ask your admin to enable HTTPS on the portal."
      );
    }
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      /*
        1080p asked for, 720p accepted, nothing below 360p.

        The old numbers asked for 640x480 and capped at 720p, so even people
        on a good line and a good camera got a soft picture -- the browser
        gives you what you ask for, not the best the camera can do.

        4K is deliberately not requested. A 2160p stream is roughly 20 Mbit/s
        upstream, more than most office connections have to spare in the
        upward direction, and it is decoded into a window a few hundred
        pixels tall. Asking for it does not produce a sharper call; it
        produces a call that stalls. 1080p is the point where more pixels
        stop being visible on screen and start being dropped frames.
      */
      video: isVideo ? {
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 30, max: 30 }
      } : false
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err: any) {
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        toast.error(isVideo ? "Camera & Microphone access is required for video calls." : "Microphone access is required for audio calls.");
      } else {
        toast.error("Could not access media devices: " + (err.message || "Unknown error"));
      }
      throw err;
    }

    localStreamRef.current = stream;
    setLocalStream(stream);

    const iceConfig = await getIceServersConfig();
    const pc = new RTCPeerConnection(iceConfig);
    pcRef.current = pc;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    /*
      Raise the ceiling on the video encoder.

      Capturing at 1080p achieves nothing on its own: browsers start a video
      sender at somewhere around 1 to 2.5 Mbit/s regardless of what the camera
      is producing, and simply re-encode the high resolution frames down to
      fit. The picture stays soft and the extra capture work is wasted.

      2.5 Mbit/s is chosen rather than something larger because it is about
      what 1080p30 of a talking head needs -- faces are mostly still, so the
      codec spends very little on most of the frame -- and because a ceiling
      the network cannot sustain is worse than a lower one: congestion
      control reacts by dropping frames, and a stuttering sharp picture
      reads as more broken than a smooth slightly softer one.

      maintain-framerate says which way to give when the line cannot keep up.
      Faces in motion look wrong at low frame rates in a way they do not look
      wrong at slightly reduced resolution.

      Wrapped because setParameters is not implemented identically across
      browsers, and a failure here must not stop a call that would otherwise
      connect perfectly well at the default bitrate.
    */
    void (async () => {
      try {
        const videoSender = pc.getSenders().find((sn) => sn.track?.kind === "video");
        if (!videoSender) return;
        const params = videoSender.getParameters();
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
        params.encodings[0].maxBitrate = 2_500_000;
        params.degradationPreference = "maintain-framerate";
        await videoSender.setParameters(params);
      } catch {
        // Default bitrate it is.
      }
    })();

    pc.ontrack = (event) => {
      const stream = (event.streams && event.streams[0]) ? event.streams[0] : null;
      if (stream) {
        setRemoteStream(stream);
        stream.onaddtrack = () => {
          setRemoteStream(new MediaStream(stream.getTracks()));
        };
        stream.onremovetrack = () => {
          setRemoteStream(new MediaStream(stream.getTracks()));
        };
      } else if (event.track) {
        setRemoteStream((prev) => {
          if (prev) {
            if (!prev.getTracks().some((t) => t.id === event.track.id)) {
              prev.addTrack(event.track);
            }
            return new MediaStream(prev.getTracks());
          }
          return new MediaStream([event.track]);
        });
      }
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) sendSignal(partnerId, "candidate", { candidate: event.candidate });
    };

    /*
     * Rebuild the path when ICE fails, rather than only asking for one.
     *
     * This called pc.restartIce() on its own. That does not restart anything by
     * itself — it marks the connection as needing fresh candidates and fires
     * negotiationneeded, and something has to answer that by creating an offer
     * and sending it. There was no negotiationneeded handler, so the flag was
     * set and nothing ever followed: the restart never happened, the three
     * second timer below expired, and the call ended with "The connection
     * dropped."
     *
     * ICE fails routinely mid-call — wifi handing over to mobile, a carrier
     * rotating its NAT binding, a laptop waking up. Every one of those was
     * ending the call outright when a restart would have carried it through.
     */
    const restartIceProperly = async () => {
      const conn = pcRef.current;
      if (!conn || restartingRef.current) return;

      // Only the caller renegotiates. Both sides offering at the same moment is
      // glare: the offers collide, neither applies, and the call ends up worse
      // off than the failure that prompted them.
      if (!isCallerRef.current) return;

      // Twice. If two fresh sets of candidates cannot find a path, there is no
      // path — the network is blocking it — and retrying forever leaves two
      // people watching a call that will never come back.
      if (restartCountRef.current >= 2) return;

      restartingRef.current = true;
      restartCountRef.current += 1;
      try {
        const offer = await conn.createOffer({ iceRestart: true });
        await conn.setLocalDescription(offer);
        sendSignal(partnerId, "offer", { sdp: offer, iceRestart: true });
      } catch (e) {
        // Past saving; the timer below will close it.
      } finally {
        restartingRef.current = false;
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") void restartIceProperly();
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        void restartIceProperly();
        // Eight seconds, not three. A restart has to gather candidates, reach
        // the TURN server and complete a round trip through the other client —
        // on a slow mobile connection three seconds cut off restarts that were
        // still in progress and would have succeeded.
        //
        // Only ever one of these. Restarting the countdown on each failure
        // rather than stacking a second timer beside the first is what keeps
        // the deadline meaning "eight seconds since the last bad news".
        cancelGiveUp();
        giveUpTimerRef.current = setTimeout(() => {
          giveUpTimerRef.current = null;
          if (pcRef.current && (pcRef.current.connectionState === "failed" || pcRef.current.connectionState === "closed")) {
            if (callStateRef.current === "connected" || callStateRef.current === "connecting" || callStateRef.current === "ringing") {
              toast.error("The connection dropped.");
              cleanupCall();
            }
          }
        }, 8000);
      }

      /*
        Recovered.

        Clearing the budget lets a later, unrelated failure have its own two
        attempts instead of inheriting a spent counter from an hour ago, and
        cancelling the countdown is what stops a call that has already come
        back from being torn down by a timer set before it did. Without that
        second line the timer fired, found the connection healthy, and did
        nothing -- but only because of a guard; anything that made the state
        wobble at the eight second mark ended a working call.
      */
      if (pc.connectionState === "connected") {
        restartCountRef.current = 0;
        cancelGiveUp();
      }
    };
    return pc;
  }, [sendSignal, cleanupCall, getIceServersConfig, cancelGiveUp]);

  const startCall = useCallback(async (partnerId: number, partnerName: string, isVideo: boolean) => {
    if (callStateRef.current !== "idle") return;

    setActiveCallPartner({ id: partnerId, name: partnerName });
    setCallIsVideo(isVideo);
    setCallState("calling");
    pendingOfferRef.current = null;
    pendingCandidatesRef.current = [];
    isCallerRef.current = true;
    offerSentRef.current = false;

    try {
      // Own devices first: if they are unavailable there is no point making the
      // other phone ring, and the caller hears the reason straight away.
      await setupPeerConnection(partnerId, isVideo);
      // The offer waits for "ringing" — see the note on this provider.
      await sendSignal(partnerId, "calling", { isVideo });
    } catch (e) {
      cleanupCall();
      throw e;
    }
  }, [setupPeerConnection, sendSignal, cleanupCall]);

  const acceptCall = useCallback(async () => {
    const partner = partnerRef.current;
    // We read it here just to know if it's video, but we MUST read it again after setup.
    const initialOffer = pendingOfferRef.current;
    if (!partner) return;

    try {
      const isVideo = initialOffer?.isVideo ?? callIsVideo;
      const pc = await setupPeerConnection(partner.id, isVideo);

      if (pc.remoteDescription) {
        // The offer arrived and was processed by handleSignal while we were waiting for the camera!
        return;
      }

      // READ AGAIN! The offer might have arrived while we were waiting for the camera.
      const currentOffer = pendingOfferRef.current;

      if (!currentOffer) {
        // Answered before the offer landed. Ask again and let the arriving offer
        // be answered below; the caller re-sends on "ringing".
        setCallState("connecting");
        await sendSignal(partner.id, "ringing", null);
        return;
      }

      await pc.setRemoteDescription(new RTCSessionDescription(currentOffer.sdp));
      await drainCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal(partner.id, "answer", { sdp: answer });
      pendingOfferRef.current = null;
      setCallState("connected");
    } catch (e: any) {
      if (partner) sendSignal(partner.id, "decline", null);
      cleanupCall();
      throw e;
    }
  }, [callIsVideo, setupPeerConnection, drainCandidates, sendSignal, cleanupCall]);

  const rejectCall = useCallback(() => {
    const partner = partnerRef.current;
    if (partner) {
      sendSignal(partner.id, "decline", null);
      logCall(partner.id, "DECLINED", callIsVideo, 0);
    }
    cleanupCall();
  }, [sendSignal, logCall, callIsVideo, cleanupCall]);

  const hangUp = useCallback(() => {
    const partner = partnerRef.current;
    if (partner) {
      sendSignal(partner.id, "hangup", null);
      const seconds = elapsedSeconds();
      // Hanging up before anybody answered is a missed call, not a short one.
      logCall(partner.id, seconds > 0 ? "ENDED" : "MISSED", callIsVideo, seconds);
    }
    cleanupCall();
  }, [sendSignal, logCall, callIsVideo, cleanupCall]);

  const toggleTrack = useCallback((kind: "audio" | "video") => {
    const tracks = kind === "audio"
      ? localStreamRef.current?.getAudioTracks()
      : localStreamRef.current?.getVideoTracks();
    if (!tracks || tracks.length === 0) return false;
    const next = !tracks[0].enabled;
    tracks.forEach((t) => { t.enabled = next; });
    return next;
  }, []);

  /** Signals arriving from the other side. */
  const handleSignal = useCallback(async (signal: CallSignal) => {
    const { senderId, senderName, type, data } = signal;

    switch (type) {
      case "calling":
        if (callStateRef.current === "idle") {
          pendingOfferRef.current = null;
          pendingCandidatesRef.current = [];
          isCallerRef.current = false;
          setActiveCallPartner({ id: senderId, name: senderName });
          setCallIsVideo(!!data?.isVideo);
          setCallState("incoming");
          // Saying "ringing" is also what tells the caller to send the offer,
          // so it must only be said once this side is genuinely listening.
          sendSignal(senderId, "ringing", null);
        } else {
          sendSignal(senderId, "decline", { reason: "busy" });
        }
        break;

      case "ringing":
        // The other side is listening — now the offer can go.
        if (isCallerRef.current && pcRef.current && !offerSentRef.current) {
          offerSentRef.current = true;
          setCallState("ringing");
          try {
            const offer = await pcRef.current.createOffer();
            await pcRef.current.setLocalDescription(offer);
            await sendSignal(senderId, "offer", { sdp: offer, isVideo: callIsVideo });
          } catch (e) {
            console.error("Could not offer the call", e);
            toast.error("Could not start the call.");
            cleanupCall();
          }
        }
        break;

      case "offer":
        // Held until Accept is pressed, unless this side already accepted and
        // was waiting for it.
        if (pcRef.current && localStreamRef.current && !isCallerRef.current) {
          /*
            An offer arriving on a call that is already up is the other side
            repairing the path, not a new call.

            This is the side that cannot repair anything itself -- only the
            caller may re-offer, or the two offers collide as glare -- so all
            it could previously do was watch its own eight second countdown
            run out. When the repair took longer than the remainder of that
            countdown, this side hung up on a call that was in the middle of
            coming back, and the other side saw the call die just as its
            restart succeeded. That is the "connection dropped" people were
            getting on calls that recovered.

            Arrival of the offer is proof the far end is alive and working on
            it, so the countdown is cancelled here and, if the repair does not
            land, the connection will fail again and start a fresh one.
          */
          if (data?.iceRestart) cancelGiveUp();
          try {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(data?.sdp));
            await drainCandidates();
            const answer = await pcRef.current.createAnswer();
            await pcRef.current.setLocalDescription(answer);
            await sendSignal(senderId, "answer", { sdp: answer });
            setCallState("connected");
          } catch (e) {
            console.error("Could not answer the call", e);
            cleanupCall();
          }
          break;
        }
        if (callStateRef.current === "idle" || callStateRef.current === "incoming"
            || callStateRef.current === "ringing" || callStateRef.current === "connecting") {
          pendingOfferRef.current = { senderId, sdp: data?.sdp, isVideo: !!data?.isVideo };
          setActiveCallPartner({ id: senderId, name: senderName });
          setCallIsVideo(!!data?.isVideo);
          if (callStateRef.current === "idle") {
            setCallState("incoming");
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              try {
                const n = new Notification(`📞 Incoming ${data?.isVideo ? "Video" : "Voice"} Call`, {
                  body: `${senderName} is calling you. Click to answer.`,
                  icon: "/pixous-logo.png",
                  requireInteraction: true,
                  tag: "incoming-call"
                });
                n.onclick = () => {
                  window.focus();
                  n.close();
                };
              } catch (e) {}
            }
          }
        }
        break;

      case "answer":
        if (pcRef.current) {
          // The far end answered, so it is there and negotiating. Same reason
          // as above: do not let a countdown started before this arrived end a
          // call that is in the middle of being repaired.
          cancelGiveUp();
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
          await drainCandidates();
          setCallState("connected");
        }
        break;

      case "candidate":
        if (!data?.candidate) break;
        if (!pcRef.current || !pcRef.current.remoteDescription) {
          pendingCandidatesRef.current.push(data.candidate);
          break;
        }
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error("Error adding received ICE candidate", e);
        }
        break;

      case "decline": {
        const busy = data?.reason === "busy";
        if (callStateRef.current !== "idle") {
          toast.error(busy ? "They are on another call." : "Call declined.");
          if (isCallerRef.current) logCall(senderId, busy ? "MISSED" : "DECLINED", callIsVideo, 0);
        }
        cleanupCall();
        break;
      }

      case "hangup":
        if (callStateRef.current === "incoming") toast("Missed call", { icon: "📞" });
        cleanupCall();
        break;

      default:
        break;
    }
  }, [sendSignal, drainCandidates, cleanupCall, logCall, callIsVideo, cancelGiveUp]);

  /*
    Extra listeners on the same stream of signals.

    A Set rather than an array so a listener that somehow registers twice
    still only fires once, and so removal is by identity rather than index --
    indexes shift when an earlier listener unsubscribes first.
  */
  const signalListenersRef = useRef(new Set<(s: CallSignal) => void>());
  const addSignalListener = useCallback((fn: (s: CallSignal) => void) => {
    signalListenersRef.current.add(fn);
    return () => { signalListenersRef.current.delete(fn); };
  }, []);

  const handlerRef = useRef(handleSignal);
  useEffect(() => { handlerRef.current = handleSignal; }, [handleSignal]);

  // One connection for the life of the session, so the phone can ring on any
  // page. Signals are dispatched through a ref so re-subscribing is unnecessary.
  useEffect(() => {
    if (!tokenStore.access || !user) return;

    const client = new Client({
      webSocketFactory: () => new SockJS(`${BASE}/ws`),
      connectHeaders: { Authorization: `Bearer ${tokenStore.access}` },
      reconnectDelay: 5000,
      onConnect: () => {
        clientRef.current = client;
        setConnected(true);
        client.subscribe(`/topic/calls/${user.id}`, (msg) => {
          try {
            const signal = JSON.parse(msg.body) as CallSignal;
            /*
              Listeners first, and each in its own try, because one that
              throws must not stop the others or the one-to-one handler
              below it. A group call going wrong cannot be allowed to
              stop an ordinary call from ringing.
            */
            signalListenersRef.current.forEach((fn) => {
              try { fn(signal); } catch (e) { console.error("Signal listener failed", e); }
            });
            handlerRef.current(signal);
          } catch (e) {
            console.error("Invalid calling signal payload", e);
          }
        });
      },
      onDisconnect: () => setConnected(false),
      onWebSocketClose: () => setConnected(false)
    });

    client.activate();
    return () => {
      client.deactivate();
      clientRef.current = null;
      setConnected(false);
    };
  }, [user?.id]);

  // Request Notification permission on mount for background push alerts
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Continuous realistic Ringtone sound effect while receiving an incoming call
  useEffect(() => {
    if (callState !== "incoming" && callState !== "ringing") return;
    const stopRing = playRingtone();
    return () => {
      stopRing();
    };
  }, [callState]);

  // A call nobody picks up stops ringing after three quarters of a minute.
  useEffect(() => {
    if (callState !== "calling" && callState !== "ringing" && callState !== "incoming") return;
    const timer = window.setTimeout(() => {
      const partner = partnerRef.current;
      if (partner) {
        sendSignal(partner.id, "hangup", null);
        if (isCallerRef.current) logCall(partner.id, "MISSED", callIsVideo, 0);
      }
      toast.error("No answer.");
      cleanupCall();
    }, NO_ANSWER_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callState]);

  /**
   * Answering from anywhere else in the portal opens the conversation as well,
   * so the call and its chat are in the same place. The room is asked for by
   * partner, since a direct chat is found or created on demand.
   */
  const onAccept = async () => {
    const partner = partnerRef.current;
    try {
      await acceptCall();
    } catch (e: any) {
      toast.error(e?.message || "Could not answer the call");
      return;
    }
    if (!partner) return;
    try {
      const res = await api.post<{ id: number }>(`/communities/direct/${partner.id}`);
      navigate(`/chat?c=${res.data.id}`);
    } catch {
      navigate("/chat");
    }
  };

  const value = useMemo<CallApi>(() => ({
    callState, activeCallPartner, callIsVideo, localStream, remoteStream,
    startCall, acceptCall, rejectCall, hangUp, toggleTrack,
    sendSignal, addSignalListener, getIceServers: getIceServersConfig,
    sharingScreen, toggleScreenShare
  }), [callState, activeCallPartner, callIsVideo, localStream, remoteStream,
    startCall, acceptCall, rejectCall, hangUp, toggleTrack,
    sendSignal, addSignalListener, getIceServersConfig,
    sharingScreen, toggleScreenShare]);

  return (
    <CallContext.Provider value={value}>
      {children}
      {/* Above the routes, so a call covers whatever page is open. */}
      {callState !== "idle" && activeCallPartner && (
        <CallOverlay
          state={callState}
          partnerName={activeCallPartner.name}
          isVideo={callIsVideo}
          localStream={localStream}
          remoteStream={remoteStream}
          muted={muted}
          cameraOff={cameraOff}
          onAccept={onAccept}
          onReject={rejectCall}
          onHangUp={hangUp}
          onToggleMute={() => setMuted(!toggleTrack("audio"))}
          onToggleCamera={() => setCameraOff(!toggleTrack("video"))}
          sharingScreen={sharingScreen}
          onToggleScreenShare={() => void toggleScreenShare()}
        />
      )}
      {/* Silent when the socket is down, but a call cannot arrive then, so the
          calling buttons say so rather than failing quietly. */}
      <span className="hidden" data-calls-connected={connected ? "yes" : "no"} />
    </CallContext.Provider>
  );
}

/**
 * The calling API. Outside a provider it returns a dormant version rather than
 * throwing, so a page that only lists chats still renders.
 */
export function useCalls(): CallApi {
  const ctx = useContext(CallContext);
  return ctx ?? DORMANT;
}

const DORMANT: CallApi = {
  callState: "idle",
  activeCallPartner: null,
  callIsVideo: false,
  localStream: null,
  remoteStream: null,
  startCall: async () => { toast.error("Calling is not available here."); },
  acceptCall: async () => {},
  rejectCall: () => {},
  hangUp: () => {},
  toggleTrack: () => false,
  // No socket outside the provider, so these do nothing rather than pretend.
  sendSignal: async () => {},
  addSignalListener: () => () => {},
  getIceServers: async () => iceServers,
  sharingScreen: false,
  toggleScreenShare: async () => {}
};
