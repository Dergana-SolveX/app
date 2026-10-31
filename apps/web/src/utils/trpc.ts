import type { AppRouter } from "@solvex-dergana/api/routers/index";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { toast } from "sonner";

import { ENV } from "../env";

function getServerUrl(url: string) {
  const processEnv = typeof process === "undefined" ? undefined : process.env;
  if (typeof window === "undefined" && processEnv?.SERVER_URL) {
    return processEnv.SERVER_URL.endsWith("/")
      ? processEnv.SERVER_URL.slice(0, -1)
      : processEnv.SERVER_URL;
  }

  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      toast.error(error.message, {
        action: {
          label: "Réessayer",
          onClick: () => {
            query.invalidate();
          },
        },
      });
    },
  }),
});

const serverUrl = `${getServerUrl(ENV.VITE_SERVER_URL)}/trpc`;

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      // Live streams (dispatcher incidents) use Server-Sent Events; everything else is batched HTTP.
      condition: (op) => op.type === "subscription",
      true: httpSubscriptionLink({
        url: serverUrl,
        eventSourceOptions: () => ({ withCredentials: true }),
      }),
      false: httpBatchLink({
        url: serverUrl,
        fetch(url, options) {
          return fetch(url, {
            ...options,
            credentials: "include",
          });
        },
      }),
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
