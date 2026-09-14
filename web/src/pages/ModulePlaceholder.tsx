import { Link } from "react-router-dom";
import { Construction, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * Rendered for modules that are modelled and API-scaffolded on the backend but
 * whose dedicated UI is not part of this build. Keeps navigation complete and
 * documents exactly where each capability lives.
 */
export function ModulePlaceholder({
  title,
  summary,
  endpoints
}: {
  title: string;
  summary: string;
  endpoints?: string[];
}) {
  return (
    <div>
      <PageHeader title={title} subtitle={summary} />
      <Card>
        <CardContent className="p-8">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/20">
            <Construction className="h-6 w-6 text-primary" />
          </div>
          <h2 className="font-display text-lg font-semibold">Scaffolded module</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            The data model and backend foundations for this area are in place. The dedicated
            screen is planned for a later iteration — the API surface below is ready to build on.
          </p>

          {endpoints && endpoints.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {endpoints.map((e) => (
                <Badge key={e} variant="secondary" className="code-chip">
                  {e}
                </Badge>
              ))}
            </div>
          )}

          <Link to="/" className="mt-6 inline-block">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4" /> Back to dashboard
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
