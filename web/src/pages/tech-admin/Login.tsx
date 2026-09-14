import { PixousLoader } from "@/components/ui/pixous-loader";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTechAdminAuth } from "@/context/TechAdminAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Volume2, VolumeX } from "lucide-react";

export function TechAdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  const { login } = useTechAdminAuth();
  const navigate = useNavigate();

  const [soundOn, setSoundOn] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /**
   * Start or stop the background music.
   *
   * Off to begin with, and started only from this click. Browsers refuse to
   * autoplay audio until someone has interacted with the page, so a track that
   * tried to start on load simply never played — and nothing said why. Tying it
   * to the button makes the click itself the permission.
   */
  const toggleSound = () => {
    const el = audioRef.current;
    if (!el) return;
    if (soundOn) {
      el.pause();
      setSoundOn(false);
      return;
    }
    el.volume = 0.35; // background, not a performance
    void el
      .play()
      .then(() => setSoundOn(true))
      // Refused anyway: leave the button showing "off", which is the truth.
      .catch(() => setSoundOn(false));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await login(username, password);
      navigate("/tech-admin/dashboard");
    } catch (err: any) {
      setError(err.response?.data?.message || "Invalid credentials. Access denied.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isDark = theme === "dark";

  return (
    <div className={`relative flex min-h-screen items-center justify-center lg:justify-end lg:pr-32 transition-colors duration-300 px-4 overflow-hidden ${isDark ? "bg-slate-950 text-slate-50" : "bg-[#0a0118] text-purple-100"}`}>
      
      {/*
        Both files are served from web/public.

        They were referenced as /@fs/C:/Users/balas/Downloads/... — a path the
        Vite dev server resolves and a built bundle cannot. On the deployed site
        the video and the audio were simply absent, which is why this page was a
        flat dark rectangle there while it looked right locally. Anything the
        browser has to fetch must live inside the project.

        Muted, because no browser will autoplay sound unmuted; the button below
        is what turns it on, and it counts as the click that grants permission.
      */}
      <video
        autoPlay
        loop
        muted
        playsInline
        // Nothing here needs the video to be understood, so it is decoration.
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover motion-reduce:hidden"
      >
        <source src="/tech-admin-login.mp4" type="video/mp4" />
      </video>

      <audio ref={audioRef} loop src="/tech-admin-login.mp3" />

      {/* Overlay to ensure readability */}
      <div className={`absolute inset-0 pointer-events-none transition-colors duration-300 ${isDark ? "bg-slate-950/40" : "bg-[#0a0118]/60 backdrop-blur-[2px]"}`} />

      {/* Sound, where the theme switch used to be. The theme control was
          removed on request; there was little for it to change here anyway,
          since the background is a video either way. */}
      <div className="absolute top-6 right-6 z-10">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={toggleSound}
          aria-pressed={soundOn}
          className={`rounded-full transition backdrop-blur-md ${isDark ? "bg-slate-900/40 border-cyan-500/30 text-cyan-300 hover:bg-cyan-900/50" : "bg-purple-900/40 border-purple-500/30 text-purple-200 hover:bg-purple-900/60"}`}
          title={soundOn ? "Turn sound off" : "Turn sound on"}
        >
          {soundOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
        </Button>
      </div>

      <div className={`relative z-10 w-full max-w-sm space-y-6 rounded-2xl p-6 shadow-2xl transition-all duration-300 border backdrop-blur-xl ${isDark ? "bg-slate-900/40 border-cyan-500/30 shadow-[0_0_20px_rgba(6,182,212,0.15)] ring-1 ring-cyan-500/20" : "bg-[#13002b]/70 border-purple-500/30 shadow-[0_0_30px_rgba(168,85,247,0.2)] ring-1 ring-purple-500/20"}`}>
        <div className="text-center">
          <ShieldCheck className={`mx-auto h-10 w-10 drop-shadow-md ${isDark ? "text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]" : "text-purple-400 drop-shadow-[0_0_10px_rgba(168,85,247,0.5)]"}`} />
          <h2 className={`mt-3 text-xl font-bold tracking-tight drop-shadow-sm ${isDark ? "text-cyan-400" : "text-purple-100"}`}>
            SaaS Control Center
          </h2>
          <p className={`mt-1.5 text-xs font-bold ${isDark ? "text-cyan-400" : "text-purple-200"}`}>
            Enterprise Technical Administration
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className={`rounded-md p-4 text-sm border ${isDark ? "bg-red-900/30 text-red-400 border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.2)]" : "bg-red-900/30 text-red-400 border-red-500/30 shadow-[0_0_8px_rgba(239,68,68,0.2)]"}`}>
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <Label htmlFor="username" className={isDark ? "text-cyan-100" : "text-purple-200"}>Username</Label>
              <Input
                id="username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={`mt-1 transition ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white placeholder:text-slate-500 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400" : "bg-purple-950/50 border-purple-500/30 text-purple-100 placeholder:text-purple-400/50 focus:border-purple-400 focus:ring-1 focus:ring-purple-400"}`}
                placeholder="Admin username"
              />
            </div>

            <div>
              <Label htmlFor="password" className={isDark ? "text-cyan-100" : "text-purple-200"}>Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`mt-1 transition ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white placeholder:text-slate-500 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400" : "bg-purple-950/50 border-purple-500/30 text-purple-100 placeholder:text-purple-400/50 focus:border-purple-400 focus:ring-1 focus:ring-purple-400"}`}
                placeholder="••••••••"
              />
            </div>
          </div>

          <Button
            type="submit"
            className={`w-full font-bold ${isDark ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-[0_0_15px_rgba(6,182,212,0.4)] border border-cyan-400" : "bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.5)] border border-purple-400"}`}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <PixousLoader size="xs" className="mr-2" />
                Authenticating...
              </>
            ) : (
              "Secure Login"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
