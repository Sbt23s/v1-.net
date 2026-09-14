import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import toast from "react-hot-toast";
import { Lock, User, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { tokenStore, apiMessage } from "@/lib/api";
import { motion } from "framer-motion";

const schema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required")
});

type FormValues = z.infer<typeof schema>;

// A DEMO list of seeded usernames and codes sat here, unreferenced. Nothing
// rendered it, but a list of working credentials in a login page is not
// something to leave lying around on the chance it gets wired up later.

function Field({ label, icon: Icon, isActive, children, error }: { label: string, icon: any, isActive: boolean, children: React.ReactNode, error?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-white/80">{label}</span>
      <motion.div
        animate={{ scale: isActive ? 1.015 : 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 22 }}
        className={[
          'flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 backdrop-blur-sm',
          'transition-colors duration-300',
          isActive
            ? 'border-brand-ring bg-white/10 ring-2 ring-brand-ring/50 shadow-[0_0_20px_-4px_rgba(74,222,128,0.6)]'
            : 'border-white/15 bg-white/[0.06]',
          error ? 'border-red-500/50 ring-red-500/20' : ''
        ].join(' ')}
      >
        <Icon size={16} className={isActive ? 'text-brand-ring' : 'text-white/40'} strokeWidth={2} />
        <div className="flex min-h-[1.25rem] flex-1 items-center text-sm text-white">
          {children}
        </div>
      </motion.div>
      {error && <span className="mt-1 block text-[10px] text-red-400">{error}</span>}
    </label>
  )
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [buttonGlow, setButtonGlow] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors }
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  if (tokenStore.access) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      await login(values.username, values.password);
      toast.success("Welcome back");
      const from = (location.state as { from?: string })?.from || "/";
      navigate(from, { replace: true });
    } catch (err) {
      toast.error(apiMessage(err, "Login failed — check your username and password"));
    } finally {
      setSubmitting(false);
    }
  }

  function fillDemo(username: string) {
    setValue("username", username, { shouldValidate: true });
    setValue("password", "Test1234@", { shouldValidate: true });
  }

  const container = { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.15 } } }
  const item = {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } }}

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      {/*
        Video background, but the poster is what people actually wait for.

        The clip is 2.6 MB and this is the first page of the product, so it
        was 2.6 MB standing between somebody and the sign-in form -- on a
        slow connection, a blank screen while a decorative background
        downloaded. preload="none" lets the browser paint the poster frame
        immediately and fetch the video afterwards; autoPlay still starts it
        as soon as enough has arrived, so the page looks the same a moment
        later and is usable straight away.
      */}
      <video
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay muted loop playsInline preload="none" poster="/video/poster.jpg"
      >
        <source src="/video/login-bg.mp4" type="video/mp4" />
      </video>

      {/* Subtle overall darken so the glass card stays readable */}
      <div className="absolute inset-0 bg-slate-950/40" />

      {/* Centered compact card */}
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="w-full max-w-sm rounded-2xl border border-white/15 bg-transparent p-7 shadow-2xl backdrop-blur-sm"
        >
          <div className="flex justify-between items-start mb-5">
            <div className="space-y-1">
              <motion.h2 variants={item} className="text-2xl font-extrabold text-white pt-1">
                Sign in
              </motion.h2>
              <motion.p variants={item} className="mt-0.5 text-sm text-white/60">
                Welcome to Login Page
              </motion.p>
            </div>
            <motion.img
              variants={item}
              src="https://pixoustech.com/public/assets/images/common/pixous-logo1.png"
              alt="Pixous Logo"
              className="h-16 w-auto object-contain mt-1 p-2 rounded-lg bg-white shadow-md border border-white/20"
              onError={(e) => {
                // If official site image fails to load, hide image box gracefully
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
            <motion.div variants={item}>
              <Field label="Username or Name" icon={User} isActive={activeField === 'username'} error={errors.username?.message}>
                <input
                  type="text"
                  placeholder="username or full name"
                  className="w-full bg-transparent outline-none placeholder:text-white/35 text-white"
                  onFocus={() => setActiveField('username')}
                  {...register("username")}
                  onBlur={(e) => {
                    void register("username").onBlur(e);
                    setActiveField(null);
                  }}
                />
              </Field>
            </motion.div>

            <motion.div variants={item}>
              <Field label="Password" icon={Lock} isActive={activeField === 'password'} error={errors.password?.message}>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-white/35 text-white tracking-[0.2em]"
                  onFocus={() => setActiveField('password')}
                  {...register("password")}
                  onBlur={(e) => {
                    void register("password").onBlur(e);
                    setActiveField(null);
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="shrink-0 text-white/40 hover:text-white/80 transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </Field>
            </motion.div>

            <motion.div variants={item}>
              <motion.button
                type="submit"
                disabled={submitting}
                whileHover={{ y: -2 }}
                whileTap={{ y: 0, scale: 0.99 }}
                onHoverStart={() => setButtonGlow(true)}
                onHoverEnd={() => setButtonGlow(false)}
                animate={{
                  boxShadow: buttonGlow
                    ? '0 0 0 3px rgba(74,222,128,0.4), 0 14px 30px -10px rgba(21,128,61,0.8)'
                    : '0 8px 20px -10px rgba(21,128,61,0.6)'}}
                transition={{ duration: 0.4 }}
                className="group relative w-full overflow-hidden rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed"
              >
                <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                {submitting && <PixousLoader size="xs" className="mr-2" />}
                {submitting ? "Signing in..." : "Sign in"}
              </motion.button>
            </motion.div>
          </form>
        </motion.div>
      </div>
    </div>
  )
}
