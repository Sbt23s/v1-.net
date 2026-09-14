import React, { useState, useEffect, useRef, Suspense, lazy } from "react";
import { X, Volume2, VolumeX, Play, Pause, Megaphone } from "lucide-react";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";
import { api, tokenStore } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { resolvePhotoUrl } from "@/components/ui/avatar";
/*
  lottie-react is 316 KB minified -- the fourth-largest chunk in the build, and
  larger than React itself. It renders one thing: the optional entrance
  animation over an announcement card, which most companies have never uploaded
  and which is skipped entirely when effectEnabled is off.

  Imported at the top of this file, it loaded on every page: this modal is
  mounted unconditionally in AppLayout so it can listen for an announcement, so
  every sign-in fetched a third of a megabyte for an effect that usually does
  not exist. Behind a lazy import it is fetched only when an announcement
  actually carries one.

  Suspense fallback is null rather than a spinner: it is decoration over a card
  that is already on screen, and a loading state for a flourish would be worse
  than the flourish arriving a moment late.
*/
const Lottie = lazy(() =>
  import("lottie-react").then((m) => ({ default: m.Lottie })));

interface Announcement {
  id: number;
  title?: string;
  description?: string;
  mediaType: "VIDEO" | "IMAGE" | "POSTER";
  mediaUrl: string;
  mediaName?: string;
  status: "ACTIVE" | "INACTIVE" | "DELETED";
  targetRoles: string;
  durationSeconds: number;
  /** Lottie JSON played over the media. Absent when none was uploaded. */
  effectUrl?: string | null;
  /** Whether to play it. An effect can be uploaded and switched off. */
  effectEnabled?: boolean;
}

export function GlobalLoginAnnouncementModal() {
  const { user } = useAuth();
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState(15);
  const [isMuted, setIsMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<any>(null);
  const shownThisSessionRef = useRef<Set<number>>(new Set());

  const showAnnouncement = (active: Announcement) => {
    // Show on every login - only skip if already shown in this page load session
    if (shownThisSessionRef.current.has(active.id)) return;
    shownThisSessionRef.current.add(active.id);
    setAnnouncement(active);
    setTimeLeft(active.durationSeconds || 15);
    setIsPlaying(true);
    setIsMuted(false);
    setIsOpen(true);
  };

  const fetchActive = async () => {
    try {
      const isJustLoggedIn = sessionStorage.getItem("just_logged_in") === "true";
      if (!isJustLoggedIn) return;

      const res = await api.get<{ data: Announcement | null }>("/global-announcements/active");
      const active = res.data?.data;
      if (active && active.status === "ACTIVE") {
        sessionStorage.removeItem("just_logged_in");
        showAnnouncement(active);
      }
    } catch (err) {
      console.error("Failed to fetch active announcement", err);
    }
  };

  useEffect(() => {
    if (!user) return;

    // Short delay so the dashboard renders first, then popup appears
    const delay = setTimeout(() => {
      fetchActive();
    }, 800);

    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    const client = new Client({
      webSocketFactory: () => new SockJS(wsUrl),
      connectHeaders: {
        Authorization: tokenStore.access ? `Bearer ${tokenStore.access}` : ""
      },
      reconnectDelay: 5000,
      onConnect: () => {
        client.subscribe("/topic/global-announcement", (message) => {
          try {
            const body = JSON.parse(message.body);
            if (body.action === "PUBLISHED" && body.status === "ACTIVE") {
              const newAnn: Announcement = {
                id: body.id,
                title: body.title,
                description: body.description,
                mediaType: body.mediaType,
                mediaUrl: body.mediaUrl,
                status: "ACTIVE",
                targetRoles: body.targetRoles,
                durationSeconds: body.durationSeconds || 15,
                effectUrl: body.effectUrl,
                effectEnabled: body.effectEnabled
              };
              // Real-time: always show immediately for new published announcements
              shownThisSessionRef.current.delete(body.id);
              showAnnouncement(newAnn);
            } else if (body.action === "DELETED" || body.action === "INACTIVATED") {
              setAnnouncement((prev) => {
                if (prev && prev.id === body.id) {
                  setIsOpen(false);
                  return null;
                }
                return prev;
              });
            }
          } catch (e) {
            console.error("STOMP announcement parse error", e);
          }
        });
      }
    });

    client.activate();

    return () => {
      clearTimeout(delay);
      client.deactivate();
    };
  }, [user]);

  // Reset shown set when user changes (i.e. new login)
  useEffect(() => {
    shownThisSessionRef.current.clear();
  }, [user?.id]);

  // Countdown timer
  useEffect(() => {
    if (!isOpen || !announcement) return;

    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          handleClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isOpen, announcement?.id]);

  const handleClose = () => {
    setIsOpen(false);
    if (videoRef.current) {
      videoRef.current.pause();
    }
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  if (!isOpen || !announcement) return null;

  const resolvedUrl = resolvePhotoUrl(announcement.mediaUrl) || announcement.mediaUrl;
  const duration = announcement.durationSeconds || 15;

  // Null unless there is an effect and it is switched on. Uploading one and
  // turning it off has to leave the popup exactly as it was without one.
  const effectUrl =
    announcement.effectEnabled && announcement.effectUrl
      ? resolvePhotoUrl(announcement.effectUrl) || announcement.effectUrl
      : null;
  const progressPercent = Math.max(0, Math.min(100, ((duration - timeLeft) / duration) * 100));

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 99999 }}
      className="flex items-center justify-center p-4 sm:p-6 bg-black/75 backdrop-blur-md animate-in fade-in duration-300"
    >
      {/* Full-screen background blurred ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {announcement.mediaType === "VIDEO" ? (
          <video
            src={resolvedUrl}
            className="h-full w-full object-cover opacity-25 blur-3xl scale-125"
            autoPlay
            loop
            muted
            playsInline
          />
        ) : (
          <img
            src={resolvedUrl}
            alt=""
            className="h-full w-full object-cover opacity-25 blur-3xl scale-125"
          />
        )}
      </div>

      {/* Centered Poster Card Container - Auto-fits media aspect ratio with zero black sidebars */}
      <div className="relative z-10 inline-flex flex-col items-center justify-center max-h-[85vh] max-w-[90vw] md:max-w-[80vw] lg:max-w-4xl rounded-2xl overflow-hidden shadow-2xl border border-white/25 bg-slate-950/90 backdrop-blur-2xl group">
        
        {/* Inner Media Blurred Ambient Fill (Fills side gaps with matching video/photo artwork glow) */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          {announcement.mediaType === "VIDEO" ? (
            <video
              src={resolvedUrl}
              className="h-full w-full object-cover opacity-50 blur-2xl scale-125"
              autoPlay
              loop
              muted
              playsInline
            />
          ) : (
            <img
              src={resolvedUrl}
              alt=""
              className="h-full w-full object-cover opacity-50 blur-2xl scale-125"
            />
          )}
        </div>

        {/* Entrance Lottie Effect Over Card */}
        {effectUrl ? (
          <div className="absolute inset-0 z-30 pointer-events-none">
            <Suspense fallback={null}>
              <Lottie
                src={effectUrl}
                autoplay
                loop={false}
                className="h-full w-full"
              />
            </Suspense>
          </div>
        ) : null}

        {/* Clean Sleek Floating Close Button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 z-40 grid h-10 w-10 place-items-center rounded-full bg-black/75 text-white hover:bg-black/95 hover:scale-105 transition-all border border-white/30 shadow-2xl backdrop-blur-md"
          title="Close Announcement"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Media Content */}
        <div className="relative z-10 flex items-center justify-center max-h-[82vh] overflow-hidden">
          {announcement.mediaType === "VIDEO" ? (
            <>
              <video
                ref={videoRef}
                src={resolvedUrl}
                className="max-h-[80vh] w-auto max-w-full object-contain rounded-2xl shadow-2xl"
                autoPlay
                loop
                muted={isMuted}
                playsInline
              />
              {/* Video Controls - bottom right of card */}
              <div className="absolute bottom-4 right-4 z-30 flex items-center gap-2 rounded-full bg-black/75 backdrop-blur-md px-3.5 py-1.5 border border-white/25 shadow-xl">
                <button onClick={togglePlay} className="text-white hover:text-primary transition-colors" title={isPlaying ? "Pause" : "Play"}>
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <div className="w-px h-3.5 bg-white/30" />
                <button onClick={toggleMute} className="text-white hover:text-primary transition-colors" title={isMuted ? "Unmute" : "Mute"}>
                  {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
              </div>
            </>
          ) : (
            <img
              src={resolvedUrl}
              alt={announcement.title || "Announcement"}
              className="max-h-[80vh] w-auto max-w-full object-contain rounded-2xl shadow-2xl"
            />
          )}

          {/* Title & Description overlay at bottom of poster if provided */}
          {(announcement.title || announcement.description) && (
            <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-6 text-left">
              {announcement.title && (
                <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight drop-shadow-md">
                  {announcement.title}
                </h2>
              )}
              {announcement.description && (
                <p className="mt-1 text-xs sm:text-sm text-white/90 max-w-2xl font-medium drop-shadow">
                  {announcement.description}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
