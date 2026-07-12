'use client'

export default function OfflinePage() {
  return (
    <div className="min-h-screen grid place-items-center bg-background p-6">
      <div className="text-center max-w-sm">
        <div className="mx-auto mb-6 size-20 rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-700 grid place-items-center shadow-lg">
          <svg viewBox="0 0 24 24" fill="none" className="size-10">
            <path d="M6 5.5v13" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
            <path d="M6 12l7-6.5M6 12l7 6.5" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-foreground mb-2">You're offline</h1>
        <p className="text-sm text-muted-foreground mb-6">
          KhataPro ERP needs an internet connection to load your financial data. Please check your connection and try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium press-sm"
        >
          Retry
        </button>
        <p className="text-[10px] text-muted-foreground mt-8">
          Financial writes are never queued offline. All accounting entries require a live server connection.
        </p>
      </div>
    </div>
  );
}
