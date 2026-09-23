import React, { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Megaphone, Video, Image as ImageIcon, Plus, CheckCircle2,
  Trash2, Play, Eye, AlertTriangle, Sparkles, Check
} from "lucide-react";
import { PixousLoader } from "@/components/ui/pixous-loader";
import toast from "react-hot-toast";
import dayjs from "dayjs";
import { api, apiMessage } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader } from "@/components/ui/dialog";

interface Announcement {
  id: number;
  title?: string;
  description?: string;
  mediaType: "VIDEO" | "IMAGE" | "POSTER";
  mediaUrl: string;
  mediaName?: string;
  mediaSize?: number;
  effectUrl?: string | null;
  effectName?: string | null;
  effectEnabled?: boolean;
  status: "ACTIVE" | "INACTIVE" | "DELETED";
  targetRoles: string;
  durationSeconds: number;
  createdByName?: string;
  createdAt: string;
  publishedAt?: string;
}

const AVAILABLE_ROLES = ["Employee", "TL", "HR", "Admin"];

export function SettingsAnnouncementsTab() {
  const qc = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [mediaType, setMediaType] = useState<"VIDEO" | "IMAGE" | "POSTER">("IMAGE");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetRoles, setTargetRoles] = useState<string[]>(["Employee", "TL", "HR", "Admin"]);
  const [durationSeconds, setDurationSeconds] = useState<number>(15);
  const [publishImmediately, setPublishImmediately] = useState(true);
  const [previewModal, setPreviewModal] = useState<Announcement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const listQuery = useQuery({
    queryKey: ["global-announcements-list"],
    queryFn: async () => {
      const res = await api.get<{ data: Announcement[] }>("/tech-admin/global-announcements");
      return res.data?.data || [];
    }
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("mediaType", mediaType);
      formData.append("title", title);
      formData.append("description", description);
      formData.append("targetRoles", JSON.stringify(targetRoles));
      formData.append("durationSeconds", String(durationSeconds));
      formData.append("publishImmediately", String(publishImmediately));
      if (selectedFile) formData.append("file", selectedFile);

      return api.post("/tech-admin/global-announcements", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
    },
    onSuccess: () => {
      toast.success("Announcement created successfully");
      qc.invalidateQueries({ queryKey: ["global-announcements-list"] });
      setIsCreateOpen(false);
      setTitle("");
      setDescription("");
      setSelectedFile(null);
      setFilePreviewUrl(null);
    },
    onError: (err: any) => {
      toast.error(apiMessage(err, "Failed to create announcement"));
    }
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return api.put(`/tech-admin/global-announcements/${id}/status`, { status });
    },
    onSuccess: () => {
      toast.success("Announcement status updated");
      qc.invalidateQueries({ queryKey: ["global-announcements-list"] });
    },
    onError: (err: any) => {
      toast.error(apiMessage(err, "Failed to update status"));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.delete(`/tech-admin/global-announcements/${id}`);
    },
    onSuccess: () => {
      toast.success("Announcement deleted");
      qc.invalidateQueries({ queryKey: ["global-announcements-list"] });
    },
    onError: (err: any) => {
      toast.error(apiMessage(err, "Failed to delete announcement"));
    }
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024) {
        toast.error("File size must be under 50 MB");
        return;
      }
      setSelectedFile(file);
      setFilePreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleToggleRole = (r: string) => {
    setTargetRoles((prev) =>
      prev.includes(r) ? prev.filter((item) => item !== r) : [...prev, r]
    );
  };

  const announcements = listQuery.data || [];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card shadow-sm">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-primary" />
            Global Announcements
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Broadcast greeting banners, company-wide announcements, and popups shown on login.
          </p>
        </div>

        <Button
          size="sm"
          onClick={() => setIsCreateOpen(true)}
          className="gap-1.5 text-xs h-9"
        >
          <Plus className="w-4 h-4" />
          New Announcement
        </Button>
      </div>

      {/* Announcements List */}
      {listQuery.isLoading ? (
        <div className="flex items-center justify-center p-12">
          <PixousLoader size="md" />
        </div>
      ) : announcements.length === 0 ? (
        <Card className="border-border bg-card p-12 text-center shadow-sm">
          <Megaphone className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
          <h4 className="text-sm font-semibold text-foreground">No Announcements Yet</h4>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Create a broadcast announcement with an image or video to greet employees when they log in.
          </p>
          <Button
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            className="mt-4 gap-1.5 text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Announcement
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {announcements.map((ann) => (
            <Card key={ann.id} className="border-border bg-card shadow-sm flex flex-col justify-between">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={ann.status === "ACTIVE" ? "default" : "secondary"}
                      className="text-[10px] px-1.5 py-0 capitalize"
                    >
                      {ann.status}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 uppercase">
                      {ann.mediaType}
                    </Badge>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {dayjs(ann.createdAt).format("MMM D, YYYY")}
                  </span>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-foreground">
                    {ann.title || "Untitled Announcement"}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {ann.description || "No description provided."}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground pt-2 border-t border-border/60">
                  <span>Duration: {ann.durationSeconds}s</span>
                  <span>•</span>
                  <span>Target: {ann.targetRoles || "All"}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviewModal(ann)}
                    className="text-xs h-7 gap-1"
                  >
                    <Eye className="w-3 h-3" />
                    Preview
                  </Button>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant={ann.status === "ACTIVE" ? "secondary" : "default"}
                      onClick={() =>
                        statusMutation.mutate({
                          id: ann.id,
                          status: ann.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"
                        })
                      }
                      className="text-xs h-7"
                    >
                      {ann.status === "ACTIVE" ? "Retire" : "Publish"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(ann.id)}
                      className="text-destructive hover:bg-destructive/10 text-xs h-7 px-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onClose={() => setIsCreateOpen(false)} className="max-w-lg">
          <DialogHeader
            title="Create Global Announcement"
            description="Broadcast high-priority modal announcements to employees upon signing in."
          />

          <div className="space-y-4 my-5 max-h-[70vh] overflow-y-auto pr-1">
            <div>
              <Label className="text-xs font-semibold">Media Type</Label>
              <div className="grid grid-cols-3 gap-2 mt-1.5">
                {(["IMAGE", "VIDEO", "POSTER"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMediaType(t)}
                    className={`py-2 px-3 text-xs font-semibold rounded-lg border transition-all ${
                      mediaType === t
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold">Upload Media File *</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept={mediaType === "VIDEO" ? "video/*" : "image/*"}
                onChange={handleFileChange}
                className="mt-1 block w-full text-xs text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:opacity-90"
              />
              {filePreviewUrl && (
                <div className="mt-2 rounded-lg overflow-hidden border border-border max-h-40 bg-muted/30 flex items-center justify-center">
                  {mediaType === "VIDEO" ? (
                    <video src={filePreviewUrl} controls className="max-h-40 w-auto" />
                  ) : (
                    <img src={filePreviewUrl} alt="Preview" className="max-h-40 w-auto object-contain" />
                  )}
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs font-semibold">Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Annual Company Offsite 2026!"
                className="mt-1 text-xs"
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">Description / Message</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief message displayed below the media..."
                className="mt-1 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold">Display Duration (seconds)</Label>
                <Input
                  type="number"
                  value={durationSeconds}
                  onChange={(e) => setDurationSeconds(Number(e.target.value))}
                  min={5}
                  max={60}
                  className="mt-1 text-xs"
                />
              </div>

              <div>
                <Label className="text-xs font-semibold">Publish State</Label>
                <label className="flex items-center gap-2 mt-2.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={publishImmediately}
                    onChange={(e) => setPublishImmediately(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                  />
                  <span>Publish Immediately</span>
                </label>
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold">Target Audience</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1.5">
                {AVAILABLE_ROLES.map((r) => (
                  <label
                    key={r}
                    className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer ${
                      targetRoles.includes(r)
                        ? "border-primary bg-primary/5 text-foreground font-medium"
                        : "border-border text-muted-foreground hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={targetRoles.includes(r)}
                      onChange={() => handleToggleRole(r)}
                      className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5"
                    />
                    <span>{r}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !selectedFile}
              className="gap-1.5"
            >
              {createMutation.isPending && <PixousLoader size="xs" />}
              {createMutation.isPending ? "Publishing..." : "Save Announcement"}
            </Button>
          </div>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={Boolean(previewModal)} onClose={() => setPreviewModal(null)} className="max-w-md">
          <DialogHeader
            title={previewModal?.title || "Announcement Preview"}
            description={`Duration: ${previewModal?.durationSeconds ?? 0} seconds`}
          />

          <div className="my-4 rounded-lg overflow-hidden border border-border bg-black/5 flex items-center justify-center min-h-[160px]">
            {previewModal?.mediaType === "VIDEO" ? (
              <video src={previewModal.mediaUrl} controls autoPlay className="max-h-60 w-auto" />
            ) : (
              <img
                src={previewModal?.mediaUrl}
                alt="Announcement"
                className="max-h-60 w-auto object-contain"
              />
            )}
          </div>

          {previewModal?.description && (
            <p className="text-xs text-foreground/80 leading-relaxed mb-4">
              {previewModal.description}
            </p>
          )}

          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setPreviewModal(null)}>
              Close Preview
            </Button>
          </div>
      </Dialog>
    </div>
  );
}
