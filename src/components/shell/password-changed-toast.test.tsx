// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const { toastSuccess, replace, params } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  replace: vi.fn(),
  params: { value: new URLSearchParams() },
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => params.value,
  usePathname: () => "/pipeline",
  useRouter: () => ({ replace }),
}));

import { PasswordChangedToast } from "./password-changed-toast";

describe("PasswordChangedToast", () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    replace.mockReset();
  });

  it("toasts once and clears the param", () => {
    params.value = new URLSearchParams("senha=ok");
    const { rerender } = render(<PasswordChangedToast />);
    rerender(<PasswordChangedToast />);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("Senha definida.");
    expect(replace).toHaveBeenCalledWith("/pipeline");
  });

  it("does nothing without the param", () => {
    params.value = new URLSearchParams("outro=1");
    render(<PasswordChangedToast />);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
