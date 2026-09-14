import React from 'react';
import { PixousLoader } from '@/components/ui/pixous-loader';

interface PageLoaderProps {
  text?: string;
  className?: string;
}

export function PageLoader({ text = "Loading page details...", className = "" }: PageLoaderProps) {
  return (
    <div className={`flex flex-col h-full w-full items-center justify-center min-h-[50vh] gap-4 p-6 ${className}`}>
      <PixousLoader size="xl" />
      {text && (
        <p className="text-sm font-medium text-muted-foreground tracking-wide">
          {text}
        </p>
      )}
    </div>
  );
}
