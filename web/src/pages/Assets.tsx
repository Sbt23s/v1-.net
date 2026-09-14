import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "react-qr-code";
import * as XLSX from "xlsx";
import dayjs from "dayjs";
import {
  Plus, Boxes, QrCode, CheckCircle2, PackageCheck, PackageX, Trash2,
  Download, Eye, CalendarDays
} from "lucide-react";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { useRoster } from "@/hooks/useRoster";
import { todayIso, DATE_MIN, DATE_MAX } from "@/lib/dates";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { PageLoader } from "@/components/ui/page-loader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import type { ApiEnvelope, PageEnvelope, Asset, UserSummary } from "@/types";
import { StatTile, TILE_FILLS } from "@/components/ui/stat-tile";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import { useTableSort } from "@/hooks/useTableSort";
import { Search, UserCheck, Wrench } from "lucide-react";

export default function AssetsPage() {
  const qc = useQueryClient();
  const { user, hasPermission, hasRole } = useAuth();
  const isCto = user?.employeeCode?.toUpperCase() === "PIX-E100";
  const isSysAdmin = hasRole("SUPER_ADMIN") || hasRole("COMPANY_ADMIN") || isCto;
  
  // Can view full equipment inventory: System Admin, CTO, HR (IT_HR / IT_MGR), or ASSET_MANAGE
  const canView = isSysAdmin || hasPermission("ASSET_MANAGE") || hasRole("IT_HR") || hasRole("IT_MGR");
  
  /*
    Who can register and allocate.

    This was System Admin and the CTO alone, while HR could see the inventory
    and do nothing with it -- so the people who actually hand a laptop to a
    joiner had to ask an administrator to record it. The server never agreed
    with that: every write on AssetController is guarded on ASSET_MANAGE, which
    HR holds, so the API would have accepted them all along and only the button
    was missing.

    ASSET_MANAGE is now what the button asks for, which makes the screen say
    what the server already enforced.
  */
  const canManage = isSysAdmin || hasPermission("ASSET_MANAGE");
  const [invSearch, setInvSearch] = useState("");
  const [invStatus, setInvStatus] = useState("ALL");
  const [invCategory, setInvCategory] = useState("ALL");
  const [invHolder, setInvHolder] = useState("ALL");
  // The asset a holder has opened to read in full.
  const [myView, setMyView] = useState<Asset | null>(null);
  const [invPage, setInvPage] = useState(0);
  const [qrAsset, setQrAsset] = useState<Asset | null>(null);
  const [allocateAsset, setAllocateAsset] = useState<Asset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [invFrom, setInvFrom] = useState("");
  const [invTo, setInvTo] = useState("");

  const [searchParams, setSearchParams] = useSearchParams();
  const lookupCode = searchParams.get("code");

  const lookupAsset = useQuery({
    queryKey: ["assets", "lookup", lookupCode],
    enabled: !!lookupCode,
    queryFn: async () => {
      const res = await api.get<ApiEnvelope<Asset>>(`/assets/lookup?code=${lookupCode}`);
      return res.data.data;
    }
  });

  const mine = useQuery({
    queryKey: ["assets", "mine"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<Asset[]>>("/assets/my-assets")).data.data
  });

  const inventory = useQuery({
    queryKey: ["assets", "inventory"],
    enabled: canView,
    queryFn: async () => {
      const res = await api.get<PageEnvelope<Asset>>("/assets?size=1000");
      return res.data?.content || [];
    }
  });

  const acknowledge = useMutation({
    mutationFn: async (id: number) => api.post(`/assets/${id}/acknowledge`),
    onSuccess: () => {
      toast.success("Receipt acknowledged");
      qc.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Could not acknowledge"))
  });

  const deleteAsset = useMutation({
    mutationFn: async (id: number) => api.delete(`/assets/${id}`),
    onSuccess: () => {
      toast.success("Asset deleted");
      qc.invalidateQueries({ queryKey: ["assets"] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(apiMessage(err, "Could not delete asset"))
  });

  /** The inventory as the table shows it: searched, filtered, then paged. */
  const invAll = inventory.data ?? [];
  const invStats = useMemo(() => {
    const by = (fn: (a: Asset) => boolean) => invAll.filter(fn).length;
    const stock = (a: Asset) => a.status === "IN_STOCK" || a.status === "AVAILABLE";
    // Out of stock means there is none left to give out: the status says so, or
    // the count has reached zero. Both are the same thing to whoever is asking.
    const outOfStock = (a: Asset) => a.status === "OUT_OF_STOCK" || (a.quantity ?? 1) <= 0;
    return {
      total: invAll.length,
      units: invAll.reduce((n, a) => n + (a.quantity ?? 1), 0),
      inStock: by((a) => stock(a) && !outOfStock(a)),
      allocated: by((a) => a.status === "ALLOCATED" || a.status === "ASSIGNED" || !!a.assignedTo),
      outOfStock: by(outOfStock)
    };
  }, [invAll]);

  // Names for the "Allocated to" column and filter. The allocate dialog already
  // reads this list, so it is usually in cache by the time it is needed here.
  const peopleQ = useRoster(canView);
  const nameById = useMemo(() => {
    const m = new Map<number, string>();
    (peopleQ.data ?? []).forEach((u) => m.set(u.id, u.name));
    return m;
  }, [peopleQ.data]);

  /** Everyone currently holding at least one asset, with how many. */
  const holders = useMemo(() => {
    const counts = new Map<number, number>();
    invAll.forEach((a) => {
      if (a.assignedTo) counts.set(a.assignedTo, (counts.get(a.assignedTo) ?? 0) + 1);
    });
    return Array.from(counts, ([id, count]) => ({
      id, count, name: nameById.get(id) ?? `#${id}`
    })).sort((x, y) => x.name.localeCompare(y.name));
  }, [invAll, nameById]);

  const invCategories = useMemo(
    () => [...new Set(invAll.map((a) => a.category).filter(Boolean))].sort(),
    [invAll]
  );
  const invStatuses = useMemo(
    () => [...new Set(invAll.map((a) => a.status).filter(Boolean))].sort(),
    [invAll]
  );

  const invRows = useMemo(() => {
    const needle = invSearch.trim().toLowerCase();
    return invAll.filter((a) => {
      if (invStatus !== "ALL" && a.status !== invStatus) return false;
      if (invCategory !== "ALL" && a.category !== invCategory) return false;
      if (invHolder !== "ALL" && String(a.assignedTo ?? "") !== invHolder) return false;
      // Purchased between these dates. An asset with no purchase date recorded
      // is left out while a window is set: it cannot be shown to fall inside
      // one, and guessing either way would be wrong.
      if (invFrom || invTo) {
        const day = String(a.purchaseDate ?? "").slice(0, 10);
        if (!day) return false;
        if (invFrom && day < invFrom) return false;
        if (invTo && day > invTo) return false;
      }
      if (!needle) return true;
      return `${a.assetCode ?? ""} ${a.assetType ?? ""} ${a.brand ?? ""} ${a.model ?? ""} ${a.serialNumber ?? ""}`
        .toLowerCase().includes(needle);
    });
  }, [invAll, invSearch, invStatus, invCategory, invHolder, invFrom, invTo]);

  const invSort = useTableSort<any>(invRows, (row, key) => {
    switch (key) {
      case "code": return row.assetCode ?? "";
      case "type": return row.assetType ?? "";
      case "category": return row.category ?? "";
      case "status": return row.status ?? "";
      case "holder": return nameById.get(row.assignedTo) ?? "";
      case "stock": return Number(row.quantity ?? 0);
      case "warranty": return row.warrantyEnd ?? "";
      case "purchased": return row.purchaseDate ?? "";
      default: return "";
    }
  });
  const invSorted = invSort.sorted;

  // The shared hook rather than a hand-rolled slice, so the inventory gains the
  // page numbers and the rows-per-page choice like every other table.
  const invPaged = usePagedRows(invSorted, 15, [invSearch, invStatus, invCategory, invHolder, invFrom, invTo, invSort.key, invSort.dir]);
  const invPageRows = invPaged.pageRows;

  // The employee's own equipment pages the same way. Somebody holding a laptop,
  // a phone, a headset and a monitor is common; a long list here is not.
  const minePaged = usePagedRows(mine.data ?? [], 15, [mine.data]);

  return (
    <div>
      <PageHeader
        title="Assets"
        subtitle={canManage
          ? "The full equipment inventory — System Admin registers and allocates equipment."
          : "The full equipment inventory — view stock levels and allocations."}
        actions={
          canView ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setExportOpen(true)}>
                <Download className="h-4 w-4 mr-2" /> Export
              </Button>
              {canManage && (
                <Button onClick={() => setRegisterOpen(true)}>
                  <Plus className="h-4 w-4" /> Register asset
                </Button>
              )}
            </div>
          ) : null
        }
      />

      {/* My assets — not shown to HR */}
      {!canManage && (
        <>
          <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Assigned to me
          </h2>
          {mine.isLoading ? (
            <PageLoader text="Loading your assigned assets..." className="min-h-[200px]" />
          ) : (mine.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={Boxes}
              title="No assets assigned"
              description="Equipment allocated to you will appear here."
            />
          ) : (
            <Card className="mb-8">
              <CardContent className="p-0 overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr className="border-b border-slate-300 dark:border-slate-700 bg-card text-left text-xs font-semibold text-slate-800 dark:text-slate-200 [&>th]:px-3.5 [&>th]:py-3 [&>th]:border-r [&>th]:border-slate-300 dark:[&>th]:border-slate-700 last:[&>th]:border-r-0">
                      <th className="w-14">S.No</th>
                      <th>Asset</th>
                      <th>Asset Code</th>
                      <th>Brand / Model</th>
                      <th>Warranty</th>
                      <th>Purchased</th>
                      <th className="text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {minePaged.pageRows.map((a, i) => (
                      <tr key={a.id} className="border-b border-slate-200 dark:border-slate-800 align-top last:border-0 hover:bg-muted/60 transition-colors [&>td]:px-3.5 [&>td]:py-3 [&>td]:border-r [&>td]:border-b [&>td]:border-slate-200 dark:[&>td]:border-slate-800 last:[&>td]:border-r-0">
                        <td className="text-muted-foreground">
                          {minePaged.page * minePaged.pageSize + i + 1}
                        </td>
                        <td className="font-medium">{a.assetType || a.category}</td>
                        <td>
                          <span className="code-chip text-xs text-muted-foreground">{a.assetCode}</span>
                        </td>
                        <td className="text-muted-foreground">
                          {[a.brand, a.model].filter(Boolean).join(" ") || "—"}
                        </td>
                        <td className="whitespace-nowrap text-muted-foreground">
                          {warrantyLabel(a.warrantyExpiry)}
                        </td>
                        <td className="whitespace-nowrap text-muted-foreground">
                          {a.purchaseDate ? dayjs(a.purchaseDate).format("DD MMM YYYY") : "—"}
                        </td>
                        <td className="text-right">
                          <Button variant="outline" size="sm" onClick={() => setMyView(a)}>
                            <Eye className="mr-1 h-3.5 w-3.5" /> View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <TablePagination
                  page={minePaged.page} totalPages={minePaged.totalPages} onChange={minePaged.setPage}
                  pageSize={minePaged.pageSize} onPageSizeChange={minePaged.setPageSize}
                  total={minePaged.total}
                  always
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Inventory — HR acts on it, an admin reads it. */}
      {canView && (
        <Card className="mt-8">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Inventory</CardTitle>
              <span className="text-xs text-muted-foreground">
                {invRows.length} of {invStats.total} asset{invStats.total === 1 ? "" : "s"}
                {" · "}{invStats.units} unit{invStats.units === 1 ? "" : "s"} in total
              </span>
            </div>

            {/*
              Filters above the numbers they change.

              These sat under the four tiles, so a search or a status moved
              counts the reader had already scrolled past.
            */}
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search code, type, brand or serial…"
                  className="pl-9"
                  value={invSearch}
                  onChange={(e) => { setInvSearch(e.target.value); setInvPage(0); }}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Status</label>
                <Select
                  value={invStatus}
                  onChange={(e) => { setInvStatus(e.target.value); setInvPage(0); }}
                  className="w-40"
                >
                  <option value="ALL">All statuses</option>
                  {invStatuses.map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Category</label>
                <Select
                  value={invCategory}
                  onChange={(e) => { setInvCategory(e.target.value); setInvPage(0); }}
                  className="w-40"
                >
                  <option value="ALL">All categories</option>
                  {invCategories.map((v) => <option key={v} value={v}>{v}</option>)}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Allocated to
                </label>
                <Select
                  className="h-10 w-56"
                  value={invHolder}
                  onChange={(e) => { setInvHolder(e.target.value); setInvPage(0); }}
                >
                  <option value="ALL">Everyone ({holders.length} holding)</option>
                  {holders.map((h) => (
                    <option key={h.id} value={String(h.id)}>
                      {h.name} — {h.count} asset{h.count === 1 ? "" : "s"}
                    </option>
                  ))}
                </Select>
              </div>
              {/* Purchased between, for narrowing the register to a period. */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Purchased
                </label>
                <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-2 py-[5px]">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Input
                    type="date"
                    aria-label="Purchased from"
                    className="h-[30px] w-[9rem] border-transparent bg-transparent px-1.5 text-xs focus-visible:border-input focus-visible:bg-background"
                    max={invTo || undefined}
                    value={invFrom}
                    onChange={(e) => { setInvFrom(e.target.value); setInvPage(0); }}
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="date"
                    aria-label="Purchased to"
                    className="h-[30px] w-[9rem] border-transparent bg-transparent px-1.5 text-xs focus-visible:border-input focus-visible:bg-background"
                    min={invFrom || undefined}
                    value={invTo}
                    onChange={(e) => { setInvTo(e.target.value); setInvPage(0); }}
                  />
                </div>
              </div>
              {(invSearch || invStatus !== "ALL" || invCategory !== "ALL" || invHolder !== "ALL" || invFrom || invTo) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setInvSearch(""); setInvStatus("ALL"); setInvCategory("ALL");
                    setInvHolder("ALL"); setInvFrom(""); setInvTo(""); setInvPage(0);
                  }}
                >
                  Reset
                </Button>
              )}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                compact label="Total assets" value={invStats.total} icon={Boxes}
                fill={TILE_FILLS.violet} hint="Everything registered"
                active={invStatus === "ALL"} onClick={() => { setInvStatus("ALL"); setInvPage(0); }}
              />
              <StatTile
                compact label="In stock" value={invStats.inStock} icon={PackageCheck}
                fill={TILE_FILLS.green} hint="Ready to allocate"
              />
              <StatTile
                compact label="Allocated" value={invStats.allocated} icon={UserCheck}
                fill={TILE_FILLS.blue} hint="With an employee"
              />
              <StatTile
                compact label="Out of stock" value={invStats.outOfStock} icon={PackageX}
                fill={TILE_FILLS.amber} hint="Nothing left to allocate"
                active={invStatus === "OUT_OF_STOCK"}
                onClick={() => { setInvStatus(invStatus === "OUT_OF_STOCK" ? "ALL" : "OUT_OF_STOCK"); setInvPage(0); }}
              />
            </div>
          </CardHeader>
          <CardContent>
            {inventory.isLoading ? (
              <Skeleton className="h-52" />
            ) : invAll.length === 0 ? (
              <EmptyState title="No assets registered" description="Register your first asset to begin." />
            ) : invRows.length === 0 ? (
              <EmptyState title="Nothing matches these filters" description="Clear the filters above to see the whole inventory." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {canManage && <TableHead className="text-right">Action</TableHead>}
                    <TableHead sortKey="code" activeKey={invSort.key} sortDir={invSort.dir} onSort={invSort.toggle}>Code</TableHead>
                    <TableHead sortKey="type" activeKey={invSort.key} sortDir={invSort.dir} onSort={invSort.toggle}>Type</TableHead>
                    <TableHead sortKey="category" activeKey={invSort.key} sortDir={invSort.dir} onSort={invSort.toggle}>Category</TableHead>
                    <TableHead sortKey="status" activeKey={invSort.key} sortDir={invSort.dir} onSort={invSort.toggle}>Status</TableHead>
                    <TableHead sortKey="holder" activeKey={invSort.key} sortDir={invSort.dir} onSort={invSort.toggle}>Allocated to</TableHead>
                    <TableHead className="text-right" sortKey="stock" activeKey={invSort.key} sortDir={invSort.dir} onSort={invSort.toggle}>Stock</TableHead>
                    <TableHead sortKey="warranty" activeKey={invSort.key} sortDir={invSort.dir} onSort={invSort.toggle}>Warranty</TableHead>
                    <TableHead sortKey="purchased" activeKey={invSort.key} sortDir={invSort.dir} onSort={invSort.toggle}>Purchased</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invPageRows.map((a) => (
                    <TableRow key={a.id}>
                      {canManage && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={() => setDeleteTarget(a)}
                            title="Delete asset"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                      )}
                      <TableCell className="code-chip">{a.assetCode}</TableCell>
                      <TableCell>{a.assetType || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{a.category}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(a.status)}>{a.status}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {a.assignedTo ? (
                          <span className="font-semibold">{nameById.get(a.assignedTo) ?? `#${a.assignedTo}`}</span>
                        ) : canManage && a.status === "IN_STOCK" ? (
                          <Button variant="outline" size="sm" className="h-7 text-xs font-semibold" onClick={() => setAllocateAsset(a)}>
                            <PackageCheck className="h-3.5 w-3.5 mr-1 text-primary" /> Allocate
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{a.quantity ?? 1}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {warrantyLabel(a.warrantyExpiry)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {a.purchaseDate ? dayjs(a.purchaseDate).format("DD MMM YYYY") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
          {invAll.length > 0 && (
            <div className="border-t">
              <div className="px-4 py-2 text-xs text-muted-foreground">
                Showing {invPageRows.length} of {invRows.length} asset{invRows.length === 1 ? "" : "s"}
              </div>
              <TablePagination
                page={invPaged.page} totalPages={invPaged.totalPages} onChange={invPaged.setPage}
                pageSize={invPaged.pageSize} onPageSizeChange={invPaged.setPageSize}
                total={invPaged.total}
                always
              />
            </div>
          )}
        </Card>
      )}

      {/* QR dialog */}
      <Dialog open={qrAsset != null} onClose={() => setQrAsset(null)} className="max-w-sm">
        {qrAsset && (
          <div className="text-center">
            <DialogHeader title={qrAsset.assetType || qrAsset.category} />
            <div className="mx-auto w-fit rounded-lg bg-white p-4">
              <QRCode value={`${window.location.origin}/assets?code=${qrAsset.assetCode}`} size={180} />
            </div>
            <div className="code-chip mt-3 text-sm text-muted-foreground">{qrAsset.assetCode}</div>
            <p className="mt-2 text-xs text-muted-foreground">
              Scan to look up this asset's details and service history.
            </p>
          </div>
        )}
      </Dialog>

      {allocateAsset && (
        <AllocateDialog asset={allocateAsset} onClose={() => setAllocateAsset(null)} />
      )}

      {myView && <MyAssetView asset={myView} onClose={() => setMyView(null)} />}

      <Dialog open={deleteTarget != null} onClose={() => setDeleteTarget(null)} className="max-w-sm">
        {deleteTarget && (
          <div>
            <DialogHeader title="Delete asset?" />
            <p className="mt-2 text-sm text-muted-foreground">
              This permanently deletes{" "}
              <span className="font-medium text-foreground">{deleteTarget.assetCode}</span>
              {deleteTarget.assetType ? ` (${deleteTarget.assetType})` : ""} and its allocation
              history. This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                className="bg-red-600 text-white hover:bg-red-700"
                disabled={deleteAsset.isPending}
                onClick={() => deleteAsset.mutate(deleteTarget.id)}
              >
                {deleteAsset.isPending ? (
                  <PixousLoader size="xs" className="mr-2" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Delete
              </Button>
            </div>
          </div>
        )}
      </Dialog>
      {registerOpen && <RegisterDialog onClose={() => setRegisterOpen(false)} />}
      {/*
        The export takes the rows the filters left, in the order the table has
        them. It read the raw inventory, so narrowing to one category and
        exporting still produced the whole register.
      */}
      {exportOpen && <ExportDialog inventoryData={invSorted} onClose={() => setExportOpen(false)} />}

      {lookupCode && (
        <Dialog open onClose={() => setSearchParams({})} className="max-w-md">
          {lookupAsset.isLoading ? (
            <div className="flex flex-col items-center justify-center p-8">
              <PixousLoader size="md" />
              <p className="mt-2 text-sm text-muted-foreground">Loading asset details...</p>
            </div>
          ) : lookupAsset.isError ? (
            <div className="text-center p-4">
              <DialogHeader title="Asset Not Found" />
              <p className="text-sm text-destructive mt-2">Could not load details for asset "{lookupCode}".</p>
              <div className="mt-4 flex justify-end">
                <Button onClick={() => setSearchParams({})}>Close</Button>
              </div>
            </div>
          ) : lookupAsset.data ? (
            <div>
              <DialogHeader
                title={`${lookupAsset.data.brand || ""} ${lookupAsset.data.model || ""}`}
                description={`Asset Code: ${lookupAsset.data.assetCode}`}
              />
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-muted-foreground">Category</span>
                  <span className="font-medium">{lookupAsset.data.category}</span>
                </div>
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-muted-foreground">Type</span>
                  <span className="font-medium">{lookupAsset.data.assetType || "—"}</span>
                </div>
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-muted-foreground">Serial Number</span>
                  <span className="font-medium code-chip">{lookupAsset.data.serialNumber || "—"}</span>
                </div>
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant={statusVariant(lookupAsset.data.status)}>{lookupAsset.data.status}</Badge>
                </div>
                <div className="flex justify-between border-b pb-1.5">
                  <span className="text-muted-foreground">Available Stock</span>
                  <span className="font-medium">{lookupAsset.data.quantity ?? 1}</span>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <Button onClick={() => setSearchParams({})}>Close</Button>
              </div>
            </div>
          ) : null}
        </Dialog>
      )}
    </div>
  );
}

/**
 * How long is left on the warranty, in the words someone would use: a year and
 * a bit, a few months, or that it has already run out.
 */
function warrantyLabel(until?: string) {
  if (!until) return "—";
  const end = dayjs(until);
  const days = end.diff(dayjs(), "day");
  if (days < 0) return `Expired ${end.format("DD MMM YYYY")}`;
  const years = Math.floor(days / 365);
  const months = Math.round((days % 365) / 30);
  const left = years > 0
    ? `${years} yr${years === 1 ? "" : "s"}${months > 0 ? ` ${months} mo` : ""}`
    : `${Math.max(1, months)} mo`;
  return `${left} left · ${end.format("DD MMM YYYY")}`;
}

/** Everything recorded about an asset, for whoever is holding it. */
function MyAssetView({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const rows: [string, string][] = [
    ["Asset code", asset.assetCode || "—"],
    ["Type", asset.assetType || "—"],
    ["Category", asset.category || "—"],
    ["Brand", asset.brand || "—"],
    ["Model", asset.model || "—"],
    ["Serial number", asset.serialNumber || "—"],
    ["Date of purchase", asset.purchaseDate ? dayjs(asset.purchaseDate).format("DD MMM YYYY") : "—"],
    ["Warranty", warrantyLabel(asset.warrantyExpiry)],
    ["Status", asset.status || "—"]
  ];
  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader
        title={asset.assetType || asset.category || "Asset"}
        description="Everything recorded about the equipment you are holding."
      />
      <dl className="divide-y text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4 py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex justify-end pt-3">
        <Button variant="outline" onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}

function AllocateDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState("");

  const employees = useQuery({
    queryKey: ["employees"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<{ content: UserSummary[] }>>("/users?size=1000")).data.data.content ?? []
  });

  const allocate = useMutation({
    mutationFn: async () =>
      api.post(`/assets/${asset.id}/allocate`, { userId: Number(userId) }),
    onSuccess: () => {
      toast.success("Asset allocated");
      qc.invalidateQueries({ queryKey: ["assets"] });
      onClose();
    },
    onError: (err) => toast.error(apiMessage(err, "Could not allocate"))
  });

  return (
    <Dialog open onClose={onClose} className="max-w-sm">
      <DialogHeader
        title={`Allocate ${asset.assetCode}`}
        description="Assign this asset to an employee by selecting their name."
      />
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="userId">Select Employee</Label>
          {employees.isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground h-10 border rounded-md px-3 bg-muted/20">
              <PixousLoader size="xs" /> Loading employees...
            </div>
          ) : (
            <Select
              id="userId"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">Choose an employee...</option>
              {(employees.data ?? [])
                .filter((u) => (u.profileStatus || "ACTIVE") !== "OFFBOARDED")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.employeeCode})
                  </option>
                ))}
            </Select>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!userId || allocate.isPending} onClick={() => allocate.mutate()}>
            {allocate.isPending && <PixousLoader size="xs" className="mr-2" />}
            Allocate
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

interface RegisterForm {
  category: string;
  assetType: string;
  brand: string;
  model: string;
  serialNumber: string;
  quantity: number;
  purchaseDate: string;
  warrantyExpiry: string;
}

function RegisterDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit } = useForm<RegisterForm>({
    defaultValues: { category: "IT", quantity: 1 }
  });

  const create = useMutation({
    mutationFn: async (v: RegisterForm) => api.post("/assets", {
      ...v,
      // Both are optional; an empty date field must not be sent as "".
      purchaseDate: v.purchaseDate || undefined,
      warrantyExpiry: v.warrantyExpiry || undefined
    }),
    onSuccess: () => {
      toast.success("Asset registered");
      qc.invalidateQueries({ queryKey: ["assets"] });
      onClose();
    },
    onError: (err) => toast.error(apiMessage(err, "Could not register asset"))
  });

  return (
    <Dialog open onClose={onClose}>
      <DialogHeader
        title="Register asset"
        description="A unique asset code and QR tag are generated automatically."
      />
      <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Select id="category" required {...register("category")}>
              <option value="IT">IT</option>
              <option value="INFRA">Infrastructure</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assetType">Type</Label>
            <Input id="assetType" required placeholder="Laptop, Excavator…" {...register("assetType")} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="brand">Brand</Label>
            <Input id="brand" required {...register("brand")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model">Model</Label>
            <Input id="model" required {...register("model")} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="serialNumber">Serial number</Label>
            <Input id="serialNumber" className="code-chip" required {...register("serialNumber")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quantity">Quantity (Stock)</Label>
            <Input id="quantity" type="number" min="1" required {...register("quantity", { valueAsNumber: true })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="purchaseDate">Date of purchase</Label>
            {/* Bought in the past, so today is the latest it can be. */}
            <Input id="purchaseDate" type="date" min={DATE_MIN} max={todayIso()} {...register("purchaseDate")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="warrantyExpiry">Warranty until</Label>
            <Input id="warrantyExpiry" type="date" min={DATE_MIN} max={DATE_MAX} {...register("warrantyExpiry")} />
            <p className="text-[11px] text-muted-foreground">
              The date cover runs out. Whoever holds the asset sees how long is left.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending && <PixousLoader size="xs" />}
            Register
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ExportDialog({ inventoryData, onClose }: { inventoryData: Asset[]; onClose: () => void }) {
  const [exportType, setExportType] = useState<"date" | "month">("date");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(""); // YYYY-MM

  const handleExport = () => {
    let filtered = [...inventoryData];

    if (exportType === "date") {
      if (startDate) {
        filtered = filtered.filter(a => a.createdAt && dayjs(a.createdAt).isAfter(dayjs(startDate).startOf('day')));
      }
      if (endDate) {
        filtered = filtered.filter(a => a.createdAt && dayjs(a.createdAt).isBefore(dayjs(endDate).endOf('day')));
      }
    } else if (exportType === "month" && selectedMonth) {
      filtered = filtered.filter(a => a.createdAt && dayjs(a.createdAt).format("YYYY-MM") === selectedMonth);
    }

    if (filtered.length === 0) {
      toast.error("No assets found for the selected filter.");
      return;
    }

    // Map details for excel sheet
    const excelData = filtered.map(a => ({
      "Asset Code": a.assetCode,
      "Category": a.category,
      "Type": a.assetType || "—",
      "Brand": a.brand || "—",
      "Model": a.model || "—",
      "Serial Number": a.serialNumber || "—",
      "Status": a.status,
      "Stock Quantity": a.quantity ?? 1,
      "Registration Date": a.createdAt ? dayjs(a.createdAt).format("YYYY-MM-DD HH:mm:ss") : "—"
    }));

    // Generate Excel sheet
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Assets");

    // Auto-adjust column widths
    const maxLens = Object.keys(excelData[0]).map(key => {
      return Math.max(
        key.length,
        ...excelData.map(row => String(row[key as keyof typeof row] || "").length)
      );
    });
    worksheet["!cols"] = maxLens.map(len => ({ wch: len + 3 }));

    XLSX.writeFile(workbook, `assets_export_${dayjs().format("YYYYMMDD_HHmmss")}.xlsx`);
    toast.success("Assets exported successfully!");
    onClose();
  };

  return (
    <Dialog open onClose={onClose} className="max-w-sm">
      <DialogHeader
        title="Export Assets"
        description="Filter assets by date range or month to export to Excel."
      />
      <div className="space-y-4 mt-3">
        <div className="flex gap-4 border-b pb-2">
          <button
            className={`text-sm font-semibold pb-1 border-b-2 transition-colors ${exportType === "date" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
            onClick={() => setExportType("date")}
          >
            Date Range
          </button>
          <button
            className={`text-sm font-semibold pb-1 border-b-2 transition-colors ${exportType === "month" ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}
            onClick={() => setExportType("month")}
          >
            Month Wise
          </button>
        </div>

        {exportType === "date" ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="startDate">Start Date</Label>
              <Input id="startDate" type="date" min={DATE_MIN} max={DATE_MAX} value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endDate">End Date</Label>
              <Input id="endDate" type="date" min={DATE_MIN} max={DATE_MAX} value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="monthSelect">Select Month</Label>
            <Input id="monthSelect" type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleExport}>
            Export
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
