import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Send, Trash2, FileText, Download, X } from "lucide-react";
import toast from "react-hot-toast";

import { api, apiMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PixousLoader } from "@/components/ui/pixous-loader";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, resolvePhotoUrl } from "@/components/ui/avatar";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { useAuth } from "@/hooks/useAuth";
import type { ApiEnvelope } from "@/types";
import dayjs from "dayjs";

/**
 * The files and the conversation attached to a leave, permission or work
 * from home request.
 *
 * One component for all three, because the two differ only in the `type` they pass:
 * the server keeps them in one table for the same reason. It is used inside a
 * details dialog, so it manages its own data and needs nothing from the page
 * beyond which request it is looking at.
 *
 * Kept live on a short interval rather than a socket. The portal's real-time
 * channel is STOMP over SockJS, which is infrastructure this component would
 * have to own a subscription to; a conversation between two people about one
 * leave request does not need that, and polling while the dialog is open costs
 * two requests every few seconds and stops the moment it closes.
 */

type RequestType = "LEAVE" | "PERMISSION" | "WFH";

interface AttachmentView {
  id: number;
  fileName: string;
  contentType?: string;
  fileSize?: number;
  image: boolean;
  url: string;
  uploadedByName: string;
  uploadedAt: string;
}

interface CommentView {
  id: number;
  authorId: number;
  authorName: string;
  authorCode?: string;
  message: string;
  attachmentUrl?: string;
  createdAt: string;
}

function humanSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RequestThread({
  type,
  requestId,
  /** Hides the upload control where the request is no longer open to change. */
  canAttach = true,
  /**
   * Hides the composer once the request has been decided. Existing comments
   * stay, and stay readable -- the conversation is the record of how the
   * decision was reached, so it is closed rather than removed.
   */
  canComment = true,
  closedNotice = true,
}: {
  type: RequestType;
  requestId: number;
  canAttach?: boolean;
  canComment?: boolean;
  /**
   * Whether to explain why commenting is off. True where the thread is closed
   * because the request was decided; false where this screen never offered
   * commenting in the first place and has nothing to account for.
   */
  closedNotice?: boolean;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const endOfThread = useRef<HTMLDivElement>(null);

  const base = `/requests/${type}/${requestId}`;
  const attachKey = ["request-attachments", type, requestId];
  const commentKey = ["request-comments", type, requestId];

  const attachments = useQuery({
    queryKey: attachKey,
    queryFn: async () =>
      (await api.get<ApiEnvelope<AttachmentView[]>>(`${base}/attachments`)).data.data,
    refetchInterval: 15000,
  });

  const comments = useQuery({
    queryKey: commentKey,
    queryFn: async () =>
      (await api.get<ApiEnvelope<CommentView[]>>(`${base}/comments`)).data.data,
    // Shorter than the attachment poll: a reply is the thing somebody is
    // waiting on, a file is not.
    refetchInterval: 8000,
  });

  /*
    Scroll to the newest message when one arrives.

    Only when the count grows -- a refetch that returns the same messages must
    not yank the view back down while somebody is reading further up.
  */
  const seen = useRef(0);
  useEffect(() => {
    const count = comments.data?.length ?? 0;
    if (count > seen.current) {
      seen.current = count;
      endOfThread.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [comments.data]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      /*
        The header has to be said here.

        The shared axios client sets Content-Type: application/json for every
        request, and that overrides the multipart boundary the browser would
        otherwise generate -- so the server receives a body it cannot parse and
        refuses the file. Every other upload in this app passes this the same
        way.
      */
      return api.post(`${base}/attachments`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
    },
    onSuccess: () => {
      toast.success("Attached");
      qc.invalidateQueries({ queryKey: attachKey });
    },
    onError: (e) => toast.error(apiMessage(e, "Could not attach that file")),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(`${base}/attachments/${id}`),
    onSuccess: () => {
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: attachKey });
    },
    onError: (e) => toast.error(apiMessage(e, "Could not remove that file")),
  });

  const send = useMutation({
    mutationFn: async (text: string) => api.post(`${base}/comments`, { message: text }),
    onSuccess: () => {
      setMessage("");
      qc.invalidateQueries({ queryKey: commentKey });
    },
    onError: (e) => toast.error(apiMessage(e, "Could not send that")),
  });

  const submit = () => {
    const text = message.trim();
    if (!text || send.isPending) return;
    send.mutate(text);
  };

  const files = attachments.data ?? [];
  const thread = comments.data ?? [];

  return (
    <div className="space-y-4">
      {/* ---------------- attachments ---------------- */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Photos &amp; documents{files.length > 0 ? ` (${files.length})` : ""}
          </div>
          {canAttach && (
            <>
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                accept="image/*,application/pdf,.doc,.docx"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Cleared so choosing the same file twice still fires.
                  e.target.value = "";
                  if (file) upload.mutate(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={upload.isPending}
                onClick={() => fileInput.current?.click()}
              >
                {upload.isPending ? (
                  <PixousLoader size="xs" className="mr-1.5" />
                ) : (
                  <Paperclip className="mr-1.5 h-3.5 w-3.5" />
                )}
                Attach
              </Button>
            </>
          )}
        </div>

        {attachments.isLoading ? (
          <div className="h-16 animate-pulse rounded-md bg-muted/50" />
        ) : files.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Nothing attached.
            {canAttach && " A photograph of a certificate or a document can go here."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {files.map((f) => {
              const href = resolvePhotoUrl(f.url);
              const mine = f.uploadedByName && user?.name === f.uploadedByName;
              return (
                <div key={f.id} className="group relative overflow-hidden rounded-md border">
                  {/*
                    An image is shown, everything else is a link. A PDF squeezed
                    into an img tag renders as nothing at all, and a photograph
                    hidden behind a download makes an approver open a file to
                    see something they could have glanced at.
                  */}
                  {f.image ? (
                    <button
                      type="button"
                      className="block w-full"
                      onClick={() => href && setLightbox(href)}
                      title={f.fileName}
                    >
                      <img
                        src={href}
                        alt={f.fileName}
                        className="h-24 w-full object-cover transition-transform group-hover:scale-105"
                      />
                    </button>
                  ) : (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-24 flex-col items-center justify-center gap-1 bg-muted/40 px-2 text-center hover:bg-muted"
                      title={f.fileName}
                    >
                      <FileText className="h-6 w-6 text-muted-foreground" />
                      <span className="line-clamp-2 break-all text-[10px] font-medium">
                        {f.fileName}
                      </span>
                    </a>
                  )}

                  <div className="flex items-center justify-between gap-1 border-t bg-background/95 px-2 py-1">
                    <span
                      className="truncate text-[10px] text-muted-foreground"
                      title={`${f.uploadedByName} · ${dayjs(f.uploadedAt).format("DD MMM, hh:mm A")}`}
                    >
                      {f.uploadedByName}
                      {humanSize(f.fileSize) ? ` · ${humanSize(f.fileSize)}` : ""}
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5">
                      <a
                        href={href}
                        download={f.fileName}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Download"
                      >
                        <Download className="h-3 w-3" />
                      </a>
                      {mine && (
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
                          title="Remove"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(f.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---------------- conversation ---------------- */}
      <div>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Comments{thread.length > 0 ? ` (${thread.length})` : ""}
        </div>

        <div className="max-h-64 space-y-2.5 overflow-y-auto rounded-md border bg-muted/20 p-3">
          {comments.isLoading ? (
            <div className="h-12 animate-pulse rounded bg-muted/50" />
          ) : thread.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">
              {canComment
                ? "No comments yet. Ask a question or add a note — the other person is told about it."
                : "No comments were left on this request."}
            </p>
          ) : (
            thread.map((c) => {
              const mine = c.authorId === user?.id;
              return (
                <div
                  key={c.id}
                  className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}
                >
                  <Avatar
                    name={c.authorName}
                    className="mt-0.5 h-7 w-7 shrink-0 bg-primary/10 text-primary text-[10px]"
                  />
                  <div className={`max-w-[78%] ${mine ? "items-end text-right" : ""}`}>
                    <div className="mb-0.5 text-[10px] text-muted-foreground">
                      {mine ? "You" : c.authorName}
                      {" · "}
                      {dayjs(c.createdAt).format("DD MMM, hh:mm A")}
                    </div>
                    <div
                      className={
                        "whitespace-pre-wrap rounded-lg px-3 py-2 text-sm " +
                        (mine
                          ? "bg-primary text-primary-foreground"
                          : "border bg-background")
                      }
                    >
                      {c.message}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endOfThread} />
        </div>

        {!canComment ? (
          /*
            Two reasons the box is not here, and they are not the same.

            A decided request is closed, and that is worth saying out loud so
            the absence reads as a rule rather than as something failing to
            load. A screen that simply does not offer commenting has nothing to
            explain -- and saying "this request has been decided" on a pending
            one would be a plain untruth.
          */
          closedNotice === false ? null : (
            <p className="mt-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              This request has been decided, so the conversation is closed.
            </p>
          )
        ) : (
        <div className="mt-2 flex items-end gap-2">
          <Textarea
            rows={1}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write a comment…"
            className="min-h-[38px] resize-none"
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks the line — as every chat does.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            className="h-[38px] w-[38px] shrink-0"
            disabled={!message.trim() || send.isPending}
            onClick={submit}
            title="Send"
          >
            {send.isPending ? (
              <PixousLoader size="xs" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        )}
      </div>

      <PhotoLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
