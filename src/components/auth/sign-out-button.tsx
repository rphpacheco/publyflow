import { Button } from "@/components/ui/button";

type ButtonProps = React.ComponentProps<typeof Button>;

export function SignOutButton({
  label,
  variant = "outline",
  size,
}: {
  label: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  return (
    <form action="/auth/signout" method="post">
      <Button type="submit" variant={variant} size={size}>
        {label}
      </Button>
    </form>
  );
}
