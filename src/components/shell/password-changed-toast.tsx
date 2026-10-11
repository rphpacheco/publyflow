"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

// One-time confirmation after a password change (/pipeline?senha=ok).
export function PasswordChangedToast() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const done = React.useRef(false);
  const flagged = params.get("senha") === "ok";

  React.useEffect(() => {
    if (!flagged || done.current) return;
    done.current = true;
    toast.success("Senha definida.");
    router.replace(pathname);
  }, [flagged, pathname, router]);

  return null;
}
