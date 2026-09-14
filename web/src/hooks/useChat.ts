import { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";
import { api, tokenStore } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useCalls } from "@/hooks/useCalls";

const BASE = import.meta.env.VITE_API_URL || "";

export interface ChatMessage {
  messageId: number;
  communityId: number;
  senderId: number;
  senderName: string;
  content: string;
  sentAt: string;
  audioPath?: string;
  /** Comma-separated upload paths for files sent with this message. */
  attachments?: string;
  deleted?: boolean;
  isOptimistic?: boolean;

  // ---- the newer chat features ----
  /** The message this one answers; absent for a top-level post. */
  parentId?: number;
  replyCount?: number;
  pinned?: boolean;
  pinnedAt?: string;
  /** Emoji to the number of people who used it. */
  reactions?: Record<string, number>;
  /** The emoji this reader has used on it. */
  myReactions?: string[];
  readCount?: number;
  requiresAck?: boolean;
  ackCount?: number;
  acknowledgedByMe?: boolean;
  /** Set while a message is still waiting for its time to come. */
  scheduledAt?: string;
  pollOptions?: string[];
  pollVotes?: number[];
  myVote?: number | null;
}

/** Everything a message can carry besides its text. */
export interface SendExtras {
  parentId?: number;
  /** ISO date-time; the message is held until then. */
  scheduledAt?: string;
  requiresAck?: boolean;
  pollOptions?: string[];
}

/** Who is online now, and when everybody else was last connected. */
export interface Presence {
  online: number[];
  lastSeen: Record<string, string>;
}

export function useChat(communityId: number | null) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  
  const stompClientRef = useRef<Client | null>(null);

  /**
   * Calling lives above the routes now, not here. It used to be part of this
   * hook, which meant the phone could only ring on the page that used it — from
   * anywhere else in the portal a call arrived silently and timed out. What is
   * returned below is that shared engine, so the chat page reads unchanged.
   */
  const calls = useCalls();

  // Who is online. The starting picture comes over REST; every arrival and
  // departure after that arrives on the socket, so this is not polled.
  const presence = useQuery({
    queryKey: ["presence"],
    queryFn: async () => (await api.get<Presence>("/presence")).data,
    enabled: !!user,
    staleTime: Infinity
  });

  // Fetch initial history
  const history = useQuery({
    queryKey: ["chat_history", communityId],
    queryFn: async () => {
      if (!communityId) return [];
      const res = await api.get<ChatMessage[]>(`/communities/${communityId}/messages`);
      return res.data;
    },
    enabled: !!communityId
  });

  // Combine initial history + live messages (that are not in history)
  const allMessages = [...(history.data || []), ...liveMessages].reduce((acc, curr) => {
    if (!acc.find((m) => m.messageId === curr.messageId)) {
      acc.push(curr);
    }
    return acc;
  }, [] as ChatMessage[]).sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

  // WebSocket signaling (persistent connection)
  useEffect(() => {
    if (!tokenStore.access || !user) return;

    const client = new Client({
      webSocketFactory: () => new SockJS(`${BASE}/ws`),
      connectHeaders: { Authorization: `Bearer ${tokenStore.access}` },
      reconnectDelay: 5000,
      onConnect: () => {
        stompClientRef.current = client;
        setIsConnected(true);

        // Somebody came online or went offline.
        client.subscribe("/topic/presence", (msg) => {
          try {
            const ev = JSON.parse(msg.body) as {
              userId: number; online: boolean; lastSeenAt: string;
            };
            qc.setQueryData<Presence>(["presence"], (old) => {
              const base: Presence = old ?? { online: [], lastSeen: {} };
              const online = ev.online
                ? Array.from(new Set([...base.online, ev.userId]))
                : base.online.filter((id) => id !== ev.userId);
              return {
                online,
                lastSeen: { ...base.lastSeen, [String(ev.userId)]: ev.lastSeenAt }
              };
            });
          } catch (e) {
            console.error("Invalid presence payload", e);
          }
        });

        // Our own arrival predates this subscription, so ask once for the room
        // as it stands rather than assuming we are the only one here.
        qc.invalidateQueries({ queryKey: ["presence"] });

      },
      onDisconnect: () => {
        setIsConnected(false);
      },
      onWebSocketClose: () => {
        setIsConnected(false);
      }
    });

    client.activate();
    return () => {
      client.deactivate();
      stompClientRef.current = null;
      setIsConnected(false);
    };
  }, [user?.id]);

  // Dynamic subscription to the active community group messages
  useEffect(() => {
    setLiveMessages([]);
    if (!isConnected || !communityId || !stompClientRef.current) return;

    const subscription = stompClientRef.current.subscribe(`/topic/community/${communityId}`, (msg) => {
      try {
        const newMsg = JSON.parse(msg.body) as ChatMessage;

        // Deletion signal — remove the message everywhere.
        if (newMsg.deleted) {
          qc.setQueryData<ChatMessage[]>(["chat_history", communityId], (old) =>
            (old || []).filter(m => m.messageId !== newMsg.messageId)
          );
          setLiveMessages((prev) => prev.filter(m => m.messageId !== newMsg.messageId));
          return;
        }

        // A message we already hold has changed rather than arrived — a pin, for
        // instance. The broadcast carries only the message itself, without the
        // reaction and receipt counts the list was built with, so overwriting
        // from it would blank them; ask the server for the room again instead.
        const known = (qc.getQueryData<ChatMessage[]>(["chat_history", communityId]) || [])
          .some((m) => m.messageId === newMsg.messageId);
        if (known) {
          qc.invalidateQueries({ queryKey: ["chat_history", communityId] });
          qc.invalidateQueries({ queryKey: ["chat_pinned", communityId] });
          return;
        }

        // 1. Instantly append to React Query's cached history
        qc.setQueryData<ChatMessage[]>(["chat_history", communityId], (old) => {
          const list = old || [];
          if (list.some(m => m.messageId === newMsg.messageId)) return list;
          return [...list, newMsg];
        });

        // 2. Remove any matching optimistic messages from liveMessages state
        setLiveMessages((prev) => prev.filter(m => !(m.isOptimistic && m.content === newMsg.content && m.senderId === newMsg.senderId)));
      } catch (e) {
        console.error("Invalid chat payload", e);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [isConnected, communityId, qc]);

  const sendMsgMutation = useMutation({
    mutationFn: async ({ content, extras }: { content: string; extras?: SendExtras }) => {
      if (!communityId) return;
      await api.post(`/communities/${communityId}/messages`, { content, ...(extras || {}) });
    }
  });

  // ---- search, pinning, reactions, receipts, polls ----

  const refreshRoom = () => {
    qc.invalidateQueries({ queryKey: ["chat_history", communityId] });
    qc.invalidateQueries({ queryKey: ["chat_pinned", communityId] });
  };

  /** Adds the emoji, or takes it away when it is already there. */
  const react = async (messageId: number, emoji: string) => {
    await api.post(`/communities/messages/${messageId}/reactions`, { emoji });
    refreshRoom();
  };

  const setPinned = async (messageId: number, pinned: boolean) => {
    await api.post(`/communities/messages/${messageId}/pin`, { pinned });
    refreshRoom();
  };

  /** Quiet — a read is a side effect of looking, so it never shows an error. */
  const markRead = async (messageId: number) => {
    try {
      await api.post(`/communities/messages/${messageId}/read`);
    } catch { /* not worth interrupting the reader for */ }
  };

  const acknowledge = async (messageId: number) => {
    await api.post(`/communities/messages/${messageId}/acknowledge`);
    refreshRoom();
  };

  const vote = async (messageId: number, optionIndex: number) => {
    await api.post(`/communities/messages/${messageId}/vote`, { optionIndex });
    refreshRoom();
  };

  const sendVoice = async (blob: Blob) => {
    if (!communityId) return;
    const fd = new FormData();
    fd.append("file", blob, "voice.webm");
    await api.post(`/communities/${communityId}/voice`, fd, {
      headers: { "Content-Type": "multipart/form-data" }
    });
    // The saved message arrives via the WebSocket broadcast for this room.
  };

  /** Send files with an optional caption. The saved message arrives over the socket. */
  const sendAttachments = async (files: File[], caption?: string) => {
    if (!communityId || files.length === 0) return;
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    if (caption && caption.trim()) fd.append("caption", caption.trim());
    await api.post(`/communities/${communityId}/attachments`, fd, {
      headers: { "Content-Type": "multipart/form-data" }
    });
  };

  const deleteMessage = async (messageId: number) => {
    await api.delete(`/communities/messages/${messageId}`);
    // Optimistic removal (the broadcast will also remove it for everyone).
    qc.setQueryData<ChatMessage[]>(["chat_history", communityId], (old) =>
      (old || []).filter(m => m.messageId !== messageId)
    );
    setLiveMessages((prev) => prev.filter(m => m.messageId !== messageId));
  };

  const handleSendMessage = async (content: string, extras?: SendExtras) => {
    if (!communityId || !user) return;

    // A poll or a message held for later is not echoed straight back — a poll
    // needs its tally and a scheduled post is not in the room yet — so showing
    // it optimistically would put a message on screen that nobody else has.
    const plain = !extras?.scheduledAt && !extras?.pollOptions?.length;

    const tempId = Date.now();
    if (plain) {
      const optimisticMsg: ChatMessage = {
        messageId: tempId,
        communityId,
        senderId: user.id,
        senderName: user.name,
        content,
        sentAt: new Date().toISOString(),
        parentId: extras?.parentId,
        isOptimistic: true
      };
      setLiveMessages((prev) => [...prev, optimisticMsg]);
    }

    try {
      await sendMsgMutation.mutateAsync({ content, extras });
      if (!plain) refreshRoom();
    } catch (err) {
      if (plain) setLiveMessages((prev) => prev.filter(m => m.messageId !== tempId));
      throw err;
    }
  };

  return {
    messages: allMessages,
    isLoading: history.isLoading,
    sendMessage: handleSendMessage,
    sendVoice,
    sendAttachments,
    deleteMessage,

    // Search, pinning, reactions, receipts and polls
    react,
    setPinned,
    markRead,
    acknowledge,
    vote,

    // Who is online, and when everybody was last seen
    onlineUserIds: presence.data?.online ?? [],
    lastSeen: presence.data?.lastSeen ?? {},

    // Calling, from the shared engine above the routes
    ...calls
  };
}
