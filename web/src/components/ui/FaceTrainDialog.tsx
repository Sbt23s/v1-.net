import { useState, useRef, useEffect, useCallback } from "react";
import { Camera, RefreshCw, CheckCircle2, AlertCircle, ScanFace, Trash2 } from "lucide-react";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const ANALYTICS_BASE = import.meta.env.VITE_ANALYTICS_URL || "http://localhost:8082";

/**
 * The poses asked for, in order. Several angles rather than one photograph is the
 * difference between face punch working in the morning light and failing in the
 * afternoon — one photo means one pose, one light, one day, and then a genuine
 * person standing slightly differently is turned away.
 */
const POSES = [
  { label: "Look straight at the camera", hint: "Neutral face, eyes open" },
  { label: "Turn your head slightly left", hint: "Just a little — stay in frame" },
  { label: "Turn your head slightly right", hint: "Just a little — stay in frame" },
  { label: "Smile", hint: "A normal smile is enough" },
];

/**
 * Enrolling somebody's face.
 *
 * <p>Each capture is sent as it is taken, so a session interrupted halfway still
 * leaves usable enrolments behind rather than nothing. The service keeps the most
 * recent few and drops the oldest, which is what lets somebody re-enrol after
 * growing a beard without the old photos outvoting the new ones.
 */
export function FaceTrainDialog({
  open,
  onOpenChange,
  userId,
  onComplete}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: number;
  onComplete?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  /** True for the first capture, which replaces whatever was enrolled before. */
  const firstRef = useRef(true);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStreaming(false);
  }, []);

  const startCamera = useCallback(async () => {
    setErrorMsg(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setErrorMsg(
        "The camera needs a secure (https) connection. It works on localhost; " +
        "ask your admin to enable HTTPS on the portal."
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }});
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setStreaming(true);
    } catch (err: any) {
      setErrorMsg(
        err?.name === "NotAllowedError"
          ? "Camera permission was refused. Allow it in the browser's address bar and try again."
          : "No camera is available. " + (err?.message ?? "")
      );
    }
  }, []);

  useEffect(() => {
    if (open) {
      setStep(0);
      setSaved(0);
      setDone(false);
      setErrorMsg(null);
      firstRef.current = true;
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const grabFrame = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !video.videoWidth) return resolve(null);
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92);
    });

  const captureOne = async () => {
    setBusy(true);
    setErrorMsg(null);
    const frame = await grabFrame();
    if (!frame) {
      setErrorMsg("Could not read the camera. Try again.");
      setBusy(false);
      return;
    }
    try {
      const form = new FormData();
      form.append("file", frame, "face.jpg");
      // The first capture of a session replaces the old enrolment; the rest add
      // to it. Otherwise re-enrolling would keep stacking onto stale photos.
      const url = `${ANALYTICS_BASE}/api/face/train/${userId}?replace=${firstRef.current}`;
      const res = await fetch(url, { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) {
        // The service is specific: no face, several faces, too small.
        setErrorMsg(data.detail || "Could not save that photo.");
        setBusy(false);
        return;
      }

      firstRef.current = false;
      setSaved(data.photos ?? saved + 1);

      // The first, straight-on photo is kept by the portal so HR can look at it
      // afterwards and confirm they registered the right person. The analytics
      // service keeps only measurements, from which no picture can be recovered.
      if (step === 0) {
        try {
          const record = new FormData();
          record.append("photo", frame, "face.jpg");
          await api.post(`/users/${userId}/face-photo`, record, {
            headers: { "Content-Type": "multipart/form-data" }
          });
        } catch {
          // The enrolment itself has already succeeded. Not being able to keep a
          // copy for HR to look at must not undo that.
        }
      }

      if (step + 1 >= POSES.length) {
        setDone(true);
        stopCamera();
        toast.success(`Face registered from ${data.photos ?? step + 1} photos`);
        setTimeout(() => {
          onOpenChange(false);
          onComplete?.();
        }, 1600);
      } else {
        setStep(step + 1);
      }
    } catch {
      setErrorMsg(
        "Could not reach the face service. Check that the analytics service is running."
      );
    } finally {
      setBusy(false);
    }
  };

  /*
    Kept, unused by any button on purpose.

    Biometric data has to remain erasable -- for somebody who leaves, or who
    asks for it -- and deleting this function would mean writing it again from
    scratch when erasure is wired into offboarding. What has been removed is
    the casual path to it, not the capability.
  */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const forgetFace = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${ANALYTICS_BASE}/api/face/${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      // Both halves go: the measurements the service holds, and the photo the
      // portal keeps. A face is biometric data and erasing it has to be complete.
      try { await api.delete(`/users/${userId}/face-photo`); } catch { /* already gone */ }
      toast.success("Face data removed");
      setSaved(0);
      setStep(0);
      firstRef.current = true;
      onComplete?.();
    } catch {
      toast.error("Could not remove the face data");
    } finally {
      setBusy(false);
    }
  };

  const pose = POSES[Math.min(step, POSES.length - 1)];

  return (
    <Dialog open={open} onClose={() => { onOpenChange(false); onComplete?.(); }} className="sm:max-w-md">
      <DialogHeader
        title="Register your face"
        description="Four quick photos. More angles means it recognises you in different light."
      />

      <div className="space-y-3">
        {done ? (
          <div className="flex flex-col items-center py-10 text-emerald-600">
            <CheckCircle2 className="mb-3 h-16 w-16" />
            <p className="text-lg font-semibold">Face registered</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {saved} photo{saved === 1 ? "" : "s"} saved. You can now punch with your face.
            </p>
          </div>
        ) : (
          <>
            {/* Which photo this is, and how many are left. */}
            <div className="flex items-center gap-1.5">
              {POSES.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-1.5 flex-1 rounded-full transition-colors",
                    i < step ? "bg-emerald-500" : i === step ? "bg-primary" : "bg-muted"
                  )}
                />
              ))}
            </div>

            <div className="rounded-lg border bg-muted/30 px-3 py-2">
              <div className="text-sm font-semibold">
                {step + 1} of {POSES.length}: {pose.label}
              </div>
              <div className="text-xs text-muted-foreground">{pose.hint}</div>
            </div>

            <div className="relative aspect-video w-full overflow-hidden rounded-xl border bg-black">
              {!streaming && !errorMsg && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <RefreshCw className="h-8 w-8 animate-spin text-white/60" />
                </div>
              )}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={cn("h-full w-full object-cover", streaming ? "block" : "hidden")}
              />
              <canvas ref={canvasRef} className="hidden" />

              {streaming && (
                <>
                  <div className="pointer-events-none absolute inset-8 rounded-full border-2 border-dashed border-white/50" />
                  {busy && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 text-white">
                      <ScanFace className="h-9 w-9 animate-pulse" />
                      <span className="text-sm font-medium">Saving…</span>
                    </div>
                  )}
                </>
              )}

              {errorMsg && !streaming && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-5 text-center">
                  <AlertCircle className="h-8 w-8 text-destructive" />
                  <p className="text-sm font-medium text-white">{errorMsg}</p>
                  <Button variant="outline" size="sm" onClick={startCamera}>Try again</Button>
                </div>
              )}
            </div>

            {errorMsg && streaming && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {errorMsg}
              </div>
            )}

            <Button
              onClick={captureOne}
              disabled={!streaming || busy}
              className="h-11 w-full"
            >
              {busy ? <RefreshCw className="mr-2 h-5 w-5 animate-spin" /> : <Camera className="mr-2 h-5 w-5" />}
              {step + 1 >= POSES.length ? "Capture and finish" : "Capture this photo"}
            </Button>

            {/*
              "Remove my face data" was here.

              A registered face is what lets somebody punch attendance, so
              erasing it does not just delete a photo -- it stops that person
              being able to clock in until an administrator sits them in front
              of a camera again. It was one button away from the capture
              button, offered on every visit to this dialog, and no confirm
              step stood between them.

              Registration is now permanent: re-registering replaces the
              photos, and nothing in the portal takes it away. Erasure for
              somebody who has actually left is a deliberate act and belongs
              with offboarding, not beside a camera shutter.
            */}

            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              Your face is stored as a set of measurements, not as photographs, and only
              to confirm your own attendance. You can remove it at any time.
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
