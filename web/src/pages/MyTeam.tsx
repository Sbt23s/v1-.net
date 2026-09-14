import { PixousLoader } from "@/components/ui/pixous-loader";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users2, Search, MessageSquare, Send, Volume2, Square, Sparkles, Rocket,
  Paperclip, FileText, Trash2, SmilePlus, X} from "lucide-react";
import dayjs from "dayjs";
import { api } from "@/lib/api";
import { fetchTtsUrl } from "@/lib/chatbot";
import { useAuth } from "@/hooks/useAuth";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import { useChat } from "@/hooks/useChat";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, resolvePhotoUrl } from "@/components/ui/avatar";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import toast from "react-hot-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ApiEnvelope, UserSummary, LeaveRequest } from "@/types";
import { useAttendanceLive } from "@/hooks/useAttendanceLive";

const MAX_ATTACHMENT_MB = 2048;
const MAX_BATCH_MB = 5120;
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "🙏", "✅"];

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)$/i;
const PDF_RE = /\.pdf$/i;
const fileName = (path: string) => decodeURIComponent(path.split("/").pop() || "file");

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
                  "cursor-zoom-in object-cover",
                  list.length > 1 ? "h-28 w-full" : "max-h-64 w-full"
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

interface MyTeam {
  teamName: string;
  members: UserSummary[];
}

interface Celebration {
  userId: number; name: string; employeeCode?: string; team?: string;
  type: "BIRTHDAY" | "ANNIVERSARY"; date: string; daysUntil: number; years?: number;
}

interface ChatGroup {
  id: number;
  name: string;
  description?: string;
  direct?: boolean;
}

interface TeamPresence {
  userId: number;
  punchedIn: boolean;
  punchInAt?: string;
}

export default function MyTeamPage() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"ALL" | "AVAILABLE" | "LEAVE">("ALL");
  const [lang, setLang] = useState<"en" | "ta">("en");
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const team = useQuery({
    queryKey: ["my-team"],
    queryFn: async () => (await api.get<ApiEnvelope<MyTeam>>("/users/my-team")).data.data
  });

  const onLeave = useQuery({
    queryKey: ["leave", "on-leave", "team"],
    retry: false,
    queryFn: async () => (await api.get<ApiEnvelope<LeaveRequest[]>>("/leave/on-leave")).data.data
  });

  const celebrations = useQuery({
    queryKey: ["dashboard", "celebrations"],
    retry: false,
    queryFn: async () => (await api.get<ApiEnvelope<Celebration[]>>("/dashboard/celebrations")).data.data
  });

  /*
   * Who on this team is in today, live.
   *
   * The announcement arrives the moment somebody punches -- at a terminal or in
   * the app -- and invalidates the "attendance" keys, this one among them. The
   * minute-long poll below is kept as the floor: a socket that cannot connect
   * through a proxy leaves the page correct but a minute behind, rather than
   * showing this morning's arrivals all afternoon.
   */
  useAttendanceLive();

  // Punch-in status for this team today — Present means they actually punched in.
  const presence = useQuery({
    queryKey: ["attendance", "my-team-today"],
    retry: false,
    refetchInterval: 60_000,
    queryFn: async () =>
      (await api.get<ApiEnvelope<TeamPresence[]>>("/attendance/my-team-today")).data.data
  });

  /*
    The team channel is not created from here any more.

    This fired a POST on every visit to the page and then did nothing with the
    result -- nothing read `teamRoom`. What it did do was create a group and
    enrol everyone sharing the visitor's designation into it, so simply opening
    My Team grew a group that nobody had chosen to add anyone to. Group
    membership is decided in Communities now, by someone with the authority to
    decide it.
  */

  const members = useMemo(() => team.data?.members ?? [], [team.data]);
  const teamName = team.data?.teamName ?? "";

  // Who on this team is on approved leave today.
  const leaveById = useMemo(() => {
    const m = new Map<number, LeaveRequest>();
    (onLeave.data ?? []).forEach((l) => m.set(l.userId, l));
    return m;
  }, [onLeave.data]);

  // Present means they actually punched in today; everyone else is absent,
  // with their leave type shown when that is the reason.
  const presenceById = useMemo(() => {
    const m = new Map<number, TeamPresence>();
    (presence.data ?? []).forEach((p) => m.set(p.userId, p));
    return m;
  }, [presence.data]);
  const isPresent = (id: number) => presenceById.get(id)?.punchedIn === true;

  const leader = members.find((m) => (m.roles ?? []).includes("IT_TL"));
  const presentCount = members.filter((m) => isPresent(m.id)).length;
  const absentCount = members.length - presentCount;

  // Celebrations for this team only.
  const teamCelebrations = useMemo(() => {
    const ids = new Set(members.map((m) => m.id));
    return (celebrations.data ?? []).filter((c) => ids.has(c.userId));
  }, [celebrations.data, members]);
  const rows = members.filter((m) => {
    if (filter === "AVAILABLE" && !isPresent(m.id)) return false;
    if (filter === "LEAVE" && isPresent(m.id)) return false;
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return `${m.name} ${m.employeeCode} ${m.designationTitle ?? ""} ${m.techStack ?? ""}`
      .toLowerCase().includes(needle);
  });

  // Paged with the numbers and rows-per-page, like every other table.
  const rowsPaged = usePagedRows(rows, 15, [members, filter, q]);

  // ---- Team pulse: a plain-language read of the numbers above ----
  const pulseLines = useMemo(() => {
    if (members.length === 0) return { en: [] as string[], ta: [] as string[] };
    const absentNames = members.filter((m) => !isPresent(m.id)).map((m) => m.name);
    const present = members.length - absentNames.length;
    const onLeaveNames = members.filter((m) => leaveById.has(m.id)).map((m) => m.name);
    const bdayToday = teamCelebrations.filter((c) => c.type === "BIRTHDAY" && c.daysUntil === 0);
    const next = teamCelebrations.filter((c) => c.daysUntil > 0)[0];

    const en: string[] = [];
    const ta: string[] = [];

    // 1 — who the team is
    en.push(`${teamName} has ${members.length} member${members.length === 1 ? "" : "s"}${leader ? `, led by ${leader.name}` : ""}.`);
    ta.push(`${teamName} அணியில் ${members.length} உறுப்பினர்கள் உள்ளனர்${leader ? `, தலைவர் ${leader.name}` : ""}.`);

    // 2 — attendance today, based on who has actually punched in
    if (absentNames.length) {
      const leaveNote = onLeaveNames.length ? ` (${onLeaveNames.join(", ")} on leave)` : "";
      const leaveNoteTa = onLeaveNames.length ? ` (${onLeaveNames.join(", ")} விடுப்பில்)` : "";
      en.push(`${present} punched in today · ${absentNames.length} not yet — ${absentNames.join(", ")}${leaveNote}.`);
      ta.push(`இன்று ${present} பேர் பஞ்ச் இன் செய்துள்ளனர் · ${absentNames.length} பேர் இல்லை — ${absentNames.join(", ")}${leaveNoteTa}.`);
    } else {
      en.push(`All ${members.length} have punched in today.`);
      ta.push(`இன்று அனைவரும் (${members.length}) பஞ்ச் இன் செய்துவிட்டனர்.`);
    }

    // 3 — celebrations worth acting on
    if (bdayToday.length) {
      en.push(`It's ${bdayToday.map((c) => c.name).join(", ")}'s birthday today — wish them in the team chat.`);
      ta.push(`இன்று ${bdayToday.map((c) => c.name).join(", ")} பிறந்தநாள் — அணி அரட்டையில் வாழ்த்துங்கள்.`);
    } else if (next) {
      const what = next.type === "BIRTHDAY" ? "birthday" : `${next.years}-year work anniversary`;
      const whatTa = next.type === "BIRTHDAY" ? "பிறந்தநாள்" : `${next.years} ஆண்டு பணி நிறைவு`;
      en.push(`Coming up: ${next.name}'s ${what} in ${next.daysUntil} day${next.daysUntil === 1 ? "" : "s"}.`);
      ta.push(`வரவிருப்பது: ${next.name} ${whatTa}, ${next.daysUntil} நாட்களில்.`);
    }

    return { en, ta };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, leaveById, presenceById, teamCelebrations, teamName, leader]);

  const stopVoice = () => {
    try { window.speechSynthesis?.cancel(); } catch { /* not supported */ }
    if (audioRef.current) audioRef.current.pause();
    setSpeaking(false);
  };

  // Same voice pipeline as the chatbot: native Tamil audio from the server,
  // browser speech only if that is unavailable.
  const speak = async (l: "en" | "ta" = lang) => {
    if (speaking) { stopVoice(); return; }
    const text = (l === "ta" ? pulseLines.ta : pulseLines.en).join(" ");
    if (!text) return;
    setSpeaking(true);
    try {
      const url = await fetchTtsUrl(text, l);
      if (url) {
        const audio = audioRef.current ?? new Audio();
        audioRef.current = audio;
        audio.src = url;
        audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
        await audio.play();
        return;
      }
    } catch { /* fall through to browser speech */ }
    try {
      const synth = window.speechSynthesis;
      if (!synth) { setSpeaking(false); return; }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = l === "ta" ? "ta-IN" : "en-US";
      u.onend = () => setSpeaking(false);
      synth.speak(u);
    } catch { setSpeaking(false); }
  };

  if (team.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div>
        <PageHeader title="Teams" subtitle="Your team and everyone in it." />
        <EmptyState
          icon={Users2}
          title="No team assigned"
          description="You aren't part of a team yet. Your admin can assign you to one."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Teams" subtitle="Your team and everyone in it." />

      {/*
        One column, full width.

        This was a 1fr/340px split with the team chat filling the rail. The
        chat is gone, and what was left was a single small card holding a
        third of the page while the roster -- eight columns of names, emails
        and phone numbers, the thing people come here for -- was squeezed into
        what remained. Coming up now sits under the roster at full width,
        where it reads as the footnote it is.
      */}
      <div className="space-y-5">
        <div className="space-y-5">
          {/* Team header + pulse narrative */}
          <Card>
            <CardContent className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                    <Rocket className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-xl font-bold">{teamName}</h2>
                      <Badge className="border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                        Active
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Your team · {members.length} member{members.length === 1 ? "" : "s"}
                      {leader ? ` · led by ${leader.name}` : ""}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-full border bg-muted/60 p-1">
                    {([["en", "English"], ["ta", "தமிழ்"]] as const).map(([code, label]) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => { stopVoice(); setLang(code); }}
                        className={cn(
                          "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                          lang === code ? "bg-primary text-primary-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <Button size="sm" variant={speaking ? "outline" : "default"} onClick={() => speak()}>
                    {speaking
                      ? <><Square className="mr-1.5 h-3.5 w-3.5" /> Stop</>
                      : <><Volume2 className="mr-1.5 h-4 w-4" /> Listen</>}
                  </Button>
                </div>
              </div>

              <div className="mt-4 flex gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="space-y-0.5 text-sm">
                  {(lang === "ta" ? pulseLines.ta : pulseLines.en).map((line, i) => (
                    <p key={i} className={i === 0 ? "font-medium" : "text-muted-foreground"}>{line}</p>
                  ))}
                </div>
              </div>

            </CardContent>
          </Card>

          {/* Roster */}
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b px-5 py-3.5">
                <h3 className="font-semibold">Team roster</h3>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Live from your team
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-b p-4">
                <div className="relative min-w-[220px] flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search name, employee ID or skill…"
                    className="pl-9"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
                <div className="inline-flex rounded-full border bg-muted/60 p-1">
                  {([
                    ["ALL", `All ${members.length}`],
                    ["AVAILABLE", `Present ${presentCount}`],
                    ["LEAVE", `Absent ${absentCount}`]
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setFilter(key)}
                      className={cn(
                        "rounded-full px-3.5 py-1 text-xs font-semibold transition-colors",
                        filter === key ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr className="border-b bg-muted/20 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="w-12 font-semibold">#</th>
                      <th className="font-semibold">Name</th>
                      <th className="font-semibold">Employee ID</th>
                      <th className="font-semibold">Designation</th>
                      <th className="font-semibold">Email</th>
                      <th className="font-semibold">Contact</th>
                      <th className="font-semibold">Today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center text-sm text-muted-foreground">
                          No teammate matches that search.
                        </td>
                      </tr>
                    ) : rowsPaged.pageRows.map((m, i) => {
                      const isMe = m.id === user?.id;
                      return (
                        <tr key={m.id} className={cn("border-b last:border-0 hover:bg-muted/20", isMe && "bg-primary/5")}>
                          <td className="text-muted-foreground tabular-nums">{i + 1}</td>
                          <td>
                            <div className="flex items-center gap-3">
                              <Avatar name={m.name} src={m.photoPath} className="h-9 w-9 text-xs" />
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium">{m.name}</span>
                                {isMe && <span className="text-[11px] text-muted-foreground">(you)</span>}
                                {(m.roles ?? []).includes("IT_TL") && (
                                  <Badge className="border-0 bg-green-100 text-green-700 text-[10px] dark:bg-green-900/30 dark:text-green-400">
                                    Team Leader
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="whitespace-nowrap">
                            <span className="code-chip text-xs text-muted-foreground">{m.employeeCode}</span>
                          </td>
                          <td>{m.designationTitle || "—"}</td>
                          <td>
                            {m.email
                              ? <a href={`mailto:${m.email}`} className="text-primary hover:underline">{m.email}</a>
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="whitespace-nowrap tabular-nums text-muted-foreground">
                            {m.phone || "—"}
                          </td>
                          <td className="whitespace-nowrap">
                            {isPresent(m.id) ? (
                              <Badge className="border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                Present
                                {presenceById.get(m.id)?.punchInAt && (
                                  <span className="ml-1 font-normal opacity-80">
                                    {dayjs(presenceById.get(m.id)!.punchInAt).format("h:mm A")}
                                  </span>
                                )}
                              </Badge>
                            ) : (
                              <Badge className="border-0 bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                                Absent{leaveById.has(m.id) ? ` · ${leaveById.get(m.id)!.leaveTypeName}` : ""}
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
            {rows.length > 0 && (
          <TablePagination
            page={rowsPaged.page} totalPages={rowsPaged.totalPages} onChange={rowsPaged.setPage}
            pageSize={rowsPaged.pageSize} onPageSizeChange={rowsPaged.setPageSize}
            total={rowsPaged.total}
            always
          />
            )}
          </Card>

        </div>

        {/* ---------------- below the roster ---------------- */}
        <div className="space-y-5">
          {/*
            Team chat is not shown here for any role. The rail is the roster
            and what is coming up; a second place to message the same people
            was one more inbox to remember to check, and Chat already holds
            the conversation.

            The component and its query are left in place so restoring this is
            putting one element back rather than rebuilding it.
          */}

          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between border-b px-5 py-3.5">
                <h3 className="font-semibold">Coming up</h3>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Next 30 days
                </span>
              </div>
              <div className="p-5">
                {teamCelebrations.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Nothing in the next 30 days.
                  </p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {teamCelebrations.map((c) => (
                      <div key={`${c.type}-${c.userId}`} className="flex items-center gap-3 rounded-lg border p-3">
                        <Avatar name={c.name} className="h-8 w-8 text-[11px]" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{c.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {c.type === "BIRTHDAY" ? "Birthday" : `${c.years}-year work anniversary`}
                          </div>
                        </div>
                        <span className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          c.daysUntil === 0
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground"
                        )}>
                          {c.daysUntil === 0 ? "Today" : c.daysUntil === 1 ? "Tomorrow" : dayjs(c.date).format("DD MMM")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * The team's own conversation, private to its members and lived-in right here
 * — it deliberately does not appear in the Chat page's channel list.
 */
function TeamChatRail({
  group, teamName, loading, failed
}: {
  group?: ChatGroup; teamName: string; loading: boolean; failed: boolean;
}) {
  const { user } = useAuth();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const { messages, isLoading, sendMessage, sendAttachments, deleteMessage, react } = useChat(group?.id ?? null);

  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [sendingFiles, setSendingFiles] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const recent = messages.slice(-50);

  // Keep the latest message in view as the conversation grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [recent.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text && pendingFiles.length === 0) return;
    if (!group) return;

    if (pendingFiles.length > 0) {
      setSendingFiles(true);
      const batch = pendingFiles;
      setPendingFiles([]);
      try {
        await sendAttachments(batch, text);
        setDraft("");
      } catch (err: any) {
        toast.error("Failed to upload attachments");
        setPendingFiles(batch);
      } finally {
        setSendingFiles(false);
      }
    } else {
      sendMessage(text);
      setDraft("");
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added = Array.from(files);
    const sz = (sum: number, f: File) => sum + f.size;
    const batchTotal = pendingFiles.reduce(sz, 0) + added.reduce(sz, 0);

    if (added.some((f) => f.size > MAX_ATTACHMENT_MB * 1024 * 1024)) {
      toast.error(`No single file can be larger than ${MAX_ATTACHMENT_MB}MB.`);
      return;
    }
    if (batchTotal > MAX_BATCH_MB * 1024 * 1024) {
      toast.error(`The total size cannot exceed ${MAX_BATCH_MB}MB at once.`);
      return;
    }
    setPendingFiles((p) => [...p, ...added]);
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <Card>
      <CardContent className="flex h-[520px] flex-col p-0">
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <div>
            <h3 className="font-semibold">Team chat</h3>
            <p className="text-[11px] text-muted-foreground">Only your team can see this</p>
          </div>
          <Badge variant="secondary" className="text-[10px]">{teamName}</Badge>
        </div>

        {loading ? (
          <div className="flex-1 p-4"><Skeleton className="h-full" /></div>
        ) : !group || failed ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center">
            <MessageSquare className="h-7 w-7 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">
              Team chat is unavailable — you may not be assigned to a team yet.
            </p>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {isLoading ? (
                <Skeleton className="h-24" />
              ) : recent.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No messages yet — say hello.</p>
              ) : recent.map((m) => {
                const mine = m.senderId === user?.id;
                return (
                  <div key={m.messageId} className={cn("group flex gap-2", mine && "flex-row-reverse")}>
                    <Avatar name={m.senderName} className="h-7 w-7 shrink-0 text-[10px]" />
                    <div className="flex max-w-[78%] flex-col gap-1">
                      <div className={cn(
                        "rounded-xl px-3 py-2 relative",
                        mine ? "bg-primary text-primary-foreground" : "bg-muted"
                      )}>
                        {!mine && <div className="text-[11px] font-semibold text-primary">{m.senderName}</div>}
                        
                        <MessageAttachments paths={m.attachments} isMe={mine} onOpenImage={setLightbox} />
                        
                        {m.deleted ? (
                          <p className={cn("text-[12.5px] italic opacity-50", mine ? "text-primary-foreground" : "text-muted-foreground")}>
                            Message deleted
                          </p>
                        ) : (
                          <p className="text-[12.5px] leading-snug whitespace-pre-wrap break-words">
                            {m.audioPath ? "🎤 Voice message" : m.content}
                          </p>
                        )}
                        <div className={cn("mt-0.5 text-[10px]", mine ? "text-primary-foreground/75" : "text-muted-foreground")}>
                          {dayjs(m.sentAt).format("h:mm A")}
                        </div>

                        {/* Quick actions (hover) */}
                        {!m.deleted && (
                          <div className={cn(
                            "absolute top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1",
                            mine ? "right-[105%]" : "left-[105%]"
                          )}>
                            <div className="relative group/react">
                              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full bg-background shadow-sm border text-muted-foreground hover:text-foreground">
                                <SmilePlus className="h-3.5 w-3.5" />
                              </Button>
                              <div className="absolute top-1/2 -translate-y-1/2 hidden group-hover/react:flex items-center gap-1 rounded-full bg-background border shadow-md p-1 z-10" style={{ [mine ? "right" : "left"]: "100%", margin: "0 4px" }}>
                                {QUICK_REACTIONS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    onClick={() => react(m.messageId, emoji)}
                                    className={cn(
                                      "h-7 w-7 rounded-full text-sm flex items-center justify-center hover:bg-muted transition-transform hover:scale-110",
                                      (m.myReactions || []).includes(emoji) && "bg-primary/10"
                                    )}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {mine && (
                              <Button
                                variant="ghost" size="icon"
                                onClick={() => { if (confirm("Delete this message?")) deleteMessage(m.messageId); }}
                                className="h-7 w-7 rounded-full bg-background shadow-sm border text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Reactions display */}
                      {m.reactions && Object.keys(m.reactions).length > 0 && (
                        <div className={cn("flex flex-wrap gap-1 mt-0.5", mine && "justify-end")}>
                          {Object.entries(m.reactions).map(([emoji, count]) => {
                            const iReacted = (m.myReactions || []).includes(emoji);
                            return (
                              <button
                                key={emoji}
                                onClick={() => react(m.messageId, emoji)}
                                className={cn(
                                  "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] hover:bg-muted/50",
                                  iReacted ? "border-primary/50 bg-primary/10" : "bg-card"
                                )}
                              >
                                <span>{emoji}</span>
                                {count > 1 && <span className="font-medium text-muted-foreground">{count}</span>}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t bg-muted/20 p-3 pb-0">
                {pendingFiles.map((file, i) => (
                  <div key={i} className="group relative flex items-center gap-2 rounded-md border bg-card p-1 pr-2 shadow-sm">
                    <StagedThumb file={file} />
                    <div className="max-w-[120px] truncate text-[11px] font-medium">{file.name}</div>
                    <button
                      type="button"
                      onClick={() => setPendingFiles((p) => p.filter((_, idx) => idx !== i))}
                      className="absolute -right-1.5 -top-1.5 hidden rounded-full border bg-background p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 border-t p-3">
              <input
                type="file"
                multiple
                className="hidden"
                ref={fileInput}
                onChange={(e) => handleFiles(e.target.files)}
              />
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => fileInput.current?.click()}
                disabled={sendingFiles}
              >
                <Paperclip className="h-5 w-5" />
              </Button>
              <Input
                placeholder={`Message ${teamName}…`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                disabled={sendingFiles}
              />
              <Button size="sm" onClick={send} disabled={(!draft.trim() && pendingFiles.length === 0) || sendingFiles}>
                {sendingFiles ? <PixousLoader size="xs" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            
            {lightbox && <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}
