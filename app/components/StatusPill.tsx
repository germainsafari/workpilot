export function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status.toLowerCase().replaceAll(" ", "-")}`}><span />{status}</span>;
}
