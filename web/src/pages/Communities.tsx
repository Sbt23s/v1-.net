import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Plus, Trash2, Check, UserPlus, Phone, Video } from "lucide-react";
import toast from "react-hot-toast";
import { useGroupCall } from "@/hooks/useGroupCall";
import { useCalls } from "@/hooks/useCalls";

import type { ApiEnvelope, PageEnvelope, UserSummary } from "@/types";

interface CommunityGroup {
  id: number;
  name: string;
  description: string;
  isAnnouncement?: boolean;
  announcement?: boolean;
}

function CommunityCard({
  c,
  usersData,
  onboardingIds,
  onDelete
}: {
  c: CommunityGroup;
  usersData: UserSummary[] | undefined;
  onboardingIds: number[] | undefined;
  /** Asks for the community by name, so the dialog can say which one. */
  onDelete: (c: CommunityGroup) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const groupCall = useGroupCall();
  const { callState } = useCalls();

  const { data: members, isLoading, refetch } = useQuery({
    queryKey: ["community_members", c.id],
    queryFn: async () => {
      const res = await api.get<UserSummary[]>(`/communities/${c.id}/members`);
      return res.data;
    }
  });

  /**
   * Ring this community.
   *
   * The room id is the community's own id, so two people starting a call on
   * the same group land in the same call rather than two calls that cannot
   * see each other. The member list is the community's, which is what keeps
   * the call to the group: nobody outside it is sent an invitation.
   */
  const startCommunityCall = async (video: boolean) => {
    const ids = (members ?? []).map((m) => m.id).filter(Boolean);
    if (ids.length === 0) {
      toast.error("This group has no members to call.");
      return;
    }
    try {
      await groupCall.start(`community-${c.id}`, c.name, ids, video);
    } catch (err: any) {
      toast.error(err?.message || "Could not start the group call");
    }
  };

  const addMember = useMutation({
    mutationFn: async (userId: string) => {
      await api.post(`/communities/${c.id}/members`, { userId: Number(userId) });
    },
    onSuccess: () => {
      toast.success("Member added");
      refetch();
    },
    onError: (err) => {
      import("@/lib/api").then(({ apiMessage }) => toast.error(apiMessage(err, "Failed to add member")));
    }
  });

  const removeMember = useMutation({
    mutationFn: async (userId: number) => {
      await api.delete(`/communities/${c.id}/members/${userId}`);
    },
    onSuccess: () => {
      toast.success("Member removed");
      refetch();
    },
    onError: (err) => {
      import("@/lib/api").then(({ apiMessage }) => toast.error(apiMessage(err, "Failed to remove member")));
    }
  });

  // Add-Employees list shows employees who are currently in onboarding OR
  // active (excludes offboarded/inactive), and not already members here.
  const onboardingSet = new Set(onboardingIds ?? []);
  const availableUsers = usersData
    ?.filter(u => !members?.some(m => m.id === u.id))
    .filter(u => onboardingSet.has(u.id) || u.profileStatus === "ACTIVE");

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4 border-b">
        <div>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Users className="w-5 h-5 text-primary" />
            {c.name}
          </CardTitle>
          <CardDescription className="mt-1">{c.description}</CardDescription>
          <p className="text-xs text-muted-foreground mt-1">{members?.length ?? 0} members</p>
          {/*
            The warning is about ordinary rooms, and it was shown on the
            announcement channel too -- where it is simply false. An
            announcement is visible to everybody in the company regardless of
            its member list: CommunityService returns it to every viewer, not
            only to members. So the amber line told HR nobody could see the one
            channel everybody can, and invited them to "fix" it by adding
            people who already had it.
          */}
          {!isLoading && !c.isAnnouncement && (members?.length ?? 0) <= 1 && (
            <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
              Only you are in this group, so nobody else can see it. Add people
              with Manage members.
            </p>
          )}
          {c.isAnnouncement && (
            <p className="mt-1 text-xs text-muted-foreground">
              Visible to everyone in the company. The member list controls who
              is rung on a call, not who can read it.
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/*
            Call this group.

            Only the people in it are rung -- the member list this card already
            loaded is the guest list, so nobody outside the community is
            invited into its call. Disabled while any other call is running,
            because one browser can only hold one.
          */}
          <Button
            variant="ghost"
            size="icon"
            title={`Voice call ${c.name}`}
            disabled={!members?.length || groupCall.state !== "idle" || callState !== "idle"}
            onClick={() => startCommunityCall(false)}
            className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40"
          >
            <Phone className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={`Video call ${c.name}`}
            disabled={!members?.length || groupCall.state !== "idle" || callState !== "idle"}
            onClick={() => startCommunityCall(true)}
            className="text-sky-600 hover:bg-sky-50 hover:text-sky-700 disabled:opacity-40"
          >
            <Video className="w-4 h-4" />
          </Button>
          {expanded ? (
            <Button size="sm" onClick={() => setExpanded(false)}>
              <Check className="w-4 h-4 mr-1" /> Confirm
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>
              <UserPlus className="w-4 h-4 mr-1" /> Manage members
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="text-red-500 hover:text-red-600 hover:bg-red-50"
            onClick={() => onDelete(c)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      {expanded && (
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
        {/* Left Column: Add Employees */}
        <div>
          <h4 className="font-semibold text-sm mb-3 text-muted-foreground">
            Add Employees <span className="text-[10px] font-normal text-primary">(onboarding &amp; active)</span>
          </h4>
          <div className="max-h-64 overflow-y-auto space-y-2 border rounded-lg p-3 bg-muted/40">
            {availableUsers?.map(u => (
              <div key={u.id} className="flex justify-between items-center text-sm border-b pb-2 last:border-0 last:pb-0 border-slate-100">
                <div>
                   <p className="font-medium text-xs text-slate-800">{u.name}</p>
                   <p className="text-[10px] text-muted-foreground">{u.employeeCode} {u.departmentId ? `• Dept ${u.departmentId}` : ''}</p>
                </div>
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="h-7 px-2.5 text-xs font-normal"
                  onClick={() => addMember.mutate(String(u.id))}
                  disabled={addMember.isPending}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add
                </Button>
              </div>
            ))}
            {availableUsers?.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                All onboarding &amp; active employees have been added.
              </p>
            )}
          </div>
        </div>

        {/* Right Column: Group Members */}
        <div>
          <h4 className="font-semibold text-sm mb-3 text-muted-foreground">
            Group Members ({members?.length || 0})
          </h4>
          <div className="max-h-64 overflow-y-auto space-y-2 border rounded-lg p-3 bg-muted/40">
            {isLoading ? (
              <div className="flex justify-center py-4">
                <PixousLoader size="sm" />
              </div>
            ) : (
              members?.map(m => (
                <div key={m.id} className="flex justify-between items-center text-sm border-b pb-2 last:border-0 last:pb-0 border-slate-100">
                  <div>
                     <p className="font-medium text-xs text-slate-800">{m.name}</p>
                     <p className="text-[10px] text-muted-foreground">{m.employeeCode}</p>
                  </div>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="h-7 px-2 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 font-normal"
                    onClick={() => removeMember.mutate(m.id)}
                    disabled={removeMember.isPending}
                  >
                    Remove
                  </Button>
                </div>
              ))
            )}
            {!isLoading && members?.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No members in this group yet.</p>
            )}
          </div>
        </div>
      </CardContent>
      )}
    </Card>
  );
}

export default function CommunitiesPage() {
  const qc = useQueryClient();
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [isAnnouncement, setIsAnnouncement] = useState(false);

  const { data: communities, isLoading: isLoadingCommunities } = useQuery({
    queryKey: ["admin_communities"],
    queryFn: async () => {
      const res = await api.get<CommunityGroup[]>("/communities");
      return res.data;
    }
  });

  const { data: usersData, isLoading: isLoadingUsers } = useQuery({
    queryKey: ["all_users_for_community"],
    queryFn: async () => {
      const res = await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>("/users?size=1000");
      return res.data.data.content;
    }
  });

  // Employees currently in onboarding — announcement channels only add these.
  const { data: onboardingIds } = useQuery({
    queryKey: ["onboarding_employee_ids"],
    queryFn: async () => {
      const res = await api.get<ApiEnvelope<number[]>>("/onboarding/employees");
      return res.data.data;
    }
  });

  const createGroup = useMutation({
    mutationFn: async () => {
      await api.post("/communities", { 
        name: newGroupName, 
        description: newGroupDesc,
        /*
         * The server binds this through Lombok, which names the property
         * "announcement" -- a body saying "isAnnouncement" is quietly
         * ignored, so the tick box never took effect and every channel was
         * created as an ordinary private group. Send both names: the one the
         * server reads, and the original for anything else that expects it.
         */
        announcement: isAnnouncement,
        isAnnouncement: isAnnouncement
      });
    },
    onSuccess: () => {
      /*
       * Creating a group only puts you in it. Until members are added nobody
       * else can see it, which looks exactly like the group failing to save.
       * Say the next step out loud rather than leaving it to be discovered.
       */
      toast.success(
        "Community created. Open Manage members to add people -- until then only you can see it.",
        { duration: 6000 },
      );
      setNewGroupName("");
      setNewGroupDesc("");
      setIsAnnouncement(false);
      qc.invalidateQueries({ queryKey: ["admin_communities"] });
    },
    onError: (err) => {
      import("@/lib/api").then(({ apiMessage }) => toast.error(apiMessage(err, "Failed to create group")));
    }
  });

  const deleteGroup = useMutation({
    mutationFn: async (groupId: number) => {
      await api.delete(`/communities/${groupId}`);
    },
    onSuccess: () => {
      toast.success("Community deleted");
      qc.invalidateQueries({ queryKey: ["admin_communities"] });
    },
    onError: (err) => {
      import("@/lib/api").then(({ apiMessage }) => toast.error(apiMessage(err, "Failed to delete group")));
    }
  });

  /*
    Asking in the application's own dialog rather than the browser's.

    window.confirm draws in the browser chrome -- a grey strip with the site's
    hostname above it, no styling, no theme, and no room to say which community
    is about to go. It also blocks the whole tab. Every other destructive action
    in the portal already asks properly; these two were the last that did not.

    Which one, by name: "this community" is not enough to check against when
    six of them are on screen.
  */
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);

  if (isLoadingCommunities || isLoadingUsers) {
    return (
      <div className="flex justify-center p-8">
        <PixousLoader size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-display font-bold">Community Groups</h1>
        <p className="text-muted-foreground mt-1">
          Create groups and choose who is in them. A group is only visible to its
          members — anyone on the staff can be added.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create New Community</CardTitle>
          <CardDescription>Start a new group chat channel.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input 
            placeholder="Group Name (e.g. Engineering)" 
            value={newGroupName} 
            onChange={e => setNewGroupName(e.target.value)} 
          />
          <Input 
            placeholder="Description" 
            value={newGroupDesc} 
            onChange={e => setNewGroupDesc(e.target.value)} 
          />
          <div className="flex items-center space-x-2 py-1">
            <input 
              type="checkbox" 
              id="isAnnouncement" 
              checked={isAnnouncement}
              onChange={e => setIsAnnouncement(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
            />
            <label htmlFor="isAnnouncement" className="text-sm font-medium leading-none cursor-pointer text-muted-foreground select-none">
              Announcement Channel (Only Admin/HR can post)
            </label>
          </div>
          <Button 
            disabled={!newGroupName || createGroup.isPending} 
            /*
              No confirmation on create. It asked "are you sure you want to
              create X" about a name the person had just typed into the box
              beside it, and an empty new group is undone by deleting it. A
              prompt in front of a reversible action teaches people to click
              through prompts.
            */
            onClick={() => createGroup.mutate()}
          >
            {createGroup.isPending ? <PixousLoader size="xs" className="mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
            Create
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {communities?.map(c => (
          <CommunityCard
            key={c.id}
            c={c}
            usersData={usersData}
            onboardingIds={onboardingIds}
            onDelete={(g) => setConfirmDelete({ id: g.id, name: g.name })}
          />
        ))}
        {communities?.length === 0 && (
          <p className="text-muted-foreground text-center py-6">No community groups created yet.</p>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title={`Delete "${confirmDelete?.name ?? ""}"?`}
        description={
          "The group and its message history go with it, for everyone in it. "
          + "This cannot be undone."
        }
        confirmLabel="Delete community"
        cancelLabel="Keep it"
        busy={deleteGroup.isPending}
        onConfirm={() => {
          if (confirmDelete) deleteGroup.mutate(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
