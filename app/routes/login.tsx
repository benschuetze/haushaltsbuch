import { data, Form, useActionData, useSearchParams } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { logIn, passwordMatches } from "~/lib/auth.server";
import type { Route } from "./+types/login";

export const meta: Route.MetaFunction = () => [{ title: "Anmelden · Haushaltsbuch" }];

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  if (!passwordMatches(password)) {
    return data({ error: "Passwort stimmt nicht." }, { status: 400 });
  }
  return logIn(String(form.get("next") ?? "/"));
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  const [params] = useSearchParams();
  return (
    <div className="mx-auto mt-16 max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold">Haushaltsbuch</h1>
      <Form method="post" className="space-y-4">
        <input type="hidden" name="next" value={params.get("next") ?? "/"} />
        <div className="space-y-2">
          <Label htmlFor="password">Passwort</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            aria-invalid={actionData?.error ? true : undefined}
            aria-describedby={actionData?.error ? "password-error" : undefined}
          />
          {actionData?.error ? (
            <p id="password-error" role="alert" className="text-sm text-destructive">
              {actionData.error}
            </p>
          ) : null}
        </div>
        <Button type="submit" className="w-full">
          Anmelden
        </Button>
      </Form>
    </div>
  );
}
