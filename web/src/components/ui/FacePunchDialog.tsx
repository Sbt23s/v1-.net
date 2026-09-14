import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Camera, RefreshCw, CheckCircle2, AlertCircle, ScanFace, MapPin, ShieldCheck, ShieldAlert
} from "lucide-react";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// Base URL for the Python analytics/face microservice. In production this is
// baked in at build time as "/analytics" (see web/Dockerfile) and routed by
// Nginx to the analytics container; local dev defaults to the service's
// default port since it runs standalone there.
const ANALYTICS_BASE = import.meta.env.VITE_ANALYTICS_URL || "http://localhost:8082";

/** Milliseconds between the two frames the liveness check compares. */
const LIVENESS_GAP_MS = 350;

interface VerifyResult {
  match: boolean;
  score?: number;
  /** The distance as a percentage, for people rather than machines. */
  confidence?: number;
  tolerance?: number;
  enrolledPhotos?: number;
  facesInFrame?: number;
  quality?: {
    lighting?: string; blurred?: boolean; tooFar?: boolean;
    brightness?: number; contrast?: number; sharpness?: number;
    faceWidth?: number; faceHeight?: number;
  };
  expressions?: {
    eyesClosed?: boolean; eyeOpenness?: number;
    smiling?: boolean; headTurn?: string;
  };
  liveness?: {
    checked: boolean; passed: boolean | null; motion?: number | null;
    blinked?: boolean; expressionChanged?: boolean; headMoved?: boolean;
  };
  /** Named by the service so a silence is never read as a pass. */
  notChecked?: string[];
  message?: string;
}

/**
 * Punching in or out with a face.
 *
 * <p>Three things happen in order, and the order matters. The location is read
 * first, because a punch without it cannot be placed. Two camera frames are then
 * captured a moment apart and sent together: a person is never perfectly still
 * and a photograph held to the lens is, which is what separates them. Only then
 * is the punch recorded — with the selfie and the match score attached, so it can
 * be answered for months later.
 *
 * <p>A failed match does not silently fall back to an ordinary punch. It says
 * what went wrong and lets the person try again, or punch without verification if
 * they choose to — recorded as exactly that.
 */
export function FacePunchDialog({
  open,
  onOpenChange,
  userId,
  isPunchIn,
  onDone}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: number;
  isPunchIn: boolean;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [streaming, setStreaming] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStreaming(false);
  }, []);

  const startCamera = useCallback(async () => {
    setErrorMsg(null);
    // The camera is only offered to a secure page. On plain HTTP the browser does
    // not expose mediaDevices at all, so say why rather than letting it fail with
    // a message about permissions that nobody can act on.
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

  // The location is read as the dialog opens rather than at the moment of
  // punching, so a slow fix does not sit between pressing the button and the
  // punch landing.
  const readLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy)});
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  }, []);

  useEffect(() => {
    if (open) {
      setSuccess(false);
      setErrorMsg(null);
      setResult(null);
      setVerifying(false);
      startCamera();
      readLocation();
    } else {
      stopCamera();
    }
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** One frame off the video element, as a JPEG. */
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
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9);
    });

  const punch = useMutation({
    mutationFn: async ({ photo, verified, score, detail }: {
      photo: Blob | null; verified: boolean; score?: number; detail?: VerifyResult;
    }) => {
      // Multipart, because the selfie travels with the punch. The photo is
      // evidence for the punch, not a separate upload that could be orphaned.
      const form = new FormData();
      form.append("kind", isPunchIn ? "punch-in" : "punch-out");
      form.append("verified", String(verified));
      if (photo) form.append("photo", photo, "punch.jpg");
      if (score != null) form.append("score", String(score));
      // Everything the check measured, kept with the punch so a dispute months
      // later has something to read rather than a bare yes.
      if (detail) form.append("detail", JSON.stringify(detail));
      if (coords) {
        form.append("latitude", String(coords.lat));
        form.append("longitude", String(coords.lng));
        form.append("accuracy", String(coords.accuracy));
      }
      form.append("mode", "FACE_VERIFIED");
      await api.post("/attendance/face-punch", form, {
        headers: { "Content-Type": "multipart/form-data" }});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard", "me"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["attendance-insights"] });
      setSuccess(true);
      toast.success(isPunchIn ? "Punched in" : "Punched out");
      stopCamera();
      setTimeout(() => {
        onOpenChange(false);
        onDone?.();
      }, 1600);
    },
    onError: (err: any) => {
      setVerifying(false);
      setErrorMsg(err.response?.data?.message || "Could not record the punch.");
    }});

  const captureAndVerify = async () => {
    setVerifying(true);
    setErrorMsg(null);
    setResult(null);

    const first = await grabFrame();
    if (!first) {
      setErrorMsg("Could not read the camera. Try again.");
      setVerifying(false);
      return;
    }
    // The second frame is what makes the liveness check possible at all.
    await new Promise((r) => setTimeout(r, LIVENESS_GAP_MS));
    const second = await grabFrame();

    try {
      const form = new FormData();
      form.append("file", first, "face.jpg");
      if (second) form.append("file2", second, "face2.jpg");

      const res = await fetch(`${ANALYTICS_BASE}/api/face/verify/${userId}`, {
        method: "POST",
        body: form});
      const data = await res.json();

      if (!res.ok) {
        // The service explains itself — no face, several faces, not enrolled.
        setErrorMsg(data.detail || "Verification failed.");
        setVerifying(false);
        return;
      }

      setResult(data as VerifyResult);

      if (data.match) {
        punch.mutate({ photo: first, verified: true, score: data.score, detail: data });
      } else {
        setErrorMsg(data.message || "That face does not match the one enrolled for you.");
        setVerifying(false);
      }
    } catch {
      setErrorMsg(
        "Could not reach the face service. It may not be running — you can still " +
        "punch without verification below."
      );
      setVerifying(false);
    }
  };


  return (
    <Dialog open={open} onClose={() => onOpenChange(false)} className="sm:max-w-md">
      <DialogHeader
        title={isPunchIn ? "Punch in with your face" : "Punch out with your face"}
        description="Look at the camera and hold still for a moment."
      />

      <div className="space-y-3">
        {success ? (
          <div className="flex flex-col items-center py-10 text-emerald-600">
            <CheckCircle2 className="mb-3 h-16 w-16" />
            <p className="text-lg font-semibold">
              {isPunchIn ? "Punched in" : "Punched out"}
            </p>
            {result?.score != null && (
              <p className="mt-1 text-xs text-muted-foreground">
                Face matched · score {result.score.toFixed(3)}
              </p>
            )}
          </div>
        ) : (
          <>
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
                  {verifying && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 text-white">
                      <ScanFace className="h-9 w-9 animate-pulse" />
                      <span className="text-sm font-medium">Checking your face…</span>
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

            {/* Where this punch will be recorded from, before it is made. */}
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
              {locating ? (
                <span className="text-muted-foreground">Finding your location…</span>
              ) : coords ? (
                <span className="tabular-nums">
                  {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                  <span className="ml-1.5 text-muted-foreground">±{coords.accuracy}m</span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  No location — the punch will be recorded without one
                </span>
              )}
            </div>

            {/* What the check actually found, rather than a bare pass or fail. */}
            {result && !result.match && (
              <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-destructive">
                  <ShieldAlert className="h-3.5 w-3.5" /> Not verified
                </div>
                <p className="text-muted-foreground">{result.message}</p>
                {result.score != null && (
                  <p className="text-muted-foreground">
                    Distance {result.score.toFixed(3)} against a limit of{" "}
                    {result.tolerance?.toFixed(2) ?? "0.50"}
                    {result.enrolledPhotos != null && ` · ${result.enrolledPhotos} photo(s) enrolled`}
                  </p>
                )}
                {result.liveness?.checked && result.liveness.passed === false && (
                  <p className="font-medium text-destructive">
                    The two frames were identical, which is what a photograph looks like.
                  </p>
                )}
              </div>
            )}

            {errorMsg && streaming && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {errorMsg}
              </div>
            )}

            <Button
              onClick={captureAndVerify}
              disabled={!streaming || verifying || punch.isPending}
              className="h-11 w-full"
            >
              {verifying || punch.isPending ? (
                <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Camera className="mr-2 h-5 w-5" />
              )}
              {isPunchIn ? "Verify and punch in" : "Verify and punch out"}
            </Button>

            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              Your photo and location are stored with this punch so it can be confirmed
              later. A punch is only recorded when your face is verified.
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
