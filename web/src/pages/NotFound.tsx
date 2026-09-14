import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center blueprint-grid p-6 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary">
        <Compass className="h-8 w-8 text-primary-foreground" />
      </div>
      <div className="font-display text-6xl font-bold text-white">404</div>
      <p className="mt-2 max-w-sm text-white/60">
        This page isn't on the blueprint. It may have moved, or the link is off.
      </p>
      <Link to="/" className="mt-6">
        <Button>Back to dashboard</Button>
      </Link>
    </div>
  );
}
