import { SessionProvider } from "./_lib/SessionProvider";

// Customer-facing shell. `/` is the storefront + self-service dashboard; it is
// completely separate from the admin console at `/dashboard`.
export default function PortalLayout({ children }) {
  return <SessionProvider>{children}</SessionProvider>;
}
