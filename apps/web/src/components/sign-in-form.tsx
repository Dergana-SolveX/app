import { Button } from "@solvex-dergana/ui/components/button";
import { Input } from "@solvex-dergana/ui/components/input";
import { Label } from "@solvex-dergana/ui/components/label";
import { Logo } from "@solvex-dergana/ui/components/logo";
import { cn } from "@solvex-dergana/ui/lib/utils";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  BellRingIcon,
  CircleAlertIcon,
  ClipboardCheckIcon,
  EyeIcon,
  EyeOffIcon,
  HospitalIcon,
  Loader2Icon,
  RadioTowerIcon,
} from "lucide-react";
import { useState } from "react";
import z from "zod";

import { authClient } from "@/lib/auth-client";
import { DEMO_PASSWORD, QUICK_LOGINS } from "@/lib/demo-accounts";

import Loader from "./loader";

const STEPS = [
  { icon: RadioTowerIcon, title: "Détection", text: "Puce, téléphone ou témoin signale le choc." },
  { icon: BellRingIcon, title: "Alerte", text: "Elle passe même sans internet, par SMS ou USSD." },
  { icon: ClipboardCheckIcon, title: "Évaluation", text: "Un incident, un triage, une décision humaine." },
  { icon: HospitalIcon, title: "Orientation", text: "Le bon hôpital, prévenu avant l'arrivée." },
];

export default function SignInForm() {
  const navigate = useNavigate();
  const { isPending } = authClient.useSession();
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  async function signIn(email: string, password: string, key: string) {
    setSigningIn(key);
    setError(null);
    const { error } = await authClient.signIn.email({ email, password });
    setSigningIn(null);
    if (error) {
      setError(
        error.message || "Connexion impossible. Vérifiez vos identifiants et la connexion à l'API.",
      );
      return;
    }
    navigate({ to: "/dashboard" });
  }

  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: ({ value }) => signIn(value.email, value.password, "form"),
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

  const busy = signingIn !== null;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Brand panel */}
      <aside
        className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between"
        style={{
          backgroundImage:
            "radial-gradient(60rem 30rem at 0% 0%, color-mix(in srgb, var(--sidebar-primary) 16%, transparent), transparent 60%), linear-gradient(color-mix(in srgb, var(--sidebar-border) 55%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--sidebar-border) 55%, transparent) 1px, transparent 1px)",
          backgroundSize: "auto, 44px 44px, 44px 44px",
        }}
      >
        <Logo inverted />
        <div className="max-w-lg">
          <h2 className="text-4xl leading-[1.1] font-extrabold tracking-tight text-sidebar-accent-foreground">
            Du choc à l'hôpital,
            <br />
            <span className="text-sidebar-primary">sans perdre une minute.</span>
          </h2>
          <ol className="mt-10 space-y-5">
            {STEPS.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="flex items-start gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-sidebar-border bg-sidebar-accent text-sidebar-primary">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-bold text-sidebar-accent-foreground">
                    {i + 1}. {title}
                  </span>
                  <span className="block text-sidebar-muted">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <p className="text-sm text-sidebar-muted">
          SolveX 3.0 · Prototype · Données de démonstration
        </p>
      </aside>

      {/* Form column */}
      <main id="main" className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <Logo className="mb-10 lg:hidden" />
          <h1 className="text-3xl font-extrabold tracking-tight">Connexion</h1>
          <p className="mt-2 text-muted-foreground">Accédez à votre poste de travail.</p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            className="mt-8 space-y-5"
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
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={field.state.meta.errors.length > 0}
                  />
                  {field.state.meta.errors.map((e) => (
                    <p
                      key={e?.message}
                      role="alert"
                      className="text-sm font-medium text-destructive"
                    >
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
                  <div className="relative">
                    <Input
                      id={field.name}
                      name={field.name}
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      className="pe-12"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      aria-invalid={field.state.meta.errors.length > 0}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="absolute inset-e-1.5 top-1.5"
                      aria-label={
                        showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"
                      }
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </Button>
                  </div>
                  {field.state.meta.errors.map((e) => (
                    <p
                      key={e?.message}
                      role="alert"
                      className="text-sm font-medium text-destructive"
                    >
                      {e?.message}
                    </p>
                  ))}
                </div>
              )}
            </form.Field>

            {error && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md border border-sev-red/40 bg-sev-red-soft px-3 py-2.5 text-sm font-medium text-sev-red"
              >
                <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {signingIn === "form" ? (
                <>
                  <Loader2Icon className="animate-spin" /> Connexion…
                </>
              ) : (
                "Se connecter"
              )}
            </Button>
          </form>

          <section aria-labelledby="demo-accounts" className="mt-10">
            <div className="flex items-center gap-3">
              <h2
                id="demo-accounts"
                className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase"
              >
                Accès démo
              </h2>
              <span className="h-px flex-1 bg-border" />
            </div>
            <ul className="mt-4 space-y-2">
              {QUICK_LOGINS.map(({ label, hint, email, icon: Icon }) => (
                <li key={email}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => signIn(email, DEMO_PASSWORD, email)}
                    className={cn(
                      "group flex min-h-14 w-full cursor-pointer items-center gap-3.5 rounded-lg border bg-card px-3.5 py-2.5 text-start transition-colors",
                      "hover:border-primary/60 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
                    )}
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-secondary text-primary group-hover:bg-card">
                      {signingIn === email ? (
                        <Loader2Icon className="size-[1.1rem] animate-spin" aria-hidden="true" />
                      ) : (
                        <Icon className="size-[1.1rem]" aria-hidden="true" />
                      )}
                    </span>
                    <span className="flex-1 leading-tight">
                      <span className="block font-semibold">{label}</span>
                      <span className="block text-sm text-muted-foreground">{hint}</span>
                    </span>
                    <ArrowRightIcon
                      className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-muted-foreground">
              Comptes de démonstration : un clic ouvre l'écran du rôle choisi.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
