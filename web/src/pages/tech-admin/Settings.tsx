import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings2, ShieldCheck, Key, Save, Check } from "lucide-react";
import { useTechAdminAuth } from "@/context/TechAdminAuthContext";

export function TechAdminSettings() {
  const { admin, theme } = useTechAdminAuth();
  const isDark = theme === "dark";

  const [saved, setSaved] = useState(false);
  const [formData, setFormData] = useState({
    name: admin?.name || "Master Technical Admin",
    username: admin?.username || "admin",
    email: "admin@hrportal.com",
    mfaEnabled: true});

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const cardBg = isDark ? "bg-slate-900/40 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.15)] text-slate-100" : "bg-[#13002b]/40 backdrop-blur-xl border-purple-500/30 text-purple-100 shadow-[0_0_20px_rgba(168,85,247,0.15)]";

  return (
    <div className="space-y-6 max-w-4xl">
      <div className={`flex justify-between items-center border-b pb-4 ${isDark ? "border-cyan-500/20" : "border-purple-500/30"}`}>
        <div>
          <h2 className={`text-xl font-semibold flex items-center gap-2 ${isDark ? "text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]" : "text-purple-300 drop-shadow-[0_0_10px_rgba(168,85,247,0.5)]"}`}>
            <Settings2 className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-purple-400"}`} />
            System Administration Settings
          </h2>
          <p className={`text-sm mt-1 font-medium ${isDark ? "text-cyan-400" : "text-purple-200"}`}>
            Configure global Technical Admin profile, security parameters, and system preferences.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {saved && (
          <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2">
            <Check className="w-4 h-4" /> Settings updated successfully!
          </div>
        )}

        <Card className={cardBg}>
          <CardHeader className={isDark ? "border-b border-cyan-500/20 pb-4" : "border-b border-purple-500/20 pb-4"}>
            <CardTitle className="text-md flex items-center gap-2">
              <ShieldCheck className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-purple-400"}`} />
              Technical Admin Account Profile
            </CardTitle>
            <CardDescription className={`font-medium ${isDark ? "text-cyan-400" : "text-purple-200"}`}>
              Master credential parameters used for multi-tenant administration.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className={isDark ? "text-slate-300" : "text-purple-300"}>Full Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className={`mt-1 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-purple-950/50 border-purple-500/30 text-purple-100 focus:border-purple-400"}`}
                />
              </div>
              <div>
                <Label className={isDark ? "text-slate-300" : "text-purple-300"}>Username</Label>
                <Input
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className={`mt-1 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-purple-950/50 border-purple-500/30 text-purple-100 focus:border-purple-400"}`}
                />
              </div>
            </div>

            <div>
              <Label className={isDark ? "text-slate-300" : "text-purple-300"}>Email Address</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className={`mt-1 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-purple-950/50 border-purple-500/30 text-purple-100 focus:border-purple-400"}`}
              />
            </div>
          </CardContent>
        </Card>

        <Card className={cardBg}>
          <CardHeader className={isDark ? "border-b border-cyan-500/20 pb-4" : "border-b border-purple-500/20 pb-4"}>
            <CardTitle className="text-md flex items-center gap-2">
              <Key className={`w-5 h-5 ${isDark ? "text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]" : "text-amber-500"}`} />
              Security & Global Platform Preferences
            </CardTitle>
            <CardDescription className={`font-medium ${isDark ? "text-cyan-400" : "text-purple-200"}`}>
              Multi-tenant security parameters and global system rules.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className={`flex items-center justify-between p-3 rounded-lg border ${isDark ? "border-cyan-500/20 bg-cyan-900/10" : "border-purple-500/20 bg-purple-900/10"}`}>
              <div>
                <span className={`text-sm font-medium block ${isDark ? "text-slate-200" : "text-purple-200"}`}>Enforce Multi-Factor Authentication (MFA)</span>
                <span className={`text-xs font-medium ${isDark ? "text-cyan-400" : "text-purple-200"}`}>Require MFA for all Technical Admin logins</span>
              </div>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, mfaEnabled: !formData.mfaEnabled })}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                  formData.mfaEnabled ? (isDark ? 'bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.5)]' : 'bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]') : (isDark ? 'bg-slate-800' : 'bg-purple-950')
                }`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  formData.mfaEnabled ? 'translate-x-4' : 'translate-x-0'
                }`} />
              </button>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" className={isDark ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold border border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]" : "bg-purple-600 hover:bg-purple-500 text-white border border-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.5)]"}>
            <Save className="w-4 h-4 mr-2" /> Save Settings
          </Button>
        </div>
      </form>
    </div>
  );
}
