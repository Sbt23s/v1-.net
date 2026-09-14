import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";
import { api, tokenStore } from "@/lib/api";
import type { ApiEnvelope } from "@/types";

const BASE = import.meta.env.VITE_API_URL || "";

/** One line of the conversation kept against a task. */
export interface TaskMessage {
  id: number;
  taskId: number;
  senderId: number;
  senderName: string;
  senderCode?: string;
  content?: string;
  /** Comma-separated upload paths for files sent with this message. */
  attachments?: string;
  sentAt: string;
}

/**
 * The conversation on one task, live.
 *
 * <p>The socket exists only while a task is open, because that is the only time
 * anybody is reading it. History comes over REST; everything said afterwards
 * arrives on the socket, so nothing is polled.
 */
export function useTaskChat(taskId: number | null) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const clientRef = useRef<Client | null>(null);

  const history = useQuery({
    queryKey: ["task-chat", taskId],
    enabled: !!taskId,
    queryFn: async () => {
      if (!taskId) return [] as TaskMessage[];
      const res = await api.get<ApiEnvelope<TaskMessage[]>>(`/tasks/${taskId}/messages`);
      return res.data.data;
    }
  });

  useEffect(() => {
    if (!taskId || !tokenStore.access) return;

    const client = new Client({
      webSocketFactory: () => new SockJS(`${BASE}/ws`),
      connectHeaders: { Authorization: `Bearer ${tokenStore.access}` },
      reconnectDelay: 5000,
      onConnect: () => {
        setConnected(true);
        client.subscribe(`/topic/tasks/${taskId}`, (frame) => {
          try {
            const msg = JSON.parse(frame.body) as TaskMessage;
            qc.setQueryData<TaskMessage[]>(["task-chat", taskId], (old) => {
              const list = old || [];
              if (list.some((m) => m.id === msg.id)) return list;
              return [...list, msg];
            });
            // The badge on the task's chat icon counts messages.
            qc.invalidateQueries({ queryKey: ["task-chat-counts"] });
          } catch (e) {
            console.error("Invalid task message payload", e);
          }
        });
      },
      onDisconnect: () => setConnected(false),
      onWebSocketClose: () => setConnected(false)
    });

    client.activate();
    clientRef.current = client;
    return () => {
      client.deactivate();
      clientRef.current = null;
      setConnected(false);
    };
  }, [taskId, qc]);

  /** Post a message, with or without files. */
  const send = async (content: string, files: File[]) => {
    if (!taskId) return;
    const fd = new FormData();
    if (content.trim()) fd.append("content", content.trim());
    files.forEach((f) => fd.append("files", f, f.name));
    await api.post(`/tasks/${taskId}/messages`, fd, {
      headers: { "Content-Type": "multipart/form-data" }
    });
    // The saved message arrives over the socket; ask anyway in case it is down.
    if (!clientRef.current?.connected) {
      await qc.invalidateQueries({ queryKey: ["task-chat", taskId] });
    }
    qc.invalidateQueries({ queryKey: ["task-chat-counts"] });
  };

  return {
    messages: history.data ?? [],
    isLoading: history.isLoading,
    isError: history.isError,
    connected,
    send
  };
}
