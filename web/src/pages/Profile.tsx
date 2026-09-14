import { PixousLoader } from "@/components/ui/pixous-loader";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { nameRules, emailRules, pincodeRules, digitsOnly } from "@/lib/validation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Plus, Trash2, Landmark, BadgeCheck, Camera, Download
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Avatar, resolvePhotoUrl } from "@/components/ui/avatar";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiEnvelope, Profile, BankResponse, DropdownItem } from "@/types";
import { roleLabels } from "@/lib/roles";

function genderLabel(g?: string): string | undefined {
  if (!g) return undefined;
  const c = g.trim().toUpperCase()[0];
  return c === "M" ? "Male" : c === "F" ? "Female" : c === "O" ? "Other" : g;
}

function industryLabel(i?: string): string | undefined {
  return i === "IT" ? "DIGITAL" : i === "CIVIL" ? "INFRA" : i;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface ProfileForm {
  name?: string;
  email?: string;
  gender?: string;
  house?: string;
  street?: string;
  locality?: string;
  district?: string;
  state?: string;
  pincode?: string;
}

export default function ProfilePage() {
  const qc = useQueryClient();
  const { refreshUser } = useAuth();
  const [bankOpen, setBankOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: async () => (await api.get<ApiEnvelope<Profile>>("/users/me")).data.data
  });

  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.post<ApiEnvelope<{ photoPath: string }>>("/users/me/photo", fd, {
        headers: { "Content-Type": "multipart/form-data" }
      });
    },
    onSuccess: async () => {
      toast.success("Photo updated");
      await qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      // Update the sidebar / topbar avatar too.
      await refreshUser();
    },
    onError: (err) => toast.error(apiMessage(err, "Could not upload photo"))
  });

  const removePhoto = useMutation({
    mutationFn: async () => api.delete("/users/me/photo"),
    onSuccess: async () => {
      toast.success("Photo removed");
      await qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      // The sidebar and topbar go back to initials too.
      await refreshUser();
    },
    onError: (err) => toast.error(apiMessage(err, "Could not remove photo"))
  });

  function onPhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB");
      return;
    }
    uploadPhoto.mutate(file);
    e.target.value = ""; // allow re-selecting the same file
  }

  const banks = useQuery({
    queryKey: ["banks"],
    queryFn: async () => (await api.get<ApiEnvelope<BankResponse[]>>("/users/me/bank")).data.data
  });

  // Department, team and office are stored as ids; these turn them into names.
  const orgLookups = useQuery({
    queryKey: ["org-dropdowns", "my-profile"],
    queryFn: async () => (await api.post<ApiEnvelope<Record<string, DropdownItem[]>>>(
      "/org/dropdowns", ["department", "designation", "office_location"]
    )).data.data
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ProfileForm>({ mode: "onBlur" });
  const nameField = register("name", nameRules);

  useEffect(() => {
    if (profile.data) {
      reset({
        name: profile.data.name,
        email: profile.data.email,
        gender: (profile.data.gender ?? "").trim().toUpperCase().slice(0, 1),
        house: profile.data.address?.house,
        street: profile.data.address?.street,
        locality: profile.data.address?.locality,
        district: profile.data.address?.district,
        state: profile.data.address?.state,
        pincode: profile.data.address?.pincode
      });
    }
  }, [profile.data, reset]);

  const save = useMutation({
    mutationFn: async (v: ProfileForm) => api.put("/users/me", v),
    onSuccess: () => {
      toast.success("Profile updated");
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Could not update profile"))
  });

  const removeBank = useMutation({
    mutationFn: async (id: number) => api.delete(`/users/me/bank/${id}`),
    onSuccess: () => {
      toast.success("Bank account removed");
      qc.invalidateQueries({ queryKey: ["banks"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Could not remove account"))
  });

  const p = profile.data;

  const labelFor = (items: DropdownItem[] | undefined, id?: number) =>
    id == null ? undefined : items?.find((i) => i.id === id)?.label;
  const deptName = p?.departmentTitle || labelFor(orgLookups.data?.department, p?.departmentId);
  const teamName = p?.designationTitle || labelFor(orgLookups.data?.designation, p?.designationId);
  const officeName = labelFor(orgLookups.data?.office_location, p?.officeLocationId);
  const addressStr = p?.address
    ? [p.address.house, p.address.street, p.address.locality,
       p.address.district, p.address.state, p.address.pincode].filter(Boolean).join(", ")
    : "";

  // Everything on the record, in the order it reads best. Also what the
  // downloaded document carries, so the two never disagree.
  const detailRows: [string, string | undefined][] = p ? [
    ["Employee Code", p.employeeCode],
    ["Username", p.username],
    ["Full Name", p.name],
    ["Email", p.email],
    ["Personal Email", p.personalEmail],
    ["Phone", p.phone],
    ["Alternate Phone", p.alternatePhone],
    ["Aadhaar Number", p.aadhar],
    ["PAN", p.pan],
    ["PF Number", p.pfNumber],
    ["Gender", genderLabel(p.gender)],
    ["Date of Birth", p.dob ? dayjs(p.dob).format("DD MMM YYYY") : undefined],
    ["Blood Group", p.bloodGroup],
    ["Industry", industryLabel(p.industry)],
    ["Team", teamName],
    ["Department", deptName],
    ["Position", p.positionTitle],
    ["Office Location", officeName],
    ["Employment Type", p.employmentType],
    ["Date of Joining", p.dateOfJoining ? dayjs(p.dateOfJoining).format("DD MMM YYYY") : undefined],
    ["Emergency Contact", p.emergencyContact
      ? `${p.emergencyContact}${p.emergencyContactRelation ? ` (${p.emergencyContactRelation})` : ""}`
      : undefined],
    ["Status", p.profileStatus],
    ["Roles", roleLabels(p.roles).join(", ")],
    ["Address", addressStr]
  ] : [];

  /** The whole record as one document, photo and all. */
  async function downloadProfile() {
    if (!p) return;
    setDownloading(true);
    try {
      // The photo travels as base64, so the file stands on its own.
      let photoHtml = "";
      if (p.photoPath) {
        try {
          const url = resolvePhotoUrl(p.photoPath);
          const blob = await (await fetch(url!)).blob();
          const dataUrl: string = await new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onloadend = () => res(fr.result as string);
            fr.onerror = rej;
            fr.readAsDataURL(blob);
          });
          photoHtml = `<img src="${dataUrl}" width="132" height="132" style="object-fit:cover;border-radius:10px;" />`;
        } catch {
          /* no photo — skip it */
        }
      }

      const tableRows = detailRows
        .map(([k, v]) =>
          `<tr><td style="padding:6px 12px;border:1px solid #d9d9d9;background:#f5f6fa;font-weight:bold;width:34%;">${escapeHtml(k)}</td><td style="padding:6px 12px;border:1px solid #d9d9d9;">${escapeHtml(v || "—")}</td></tr>`)
        .join("");

      const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>${escapeHtml(p.name)} - Profile</title></head>
<body style="font-family:Calibri,Arial,sans-serif;color:#1f2937;">
  <div style="text-align:center;margin-bottom:6px;">${photoHtml}</div>
  <h1 style="text-align:center;margin:6px 0 0;font-size:22px;">${escapeHtml(p.name)}</h1>
  <p style="text-align:center;color:#6b7280;margin:2px 0 18px;">${escapeHtml(p.employeeCode)} &middot; Pixous Technologies</p>
  <table style="border-collapse:collapse;width:100%;font-size:13px;">${tableRows}</table>
  <p style="margin-top:22px;color:#9ca3af;font-size:11px;">Generated on ${dayjs().format("DD MMM YYYY, h:mm A")}</p>
</body></html>`;

      const blob = new Blob(["﻿", html], { type: "application/msword" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${p.employeeCode}_${p.name.replace(/\s+/g, "_")}_Profile.doc`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(href);
      toast.success("Profile downloaded");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="My profile"
        subtitle="Your details and bank accounts for payroll."
        actions={
          <Button variant="outline" disabled={!p || downloading} onClick={downloadProfile}>
            {downloading ? <PixousLoader size="xs" /> : <Download className="h-4 w-4" />}
            Download profile
          </Button>
        }
      />

      {profile.isLoading || !p ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Identity card */}
          <Card className="lg:col-span-1">
            <CardContent className="flex flex-col items-center p-6 text-center">
              <div className="group relative">
                <Avatar name={p.name} src={p.photoPath} className="h-20 w-20 text-2xl" />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPhotoPicked}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadPhoto.isPending}
                  className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow-md transition-transform hover:scale-105 disabled:opacity-60"
                  aria-label="Change photo"
                  title="Add / change photo"
                >
                  {uploadPhoto.isPending ? (
                    <PixousLoader size="xs" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadPhoto.isPending || removePhoto.isPending}
                  className="text-primary hover:underline disabled:opacity-60"
                >
                  {p.photoPath ? "Change photo" : "Add photo"}
                </button>
                {/* Only worth offering once there is a photo to take away. */}
                {p.photoPath && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("Remove your profile photo?")) removePhoto.mutate();
                      }}
                      disabled={uploadPhoto.isPending || removePhoto.isPending}
                      className="inline-flex items-center gap-1 text-destructive hover:underline disabled:opacity-60"
                    >
                      {removePhoto.isPending
                        ? <PixousLoader size="xs" />
                        : <Trash2 className="h-3 w-3" />}
                      Remove photo
                    </button>
                  </>
                )}
              </div>
              <h2 className="mt-3 font-display text-lg font-bold">{p.name}</h2>
              <div className="code-chip text-sm text-muted-foreground">{p.employeeCode}</div>
              <div className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                <BadgeCheck className="h-4 w-4 text-success" />
                {p.profileStatus || "Active"}
              </div>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {roleLabels(p.roles).map((label) => (
                  <Badge key={label} className="code-chip">
                    {label}
                  </Badge>
                ))}
              </div>
              <dl className="mt-6 w-full space-y-2 text-left text-sm">
                <Row label="Industry" value={p.industry === "IT" ? "DIGITAL" : p.industry === "CIVIL" ? "INFRA" : p.industry} />
                <Row label="Employment" value={p.employmentType} />
                <Row
                  label="Joined"
                  value={p.dateOfJoining ? dayjs(p.dateOfJoining).format("DD MMM YYYY") : undefined}
                />
                <Row label="Aadhaar" value={p.aadhar ? `•••• •••• ${p.aadhar.slice(-4)}` : undefined} />
              </dl>
            </CardContent>
          </Card>

          {/* Editable form */}
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Personal details</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="name">Full name</Label>
                      {/*
                        Digits are dropped as they are typed rather than
                        reported afterwards. Telling somebody their name is
                        wrong once they have finished typing it is worse than
                        never letting the wrong character land, and the rules
                        still run on submit for everything a filter cannot
                        catch.
                      */}
                      <Input
                        id="name"
                        {...nameField}
                        onChange={(e) => {
                          e.target.value = e.target.value.replace(/[0-9]/g, "");
                          nameField.onChange(e);
                        }}
                      />
                      {errors.name && (
                        <p className="text-xs text-destructive">{errors.name.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" type="email" {...register("email", emailRules)} />
                      {errors.email && (
                        <p className="text-xs text-destructive">{errors.email.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="gender">Gender</Label>
                      {/*
                        A list rather than a free text box. It was typed by
                        hand, so the stored value could be "F", "female",
                        "FEMALE" or anything else, and the field showed the
                        single letter the server keeps rather than a word.
                        The values here are the single letters the server
                        already stores, so nothing about the saved data
                        changes.
                      */}
                      <Select id="gender" {...register("gender")}>
                        <option value="">Select…</option>
                        <option value="M">Male</option>
                        <option value="F">Female</option>
                        <option value="O">Other</option>
                      </Select>
                    </div>
                  </div>

                  <div className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Address
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="house">House / building</Label>
                      <Input id="house" {...register("house")} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="street">Street</Label>
                      <Input id="street" {...register("street")} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="locality">Locality</Label>
                      <Input id="locality" {...register("locality")} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="district">District</Label>
                      <Input id="district" {...register("district")} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="state">State</Label>
                      <Input id="state" {...register("state")} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pincode">Pincode</Label>
                      {/*
                        Digits only, as they are typed.

                        A letter that never appears is clearer than one that
                        appears and is then complained about -- and this also
                        takes the space out of a pasted "560 001" rather than
                        making somebody work out why it was refused.
                      */}
                      <Input
                        id="pincode"
                        className="code-chip"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="6 digits"
                        {...register("pincode", pincodeRules)}
                        onChange={(e) => {
                          e.target.value = digitsOnly(e.target.value, 6);
                          register("pincode", pincodeRules).onChange(e);
                        }}
                      />
                      {errors.pincode && (
                        <p className="text-xs text-destructive">
                          {errors.pincode.message as string}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button type="submit" disabled={save.isPending}>
                      {save.isPending ? (
                        <PixousLoader size="xs" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      Save changes
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* The whole record, read-only — the same list the download carries. */}
            <Card>
              <CardHeader>
                <CardTitle>Full details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                  {detailRows.map(([label, value]) => (
                    <div key={label} className="flex items-start justify-between gap-4 border-b pb-2">
                      <dt className="shrink-0 text-muted-foreground">{label}</dt>
                      <dd className="break-words text-right font-medium">{value || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            {/* Bank accounts */}
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Bank accounts</CardTitle>
                <Button variant="outline" size="sm" onClick={() => setBankOpen(true)}>
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </CardHeader>
              <CardContent>
                {banks.isLoading ? (
                  <Skeleton className="h-24" />
                ) : (banks.data?.length ?? 0) === 0 ? (
                  <EmptyState
                    icon={Landmark}
                    title="No bank accounts"
                    description="Add an account so payroll can be credited correctly."
                  />
                ) : (
                  <div className="space-y-3">
                    {banks.data!.map((b) => (
                      <div
                        key={b.id}
                        className="flex items-center gap-3 rounded-lg border p-3"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                          <Landmark className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{b.bankName}</span>
                            {b.primary && <Badge variant="success">Primary</Badge>}
                          </div>
                          <div className="code-chip text-xs text-muted-foreground">
                            ••••{b.accountNumber.slice(-4)} · {b.ifscCode}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={removeBank.isPending}
                          onClick={() => removeBank.mutate(b.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {bankOpen && <AddBankDialog onClose={() => setBankOpen(false)} />}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between border-b pb-2 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value || "—"}</dd>
    </div>
  );
}

interface BankForm {
  bankName: string;
  branchName?: string;
  accountNumber: string;
  ifscCode: string;
  accountHolderName: string;
  primary?: boolean;
}

function AddBankDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<BankForm>();

  const add = useMutation({
    mutationFn: async (v: BankForm) => api.post("/users/me/bank", v),
    onSuccess: () => {
      toast.success("Bank account added");
      qc.invalidateQueries({ queryKey: ["banks"] });
      onClose();
    },
    onError: (err) => toast.error(apiMessage(err, "Could not add account"))
  });

  return (
    <Dialog open onClose={onClose}>
      <DialogHeader title="Add bank account" description="Used for salary credit." />
      <form onSubmit={handleSubmit((v) => add.mutate(v))} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="accountHolderName">Account holder name</Label>
          <Input id="accountHolderName" {...register("accountHolderName", { required: true })} />
          {errors.accountHolderName && (
            <p className="text-xs text-destructive">Required</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="bankName">Bank</Label>
            <Input id="bankName" {...register("bankName", { required: true })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branchName">Branch</Label>
            <Input id="branchName" {...register("branchName")} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="accountNumber">Account number</Label>
            <Input
              id="accountNumber"
              className="code-chip"
              {...register("accountNumber", { 
                required: "Required",
                pattern: { value: /^\d{6,20}$/, message: "Must be 6-20 digits" }
              })}
            />
            {errors.accountNumber && (
              <p className="text-xs text-destructive">{errors.accountNumber.message as string}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ifscCode">IFSC</Label>
            <Input
              id="ifscCode"
              className="code-chip uppercase"
              {...register("ifscCode", { 
                required: "Required",
                pattern: { value: /^[A-Z]{4}0[A-Z0-9]{6}$/i, message: "Invalid IFSC format" }
              })}
            />
            {errors.ifscCode && (
              <p className="text-xs text-destructive">{errors.ifscCode.message as string}</p>
            )}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" {...register("primary")} />
          Set as primary account
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={add.isPending}>
            {add.isPending && <PixousLoader size="xs" />}
            Add account
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
