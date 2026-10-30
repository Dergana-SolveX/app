import { Button } from "@solvex-dergana/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@solvex-dergana/ui/components/card";
import { Input } from "@solvex-dergana/ui/components/input";
import { Label } from "@solvex-dergana/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { DEMO_PASSWORD, QUICK_LOGINS } from "@/lib/demo-accounts";

import Loader from "./loader";

export default function SignInForm() {
  const navigate = useNavigate();
  const { isPending } = authClient.useSession();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(email: string, password: string) {
    setSigningIn(true);
    setError(null);
    const { error } = await authClient.signIn.email({ email, password });
    setSigningIn(false);
    if (error) {
      setError(error.message || "Connexion impossible. Vérifiez vos identifiants.");
      return;
    }
    navigate({ to: "/dashboard" });
  }

  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: ({ value }) => signIn(value.email, value.password),
    validators: {
      onSubmit: z.object({
        email: z.email("Adresse e-mail invalide"),
        password: z.string().min(8, "Le mot de passe contient au moins 8 caractères"),
      }),
    },
  });

  if (isPending) {
    return <Loader />;
  }

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md items-center p-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-xl">SVX Rescue</CardTitle>
          <CardDescription>Réponse aux urgences routières. Connectez-vous pour continuer.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            className="space-y-4"
            noValidate
          >
            <form.Field name="email">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Adresse e-mail</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    autoComplete="username"
                    className="h-11"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={field.state.meta.errors.length > 0}
                  />
                  {field.state.meta.errors.map((e) => (
                    <p key={e?.message} role="alert" className="text-destructive">
                      {e?.message}
                    </p>
                  ))}
                </div>
              )}
            </form.Field>

            <form.Field name="password">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Mot de passe</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="password"
                    autoComplete="current-password"
                    className="h-11"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={field.state.meta.errors.length > 0}
                  />
                  {field.state.meta.errors.map((e) => (
                    <p key={e?.message} role="alert" className="text-destructive">
                      {e?.message}
                    </p>
                  ))}
                </div>
              )}
            </form.Field>

            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="h-11 w-full cursor-pointer" disabled={signingIn}>
              {signingIn ? "Connexion…" : "Se connecter"}
            </Button>
          </form>

          <section aria-labelledby="demo-accounts" className="space-y-3 border-t pt-4">
            <div>
              <h2 id="demo-accounts" className="font-medium">
                Comptes de démonstration
              </h2>
              <p className="text-muted-foreground">Un clic pour entrer avec le rôle choisi.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_LOGINS.map((q) => (
                <Button
                  key={q.email}
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 cursor-pointer flex-col items-start gap-0.5 py-2 text-left"
                  disabled={signingIn}
                  onClick={() => signIn(q.email, DEMO_PASSWORD)}
                >
                  <span className="font-medium">{q.label}</span>
                  <span className="text-muted-foreground font-normal">{q.hint}</span>
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground">Données de démonstration.</p>
          </section>
        </CardContent>
      </Card>
    </main>
  );
}
