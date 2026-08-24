export function StartupLoading() {
  return (
    <main
      data-testid="reader-startup-loading"
      aria-busy="true"
      aria-live="polite"
      className="flex h-dvh w-dvw items-center justify-center bg-background text-foreground"
    >
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
        Preparing deterministic reader fonts...
      </div>
    </main>
  );
}
