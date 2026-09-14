import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState
} from "react";
import toast from "react-hot-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCalls, playRingtone, type CallSignal } from "@/hooks/useCalls";

/**
 * Group voice and video calling.
 *
 * # Why a mesh, and what it costs
 *
 * Every participant holds one peer connection to every other participant and
 * sends their own camera to each of them. Nothing is added to the server: the
 * signalling relay a one-to-one call already uses is enough, because a mesh
 * is only ever a set of one-to-one connections that happen to know about each
 * other.
 *
 * The price is upstream bandwidth. With N people each person uploads N-1
 * copies of themselves, so the cost grows with the size of the room while the
 * upstream on an office line does not. Six is the honest ceiling for that: at
 * six a participant is sending five streams, which at the reduced group
 * resolution below is about 2 Mbit/s up, and most connections manage it. At
 * twelve it would be eleven streams and nobody would get a usable call.
 *
 * Going beyond that means a media server -- an SFU -- which every participant
 * sends one copy to and which forwards it on. That is a separate piece of
 * infrastructure, not a change to this file, and it is the only way a room of
 * twelve works. This module is deliberately shaped so that swapping the
 * transport underneath it would not change the interface it presents.
 */

/**
 * The point past which a mesh stops being usable, for video. See above.
 */
export const MAX_GROUP_PARTICIPANTS = 6;

/**
 * The same ceiling for a call with no cameras, which is a different number
 * because audio is a different order of magnitude.
 *
 * Video at the reduced group resolution is roughly 400 kbit/s per stream, so
 * six people is about 2 Mbit/s up and that is the honest limit. Opus voice is
 * nearer 40 kbit/s, so twenty-five people is about 1 Mbit/s up -- less than a
 * six-way video call costs. The mesh is the same mesh; only what it carries
 * has changed.
 *
 * Twenty-five rather than everybody. It covers a company of this size with
 * room to spare, and it stops short of the point where a mesh's connection
 * count, rather than its bandwidth, becomes the problem: at twenty-five each
 * browser holds twenty-four peer connections, which is a lot but is a number
 * browsers manage. An all-hands beyond that wants an SFU, and pretending
 * otherwise would break the call in front of everybody.
 */
export const MAX_AUDIO_PARTICIPANTS = 25;

/** The ceiling that applies to a call, given whether it carries video. */
export function maxParticipants(video: boolean) {
  return video ? MAX_GROUP_PARTICIPANTS : MAX_AUDIO_PARTICIPANTS;
}

/**
 * Group video is captured smaller than a one-to-one call on purpose.
 *
 * A tile in a grid of six is a few hundred pixels wide, so anything above
 * 360p is decoded and then thrown away by the scaler -- it costs upload
 * bandwidth, encoder time and battery to deliver detail that is never shown.
 * The saving is what makes five simultaneous uploads possible at all.
 */
const GROUP_VIDEO: MediaTrackConstraints = {
  width: { ideal: 640, max: 1280 },
  height: { ideal: 360, max: 720 },
  frameRate: { ideal: 24, max: 30 }
};

/** Per-stream ceiling, chosen so a full room fits in a typical upload. */
const GROUP_MAX_BITRATE = 400_000;

/**
 * How long a group call may go unanswered.
 *
 * Without this an invitation rang until somebody closed the tab, and the
 * caller sat in an empty call with no way to tell the difference between
 * "still ringing" and "nobody is going to answer". Forty-five seconds is
 * about as long as anyone lets a phone ring before deciding it is not being
 * picked up.
 */
const RING_TIMEOUT_MS = 45_000;

/* ------------------------------------------------------------------ types */

export type GroupCallState = "idle" | "inviting" | "incoming" | "joining" | "active";

export interface GroupParticipant {
  id: number;
  name: string;
  stream: MediaStream | null;
  /** False until their tracks arrive, so a tile can show why it is empty. */
  connected: boolean;
  muted: boolean;
  cameraOff: boolean;
}

interface GroupInvite {
  roomId: string;
  roomName: string;
  fromId: number;
  fromName: string;
  isVideo: boolean;
  memberIds: number[];
}

interface GroupCallApi {
  state: GroupCallState;
  roomName: string;
  isVideo: boolean;
  localStream: MediaStream | null;
  participants: GroupParticipant[];
  invite: GroupInvite | null;
  muted: boolean;
  cameraOff: boolean;
  sharingScreen: boolean;

  start: (roomId: string, roomName: string, memberIds: number[], isVideo: boolean) => Promise<void>;
  accept: () => Promise<void>;
  decline: () => void;
  leave: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  toggleScreenShare: () => Promise<void>;
  /** Ring more people into the call that is already running. */
  addPeople: (userIds: number[]) => void;
  /** Who is already here or has been rung, so a picker can exclude them. */
  memberIds: number[];
}

const GroupCallContext = createContext<GroupCallApi | null>(null);

/* -------------------------------------------------------------- the peer */

interface Peer {
  pc: RTCPeerConnection;
  name: string;
  stream: MediaStream;
  /** Candidates that arrived before there was a description to attach them to. */
  pending: RTCIceCandidateInit[];
  /*
    Reported by the far end, not read off the track.

    A track's "enabled" flag is local to whoever owns it -- muting does not
    travel down the wire, and the receiving browser sees a track that is
    still live and still enabled, carrying silence. Reading it here would
    show everybody as unmuted forever, so each person announces their own
    state instead.
  */
  muted: boolean;
  cameraOff: boolean;
}

export function GroupCallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { sendSignal, addSignalListener, getIceServers } = useCalls();

  const [state, setState] = useState<GroupCallState>("idle");
  const [roomName, setRoomName] = useState("");
  const [isVideo, setIsVideo] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [participants, setParticipants] = useState<GroupParticipant[]>([]);
  const [invite, setInvite] = useState<GroupInvite | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);

  const roomIdRef = useRef<string | null>(null);
  /*
    Everyone who belongs to this call, including people still ringing.

    A late invitation has to carry the whole list, not just the newcomer: when
    they accept they announce themselves to every id in it, and that is how
    the mesh gets built. Handing them a short list would connect them to some
    of the room and not the rest.
  */
  const memberIdsRef = useRef<number[]>([]);
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const peersRef = useRef(new Map<number, Peer>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const stateRef = useRef<GroupCallState>("idle");
  /** Stops the ringing tone. Null when nothing is ringing. */
  const stopRingRef = useRef<(() => void) | null>(null);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
    Silence and cancel together, always. The tone and the timer are started at
    the same moment and either one outliving the other is a bug the user hears
    -- a phone that rings after the call is over, or a call that never gives up.
  */
  const stopRinging = useCallback(() => {
    stopRingRef.current?.();
    stopRingRef.current = null;
    if (ringTimerRef.current) {
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
  }, []);
  const isVideoRef = useRef(true);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { isVideoRef.current = isVideo; }, [isVideo]);

  /** Rebuild the participant list from the peer map, for rendering. */
  const publish = useCallback(() => {
    setParticipants(
      Array.from(peersRef.current.entries()).map(([id, p]) => ({
        id,
        name: p.name,
        stream: p.stream,
        connected: p.stream.getTracks().length > 0,
        muted: p.muted,
        cameraOff: p.cameraOff
      }))
    );
  }, []);

  /* ------------------------------------------------------------ teardown */

  const teardown = useCallback((notify: boolean) => {
    stopRinging();
    const room = roomIdRef.current;

    if (notify && room) {
      // Told individually rather than broadcast, because the relay addresses
      // one person at a time. Failures are ignored: leaving must always work,
      // even when the network is the reason we are leaving.
      peersRef.current.forEach((_, id) => {
        void sendSignal(id, "g-leave", { roomId: room });
      });
    }

    peersRef.current.forEach((p) => {
      try { p.pc.close(); } catch { /* already gone */ }
    });
    peersRef.current.clear();

    // Tracks are stopped one by one. Dropping the reference alone leaves the
    // camera light on, which reads as the app still watching you.
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraTrackRef.current?.stop();
    localStreamRef.current = null;
    cameraTrackRef.current = null;

    roomIdRef.current = null;
    memberIdsRef.current = [];
    setMemberIds([]);
    setLocalStream(null);
    setParticipants([]);
    setInvite(null);
    setState("idle");
    setMuted(false);
    setCameraOff(false);
    setSharingScreen(false);
  }, [sendSignal, stopRinging]);

  /* ------------------------------------------------- one connection to one */

  /**
   * Re-offer to one peer after its path broke.
   *
   * Only the impolite side does this. If both ends offer at the same moment
   * the offers collide -- glare -- and neither is applied, leaving the link
   * worse than the failure that prompted them. "Impolite" is decided by
   * comparing user ids, which both ends can work out without agreeing on
   * anything first, and which always names exactly one of the two.
   */
  const renegotiate = useCallback(async (peerId: number) => {
    const peer = peersRef.current.get(peerId);
    const room = roomIdRef.current;
    if (!peer || !room) return;
    try {
      const offer = await peer.pc.createOffer({ iceRestart: true });
      await peer.pc.setLocalDescription(offer);
      await sendSignal(peerId, "g-offer", { roomId: room, sdp: offer, restart: true });
    } catch {
      // Past saving. The tile stays, showing them as not connected.
    }
  }, [sendSignal]);

  const createPeer = useCallback(async (
    peerId: number,
    peerName: string,
    polite: boolean
  ): Promise<Peer> => {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;

    const config = await getIceServers();
    const pc = new RTCPeerConnection(config);
    const stream = new MediaStream();
    const peer: Peer = { pc, name: peerName, stream, pending: [], muted: false, cameraOff: false };
    peersRef.current.set(peerId, peer);

    localStreamRef.current?.getTracks().forEach((t) => {
      pc.addTrack(t, localStreamRef.current!);
    });

    // Hold each sender to the group ceiling. Without this the browser gives
    // every one of the N-1 senders a full single-call bitrate and the sum
    // saturates the uplink, which shows up as everyone freezing at once.
    void (async () => {
      try {
        const sender = pc.getSenders().find((sn) => sn.track?.kind === "video");
        if (!sender) return;
        const params = sender.getParameters();
        if (!params.encodings?.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = GROUP_MAX_BITRATE;
        params.degradationPreference = "maintain-framerate";
        await sender.setParameters(params);
      } catch { /* default bitrate */ }
    })();

    pc.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach((t) => {
        if (!stream.getTracks().includes(t)) stream.addTrack(t);
      });
      publish();
    };

    pc.onicecandidate = (e) => {
      if (e.candidate && roomIdRef.current) {
        void sendSignal(peerId, "g-cand", {
          roomId: roomIdRef.current,
          candidate: e.candidate.toJSON()
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        /*
          One bad link is not a bad call. In a mesh the other connections are
          independent, so the room carries on without this person rather than
          ending for everybody -- which is what tearing the call down here
          would do. The impolite side re-offers; see below for why only one.
        */
        if (!polite) void renegotiate(peerId);
      }
      if (pc.connectionState === "closed") {
        peersRef.current.delete(peerId);
        publish();
      }
    };

    return peer;
  }, [getIceServers, publish, sendSignal]);


  /* --------------------------------------------------------------- media */

  const openMedia = useCallback(async (video: boolean) => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Calls need a secure (https) connection.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: video ? GROUP_VIDEO : false
    });
    localStreamRef.current = stream;
    cameraTrackRef.current = stream.getVideoTracks()[0] ?? null;
    setLocalStream(stream);
    return stream;
  }, []);

  /* -------------------------------------------------------------- signals */

  const handle = useCallback(async (signal: CallSignal) => {
    const { senderId, senderName, type, data } = signal;
    if (!type?.startsWith("g-")) return;

    const room = data?.roomId as string | undefined;

    // An invite is the one message that may arrive with no room open.
    if (type === "g-invite") {
      if (stateRef.current !== "idle") {
        void sendSignal(senderId, "g-busy", { roomId: room });
        return;
      }
      setInvite({
        roomId: room!,
        roomName: data?.roomName || "Group call",
        fromId: senderId,
        fromName: senderName,
        isVideo: !!data?.isVideo,
        memberIds: Array.isArray(data?.memberIds) ? data.memberIds : []
      });
      setState("incoming");

      /*
        Ring, and stop ringing on its own.

        It rang silently before, so a group call only reached anybody who
        happened to be looking at the tab, and it rang for ever, so an
        invitation nobody answered stayed on screen until the tab was closed.
      */
      stopRinging();
      stopRingRef.current = playRingtone();
      ringTimerRef.current = setTimeout(() => {
        ringTimerRef.current = null;
        if (stateRef.current !== "incoming") return;
        stopRinging();
        setInvite(null);
        setState("idle");
        toast(`Missed a group call from ${senderName}`, { icon: "📞" });
      }, RING_TIMEOUT_MS);
      return;
    }

    // Everything else is only meaningful inside the room it names. Without
    // this check a stale signal from a call that has ended would be applied
    // to the call that replaced it.
    if (!room || room !== roomIdRef.current) return;

    switch (type) {
      /*
        Someone has joined. Whoever is already here connects out to them.

        The one who joins does not offer to anybody: they announce themselves
        once and let the room come to them. If both sides offered on hearing
        about each other, every pair would glare on every join.
      */
      case "g-join": {
        // Somebody is here, so the caller's own "nobody answered" clock stops.
        stopRinging();
        if (peersRef.current.has(senderId)) return;
        if (peersRef.current.size + 1 >= maxParticipants(isVideoRef.current)) {
          void sendSignal(senderId, "g-full", { roomId: room });
          return;
        }
        const polite = (user?.id ?? 0) > senderId;
        const peer = await createPeer(senderId, senderName, polite);
        publish();
        // Somebody arriving late would otherwise see everyone as unmuted
        // until the next time they happened to toggle something.
        void sendSignal(senderId, "g-state", { roomId: room, muted, cameraOff });

        /*
          Whoever was already here offers -- always, not only when impolite.

          Someone joining announces themselves and then waits; they never
          offer to anybody. So if this side declined to offer because it
          happened to hold the larger user id, nobody would offer at all and
          that one pair would sit on "Connecting..." for the rest of the call
          while every other pair worked. Politeness is not what decides who
          offers here; it decides who gives way when two offers cross, and
          that is handled where offers arrive.
        */
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        void sendSignal(senderId, "g-offer", { roomId: room, sdp: offer });
        return;
      }

      case "g-offer": {
        const polite = (user?.id ?? 0) > senderId;
        const peer = peersRef.current.get(senderId)
          ?? await createPeer(senderId, senderName, polite);

        /*
          Two people joining at the same moment each offer to the other, and
          the two offers cross. Applying a remote offer on top of a local one
          throws, and leaves the connection wedged in have-local-offer.

          One side has to give way, and both have to reach the same answer
          without talking about it first -- so it is decided by comparing
          user ids, which each side already knows. The polite side drops its
          own offer and takes the other's; the impolite side ignores the
          incoming one and lets its own stand. Exactly one offer survives.
        */
        if (peer.pc.signalingState !== "stable") {
          if (!polite) return;
          await peer.pc.setLocalDescription({ type: "rollback" } as RTCSessionDescriptionInit);
        }

        await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        // Queued candidates can only be added once there is a description.
        for (const c of peer.pending.splice(0)) {
          try { await peer.pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* stale */ }
        }
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        void sendSignal(senderId, "g-answer", { roomId: room, sdp: answer });
        publish();
        return;
      }

      case "g-answer": {
        const peer = peersRef.current.get(senderId);
        if (!peer) return;
        await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        for (const c of peer.pending.splice(0)) {
          try { await peer.pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* stale */ }
        }
        publish();
        return;
      }

      case "g-cand": {
        const peer = peersRef.current.get(senderId);
        if (!peer || !data?.candidate) return;
        if (!peer.pc.remoteDescription) {
          peer.pending.push(data.candidate);
          return;
        }
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch { /* stale candidate, harmless */ }
        return;
      }

      case "g-leave": {
        const peer = peersRef.current.get(senderId);
        if (!peer) return;
        try { peer.pc.close(); } catch { /* already gone */ }
        peersRef.current.delete(senderId);
        publish();
        // Last one out closes the room rather than leaving somebody sitting
        // alone in a call that is over.
        if (peersRef.current.size === 0 && stateRef.current === "active") {
          toast("Everyone else has left.", { icon: "👋" });
          teardown(false);
        }
        return;
      }

      /*
        Somebody's microphone or camera went on or off. Announced rather than
        detected, for the reason given on the Peer fields, and applied to the
        tile so the room can see who is speaking and who is not there.
      */
      case "g-state": {
        const peer = peersRef.current.get(senderId);
        if (!peer) return;
        peer.muted = !!data?.muted;
        peer.cameraOff = !!data?.cameraOff;
        publish();
        return;
      }

      /* The room's membership changed because somebody added people. */
      case "g-members": {
        const list = Array.isArray(data?.memberIds) ? data.memberIds : null;
        if (!list) return;
        memberIdsRef.current = list;
        setMemberIds(list);
        return;
      }

      case "g-full":
        toast.error("That call is already full.");
        teardown(false);
        return;

      case "g-busy":
        // One person being unavailable is not a reason to stop the call.
        toast(`${senderName} is on another call.`, { icon: "📞" });
        return;
    }
  }, [createPeer, publish, sendSignal, teardown, user?.id, muted, cameraOff, stopRinging]);

  const handleRef = useRef(handle);
  useEffect(() => { handleRef.current = handle; }, [handle]);

  useEffect(
    () => addSignalListener((s) => { void handleRef.current(s); }),
    [addSignalListener]
  );

  /* --------------------------------------------------------------- actions */

  const start = useCallback(async (
    roomId: string, name: string, memberIds: number[], video: boolean
  ) => {
    if (stateRef.current !== "idle") return;

    const others = memberIds.filter((id) => id !== user?.id);
    if (others.length === 0) {
      toast.error("There is nobody else in this room to call.");
      return;
    }
    const ceiling = maxParticipants(video);
    if (others.length + 1 > ceiling) {
      toast.error(
        video
          ? `Video calls take up to ${MAX_GROUP_PARTICIPANTS} people. This room has ${others.length + 1} — try an audio call.`
          : `Audio calls take up to ${MAX_AUDIO_PARTICIPANTS} people. This room has ${others.length + 1}.`
      );
      return;
    }

    setRoomName(name);
    setIsVideo(video);
    setState("inviting");
    roomIdRef.current = roomId;
    memberIdsRef.current = memberIds;
    setMemberIds(memberIds);

    try {
      // Own devices first. If the camera is refused there is no point making
      // everybody else's browser ring.
      await openMedia(video);
    } catch (e: any) {
      toast.error(e?.message || "Could not reach your camera or microphone.");
      teardown(false);
      return;
    }

    setState("active");
    for (const id of others) {
      void sendSignal(id, "g-invite", {
        roomId, roomName: name, isVideo: video, memberIds
      });
    }

    /*
      Give up if nobody joins. The caller was otherwise left sitting in an
      empty call with their camera on, unable to tell "still ringing" from
      "nobody is coming". Cancelled by the first g-join above.
    */
    stopRinging();
    ringTimerRef.current = setTimeout(() => {
      ringTimerRef.current = null;
      if (stateRef.current !== "active" || peersRef.current.size > 0) return;
      toast("Nobody answered.", { icon: "📞" });
      teardown(true);
    }, RING_TIMEOUT_MS);
  }, [openMedia, sendSignal, teardown, user?.id, stopRinging]);

  const accept = useCallback(async () => {
    const inv = invite;
    if (!inv) return;
    stopRinging();

    setRoomName(inv.roomName);
    setIsVideo(inv.isVideo);
    setState("joining");
    roomIdRef.current = inv.roomId;
    memberIdsRef.current = inv.memberIds;
    setMemberIds(inv.memberIds);

    try {
      await openMedia(inv.isVideo);
    } catch (e: any) {
      toast.error(e?.message || "Could not reach your camera or microphone.");
      void sendSignal(inv.fromId, "g-leave", { roomId: inv.roomId });
      teardown(false);
      return;
    }

    setInvite(null);
    setState("active");

    /*
      Announce to everyone the invite named, not just whoever invited us.
      Each of them opens a connection to us, which is how a mesh assembles
      itself without anyone holding a list of who is in the room.
    */
    for (const id of inv.memberIds) {
      if (id === user?.id) continue;
      void sendSignal(id, "g-join", { roomId: inv.roomId });
    }
  }, [invite, openMedia, sendSignal, teardown, user?.id, stopRinging]);

  const decline = useCallback(() => {
    stopRinging();
    if (invite) void sendSignal(invite.fromId, "g-leave", { roomId: invite.roomId });
    setInvite(null);
    setState("idle");
  }, [invite, sendSignal, stopRinging]);

  /**
   * Ring more people into a call that is already running.
   *
   * The invitation is the same one the call started with, carrying the room
   * id, so accepting drops them straight into this call rather than opening
   * a second one. The member list sent with it is the full list including
   * the new arrivals, because whoever accepts announces themselves to every
   * id in it -- that announcement is how the mesh assembles, so a short list
   * would leave the newcomer connected to part of the room only.
   *
   * Everyone already here is told about the additions too, so if two people
   * add somebody at the same time both ends still agree on who belongs.
   */
  const addPeople = useCallback((userIds: number[]) => {
    const room = roomIdRef.current;
    if (!room || stateRef.current !== "active") return;

    const fresh = userIds.filter(
      (id) => id !== user?.id && !memberIdsRef.current.includes(id)
    );
    if (fresh.length === 0) return;

    const combined = [...memberIdsRef.current, ...fresh];
    if (combined.length > MAX_GROUP_PARTICIPANTS) {
      toast.error(
        `A call takes up to ${MAX_GROUP_PARTICIPANTS} people. There is room for ` +
        `${Math.max(0, MAX_GROUP_PARTICIPANTS - memberIdsRef.current.length)} more.`
      );
      return;
    }

    memberIdsRef.current = combined;
    setMemberIds(combined);

    for (const id of fresh) {
      void sendSignal(id, "g-invite", {
        roomId: room, roomName, isVideo: isVideoRef.current, memberIds: combined
      });
    }
    // Everyone already connected learns the new list, so a second person
    // adding somebody does not overwrite the first person's addition.
    peersRef.current.forEach((_, id) => {
      void sendSignal(id, "g-members", { roomId: room, memberIds: combined });
    });

    toast.success(fresh.length === 1 ? "Ringing them now." : `Ringing ${fresh.length} people.`);
  }, [roomName, sendSignal, user?.id]);

  const leave = useCallback(() => teardown(true), [teardown]);

  /** Tell the room what our microphone and camera are doing. */
  const announceState = useCallback((isMuted: boolean, isCameraOff: boolean) => {
    const room = roomIdRef.current;
    if (!room) return;
    peersRef.current.forEach((_, id) => {
      void sendSignal(id, "g-state", { roomId: room, muted: isMuted, cameraOff: isCameraOff });
    });
  }, [sendSignal]);

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
    announceState(!track.enabled, cameraOff);
  }, [announceState, cameraOff]);

  const toggleCamera = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraOff(!track.enabled);
    announceState(muted, !track.enabled);
  }, [announceState, muted]);

  /**
   * Swap the camera for the screen, and back.
   *
   * replaceTrack rather than a new connection: it changes what each sender is
   * sending without renegotiating, so nobody's tile flickers and no offer or
   * answer is exchanged. The camera track is kept alive rather than stopped,
   * because stopping it turns the light off but also means the camera has to
   * be reopened -- and permission possibly re-granted -- to come back.
   */
  const toggleScreenShare = useCallback(async () => {
    if (sharingScreen) {
      const camera = cameraTrackRef.current;
      if (!camera) return;
      peersRef.current.forEach((p) => {
        const sender = p.pc.getSenders().find((sn) => sn.track?.kind === "video");
        void sender?.replaceTrack(camera);
      });
      const old = localStreamRef.current?.getVideoTracks()[0];
      if (old && old !== camera) {
        old.stop();
        localStreamRef.current?.removeTrack(old);
        localStreamRef.current?.addTrack(camera);
      }
      setSharingScreen(false);
      return;
    }

    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = display.getVideoTracks()[0];
      if (!track) return;

      peersRef.current.forEach((p) => {
        const sender = p.pc.getSenders().find((sn) => sn.track?.kind === "video");
        void sender?.replaceTrack(track);
      });

      const old = localStreamRef.current?.getVideoTracks()[0];
      if (old) localStreamRef.current?.removeTrack(old);
      localStreamRef.current?.addTrack(track);
      setSharingScreen(true);

      // The browser's own "stop sharing" bar bypasses this button entirely,
      // so the camera has to be restored from the track's own end event too.
      track.onended = () => { void toggleScreenShare(); };
    } catch {
      // The picker was dismissed. Not an error worth a message.
    }
  }, [sharingScreen]);

  // Leaving the page while a call is ringing must not leave a tone playing
  // with nothing on screen to explain it.
  useEffect(() => stopRinging, [stopRinging]);

  // A tab closing mid-call should not leave everyone else with a frozen tile.
  useEffect(() => {
    const bye = () => { if (roomIdRef.current) teardown(true); };
    window.addEventListener("beforeunload", bye);
    return () => window.removeEventListener("beforeunload", bye);
  }, [teardown]);

  const value = useMemo<GroupCallApi>(() => ({
    state, roomName, isVideo, localStream, participants, invite,
    muted, cameraOff, sharingScreen,
    start, accept, decline, leave, toggleMute, toggleCamera, toggleScreenShare,
    addPeople, memberIds
  }), [state, roomName, isVideo, localStream, participants, invite,
    muted, cameraOff, sharingScreen,
    start, accept, decline, leave, toggleMute, toggleCamera, toggleScreenShare,
    addPeople, memberIds]);

  return (
    <GroupCallContext.Provider value={value}>{children}</GroupCallContext.Provider>
  );
}

const DORMANT: GroupCallApi = {
  state: "idle", roomName: "", isVideo: false, localStream: null,
  participants: [], invite: null, muted: false, cameraOff: false,
  sharingScreen: false,
  start: async () => { toast.error("Group calling is not available here."); },
  accept: async () => {},
  decline: () => {},
  leave: () => {},
  toggleMute: () => {},
  toggleCamera: () => {},
  toggleScreenShare: async () => {},
  addPeople: () => {},
  memberIds: []
};

/** Outside a provider this is dormant rather than throwing, as with useCalls. */
export function useGroupCall(): GroupCallApi {
  return useContext(GroupCallContext) ?? DORMANT;
}
