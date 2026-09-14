import { useState, useRef, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useGroupCall, MAX_GROUP_PARTICIPANTS, MAX_AUDIO_PARTICIPANTS } from "@/hooks/useGroupCall";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { PixousLoader } from "@/components/ui/pixous-loader";
import { Avatar } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { isPlatformAccount } from "@/lib/people";
import { useChat, type ChatMessage, type SendExtras } from "@/hooks/useChat";
import {
  Send,
  MessageSquare,
  Hash,
  Megaphone,
  Search,
  CheckCheck,
  Check,
  Mic,
  Lock,
  UserPlus,
  X,
  Users,
  Trash2,
  Paperclip,
  FileText,
  Video,
  Pin,
  PinOff,
  Reply,
  SmilePlus,
  Eye,
  BarChart3,
  Clock,
  CheckCircle2,
  Plus,
  History,
  CornerDownRight,
  ChevronDown,
  ChevronUp,
  Phone,
  PhoneOff,
  MicOff,
  VideoOff
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { resolvePhotoUrl } from "@/components/ui/avatar";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";
import toast from "react-hot-toast";

// Kept in step with spring.servlet.multipart on the backend — refusing here gives
// a clear message instead of a failed request halfway through the upload.
// Kept in step with spring.servlet.multipart and nginx client_max_body_size:
// 2GB for one file, 5GB for everything in a single message. Refusing here gives
// a clear message instead of a failed request halfway through the upload.
const MAX_ATTACHMENT_MB = 2048;
const MAX_BATCH_MB = 5120;

/** Bytes as GB when it deserves it, otherwise MB. */
function prettySize(bytes: number) {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)}GB` : `${mb.toFixed(1)}MB`;
}

/** A size limit read as GB, for a message to the person uploading. */
function prettyLimit(mb: number) {
  return mb >= 1024 ? `${mb / 1024}GB` : `${mb}MB`;
}

/** The reactions offered on the picker — short, and unambiguous at work. */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "🙏", "✅"];

/** A poll needs at least two choices and stops being readable past six. */
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 6;

function cleanMessageContent(text?: string) {
  if (!text) return "";
  return text
    .replace(/ðŸ“ž|ðŸ“|ðŸ/g, "📞 ")
    .replace(/Â·|Â/g, "•");
}

/** One line of a message, for a quoted reply or a search hit. */
function messagePreview(msg?: { content?: string; audioPath?: string; attachments?: string }) {
  if (!msg) return "Message unavailable";
  if (msg.content && msg.content.trim()) return cleanMessageContent(msg.content);
  if (msg.audioPath) return "Voice message";
  if (msg.attachments) return "Attachment";
  return "Message";
}

interface CommunityGroup {
  id: number;
  name: string;
  description: string;
  isAnnouncement?: boolean;
  announcement?: boolean;
  direct?: boolean;
  partnerId?: number;
  partnerPhotoPath?: string;
}

interface Contact {
  id: number;
  employeeCode: string;
  name: string;
  email?: string;
  photoPath?: string;
  roles?: string[];
}

function initials(name?: string) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/**
 * Small circular avatar with photo fallback to initials. When `online` is given
 * — true or false, rather than left out — a presence dot rides on the corner.
 */
function PersonAvatar({
  name, photoPath, size = 40, active, online
}: {
  name?: string;
  photoPath?: string;
  size?: number;
  active?: boolean;
  online?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoPath]);
  const url = failed ? undefined : resolvePhotoUrl(photoPath);
  const dim = { width: size, height: size };
  const dot = Math.max(8, Math.round(size * 0.28));

  const face = url ? (
    <img
      src={url}
      alt={name}
      style={dim}
      className="rounded-full object-cover border"
      onError={() => setFailed(true)}
    />
  ) : (
    <div
      style={dim}
      className={`rounded-full flex items-center justify-center text-xs font-bold border ${
        active ? "bg-primary-foreground/15 text-primary-foreground" : "bg-primary/10 text-primary"
      }`}
    >
      {initials(name)}
    </div>
  );

  if (online === undefined) return <div className="shrink-0">{face}</div>;

  return (
    <div className="relative shrink-0">
      {face}
      <span
        style={{ width: dot, height: dot }}
        title={online ? "Online" : "Offline"}
        className={cn(
          "absolute bottom-0 right-0 rounded-full border-2 border-card",
          online ? "bg-emerald-500" : "bg-muted-foreground/40"
        )}
      />
    </div>
  );
}

/**
 * When somebody was last connected. Always with the date as well as the time —
 * "just now" reads friendlier but tells you nothing you can act on, and "today"
 * is ambiguous the moment you read it tomorrow.
 */
function lastSeenLabel(iso?: string) {
  if (!iso) return "Offline";
  const at = dayjs(iso);
  if (!at.isValid()) return "Offline";
  const stamp = at.isSame(dayjs(), "year")
    ? at.format("DD MMM, h:mm A")
    : at.format("DD MMM YYYY, h:mm A");
  return `Last seen ${stamp}`;
}

/**
 * The delivery mark on your own message: one tick once it is sent, two once
 * somebody on the other side has actually read it.
 */
function DeliveryTicks({ read, isMe }: { read: boolean; isMe: boolean }) {
  if (!read) {
    return (
      <Check
        className={cn("h-3 w-3 shrink-0", isMe ? "text-primary-foreground/70" : "text-muted-foreground")}
        aria-label="Sent"
      />
    );
  }
  return (
    <CheckCheck
      className={cn("h-3 w-3 shrink-0", isMe ? "text-sky-300" : "text-sky-600")}
      aria-label="Read"
    />
  );
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)$/i;
const PDF_RE = /\.pdf$/i;

const fileName = (path: string) => decodeURIComponent(path.split("/").pop() || "file");

/**
 * Files sent with a message. Images show as thumbnails that open full size,
 * video plays inline, and anything else is a labelled link that opens in a tab.
 */
function MessageAttachments({
  paths, isMe, onOpenImage
}: {
  paths?: string;
  isMe: boolean;
  onOpenImage: (url: string) => void;
}) {
  const list = String(paths || "").split(",").map((p) => p.trim()).filter(Boolean);
  if (list.length === 0) return null;

  return (
    <div className={cn("mb-1.5 grid gap-1.5", list.length > 1 && "grid-cols-2")}>
      {list.map((p) => {
        const url = resolvePhotoUrl(p) ?? "";
        if (IMAGE_RE.test(p)) {
          return (
            <button
              key={p}
              type="button"
              onClick={() => onOpenImage(url)}
              title="Open full size"
              className="overflow-hidden rounded-xl"
            >
              <img
                src={url}
                alt={fileName(p)}
                className={cn(
                  "cursor-zoom-in object-contain rounded-xl shadow-sm",
                  list.length > 1 ? "h-28 w-full" : "max-h-80 max-w-xs sm:max-w-sm"
                )}
              />
            </button>
          );
        }
        if (VIDEO_RE.test(p)) {
          return (
            <video
              key={p}
              src={url}
              controls
              preload="metadata"
              className={cn("rounded-xl", list.length > 1 ? "h-28 w-full" : "max-h-64 w-full")}
            />
          );
        }
        return (
          <a
            key={p}
            href={url}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-medium underline-offset-2 hover:underline",
              isMe ? "bg-white/15" : "bg-muted/60"
            )}
          >
            {PDF_RE.test(p) ? <FileText className="h-4 w-4 shrink-0" /> : <Paperclip className="h-4 w-4 shrink-0" />}
            <span className="truncate">{fileName(p)}</span>
          </a>
        );
      })}
    </div>
  );
}

/**
 * Preview of a staged image. The blob URL is created once and revoked when the
 * file is removed — building it inside the render leaked one URL per repaint.
 */
function StagedThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  if (!url) return <FileText className="h-4 w-4 text-muted-foreground" />;
  return <img src={url} alt="" className="h-7 w-7 rounded object-cover" />;
}

/**
 * How long chat history is kept. Zero means keep everything, which is where it
 * starts — nothing is ever deleted until somebody decides otherwise. A pinned
 * message survives whatever the period, since somebody pinned it on purpose.
 */
function RetentionDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [days, setDays] = useState<string>("");

  const current = useQuery({
    queryKey: ["chat_retention"],
    queryFn: async () => (await api.get<{ days: number }>("/communities/retention")).data
  });

  useEffect(() => {
    if (current.data) setDays(String(current.data.days));
  }, [current.data]);

  const save = useMutation({
    mutationFn: async (next: number) => {
      await api.put("/communities/retention", { days: next });
    },
    onSuccess: (_res, next) => {
      qc.invalidateQueries({ queryKey: ["chat_retention"] });
      toast.success(
        next === 0
          ? "Chat history will be kept indefinitely"
          : `Chat history will be kept for ${next} days`
      );
      onClose();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || "Could not save the setting");
    }
  });

  const parsed = Number(days);
  const valid = days.trim() !== "" && Number.isInteger(parsed) && parsed >= 0 && parsed <= 3650;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <History className="h-4 w-4 text-primary" /> Message retention
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {current.isLoading ? (
          <div className="flex h-28 items-center justify-center">
            <PixousLoader size="sm" />
          </div>
        ) : (
          <div className="space-y-3 p-4">
            <div>
              <label htmlFor="chat-retention-days" className="text-xs font-semibold">
                Keep messages for
              </label>
              <div className="mt-1 flex items-center gap-2">
                <Input
                  id="chat-retention-days"
                  type="number"
                  min={0}
                  max={3650}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  className="h-9 w-24"
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
            </div>

            <p className="rounded-lg bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
              <strong className="text-foreground">0 keeps everything.</strong> With any other number,
              messages older than that are cleared each hour — except pinned ones, which are always
              kept. This applies to every conversation in the portal.
            </p>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!valid || save.isPending}
                onClick={() => save.mutate(parsed)}
              >
                {save.isPending ? <PixousLoader size="xs" /> : "Save"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  // A chat notification links to /chat?c=<id>, so open that room on arrival.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedGroupId = Number(searchParams.get("c")) || null;
  const [activeGroupId, setActiveGroupId] = useState<number | null>(requestedGroupId);
  const [draft, setDraft] = useState("");
  const [chatSearch, setChatSearch] = useState("");
  /*
    Ad-hoc group calls.

    Calling from a room only works when a room already exists for exactly the
    people you want, which is rarely true -- you usually want three colleagues
    on a call, not the room they all happen to share. This picks the people
    instead, and needs no room at all: the mesh only needs a list of who is in
    it, and the id below is what keeps two concurrent calls apart.
  */
  const [groupCallOpen, setGroupCallOpen] = useState(false);
  const [groupCallPick, setGroupCallPick] = useState<number[]>([]);
  const [groupCallSearch, setGroupCallSearch] = useState("");

  // Searching inside the open room, which is what makes a long history useful.
  const [searchOpen, setSearchOpen] = useState(false);
  const [roomSearch, setRoomSearch] = useState("");
  /** A message just jumped to, briefly ringed so the eye can find it. */
  const [highlightId, setHighlightId] = useState<number | null>(null);

  const [pinnedOpen, setPinnedOpen] = useState(true);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [reactingTo, setReactingTo] = useState<number | null>(null);
  const [receiptsFor, setReceiptsFor] = useState<ChatMessage | null>(null);

  // Composer extras: a poll, a time to post at, and a request to confirm.
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[] | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [askAck, setAskAck] = useState(false);
  const [retentionOpen, setRetentionOpen] = useState(false);

  // People-picker for starting a private 1:1 chat
  const [pickerOpen, setPickerOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");

  // Voice message recording state
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [sendingVoice, setSendingVoice] = useState(false);
  // Files chosen but not yet sent, and the viewer for an image already sent.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [sendingFiles, setSendingFiles] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /*
    The channels and groups this person is in.

    Being added to a group happens on somebody else's screen -- HR or the CTO
    adds you -- so nothing here knows it happened. With refetchOnMount off and
    a five minute staleTime, the list was answered from cache on every visit
    and a new group did not appear until the cache expired or the session was
    restarted, which read as the group never arriving.

    Polled instead, and refetched when the tab is looked at again, which is
    when a missing group is actually noticed.
  */
  const { data: myGroups, isLoading: groupsLoading } = useQuery({
    queryKey: ["my_communities"],
    queryFn: async () => {
      const res = await api.get<CommunityGroup[]>("/communities/me");
      return res.data;
    },
    refetchInterval: 20000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const {
    messages, isLoading: chatLoading, sendMessage, sendVoice, sendAttachments, deleteMessage,
    react, setPinned, markRead, acknowledge, vote,
    onlineUserIds, lastSeen,
    // The call itself is drawn above the routes; the page only places one.
    callState, startCall
  } = useChat(activeGroupId);

  // Drawn above the routes as well; the page only starts one.
  const groupCall = useGroupCall();

  const onlineSet = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);

  // Switching rooms must not carry staged files across — they would be sent to
  // whichever conversation happened to be open. The same goes for a half-written
  // poll, a reply and a search: all of them belong to the room being left.
  useEffect(() => {
    setPendingFiles([]);
    setDraft("");
    setReplyTo(null);
    setPollOptions(null);
    setScheduleAt("");
    setAskAck(false);
    setOptionsOpen(false);
    setSearchOpen(false);
    setRoomSearch("");
    setReactingTo(null);
    setReceiptsFor(null);
  }, [activeGroupId]);

  // ---- pinned messages, in-room search and read receipts ----

  const pinned = useQuery({
    queryKey: ["chat_pinned", activeGroupId],
    queryFn: async () => {
      if (!activeGroupId) return [] as ChatMessage[];
      const res = await api.get<ChatMessage[]>(`/communities/${activeGroupId}/messages/pinned`);
      return res.data;
    },
    enabled: !!activeGroupId
  });

  const trimmedSearch = roomSearch.trim();
  const searchResults = useQuery({
    queryKey: ["chat_search", activeGroupId, trimmedSearch],
    queryFn: async () => {
      if (!activeGroupId) return [] as ChatMessage[];
      const res = await api.get<ChatMessage[]>(
        `/communities/${activeGroupId}/messages/search?q=${encodeURIComponent(trimmedSearch)}`
      );
      return res.data;
    },
    enabled: !!activeGroupId && searchOpen && trimmedSearch.length >= 2
  });

  interface ReceiptPerson {
    userId: number;
    name: string;
    employeeCode?: string;
    // Both are sent by CommunityService.readReceipts and both are filtered on
    // below; they were simply missing from this declaration.
    enabled?: boolean;
    profileStatus?: string;
    readAt?: string | null;
    acknowledgedAt?: string | null;
  }
  interface Receipts {
    total: number;
    readCount: number;
    ackCount: number;
    requiresAck: boolean;
    people: ReceiptPerson[];
  }

  const receipts = useQuery({
    queryKey: ["chat_receipts", receiptsFor?.messageId],
    queryFn: async () => {
      const res = await api.get<Receipts>(`/communities/messages/${receiptsFor!.messageId}/receipts`);
      return res.data;
    },
    enabled: !!receiptsFor
  });

  // Messages already reported as read, so scrolling does not repost them.
  const readReported = useRef<Set<number>>(new Set());
  useEffect(() => { readReported.current = new Set(); }, [activeGroupId]);

  // A message on screen has been seen. Reported once each, quietly.
  useEffect(() => {
    if (!activeGroupId || !user) return;
    const fresh = messages.filter(
      (m) => !m.isOptimistic && m.senderId !== user.id && !readReported.current.has(m.messageId)
    );
    if (fresh.length === 0) return;
    fresh.forEach((m) => readReported.current.add(m.messageId));
    fresh.forEach((m) => { void markRead(m.messageId); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, activeGroupId, user?.id]);

  /** Scroll a message into view and ring it for a moment. */
  const jumpToMessage = (messageId: number) => {
    const el = document.getElementById(`chat-msg-${messageId}`);
    if (!el) {
      toast.error("That message is not loaded in this view.");
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(messageId);
    window.setTimeout(() => setHighlightId((cur) => (cur === messageId ? null : cur)), 2200);
  };

  const byId = useMemo(() => {
    const map = new Map<number, ChatMessage>();
    messages.forEach((m) => map.set(m.messageId, m));
    (pinned.data || []).forEach((m) => { if (!map.has(m.messageId)) map.set(m.messageId, m); });
    return map;
  }, [messages, pinned.data]);

  // Follow ?c= when it changes — e.g. a second chat notification is clicked
  // while this page is already open — then drop it so the URL stays clean.
  useEffect(() => {
    if (!requestedGroupId) return;
    setActiveGroupId(requestedGroupId);
    const next = new URLSearchParams(searchParams);
    next.delete("c");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedGroupId]);

  const stopTimer = () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  async function startRecording() {
    if (!activeGroupId) return;
    // Microphone access requires a secure context (HTTPS). On plain HTTP the
    // browser does not expose navigator.mediaDevices at all, so tell the user
    // the real reason instead of a generic "denied" message.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Voice needs a secure (https) connection. Ask your admin to enable HTTPS.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      cancelledRef.current = false;
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        stopTimer();
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (cancelledRef.current || blob.size === 0) return;
        setSendingVoice(true);
        try {
          await sendVoice(blob);
        } catch (err: any) {
          toast.error(err.response?.data?.message || "Could not send voice message");
        } finally {
          setSendingVoice(false);
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
      setRecordSecs(0);
      recordTimerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    } catch (err) {
      toast.error("Microphone access denied or unavailable.");
    }
  }

  function stopRecording(cancel: boolean) {
    cancelledRef.current = cancel;
    setRecording(false);
    try {
      mediaRecorderRef.current?.stop();
    } catch { /* already stopped */ }
    stopTimer();
  }

  async function onDeleteMessage(messageId: number) {
    try {
      await deleteMessage(messageId);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Could not delete message");
    }
  }

  /*
    Everyone this person may contact, for both pickers.

    Fetched only while one of them is open, because it is the whole staff list
    and no other part of this page wants it. The group call picker had to be
    added to this condition: it reads the same list, so with only the private
    chat picker named here it opened onto "There is nobody here to call" --
    the request had never been made.
  */
  const { data: contacts, isLoading: contactsLoading } = useQuery({
    queryKey: ["chat_contacts"],
    queryFn: async () => {
      const res = await api.get<Contact[]>("/communities/contacts");
      return res.data;
    },
    enabled: pickerOpen || groupCallOpen
  });

  const startDirect = useMutation({
    mutationFn: async (userId: number) => {
      const res = await api.post<CommunityGroup>(`/communities/direct/${userId}`);
      return res.data;
    },
    onSuccess: async (group) => {
      await qc.invalidateQueries({ queryKey: ["my_communities"] });
      setActiveGroupId(group.id);
      setPickerOpen(false);
      setContactSearch("");
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || "Could not start chat");
    }
  });

  // Auto-scroll messages to bottom
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages, chatLoading]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeGroupId) return;

    // Files staged? Send them, with whatever was typed as the caption.
    if (pendingFiles.length > 0) {
      const files = pendingFiles;
      const caption = draft;
      setSendingFiles(true);
      try {
        await sendAttachments(files, caption);
        setPendingFiles([]);
        setDraft("");
      } catch (err: any) {
        toast.error(err.response?.data?.message || "Could not send the files");
      } finally {
        setSendingFiles(false);
      }
      return;
    }

    // A poll carries its question in the text, so both are needed.
    const options = (pollOptions || []).map((o) => o.trim()).filter(Boolean);
    if (pollOptions) {
      if (!draft.trim()) {
        toast.error("Type the poll question first.");
        return;
      }
      if (options.length < MIN_POLL_OPTIONS) {
        toast.error(`A poll needs at least ${MIN_POLL_OPTIONS} choices.`);
        return;
      }
    }

    if (!draft.trim()) return;

    if (scheduleAt && dayjs(scheduleAt).isBefore(dayjs())) {
      toast.error("That time has already passed. Pick a later one.");
      return;
    }

    const extras: SendExtras = {};
    if (replyTo) extras.parentId = replyTo.messageId;
    if (pollOptions) extras.pollOptions = options;
    if (scheduleAt) extras.scheduledAt = dayjs(scheduleAt).format("YYYY-MM-DDTHH:mm:ss");
    if (askAck) extras.requiresAck = true;

    const msg = draft;
    const wasScheduled = !!scheduleAt;
    setDraft("");
    setReplyTo(null);
    setPollOptions(null);
    setScheduleAt("");
    setAskAck(false);
    setOptionsOpen(false);
    try {
      await sendMessage(msg, extras);
      if (wasScheduled) {
        toast.success(`Scheduled for ${dayjs(scheduleAt).format("DD MMM, h:mm A")}`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to send message");
    }
  };

  /** Pin or unpin, telling the user which way it went. */
  const onTogglePin = async (msg: ChatMessage) => {
    try {
      await setPinned(msg.messageId, !msg.pinned);
      toast.success(msg.pinned ? "Unpinned" : "Pinned to this chat");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Could not pin the message");
    }
  };

  const onReact = async (messageId: number, emoji: string) => {
    setReactingTo(null);
    try {
      await react(messageId, emoji);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Could not add the reaction");
    }
  };

  const onAcknowledge = async (messageId: number) => {
    try {
      await acknowledge(messageId);
      toast.success("Confirmed — thank you");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Could not record your confirmation");
    }
  };

  const onVote = async (messageId: number, optionIndex: number) => {
    try {
      await vote(messageId, optionIndex);
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Could not record your vote");
    }
  };

  if (groupsLoading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <PixousLoader size="md" />
      </div>
    );
  }

  const activeGroup = myGroups?.find((g) => g.id === activeGroupId);
  const isAdminOrHr = user?.roles?.some((r) => r === "SUPER_ADMIN" || r === "COMPANY_ADMIN" || r === "IT_HR" || r === "IT_MGR")
    // The company head by employee code, whatever roles he happens to hold.
    || user?.employeeCode?.toUpperCase() === "PIX-E100";

  const isAnnouncement = !!(activeGroup?.announcement ?? activeGroup?.isAnnouncement);
  const isDirect = !!activeGroup?.direct;
  const canPost = !isAnnouncement || isAdminOrHr;
  const partnerOnline = activeGroup?.partnerId ? onlineSet.has(activeGroup.partnerId) : false;

  /**
   * Ring the other person, online or not. Somebody with the portal closed still
   * gets the call as a notification, so refusing to dial would only hide a call
   * they could have answered — presence is a hint, not a gate.
   */
  const onStartCall = async (video: boolean) => {
    if (!activeGroup?.partnerId) return;
    if (!partnerOnline) {
      toast(`${activeGroup.name} looks offline — ringing anyway.`, { icon: "📞" });
    }
    try {
      await startCall(activeGroup.partnerId, activeGroup.name, video);
    } catch (err: any) {
      toast.error(err?.message || "Could not start the call");
    }
  };

  /**
   * Ring everyone in the room.
   *
   * The member list is fetched at the moment of calling rather than kept in
   * sync: it is only needed here, it is small, and a list that was correct
   * when the page loaded is not necessarily correct now.
   */
  const onStartGroupCall = async (video: boolean) => {
    if (!activeGroup) return;
    try {
      // Bare array, not an envelope, and the path is plural. Both differ
      // from most endpoints in this app, so they are easy to get wrong.
      const res = await api.get<Array<{ id: number }>>(
        `/communities/${activeGroup.id}/members`
      );
      const ids = (res.data ?? []).map((m) => m.id).filter(Boolean);
      if (ids.length === 0) {
        toast.error("This room has no members to call.");
        return;
      }
      await groupCall.start(String(activeGroup.id), activeGroup.name, ids, video);
    } catch (err: any) {
      toast.error(err?.message || "Could not start the group call");
    }
  };

  /**
   * Ring the people picked in the dialog above.
   *
   * The room id is invented here rather than taken from a chat room, because
   * there is no room -- the mesh needs a list of people and something to tell
   * one call apart from another, and nothing else. It carries the caller's id
   * and the clock so two calls started in the same second by different people
   * cannot collide.
   *
   * memberIds includes the caller. Everyone who accepts announces themselves
   * to every other member, and leaving the caller out of that list would mean
   * nobody ever connected back to the person who started the call.
   */
  const startAdHocGroupCall = async (video: boolean) => {
    if (groupCallPick.length === 0 || !user?.id) return;
    const names = (contacts ?? [])
      .filter((c) => groupCallPick.includes(c.id))
      .map((c) => (c.name || "").split(" ")[0])
      .filter(Boolean);
    const title = names.length <= 2
      ? names.join(" & ")
      : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
    try {
      await groupCall.start(
        `adhoc-${user.id}-${Date.now()}`,
        title || "Group call",
        [user.id, ...groupCallPick],
        video
      );
    } catch (err: any) {
      toast.error(err?.message || "Could not start the group call");
    }
  };

  // Filter my conversations based on search text
  const filteredGroups =
    myGroups?.filter(
      (g) =>
        g.name.toLowerCase().includes(chatSearch.toLowerCase()) ||
        (g.description || "").toLowerCase().includes(chatSearch.toLowerCase())
    ) || [];
  const channels = filteredGroups.filter((g) => !g.direct);
  const directChats = filteredGroups.filter((g) => g.direct);

  const filteredContacts =
    contacts?.filter(
      (c) =>
        c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
        (c.employeeCode || "").toLowerCase().includes(contactSearch.toLowerCase())
    ) || [];

  const renderGroupButton = (group: CommunityGroup) => {
    const active = activeGroupId === group.id;
    const groupIsAnnouncement = !!(group.announcement ?? group.isAnnouncement);
    return (
      <button
        key={group.id}
        onClick={() => setActiveGroupId(group.id)}
        className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-all ${
          active ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-muted"
        }`}
      >
        {group.direct ? (
          <PersonAvatar
            name={group.name}
            photoPath={group.partnerPhotoPath}
            size={38}
            active={active}
            online={group.partnerId ? onlineSet.has(group.partnerId) : undefined}
          />
        ) : (
          <div
            className={`p-2 rounded-lg ${
              active
                ? "bg-primary-foreground/10"
                : groupIsAnnouncement
                ? "bg-amber-100 text-amber-700"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {groupIsAnnouncement ? <Megaphone className="w-4 h-4" /> : <Hash className="w-4 h-4" />}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-sm truncate">{group.name}</div>
            {group.direct ? (
              <Lock className={`w-3 h-3 shrink-0 ${active ? "text-primary-foreground/80" : "text-emerald-600"}`} />
            ) : (
              groupIsAnnouncement && (
                <Badge
                  variant="outline"
                  className={`text-[9px] uppercase px-1.5 py-0 ${
                    active
                      ? "text-primary-foreground border-primary-foreground/30 bg-primary-foreground/5"
                      : "text-amber-700 border-amber-300 bg-amber-50"
                  }`}
                >
                  Official
                </Badge>
              )
            )}
          </div>
          <div className={`text-xs truncate ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
            {group.direct
              ? group.partnerId && onlineSet.has(group.partnerId)
                ? "Online"
                : group.description || "Private chat"
              : group.description}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="relative flex h-[calc(100vh-8.5rem)] rounded-2xl border bg-card overflow-hidden shadow-md">
      {/* Sidebar: Conversations */}
      <div className="w-1/3 md:w-1/4 border-r bg-muted/10 flex flex-col relative">
        {/* Sidebar Header */}
        <div className="p-4 border-b bg-card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-lg flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-primary" />
              Chats
            </h2>
            <Button
              size="sm"
              className="h-8 gap-1.5 rounded-full"
              onClick={() => {
                setPickerOpen(true);
                setContactSearch("");
              }}
            >
              <UserPlus className="w-4 h-4" />
              New
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="Start a group call with anyone"
              onClick={() => { setGroupCallOpen(true); setGroupCallPick([]); setGroupCallSearch(""); }}
              disabled={groupCall.state !== "idle" || callState !== "idle"}
            >
              <Video className="w-4 h-4" />
              Group call
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search conversations..."
              value={chatSearch}
              onChange={(e) => setChatSearch(e.target.value)}
              className="pl-8 bg-muted/30 focus-visible:ring-1"
            />
          </div>
        </div>

        {/* Sidebar List */}
        <div className="overflow-y-auto flex-1 p-2 space-y-1">
          {filteredGroups.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground text-center">No conversations found.</div>
          )}

          {channels.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Channels &amp; Groups
              </div>
              {channels.map(renderGroupButton)}
            </>
          )}

          {directChats.length > 0 && (
            <>
              <div className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Lock className="w-3 h-3" /> Personal Chats
              </div>
              {directChats.map(renderGroupButton)}
            </>
          )}
        </div>

        {/* People Picker Overlay */}
        {pickerOpen && (
          <div className="absolute inset-0 z-20 bg-card flex flex-col">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-primary" />
                New personal chat
              </h3>
              <button
                onClick={() => setPickerOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search people..."
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  className="pl-8 bg-muted/30 focus-visible:ring-1"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {contactsLoading ? (
                <div className="flex h-full items-center justify-center">
                  <PixousLoader size="sm" />
                </div>
              ) : filteredContacts.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground text-center flex flex-col items-center gap-2">
                  <Users className="w-6 h-6 opacity-30" />
                  No people found.
                </div>
              ) : (
                filteredContacts.map((c) => (
                  <button
                    key={c.id}
                    disabled={startDirect.isPending}
                    onClick={() => startDirect.mutate(c.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-muted transition-all disabled:opacity-60"
                  >
                    <PersonAvatar name={c.name} photoPath={c.photoPath} size={38} />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{c.employeeCode}</div>
                    </div>
                    {startDirect.isPending ? (
                      <PixousLoader size="xs" />
                    ) : (
                      <MessageSquare className="w-4 h-4 text-muted-foreground" />
                    )}
                  </button>
                ))
              )}
            </div>
            <div className="p-3 border-t text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Lock className="w-3 h-3 shrink-0 text-emerald-600" />
              Private 1-to-1 conversation — only you two can see it.
            </div>
          </div>
        )}
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-card relative">
        {activeGroupId && activeGroup ? (
          <>
            {/* Header */}
            <div className="p-4 border-b flex items-center justify-between bg-muted/10">
              <div className="flex items-center gap-3">
                {isDirect ? (
                  <PersonAvatar
                    name={activeGroup.name}
                    photoPath={activeGroup.partnerPhotoPath}
                    size={42}
                    online={partnerOnline}
                  />
                ) : (
                  <div className={`p-2.5 rounded-xl ${isAnnouncement ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                    {isAnnouncement ? <Megaphone className="w-5 h-5" /> : <Hash className="w-5 h-5" />}
                  </div>
                )}
                <div>
                  <h3 className="font-bold text-sm md:text-base leading-tight">{activeGroup.name}</h3>
                  {isDirect ? (
                    partnerOnline ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        Online
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                        {lastSeenLabel(activeGroup.partnerId ? lastSeen[String(activeGroup.partnerId)] : undefined)}
                      </span>
                    )
                  ) : (
                    <span className="text-xs text-muted-foreground block truncate max-w-md">{activeGroup.description}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                {/* Voice and video calls — a private chat has one person to ring. */}
                {isDirect && activeGroup.partnerId && (
                  <>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={callState !== "idle"}
                      title="Voice call"
                      onClick={() => onStartCall(false)}
                      className="h-9 w-9 rounded-full text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40"
                    >
                      <Phone className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={callState !== "idle"}
                      title="Video call"
                      onClick={() => onStartCall(true)}
                      className="h-9 w-9 rounded-full text-sky-600 hover:bg-sky-50 hover:text-sky-700 disabled:opacity-40"
                    >
                      <Video className="h-4 w-4" />
                    </Button>
                  </>
                )}

                {/*
                  A room with several people in it gets a group call instead.
                  Announcement rooms are excluded: they are a broadcast to a
                  large audience, and ringing everybody on one would be the
                  opposite of what the room is for.
                */}
                {/*
                  Calling the announcement channel, for the people who may post
                  in it.

                  It was hidden outright on announcements, which is right for
                  an employee -- ringing the whole company is not theirs to do
                  -- and wrong for HR, the CTO and the administrators, who are
                  exactly the people who would want to address everyone live.
                  The same three who can post are the three who can call, so
                  the two permissions do not have to be reasoned about
                  separately.
                */}
                {!isDirect && activeGroup && (!isAnnouncement || isAdminOrHr) && (
                  <>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={groupCall.state !== "idle" || callState !== "idle"}
                      title="Group voice call"
                      onClick={() => onStartGroupCall(false)}
                      className="h-9 w-9 rounded-full text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40"
                    >
                      <Phone className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={groupCall.state !== "idle" || callState !== "idle"}
                      title="Group video call"
                      onClick={() => onStartGroupCall(true)}
                      className="h-9 w-9 rounded-full text-sky-600 hover:bg-sky-50 hover:text-sky-700 disabled:opacity-40"
                    >
                      <Video className="h-4 w-4" />
                    </Button>
                  </>
                )}
                {isAdminOrHr && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    title="How long chat history is kept"
                    onClick={() => setRetentionOpen(true)}
                    className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
                  >
                    <History className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  title="Search in this chat"
                  onClick={() => {
                    setSearchOpen((open) => !open);
                    setRoomSearch("");
                  }}
                  className={cn(
                    "h-9 w-9 rounded-full text-muted-foreground hover:text-foreground",
                    searchOpen && "bg-primary/10 text-primary"
                  )}
                >
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Search inside this conversation */}
            {searchOpen && (
              <div className="border-b bg-card px-4 py-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={roomSearch}
                    onChange={(e) => setRoomSearch(e.target.value)}
                    placeholder="Search messages in this chat…"
                    className="bg-muted/30 pl-8 focus-visible:ring-1"
                  />
                  {roomSearch && (
                    <button
                      type="button"
                      onClick={() => setRoomSearch("")}
                      aria-label="Clear search"
                      className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {trimmedSearch.length > 0 && trimmedSearch.length < 2 ? (
                  <p className="mt-2 text-xs text-muted-foreground">Type two or more letters.</p>
                ) : searchResults.isFetching ? (
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <PixousLoader size="xs" /> Searching…
                  </div>
                ) : trimmedSearch.length >= 2 ? (
                  (searchResults.data || []).length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Nothing matches “{trimmedSearch}”.
                    </p>
                  ) : (
                    <>
                      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {searchResults.data!.length} match{searchResults.data!.length === 1 ? "" : "es"}
                        {searchResults.data!.length === 100 && " (showing the newest 100)"}
                      </p>
                      <div className="mt-1 max-h-56 space-y-1 overflow-y-auto">
                        {searchResults.data!.map((m) => (
                          <button
                            key={m.messageId}
                            type="button"
                            onClick={() => jumpToMessage(m.messageId)}
                            className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-muted"
                          >
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="truncate text-xs font-semibold">{m.senderName}</span>
                              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                                {dayjs(m.sentAt).format("DD MMM, h:mm A")}
                              </span>
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {messagePreview(m)}
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  )
                ) : null}
              </div>
            )}

            {/* Pinned messages */}
            {(pinned.data || []).length > 0 && (
              <div className="border-b bg-amber-50/70 px-4 py-2 dark:bg-amber-500/5">
                <button
                  type="button"
                  onClick={() => setPinnedOpen((open) => !open)}
                  className="flex w-full items-center gap-2 text-left text-[11px] font-bold uppercase tracking-wider text-amber-700"
                >
                  <Pin className="h-3.5 w-3.5 shrink-0" />
                  {pinned.data!.length} pinned
                  {pinnedOpen ? (
                    <ChevronUp className="ml-auto h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="ml-auto h-3.5 w-3.5" />
                  )}
                </button>
                {pinnedOpen && (
                  <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">
                    {pinned.data!.map((m) => (
                      <div key={m.messageId} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => jumpToMessage(m.messageId)}
                          className="min-w-0 flex-1 rounded-md px-2 py-1 text-left hover:bg-amber-100/70 dark:hover:bg-amber-500/10"
                        >
                          <span className="text-xs font-semibold">{m.senderName}: </span>
                          <span className="text-xs text-muted-foreground">{messagePreview(m)}</span>
                        </button>
                        {(m.senderId === user?.id || isAdminOrHr) && (
                          <button
                            type="button"
                            onClick={() => onTogglePin({ ...m, pinned: true })}
                            title="Unpin"
                            className="shrink-0 p-1 text-amber-700 hover:text-amber-900"
                            aria-label="Unpin message"
                          >
                            <PinOff className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#e5ddd5]/30 dark:bg-muted/5">
              {chatLoading ? (
                <div className="flex h-full items-center justify-center">
                  <PixousLoader size="sm" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
                  <MessageSquare className="w-8 h-8 mb-2 opacity-30" />
                  No messages yet. Start the conversation!
                </div>
              ) : (
                messages.map((msg, idx) => {
                  const isMe = msg.senderId === user?.id;
                  const showName = !isMe && !isDirect && (idx === 0 || messages[idx - 1].senderId !== msg.senderId);

                  const audioUrl = msg.audioPath ? resolvePhotoUrl(msg.audioPath) : undefined;

                  const parent = msg.parentId ? byId.get(msg.parentId) : undefined;
                  const isPoll = !!msg.pollOptions?.length;
                  const pollTotal = (msg.pollVotes || []).reduce((s, n) => s + n, 0);
                  const waiting = !!msg.scheduledAt && dayjs(msg.scheduledAt).isAfter(dayjs());
                  const canPin = isMe || isAdminOrHr;
                  const reactionEntries = Object.entries(msg.reactions || {});

                  return (
                    <div
                      key={`${msg.messageId}-${idx}`}
                      id={`chat-msg-${msg.messageId}`}
                      className={cn(
                        "group flex flex-col scroll-mt-4",
                        isMe ? "items-end" : "items-start",
                        highlightId === msg.messageId && "rounded-2xl ring-2 ring-primary/60 ring-offset-2 ring-offset-transparent transition-shadow"
                      )}
                    >
                      {showName && (
                        <span className="text-[11px] font-semibold text-muted-foreground mb-0.5 ml-1">{msg.senderName}</span>
                      )}
                      <div className={`flex items-center gap-1.5 max-w-[75%] ${isMe ? "flex-row" : ""}`}>
                        {/* Reply, react, pin — and delete, for my own messages */}
                        {!msg.isOptimistic && (
                          <div className="relative flex shrink-0 items-center gap-0.5 rounded-full border bg-card/95 px-1.5 py-1 shadow-md backdrop-blur-md opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            {isMe && (
                              <button
                                onClick={() => onDeleteMessage(msg.messageId)}
                                title="Delete message"
                                className="rounded-full p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600 transition-colors"
                                aria-label="Delete message"
                              >
                                <Trash2 className="w-4 h-4 stroke-[2.2]" />
                              </button>
                            )}
                            {canPin && (
                              <button
                                onClick={() => onTogglePin(msg)}
                                title={msg.pinned ? "Unpin" : "Pin to this chat"}
                                className={cn(
                                  "rounded-full p-1.5 transition-colors",
                                  msg.pinned ? "text-amber-500 bg-amber-500/10" : "text-muted-foreground hover:bg-amber-500/10 hover:text-amber-600"
                                )}
                                aria-label={msg.pinned ? "Unpin message" : "Pin message"}
                              >
                                {msg.pinned ? <PinOff className="w-4 h-4 stroke-[2.2]" /> : <Pin className="w-4 h-4 stroke-[2.2]" />}
                              </button>
                            )}
                            {canPost && (
                              <button
                                onClick={() => setReactingTo((cur) => (cur === msg.messageId ? null : msg.messageId))}
                                title="React"
                                className="rounded-full p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                                aria-label="React to message"
                              >
                                <SmilePlus className="w-4 h-4 stroke-[2.2]" />
                              </button>
                            )}
                            {canPost && !waiting && (
                              <button
                                onClick={() => setReplyTo(msg)}
                                title="Reply"
                                className="rounded-full p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                                aria-label="Reply to message"
                              >
                                <Reply className="w-4 h-4 stroke-[2.2]" />
                              </button>
                            )}

                            {reactingTo === msg.messageId && (
                              <div className="absolute bottom-full z-30 mb-1 flex gap-0.5 rounded-full border bg-card p-1 shadow-lg">
                                {QUICK_REACTIONS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => onReact(msg.messageId, emoji)}
                                    className={cn(
                                      "rounded-full px-1.5 py-0.5 text-base leading-none hover:bg-muted",
                                      msg.myReactions?.includes(emoji) && "bg-primary/15"
                                    )}
                                    aria-label={`React with ${emoji}`}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        <div
                          className={`min-w-0 px-3.5 py-2 rounded-2xl shadow-sm ${
                            isMe ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-card text-foreground border rounded-tl-none"
                          }`}
                        >
                          {/* Only the sender sees a message still waiting for its
                              time; saying so stops it looking like a failure. */}
                          {waiting && (
                            <div className={cn(
                              "mb-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium",
                              isMe ? "bg-white/15" : "bg-amber-50 text-amber-700"
                            )}>
                              <Clock className="h-3 w-3 shrink-0" />
                              Scheduled for {dayjs(msg.scheduledAt).format("DD MMM, h:mm A")} — only you can see it
                            </div>
                          )}

                          {/* What this message answers. */}
                          {msg.parentId && (
                            <button
                              type="button"
                              onClick={() => jumpToMessage(msg.parentId!)}
                              className={cn(
                                "mb-1.5 flex w-full items-start gap-1.5 rounded-lg border-l-2 px-2 py-1 text-left",
                                isMe
                                  ? "border-white/50 bg-white/10 hover:bg-white/20"
                                  : "border-primary/50 bg-muted/60 hover:bg-muted"
                              )}
                            >
                              <CornerDownRight className="mt-0.5 h-3 w-3 shrink-0 opacity-70" />
                              <span className="min-w-0">
                                <span className="block text-[11px] font-semibold">
                                  {parent?.senderName ?? "Earlier message"}
                                </span>
                                <span className="block truncate text-[11px] opacity-80">
                                  {messagePreview(parent)}
                                </span>
                              </span>
                            </button>
                          )}

                          {/* The time sits in the layout rather than floating over
                              it: a short message used to have the timestamp
                              printed across the words. */}
                          {audioUrl ? (
                            <>
                              <audio controls src={audioUrl} className="h-9 max-w-[220px]" />
                              <div className={`mt-1 flex items-center justify-end gap-1 ${
                                isMe ? "text-primary-foreground/75" : "text-muted-foreground"
                              }`}>
                                <span className="text-[10px] tabular-nums">
                                  {dayjs(msg.sentAt).format("h:mm A")}
                                </span>
                                {isMe && !msg.isOptimistic && (
                                  <DeliveryTicks read={(msg.readCount ?? 0) > 0} isMe={isMe} />
                                )}
                              </div>
                            </>
                          ) : (
                            <>
                              <MessageAttachments
                                paths={msg.attachments}
                                isMe={isMe}
                                onOpenImage={setLightbox}
                              />
                              <div className="flex items-end gap-2">
                                <p className="min-w-0 flex-1 text-sm whitespace-pre-wrap leading-snug break-words">
                                  {msg.content}
                                </p>
                                <span className={`shrink-0 flex translate-y-0.5 items-center gap-1 text-[10px] tabular-nums ${
                                  isMe ? "text-primary-foreground/75" : "text-muted-foreground"
                                }`}>
                                  {dayjs(msg.sentAt).format("h:mm A")}
                                  {isMe && !msg.isOptimistic && (
                                    <DeliveryTicks read={(msg.readCount ?? 0) > 0} isMe={isMe} />
                                  )}
                                </span>
                              </div>
                            </>
                          )}

                          {/* A poll: tap a choice to vote, tap another to change it. */}
                          {isPoll && (
                            <div className="mt-2 space-y-1.5">
                              {msg.pollOptions!.map((label, i) => {
                                const count = msg.pollVotes?.[i] ?? 0;
                                const share = pollTotal === 0 ? 0 : Math.round((count / pollTotal) * 100);
                                const mine = msg.myVote === i;
                                return (
                                  <button
                                    key={`${msg.messageId}-opt-${i}`}
                                    type="button"
                                    disabled={!canPost || waiting}
                                    onClick={() => onVote(msg.messageId, i)}
                                    className={cn(
                                      "relative w-full overflow-hidden rounded-lg border px-2.5 py-1.5 text-left text-xs disabled:cursor-default",
                                      isMe ? "border-white/30" : "border-border",
                                      mine && (isMe ? "border-white/70 bg-white/10" : "border-primary bg-primary/5")
                                    )}
                                  >
                                    <span
                                      aria-hidden
                                      className={cn(
                                        "absolute inset-y-0 left-0 transition-all",
                                        isMe ? "bg-white/20" : "bg-primary/10"
                                      )}
                                      style={{ width: `${share}%` }}
                                    />
                                    <span className="relative flex items-center justify-between gap-2">
                                      <span className="flex min-w-0 items-center gap-1.5">
                                        {mine && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                                        <span className="truncate font-medium">{label}</span>
                                      </span>
                                      <span className="shrink-0 tabular-nums opacity-80">
                                        {count} · {share}%
                                      </span>
                                    </span>
                                  </button>
                                );
                              })}
                              <div className={cn(
                                "flex items-center gap-1 text-[10px]",
                                isMe ? "text-primary-foreground/75" : "text-muted-foreground"
                              )}>
                                <BarChart3 className="h-3 w-3" />
                                {pollTotal} vote{pollTotal === 1 ? "" : "s"}
                              </div>
                            </div>
                          )}

                          {/* An announcement that asks to be confirmed. */}
                          {msg.requiresAck && !waiting && (
                            msg.acknowledgedByMe ? (
                              <div className={cn(
                                "mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium",
                                isMe ? "bg-white/15" : "bg-emerald-50 text-emerald-700"
                              )}>
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                You have confirmed reading this
                              </div>
                            ) : (
                              <div className={cn(
                                "mt-2 flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5",
                                isMe ? "bg-white/15" : "bg-amber-50"
                              )}>
                                <span className={cn(
                                  "text-[11px] font-medium",
                                  isMe ? "" : "text-amber-800"
                                )}>
                                  Please confirm you have read this.
                                </span>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-6 rounded-full px-2.5 text-[11px]"
                                  onClick={() => onAcknowledge(msg.messageId)}
                                >
                                  I have read it
                                </Button>
                              </div>
                            )
                          )}

                          {/* Reactions already on this message. */}
                          {reactionEntries.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {reactionEntries.map(([emoji, count]) => {
                                const mine = msg.myReactions?.includes(emoji);
                                return (
                                  <button
                                    key={`${msg.messageId}-${emoji}`}
                                    type="button"
                                    disabled={!canPost}
                                    onClick={() => onReact(msg.messageId, emoji)}
                                    title={mine ? "Remove your reaction" : "Add your reaction"}
                                    className={cn(
                                      // A reaction gets its own colour rather than
                                      // the bubble's: on the sender's violet it was
                                      // near-invisible, and it is a different kind
                                      // of thing from the message it sits under.
                                      "flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold leading-none shadow-sm transition-colors disabled:cursor-default",
                                      mine
                                        ? "border-teal-500 bg-teal-400 text-teal-950"
                                        : "border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100"
                                    )}
                                  >
                                    <span className="text-xs">{emoji}</span>
                                    <span className="tabular-nums">{count}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* Replies, and who has read it — the sender's view. */}
                          {(!!msg.replyCount || (isMe && !isDirect && !waiting)) && (
                            <div className={cn(
                              "mt-1.5 flex flex-wrap items-center gap-3 text-[10px]",
                              isMe ? "text-primary-foreground/80" : "text-muted-foreground"
                            )}>
                              {!!msg.replyCount && (
                                <span className="flex items-center gap-1">
                                  <Reply className="h-3 w-3" />
                                  {msg.replyCount} repl{msg.replyCount === 1 ? "y" : "ies"}
                                </span>
                              )}
                              {isMe && !isDirect && !waiting && (
                                <button
                                  type="button"
                                  onClick={() => setReceiptsFor(msg)}
                                  className="flex items-center gap-1 underline-offset-2 hover:underline"
                                >
                                  <Eye className="h-3 w-3" />
                                  Read by {msg.readCount ?? 0}
                                  {msg.requiresAck && ` · ${msg.ackCount ?? 0} confirmed`}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messageEndRef} />
            </div>

            {/* Input Form */}
            <div className="p-3 border-t bg-card">
              {canPost ? (
                recording ? (
                  /* Recording bar */
                  <div className="flex items-center gap-3 rounded-full bg-red-50 border border-red-200 px-4 py-2">
                    <span className="flex h-3 w-3 items-center justify-center">
                      <span className="absolute h-3 w-3 rounded-full bg-red-500 animate-ping" />
                      <span className="h-3 w-3 rounded-full bg-red-500" />
                    </span>
                    <span className="text-sm font-medium text-red-600 flex-1">
                      Recording… {Math.floor(recordSecs / 60)}:{String(recordSecs % 60).padStart(2, "0")}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => stopRecording(true)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      className="rounded-full h-9 w-9 shrink-0 bg-red-500 hover:bg-red-600 text-white"
                      onClick={() => stopRecording(false)}
                      title="Stop & send"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                <div className="space-y-2">
                  {/* What this message will answer. */}
                  {replyTo && (
                    <div className="flex items-start gap-2 rounded-xl border-l-2 border-primary bg-muted/40 px-2.5 py-1.5">
                      <Reply className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-semibold">
                          Replying to {replyTo.senderId === user?.id ? "yourself" : replyTo.senderName}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {messagePreview(replyTo)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReplyTo(null)}
                        title="Cancel reply"
                        aria-label="Cancel reply"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Poll choices. The question is whatever is typed below. */}
                  {pollOptions && (
                    <div className="space-y-1.5 rounded-xl border bg-muted/30 p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                          <BarChart3 className="h-3.5 w-3.5" /> Poll choices
                        </span>
                        <button
                          type="button"
                          onClick={() => setPollOptions(null)}
                          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
                        >
                          Remove poll
                        </button>
                      </div>
                      {pollOptions.map((opt, i) => (
                        <div key={`poll-opt-${i}`} className="flex items-center gap-1.5">
                          <span className="w-4 shrink-0 text-center text-[11px] font-semibold text-muted-foreground">
                            {i + 1}
                          </span>
                          <Input
                            value={opt}
                            onChange={(e) =>
                              setPollOptions((prev) =>
                                (prev || []).map((o, j) => (j === i ? e.target.value : o))
                              )
                            }
                            placeholder={`Choice ${i + 1}`}
                            className="h-8 flex-1 bg-background text-xs"
                          />
                          {pollOptions.length > MIN_POLL_OPTIONS && (
                            <button
                              type="button"
                              onClick={() => setPollOptions((prev) => (prev || []).filter((_, j) => j !== i))}
                              title="Remove this choice"
                              aria-label="Remove this choice"
                              className="shrink-0 text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                      {pollOptions.length < MAX_POLL_OPTIONS && (
                        <button
                          type="button"
                          onClick={() => setPollOptions((prev) => [...(prev || []), ""])}
                          className="flex items-center gap-1 pl-5 text-[11px] font-medium text-primary hover:underline"
                        >
                          <Plus className="h-3 w-3" /> Add a choice
                        </button>
                      )}
                    </div>
                  )}

                  {/* Chips for a scheduled time and a request to confirm. */}
                  {(scheduleAt || askAck) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {scheduleAt && (
                        <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
                          <Clock className="h-3 w-3" />
                          Posts {dayjs(scheduleAt).format("DD MMM, h:mm A")}
                          <button
                            type="button"
                            onClick={() => setScheduleAt("")}
                            aria-label="Send now instead"
                            className="hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      )}
                      {askAck && (
                        <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
                          <CheckCircle2 className="h-3 w-3" />
                          Readers must confirm
                          <button
                            type="button"
                            onClick={() => setAskAck(false)}
                            aria-label="Do not ask for confirmation"
                            className="hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Files staged for sending — the caption is whatever is typed. */}
                  {pendingFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2 rounded-xl border bg-muted/30 p-2">
                      {pendingFiles.map((f, i) => (
                        <div
                          key={`${f.name}-${i}`}
                          className="flex items-center gap-1.5 rounded-lg bg-background px-2 py-1 text-xs shadow-sm"
                        >
                          {f.type.startsWith("image/") ? (
                            <StagedThumb file={f} />
                          ) : f.type.startsWith("video/") ? (
                            <Video className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="max-w-[140px] truncate font-medium">{f.name}</span>
                          <span className="text-muted-foreground">{prettySize(f.size)}</span>
                          <button
                            type="button"
                            onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                            title="Remove"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <form onSubmit={handleSend} className="flex gap-2 items-center">
                    {/* A poll, a time to post at, and asking readers to confirm. */}
                    <div className="relative shrink-0">
                      <Button
                        type="button"
                        size="icon"
                        onClick={() => setOptionsOpen((open) => !open)}
                        title="Poll, schedule, confirmation"
                        aria-label="More message options"
                        className={cn(
                          "h-9 w-9 rounded-full border border-muted-foreground/20 hover:bg-muted",
                          optionsOpen ? "bg-primary/10 text-primary" : "text-muted-foreground"
                        )}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>

                      {optionsOpen && (
                        <div className="absolute bottom-full left-0 z-30 mb-2 w-64 rounded-xl border bg-card p-2 shadow-lg">
                          <button
                            type="button"
                            onClick={() => {
                              setPollOptions((prev) => prev ?? ["", ""]);
                              setOptionsOpen(false);
                            }}
                            className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted"
                          >
                            <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <span>
                              <span className="block text-xs font-semibold">Create a poll</span>
                              <span className="block text-[11px] text-muted-foreground">
                                Ask the room to pick one choice.
                              </span>
                            </span>
                          </button>

                          <div className="rounded-lg px-2 py-2">
                            <label
                              htmlFor="chat-schedule-at"
                              className="flex items-center gap-2 text-xs font-semibold"
                            >
                              <Clock className="h-4 w-4 shrink-0 text-primary" />
                              Post later
                            </label>
                            <p className="mb-1.5 mt-0.5 text-[11px] text-muted-foreground">
                              Held until this time, then posted for you.
                            </p>
                            <Input
                              id="chat-schedule-at"
                              type="datetime-local"
                              value={scheduleAt}
                              min={dayjs().format("YYYY-MM-DDTHH:mm")}
                              onChange={(e) => setScheduleAt(e.target.value)}
                              className="h-8 text-xs"
                            />
                          </div>

                          {isAnnouncement && isAdminOrHr && (
                            <button
                              type="button"
                              onClick={() => {
                                setAskAck((cur) => !cur);
                                setOptionsOpen(false);
                              }}
                              className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted"
                            >
                              <CheckCircle2
                                className={cn(
                                  "mt-0.5 h-4 w-4 shrink-0",
                                  askAck ? "text-emerald-600" : "text-primary"
                                )}
                              />
                              <span>
                                <span className="block text-xs font-semibold">
                                  {askAck ? "Do not ask for confirmation" : "Ask readers to confirm"}
                                </span>
                                <span className="block text-[11px] text-muted-foreground">
                                  You can then see who has and has not read it.
                                </span>
                              </span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <Input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={
                        pollOptions
                          ? "Ask your poll question..."
                          : pendingFiles.length > 0
                            ? "Add a caption (optional)..."
                            : isAnnouncement
                              ? "Post an announcement to this channel..."
                              : isDirect
                                ? `Message ${activeGroup.name}...`
                                : "Type your message..."
                      }
                      className="flex-1 bg-muted/20 border-muted-foreground/20 rounded-full focus-visible:ring-1"
                      autoFocus
                    />
                    <input
                      ref={fileInput}
                      type="file"
                      multiple
                      accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                      className="hidden"
                      onChange={(e) => {
                        const picked = Array.from(e.target.files ?? []);
                        e.target.value = "";
                        const tooBig = picked.filter((f) => f.size > MAX_ATTACHMENT_MB * 1024 * 1024);
                        if (tooBig.length) {
                          toast.error(
                            `${tooBig.length} file(s) are over ${prettyLimit(MAX_ATTACHMENT_MB)} and were skipped`
                          );
                        }
                        const ok = picked.filter((f) => f.size <= MAX_ATTACHMENT_MB * 1024 * 1024);
                        setPendingFiles((prev) => {
                          const next: File[] = [...prev];
                          let total = prev.reduce((s, f) => s + f.size, 0);
                          let dropped = 0;
                          for (const f of ok) {
                            if (total + f.size > MAX_BATCH_MB * 1024 * 1024) { dropped++; continue; }
                            next.push(f);
                            total += f.size;
                          }
                          if (dropped > 0) {
                            toast.error(
                              `${dropped} file(s) would exceed the ${prettyLimit(MAX_BATCH_MB)} limit for one message`
                            );
                          }
                          return next;
                        });
                      }}
                    />
                    <Button
                      type="button"
                      size="icon"
                      onClick={() => fileInput.current?.click()}
                      disabled={sendingFiles || !!pollOptions}
                      title={pollOptions ? "Files cannot be attached to a poll" : "Attach photos, videos or documents"}
                      className="rounded-full h-9 w-9 shrink-0 border border-muted-foreground/20 hover:bg-muted text-muted-foreground"
                    >
                      <Paperclip className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      onClick={startRecording}
                      disabled={sendingVoice || pendingFiles.length > 0 || !!pollOptions}
                      title="Record voice message"
                      className="ml-2 rounded-full h-9 w-9 shrink-0 border-0 bg-rose-500 text-white shadow-sm hover:bg-rose-600 disabled:opacity-50"
                    >
                      {sendingVoice ? <PixousLoader size="xs" /> : <Mic className="w-4 h-4" />}
                    </Button>
                    <Button
                      type="submit"
                      size="icon"
                      disabled={(!draft.trim() && pendingFiles.length === 0) || sendingFiles}
                      className="rounded-full h-9 w-9 shrink-0"
                    >
                      {sendingFiles ? <PixousLoader size="xs" /> : <Send className="w-4 h-4" />}
                    </Button>
                  </form>
                </div>
                )
              ) : (
                <div className="text-center text-xs py-2 bg-amber-50 text-amber-700 border border-amber-100 rounded-xl flex items-center justify-center gap-2">
                  <Megaphone className="w-3.5 h-3.5 shrink-0" />
                  <span>Only administrators can post announcements to this channel.</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <MessageSquare className="w-16 h-16 mb-4 opacity-10" />
            <h3 className="font-bold text-lg">Select a conversation</h3>
            <p className="text-sm">Choose a channel, or start a private chat with the “New” button.</p>
          </div>
        )}
      </div>

      {/* Who has read this message, and who has confirmed it */}
      {receiptsFor && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setReceiptsFor(null)}
        >
          <div
            className="flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b p-4">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-sm font-bold">
                  <Eye className="h-4 w-4 text-primary" /> Message status
                </h3>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {messagePreview(receiptsFor)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReceiptsFor(null)}
                aria-label="Close"
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {receipts.isLoading ? (
              <div className="flex h-32 items-center justify-center">
                <PixousLoader size="sm" />
              </div>
            ) : receipts.isError || !receipts.data ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Could not load who has read this.
              </p>
            ) : (
              (() => {
                /*
                  The platform accounts are not an audience.

                  The super administrator, the system administrator and the
                  company head are excluded because a read receipt is about
                  whether the people a message was for have seen it, and none
                  of the three is one of them.

                  Everything else this filter used to do is gone. It matched
                  "ADM" anywhere in an employee code and the word "admin"
                  anywhere in a name -- so an employee called Padmini, or one
                  whose code happened to contain those letters, silently
                  vanished from the list. It also dropped anybody whose
                  profileStatus was not one of four spellings, which the
                  comment beside it admitted was producing empty lists.

                  The server decides who was addressed. It knows the channel
                  and whether it is an announcement; this does not.
                */
                const validPeople = receipts.data.people.filter(p =>
                  p.enabled !== false && !isPlatformAccount(p.employeeCode));
                const validTotal = validPeople.length;
                const validRead = validPeople.filter(p => p.readAt).length;
                const validAck = validPeople.filter(p => p.acknowledgedAt).length;

                return (
                <>
                  <div className="flex gap-2 border-b p-3">
                    <div className="flex-1 rounded-xl bg-muted/40 px-3 py-2 text-center">
                      <div className="text-lg font-bold tabular-nums">
                        {validRead}
                        <span className="text-xs font-normal text-muted-foreground">
                          {" "}/ {validTotal}
                        </span>
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Read</div>
                    </div>
                    {receipts.data.requiresAck && (
                      <div className="flex-1 rounded-xl bg-emerald-50 px-3 py-2 text-center dark:bg-emerald-500/10">
                        <div className="text-lg font-bold tabular-nums text-emerald-700">
                          {validAck}
                          <span className="text-xs font-normal text-emerald-700/70">
                            {" "}/ {validTotal}
                          </span>
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-emerald-700/80">Confirmed</div>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto p-2">
                    {validPeople.length === 0 ? (
                      <p className="p-6 text-center text-sm text-muted-foreground">
                        This room has no other members yet.
                      </p>
                    ) : (
                      validPeople.map((p) => (
                        <div
                          key={p.userId}
                          className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50"
                        >
                          <PersonAvatar name={p.name} size={32} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{p.name}</div>
                            <div className="truncate text-[11px] text-muted-foreground">
                              {p.employeeCode}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            {p.acknowledgedAt ? (
                              <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Confirmed {dayjs(p.acknowledgedAt).format("DD MMM, h:mm A")}
                              </span>
                            ) : p.readAt ? (
                              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <CheckCheck className="h-3.5 w-3.5" />
                                Read {dayjs(p.readAt).format("DD MMM, h:mm A")}
                              </span>
                            ) : (
                              <span className="text-[11px] text-muted-foreground/70">Not read yet</span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
                );
              })()
            )}
          </div>
        </div>
      )}

      {/*
        Pick who is on the call.

        Capped at the mesh ceiling, and the cap is enforced by disabling the
        rest of the list rather than by refusing after the fact -- being told
        "too many" once you have already chosen eight people is a worse
        experience than not being able to choose the seventh.
      */}
      {groupCallOpen && (
        <Dialog open onClose={() => setGroupCallOpen(false)} className="max-w-md">
          <DialogHeader
            title="Start a group call"
            description={`Choose up to ${MAX_AUDIO_PARTICIPANTS - 1} people for a voice call, or ${MAX_GROUP_PARTICIPANTS - 1} for video. Everyone you pick will ring at once.`}
          />
          <div className="px-4">
            <Input
              autoFocus
              placeholder="Search people…"
              value={groupCallSearch}
              onChange={(e) => setGroupCallSearch(e.target.value)}
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            {(contacts ?? [])
              .filter((c) => c.name?.toLowerCase().includes(groupCallSearch.toLowerCase()))
              .map((c) => {
                const picked = groupCallPick.includes(c.id);
                // The audio ceiling, because that is the higher of the two --
                // Video below refuses on its own if too many are picked, which
                // is better than a list that will not let you pick the people
                // you wanted to call in the first place.
                const full = groupCallPick.length >= MAX_AUDIO_PARTICIPANTS - 1;
                return (
                  <label
                    key={c.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted",
                      !picked && full && "cursor-not-allowed opacity-40"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={picked}
                      disabled={!picked && full}
                      onChange={() =>
                        setGroupCallPick((prev) =>
                          prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id])
                      }
                    />
                    <Avatar name={c.name} src={c.photoPath} className="h-8 w-8" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{c.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {c.employeeCode || c.email || ""}
                      </div>
                    </div>
                    {onlineSet.has(c.id) && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                    )}
                  </label>
                );
              })}
            {/*
              Loading and empty are different things and were shown the same
              way. "There is nobody here to call" is alarming and wrong while
              the list is still on its way, and it was on its way every single
              time, because the request only started when the dialog opened.
            */}
            {contactsLoading && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Loading people…
              </p>
            )}
            {!contactsLoading && (contacts ?? []).length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                There is nobody here to call.
              </p>
            )}
            {!contactsLoading && (contacts ?? []).length > 0
              && (contacts ?? []).filter((c) =>
                   c.name?.toLowerCase().includes(groupCallSearch.toLowerCase())).length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Nobody matches “{groupCallSearch}”.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t p-3">
            <span className="text-xs text-muted-foreground">
              {groupCallPick.length} selected
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={groupCallPick.length === 0}
                onClick={() => { setGroupCallOpen(false); void startAdHocGroupCall(false); }}
              >
                <Phone className="mr-1.5 h-4 w-4" /> Voice
              </Button>
              <Button
                disabled={groupCallPick.length === 0
                  || groupCallPick.length > MAX_GROUP_PARTICIPANTS - 1}
                title={groupCallPick.length > MAX_GROUP_PARTICIPANTS - 1
                  ? `Video takes ${MAX_GROUP_PARTICIPANTS} people at most — voice handles this many.`
                  : undefined}
                onClick={() => { setGroupCallOpen(false); void startAdHocGroupCall(true); }}
              >
                <Video className="mr-1.5 h-4 w-4" /> Video
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {retentionOpen && <RetentionDialog onClose={() => setRetentionOpen(false)} />}

      <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
